import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function repoRoot() {
  return path.basename(process.cwd()) === ".test-dist" ? path.dirname(process.cwd()) : process.cwd();
}

test("packaged app syncs built-in skills from app.asar.unpacked", async () => {
  const root = repoRoot();
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const asarUnpack = packageJson.build?.asarUnpack;
  assert.ok(Array.isArray(asarUnpack));
  assert.ok(asarUnpack.includes("electron/builtin-skills/**"));

  const workspaceServiceSource = await readFile(path.join(root, "electron", "workspace-service.ts"), "utf8");
  assert.match(workspaceServiceSource, /resourcesPath/);
  assert.match(workspaceServiceSource, /app\.asar\.unpacked/);
});
