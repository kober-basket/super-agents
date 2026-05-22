import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("workspace file explorer uses a VS Code style tree-first split", () => {
  const source = readSource("src/features/chat/WorkspaceFileExplorer.tsx");
  const previewSource = readSource("src/features/chat/PreviewPane.tsx");
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");

  assert.match(source, /workspace-file-explorer \$\{selectedPreview \? "has-preview" : "tree-only"\}/);
  assert.match(source, /workspace-file-tree-toolbar/);
  assert.match(source, /<aside className="workspace-file-tree">[\s\S]*\{selectedPreview \? \(/);
  assert.match(source, /workspace-file-breadcrumb-segment/);
  assert.match(source, /const fileIconMeta = directory \? null : getWorkspaceFileIconMeta\(entry\);/);
  assert.match(source, /directory \? \(\s*open \? \(/);
  assert.match(source, /fileIconMeta \? \(\s*<WorkspaceFileTypeIcon meta=\{fileIconMeta\} \/>/);
  assert.match(previewSource, /preview-editor-shell/);
  assert.match(previewSource, /preview-editor-line-number/);
  assert.doesNotMatch(source, /file-preview-placeholder/);
  assert.match(css, /\.workspace-file-explorer\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(
    css,
    /\.workspace-file-explorer\.has-preview\s*{[^}]*grid-template-columns:\s*clamp\(220px,\s*28%,\s*360px\)\s+minmax\(0,\s*1fr\)/s,
  );
  assert.match(css, /\.workspace-file-explorer\.has-preview\s+\.workspace-file-tree\s*{[^}]*border-right:/s);
  assert.match(css, /\.workspace-file-tree-toolbar\s*{[^}]*min-height:\s*42px/s);
  assert.match(css, /\.workspace-file-preview\s+\.preview-content-panel\s+\.preview-body\s*{[^}]*padding:\s*0/s);
  assert.match(css, /\.preview-editor-line\s*{[^}]*grid-template-columns:\s*54px\s+max-content/s);
  assert.match(appSource, /const PREVIEW_PANE_DEFAULT_WIDTH = 760/);
  assert.match(appSource, /const PREVIEW_PANE_MAX_WIDTH = 980/);
  assert.match(appSource, /PREVIEW_PANE_WIDTH_STORAGE_KEY,\s*PREVIEW_PANE_DEFAULT_WIDTH,\s*\[380\]/s);
});
