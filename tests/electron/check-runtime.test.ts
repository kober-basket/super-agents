import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function repoRoot() {
  return path.basename(process.cwd()) === ".test-dist" ? path.dirname(process.cwd()) : process.cwd();
}

async function touch(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "");
}

test("runtime check requires uv command shims on Windows", { skip: process.platform !== "win32" }, async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-check-"));
  const platformRoot = path.join(runtimeRoot, "win32-x64");

  try {
    await touch(path.join(platformRoot, "node", "node.exe"));
    await touch(path.join(platformRoot, "node", "npm.cmd"));
    await touch(path.join(platformRoot, "node", "npx.cmd"));
    await touch(path.join(platformRoot, "python", "python.exe"));
    await touch(path.join(platformRoot, "bin", "python3.cmd"));

    const result = spawnSync(process.execPath, [path.join(repoRoot(), "scripts", "check-runtime.mjs")], {
      cwd: repoRoot(),
      env: { ...process.env, SUPER_AGENTS_RUNTIME_ROOT: runtimeRoot },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /uv\.exe/);
    assert.match(result.stderr, /uvx\.exe/);
    assert.match(result.stderr, /uvw\.exe/);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("runtime check requires uv commands and Python on macOS runtimes", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-check-"));
  const platformRoot = path.join(runtimeRoot, "darwin-arm64");

  try {
    await touch(path.join(platformRoot, "node", "bin", "node"));
    await touch(path.join(platformRoot, "node", "bin", "npm"));
    await touch(path.join(platformRoot, "node", "bin", "npx"));

    const result = spawnSync(process.execPath, [path.join(repoRoot(), "scripts", "check-runtime.mjs")], {
      cwd: repoRoot(),
      env: {
        ...process.env,
        SUPER_AGENTS_RUNTIME_ROOT: runtimeRoot,
        SUPER_AGENTS_RUNTIME_PLATFORM: "darwin",
        SUPER_AGENTS_RUNTIME_ARCH: "arm64",
      },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /vendor[\\/]runtime[\\/]darwin-arm64[\\/]bin[\\/]uv/);
    assert.match(result.stderr, /vendor[\\/]runtime[\\/]darwin-arm64[\\/]bin[\\/]uvx/);
    assert.match(result.stderr, /vendor[\\/]runtime[\\/]darwin-arm64[\\/]bin[\\/]python3/);
    assert.doesNotMatch(result.stderr, /uvw/);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
