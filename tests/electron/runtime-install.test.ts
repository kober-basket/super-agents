import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function repoRoot() {
  return path.basename(process.cwd()) === ".test-dist" ? path.dirname(process.cwd()) : process.cwd();
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("runtime manifest pins Electron-aligned Node and Windows embedded Python", async () => {
  const manifestPath = path.join(repoRoot(), "vendor", "runtime", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    node: { version: string };
    python: { version: string };
    assets: Array<{ id: string; sha256: string }>;
  };

  assert.equal(manifest.node.version, "24.15.0");
  assert.equal(manifest.python.version, "3.14.5");

  const assetIds = manifest.assets.map((asset) => asset.id).sort();
  assert.deepEqual(assetIds, [
    "node-darwin-arm64",
    "node-darwin-x64",
    "node-win32-arm64",
    "node-win32-x64",
    "python-win32-arm64",
    "python-win32-x64",
  ]);

  for (const asset of manifest.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
});

test("runtime install dry-run prints the selected manifest assets without installing them", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-install-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  const runtimeRoot = path.join(tempDir, "runtime");

  try {
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          node: { version: "1.2.3" },
          python: { version: "3.4.5" },
          assets: [
            {
              id: "node-darwin-arm64",
              kind: "node",
              platform: "darwin",
              arch: "arm64",
              version: "1.2.3",
              url: "https://example.test/node.tar.gz",
              sha256: "a".repeat(64),
              archive: "tar.gz",
              stripComponents: 1,
              destination: "darwin-arm64/node",
              executablePaths: ["bin/node"],
            },
            {
              id: "python-win32-x64",
              kind: "python",
              platform: "win32",
              arch: "x64",
              version: "3.4.5",
              url: "https://example.test/python.zip",
              sha256: "b".repeat(64),
              archive: "zip",
              stripComponents: 0,
              destination: "win32-x64/python",
              executablePaths: [],
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot(), "scripts", "install-runtime.mjs"),
        "--manifest",
        manifestPath,
        "--runtime-root",
        runtimeRoot,
        "--dry-run",
        "--all",
      ],
      { cwd: repoRoot(), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout) as {
      dryRun: boolean;
      runtimeRoot: string;
      assets: Array<{ id: string; destination: string; url: string }>;
    };

    assert.equal(plan.dryRun, true);
    assert.equal(plan.runtimeRoot, runtimeRoot);
    assert.deepEqual(
      plan.assets.map((asset) => [asset.id, asset.destination, asset.url]),
      [
        ["node-darwin-arm64", path.join(runtimeRoot, "darwin-arm64", "node"), "https://example.test/node.tar.gz"],
        ["python-win32-x64", path.join(runtimeRoot, "win32-x64", "python"), "https://example.test/python.zip"],
      ],
    );
    assert.equal(await pathExists(path.join(runtimeRoot, "darwin-arm64", "node")), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
