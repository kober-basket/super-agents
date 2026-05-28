import { access } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const runtimeRoot = path.resolve(process.env.SUPER_AGENTS_RUNTIME_ROOT || path.join(repoRoot, "vendor", "runtime"));
const runtimePlatform = process.env.SUPER_AGENTS_RUNTIME_PLATFORM || process.platform;
const runtimeArch = process.env.SUPER_AGENTS_RUNTIME_ARCH || process.arch;
const platformKey = `${runtimePlatform}-${runtimeArch}`;
const platformRoot = path.join(runtimeRoot, platformKey);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function commandPath(name) {
  if (runtimePlatform === "win32") {
    return path.join(platformRoot, "node", name);
  }
  return path.join(platformRoot, "node", "bin", name);
}

const required = [
  commandPath(runtimePlatform === "win32" ? "node.exe" : "node"),
  commandPath(runtimePlatform === "win32" ? "npm.cmd" : "npm"),
  commandPath(runtimePlatform === "win32" ? "npx.cmd" : "npx"),
];

if (runtimePlatform === "win32") {
  required.push(path.join(platformRoot, "python", "python.exe"));
  required.push(path.join(platformRoot, "bin", "python3.cmd"));
  required.push(path.join(platformRoot, "bin", "uv.exe"));
  required.push(path.join(platformRoot, "bin", "uvx.exe"));
  required.push(path.join(platformRoot, "bin", "uvw.exe"));
} else if (runtimePlatform === "darwin") {
  required.push(path.join(platformRoot, "bin", "uv"));
  required.push(path.join(platformRoot, "bin", "uvx"));
  required.push(path.join(platformRoot, "bin", "python3"));
}

const missing = [];
for (const filePath of required) {
  if (!(await exists(filePath))) {
    missing.push(path.relative(repoRoot, filePath));
  }
}

if (missing.length > 0) {
  console.error(`Missing bundled runtime files for ${platformKey}:`);
  for (const filePath of missing) {
    console.error(`- ${filePath}`);
  }
  console.error("");
  console.error("Expected layout:");
  console.error(`- vendor/runtime/${platformKey}/node/...`);
  if (runtimePlatform === "win32") {
    console.error(`- vendor/runtime/${platformKey}/python/python.exe`);
    console.error(`- vendor/runtime/${platformKey}/bin/python3.cmd`);
    console.error(`- vendor/runtime/${platformKey}/bin/uv.exe`);
    console.error(`- vendor/runtime/${platformKey}/bin/uvx.exe`);
    console.error(`- vendor/runtime/${platformKey}/bin/uvw.exe`);
  } else if (runtimePlatform === "darwin") {
    console.error(`- vendor/runtime/${platformKey}/bin/uv`);
    console.error(`- vendor/runtime/${platformKey}/bin/uvx`);
    console.error(`- vendor/runtime/${platformKey}/bin/python3`);
  }
  process.exit(1);
}

console.log(`Bundled runtime looks ready for ${platformKey}.`);
