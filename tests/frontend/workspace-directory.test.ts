import assert from "node:assert/strict";
import test from "node:test";

import { sortWorkspaceDirectoryEntries } from "../../src/lib/workspace-directory";
import type { WorkspaceDirectoryEntry } from "../../src/types";

function entry(name: string, kind: WorkspaceDirectoryEntry["kind"]): WorkspaceDirectoryEntry {
  return {
    name,
    kind,
    path: `F:\\work\\github\\super-agents\\${name}`,
    relativePath: name,
  };
}

test("sortWorkspaceDirectoryEntries keeps folders first and sorts by name", () => {
  const sorted = sortWorkspaceDirectoryEntries([
    entry("package.json", "file"),
    entry("src", "directory"),
    entry("README.md", "file"),
    entry("electron", "directory"),
  ]);

  assert.deepEqual(sorted.map((item) => item.name), ["electron", "src", "package.json", "README.md"]);
});
