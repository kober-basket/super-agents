import assert from "node:assert/strict";
import test from "node:test";

import { getWorkspaceFileIconMeta } from "../../src/lib/workspace-file-icons";
import type { WorkspaceDirectoryEntry } from "../../src/types";

function file(name: string, mimeType = "text/plain"): WorkspaceDirectoryEntry {
  return {
    name,
    path: `/workspace/${name}`,
    relativePath: name,
    kind: "file",
    mimeType,
  };
}

test("workspace file icons classify common code and document file types", () => {
  assert.deepEqual(getWorkspaceFileIconMeta(file("SKILL.md")), {
    kind: "markdown",
    label: "Markdown 文件",
  });
  assert.deepEqual(getWorkspaceFileIconMeta(file("plugin.json", "application/json")), {
    kind: "json",
    label: "JSON 文件",
  });
  assert.deepEqual(getWorkspaceFileIconMeta(file("test_document_plugin_mapping.py")), {
    kind: "python",
    label: "Python 文件",
  });
  assert.deepEqual(getWorkspaceFileIconMeta(file("pnpm-lock.yaml")), {
    kind: "yaml",
    label: "YAML 文件",
  });
  assert.deepEqual(getWorkspaceFileIconMeta(file("banner.svg", "image/svg+xml")), {
    kind: "image",
    label: "图片文件",
  });
});

test("workspace file icons leave directory entries to the folder renderer", () => {
  const directory: WorkspaceDirectoryEntry = {
    name: "skills",
    path: "/workspace/skills",
    relativePath: "skills",
    kind: "directory",
  };

  assert.equal(getWorkspaceFileIconMeta(directory), null);
});
