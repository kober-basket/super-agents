import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installCliShims } from "../../electron/cli-shims";

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("installCliShims copies packaged CLI scripts and writes PATH-visible command shims", async () => {
  const appPath = await mkdtemp(path.join(os.tmpdir(), "super-agents-app-"));
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-support-"));

  try {
    const scriptsDir = path.join(appPath, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "super-agents.mjs"), "console.log('main cli');\n", "utf8");
    await writeFile(path.join(scriptsDir, "super-agents-admin.mjs"), "console.log('admin cli');\n", "utf8");
    await writeFile(
      path.join(scriptsDir, "super-agents-document-runtime.mjs"),
      "console.log('document runtime cli');\n",
      "utf8",
    );

    const result = await installCliShims({ appPath, runtimeRoot });
    const commandExtension = process.platform === "win32" ? ".cmd" : "";

    assert.equal(await readFile(path.join(runtimeRoot, "cli", "super-agents.mjs"), "utf8"), "console.log('main cli');\n");
    assert.equal(await readFile(path.join(runtimeRoot, "cli", "super-agents-admin.mjs"), "utf8"), "console.log('admin cli');\n");
    assert.equal(
      await readFile(path.join(runtimeRoot, "cli", "super-agents-document-runtime.mjs"), "utf8"),
      "console.log('document runtime cli');\n",
    );
    assert.equal(await fileExists(path.join(runtimeRoot, "common", "bin", `super-agents${commandExtension}`)), true);
    assert.equal(await fileExists(path.join(runtimeRoot, "common", "bin", `super-agents-admin${commandExtension}`)), true);
    assert.equal(await fileExists(path.join(runtimeRoot, "common", "bin", `super-agents-document-runtime${commandExtension}`)), true);
    assert.deepEqual(result.commands.map((command) => command.name), [
      "super-agents",
      "super-agents-admin",
      "super-agents-document-runtime",
    ]);
  } finally {
    await rm(appPath, { recursive: true, force: true });
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("installCliShims resolves CLI scripts when dev Electron appPath points at dist-electron", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-repo-"));
  const appPath = path.join(repoRoot, "dist-electron");
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-support-"));

  try {
    const scriptsDir = path.join(repoRoot, "scripts");
    await mkdir(appPath, { recursive: true });
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "super-agents.mjs"), "console.log('main cli from repo root');\n", "utf8");
    await writeFile(path.join(scriptsDir, "super-agents-admin.mjs"), "console.log('admin cli from repo root');\n", "utf8");
    await writeFile(
      path.join(scriptsDir, "super-agents-document-runtime.mjs"),
      "console.log('document runtime cli from repo root');\n",
      "utf8",
    );

    await installCliShims({ appPath, runtimeRoot });

    const commandExtension = process.platform === "win32" ? ".cmd" : "";
    assert.equal(
      await readFile(path.join(runtimeRoot, "cli", "super-agents.mjs"), "utf8"),
      "console.log('main cli from repo root');\n",
    );
    assert.equal(await fileExists(path.join(runtimeRoot, "common", "bin", `super-agents${commandExtension}`)), true);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
