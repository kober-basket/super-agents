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
  assert.match(css, /\.preview-editor-line\s*{[^}]*grid-template-columns:\s*58px\s+max-content/s);
  assert.match(appSource, /const PREVIEW_PANE_DEFAULT_WIDTH = 760/);
  assert.match(appSource, /const PREVIEW_PANE_MAX_WIDTH = 980/);
  assert.match(appSource, /readStoredWidth\(key: string,\s*fallback: number,\s*legacyValues: number\[\] = \[\],\s*legacyTolerance = 0\)/s);
  assert.match(appSource, /Math\.abs\(parsedValue - legacyValue\) <= legacyTolerance/s);
  assert.match(appSource, /PREVIEW_PANE_WIDTH_STORAGE_KEY,\s*PREVIEW_PANE_DEFAULT_WIDTH,\s*\[380,\s*640\],\s*8/s);
});

test("workspace file explorer avoids a blocking loading placeholder for text files", () => {
  const source = readSource("src/features/chat/WorkspaceFileExplorer.tsx");

  assert.match(source, /createOptimisticFilePreview\(entry\)/);
  assert.match(source, /setPreviewCache/);
  assert.doesNotMatch(source, /content:\s*""[\s\S]{0,120}loading:\s*true/);
});

test("workspace file preview editor uses calm editor-like typography", () => {
  const css = readSource("src/styles.css");

  assert.match(css, /\.preview-editor-shell\s*{[^}]*background:\s*#f8f8f8/s);
  assert.match(css, /\.preview-editor-lines\s*{[^}]*font-size:\s*13px/s);
  assert.match(css, /\.preview-editor-line-number\s*{[^}]*border-right:\s*1px\s+solid\s+#eeeeee/s);
  assert.match(css, /\.preview-editor-code\s*{[^}]*tab-size:\s*2/s);
  assert.match(css, /\.preview-editor-code\s+\.hljs-comment\s*{[^}]*font-style:\s*italic/s);
  assert.doesNotMatch(css, /\.preview-editor-lines\s*{[^}]*font-size:\s*14px/s);
});
