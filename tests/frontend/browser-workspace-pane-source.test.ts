import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("browser workspace pane keeps browser tabs controlled by the parent pane", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "..", "src/features/chat/BrowserWorkspacePane.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /useState<RightPaneBrowserPage/);
  assert.doesNotMatch(source, /setPages\(/);
});
