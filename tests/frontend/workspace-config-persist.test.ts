import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readRepoFile(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const filePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(filePath, "utf8");
}

test("scheduled config edits update local controlled inputs before deferred persistence", () => {
  const source = readRepoFile("src/features/workspace/useWorkspaceController.ts").replace(/\r\n/g, "\n");
  const match = source.match(
    /function scheduleConfigPersist\(nextConfig: AppConfig\) \{([\s\S]*?)\n  \}\n\n  function updateConfigField/,
  );

  assert.ok(match?.[1], "scheduleConfigPersist implementation should be present");
  const body = match[1];
  const localUpdateIndex = body.indexOf("setConfig(nextConfig)");
  const deferredSaveIndex = body.indexOf("window.setTimeout");

  assert.ok(localUpdateIndex >= 0, "scheduled config edits should update local config immediately");
  assert.ok(deferredSaveIndex >= 0, "scheduled config edits should still debounce persistence");
  assert.ok(localUpdateIndex < deferredSaveIndex, "local config must update before deferred persistence starts");
});
