#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const repoRoot = process.cwd();
const defaultRuntimeRoot = path.resolve(process.env.SUPER_AGENTS_RUNTIME_ROOT || path.join(repoRoot, "vendor", "runtime"));
const defaultManifestPath = path.join(defaultRuntimeRoot, "manifest.json");
const metadataFile = ".super-agents-runtime.json";

function usage() {
  return `Usage: node scripts/install-runtime.mjs [options]

Downloads the pinned runtime assets from vendor/runtime/manifest.json, verifies
SHA256 checksums, and installs them into vendor/runtime.

Options:
  --all                    Install every manifest asset (default).
  --current                Install only the current platform and architecture.
  --platform <platform>    Filter assets by platform, for example darwin or win32.
  --arch <arch>            Filter assets by architecture, for example arm64 or x64.
  --runtime-root <path>    Runtime output root. Defaults to vendor/runtime.
  --manifest <path>        Runtime manifest path. Defaults to vendor/runtime/manifest.json.
  --force                  Reinstall even when matching metadata exists.
  --dry-run                Print the install plan as JSON without downloading.
  -h, --help               Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    all: false,
    current: false,
    dryRun: false,
    force: false,
    runtimeRoot: defaultRuntimeRoot,
    manifestPath: defaultManifestPath,
    platform: "",
    arch: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--current") {
      options.current = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--runtime-root") {
      options.runtimeRoot = path.resolve(requiredValue(argv, ++index, arg));
    } else if (arg === "--manifest") {
      options.manifestPath = path.resolve(requiredValue(argv, ++index, arg));
    } else if (arg === "--platform") {
      options.platform = requiredValue(argv, ++index, arg);
    } else if (arg === "--arch") {
      options.arch = requiredValue(argv, ++index, arg);
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.current && (options.platform || options.arch)) {
    throw new Error("--current cannot be combined with --platform or --arch");
  }

  return options;
}

function requiredValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

async function readManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error(`Invalid runtime manifest: ${manifestPath}`);
  }
  return manifest;
}

function selectAssets(assets, options) {
  if (options.current) {
    return assets.filter((asset) => asset.platform === process.platform && asset.arch === process.arch);
  }

  if (options.platform || options.arch) {
    return assets.filter(
      (asset) => (!options.platform || asset.platform === options.platform) && (!options.arch || asset.arch === options.arch),
    );
  }

  return assets;
}

function validateAsset(asset) {
  const required = ["id", "kind", "platform", "arch", "version", "url", "sha256", "archive", "destination"];
  for (const key of required) {
    if (typeof asset[key] !== "string" || !asset[key]) {
      throw new Error(`Manifest asset ${asset.id || "<unknown>"} is missing ${key}`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`Manifest asset ${asset.id} has an invalid sha256`);
  }
  if (!["tar.gz", "zip"].includes(asset.archive)) {
    throw new Error(`Manifest asset ${asset.id} has unsupported archive ${asset.archive}`);
  }
  if (path.isAbsolute(asset.destination) || asset.destination.includes("..")) {
    throw new Error(`Manifest asset ${asset.id} has unsafe destination ${asset.destination}`);
  }
}

function destinationPath(runtimeRoot, asset) {
  return path.join(runtimeRoot, asset.destination);
}

function installPlan(runtimeRoot, manifestPath, assets, dryRun) {
  return {
    dryRun,
    runtimeRoot,
    manifestPath,
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      platform: asset.platform,
      arch: asset.arch,
      version: asset.version,
      url: asset.url,
      sha256: asset.sha256,
      destination: destinationPath(runtimeRoot, asset),
    })),
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isInstalled(destination, asset) {
  const metadataPath = path.join(destination, metadataFile);
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    return metadata.id === asset.id && metadata.version === asset.version && metadata.sha256 === asset.sha256;
  } catch {
    return false;
  }
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.stdio || "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function extractArchive(asset, archivePath, extractRoot) {
  await mkdir(extractRoot, { recursive: true });
  if (asset.archive === "tar.gz") {
    await run("tar", ["-xzf", archivePath, "-C", extractRoot]);
    return;
  }

  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(extractRoot)} -Force`,
    ]);
    return;
  }

  await run("unzip", ["-q", archivePath, "-d", extractRoot]);
}

async function stripSourceRoot(extractRoot, stripComponents) {
  let current = extractRoot;
  for (let index = 0; index < stripComponents; index += 1) {
    const entries = (await readdir(current, { withFileTypes: true })).filter((entry) => entry.name !== "__MACOSX");
    if (entries.length !== 1 || !entries[0].isDirectory()) {
      throw new Error(`Cannot strip ${stripComponents} component(s) from ${extractRoot}`);
    }
    current = path.join(current, entries[0].name);
  }
  return current;
}

async function moveDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await rename(source, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await cp(source, destination, { recursive: true });
    await rm(source, { recursive: true, force: true });
  }
}

async function chmodExecutables(destination, asset) {
  for (const executablePath of asset.executablePaths || []) {
    const target = path.join(destination, executablePath);
    if (await exists(target)) {
      await chmod(target, 0o755);
    }
  }
}

async function writeMetadata(destination, asset) {
  await writeFile(
    path.join(destination, metadataFile),
    JSON.stringify(
      {
        id: asset.id,
        kind: asset.kind,
        platform: asset.platform,
        arch: asset.arch,
        version: asset.version,
        url: asset.url,
        sha256: asset.sha256,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function installAsset(asset, runtimeRoot, options) {
  const destination = destinationPath(runtimeRoot, asset);
  if (!options.force && (await isInstalled(destination, asset))) {
    console.log(`skip ${asset.id}: already installed at ${path.relative(repoRoot, destination)}`);
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `super-agents-${asset.id}-`));
  try {
    const archivePath = path.join(tempDir, path.basename(new URL(asset.url).pathname));
    const extractRoot = path.join(tempDir, "extract");

    console.log(`download ${asset.id}: ${asset.url}`);
    await downloadFile(asset.url, archivePath);

    const actualSha256 = await sha256File(archivePath);
    if (actualSha256 !== asset.sha256) {
      throw new Error(`SHA256 mismatch for ${asset.id}: expected ${asset.sha256}, got ${actualSha256}`);
    }

    console.log(`extract ${asset.id}`);
    await extractArchive(asset, archivePath, extractRoot);
    const source = await stripSourceRoot(extractRoot, Number(asset.stripComponents || 0));

    console.log(`install ${asset.id}: ${path.relative(repoRoot, destination)}`);
    await moveDirectory(source, destination);
    await chmodExecutables(destination, asset);
    await writeMetadata(destination, asset);

    const destinationStat = await stat(destination);
    if (!destinationStat.isDirectory()) {
      throw new Error(`Installed destination is not a directory: ${destination}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const manifest = await readManifest(options.manifestPath);
  for (const asset of manifest.assets) {
    validateAsset(asset);
  }

  const selectedAssets = selectAssets(manifest.assets, options);
  if (selectedAssets.length === 0) {
    throw new Error("No runtime assets matched the requested filters");
  }

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(installPlan(options.runtimeRoot, options.manifestPath, selectedAssets, true), null, 2)}\n`);
    return;
  }

  for (const asset of selectedAssets) {
    await installAsset(asset, options.runtimeRoot, options);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
