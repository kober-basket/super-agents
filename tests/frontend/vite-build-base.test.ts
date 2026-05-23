import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function repoRoot() {
  return path.basename(process.cwd()) === ".test-dist" ? path.dirname(process.cwd()) : process.cwd();
}

test("vite uses relative asset paths for packaged file:// renderer loads", async () => {
  const viteConfigSource = await readFile(path.join(repoRoot(), "vite.config.ts"), "utf8");

  assert.match(viteConfigSource, /\bbase:\s*["']\.\/["']/);
});
