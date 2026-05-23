import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

test("right pane toggle does not render a numeric tab counter", () => {
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");

  assert.doesNotMatch(appSource, /rightPaneInstanceCount/);
  assert.doesNotMatch(appSource, /<span>\{rightPaneInstanceCount\}<\/span>/);
  assert.doesNotMatch(css, /\.right-pane-toggle\s+span\s*{/);
});

test("new chat home renders a fixed right pane toggle inside the chat workspace", () => {
  const chatWorkspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");
  const css = readSource("src/styles.css");

  assert.match(chatWorkspaceSource, /chat-fixed-right-pane-control/);
  assert.match(css, /\.chat-fixed-right-pane-control\s*{/);
});

test("workspace folder follows chat area while top controls stay on one row", () => {
  const appSource = readSource("src/App.tsx");
  const chatWorkspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");
  const css = readSource("src/styles.css");

  assert.match(appSource, /FolderOpen/);
  assert.match(appSource, /workspaceClient\.openFolder\(activeConversationWorkspaceRoot\)/);
  assert.match(appSource, /workspaceFolderControl=\{renderWorkspaceFolderButton\(\)\}/);
  assert.match(
    chatWorkspaceSource,
    /<div className="chat-thread-folder-control">\s*\{workspaceFolderControl\}\s*<\/div>/s,
  );
  assert.match(
    chatWorkspaceSource,
    /<div className="chat-home-folder-control">\s*\{workspaceFolderControl\}\s*<\/div>/s,
  );
  assert.match(
    chatWorkspaceSource,
    /<\/div>\s*\{isHome && workspaceFolderControl \? \(\s*<div className="chat-home-folder-control">/s,
  );
  assert.match(
    chatWorkspaceSource,
    /<div className="chat-fixed-right-pane-control">\s*\{rightPaneControl\}\s*<\/div>/s,
  );
  assert.doesNotMatch(chatWorkspaceSource, /chat-fixed-folder-control/);
  assert.doesNotMatch(chatWorkspaceSource, /chat-fixed-right-controls/);
  assert.match(
    css,
    /\.chat-fixed-right-pane-control\s*{[^}]*position:\s*fixed[^}]*top:\s*calc\(var\(--window-chrome-height\)\s*\+\s*9px\)[^}]*right:\s*calc\(var\(--window-padding\)\s*\+\s*18px\)/s,
  );
  assert.match(css, /\.workspace-main\s*{[^}]*position:\s*relative/s);
  assert.match(css, /\.chat-home-folder-control\s*{[^}]*top:\s*8px[^}]*right:\s*58px/s);
  assert.match(css, /\.app-shell\.with-preview\s+\.chat-home-folder-control\s*{[^}]*right:\s*10px/s);
  assert.match(css, /\.chat-thread-folder-control\s*{[^}]*margin-left:\s*auto[^}]*margin-right:\s*38px/s);
  assert.match(css, /\.app-shell\.with-preview\s+\.chat-thread-folder-control\s*{[^}]*margin-right:\s*0/s);
});

test("right workspace header leaves room for the pinned pane toggle", () => {
  const css = readSource("src/styles.css");

  assert.match(
    css,
    /\.app-shell\.with-preview\s+\.right-workspace-head\s*{[^}]*padding-right:\s*56px/s,
  );
});

test("right workspace top controls use a flat browser-like toolbar style", () => {
  const css = readSource("src/styles.css");

  assert.match(css, /\.right-workspace-head\s*{[^}]*background:\s*#fff/s);
  assert.match(css, /\.right-pane-toggle\s*{[^}]*border-radius:\s*10px[^}]*line-height:\s*0[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.right-pane-toggle svg,\s*\.right-workspace-add-button svg\s*{[^}]*display:\s*block/s);
  assert.match(css, /\.right-workspace-tab\.active\s*{[^}]*background:\s*#f5f5f6[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.right-workspace-add-button\s*{[^}]*border-radius:\s*10px[^}]*line-height:\s*0[^}]*box-shadow:\s*none/s);
});

test("right workspace pane expands with a restrained motion instead of popping in", () => {
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");

  assert.match(appSource, /"--right-pane-inline-width":\s*`\$\{previewPaneWidth\}px`/);
  assert.match(appSource, /showInlineRightPane \? "var\(--right-pane-inline-width\)" : "0px"/);
  assert.match(appSource, /showRightPane \|\| rightPaneMounted/);
  assert.match(appSource, /<div\s+[^>]*className=\{clsx\(\s*"right-workspace-slot"/s);
  assert.doesNotMatch(appSource, /\{showRightPane \? \(\s*<Suspense[\s\S]*?<RightWorkspacePane/s);
  assert.match(
    css,
    /\.app-shell\s*{[^}]*transition:\s*grid-template-columns 500ms cubic-bezier\(0\.37,\s*0,\s*0\.63,\s*1\)/s,
  );
  assert.match(css, /\.right-workspace-slot\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.right-workspace-slot\s*>\s+\.right-workspace-pane\s*{[^}]*width:\s*var\(--right-pane-inline-width,\s*100%\)/s);
  assert.match(css, /\.right-workspace-pane\s*{[^}]*overflow:\s*hidden/s);
  assert.match(
    css,
    /\.app-shell\.with-preview\s+\.right-workspace-slot\s+>\s+\.right-workspace-pane\s*{[^}]*animation:\s*right-pane-fade-in 500ms cubic-bezier\(0\.37,\s*0,\s*0\.63,\s*1\)/s,
  );
  assert.doesNotMatch(css, /right-pane-enter/);
  assert.match(css, /@keyframes right-pane-fade-in\s*{[\s\S]*opacity:\s*0\.72/);
  assert.match(css, /@keyframes right-pane-fade-in\s*{[\s\S]*opacity:\s*1/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*{[^}]*\.app-shell\s*{[^}]*transition:\s*none/s);
});

test("right workspace pane tracks pointer movement while resizing", () => {
  const css = readSource("src/styles.css");

  assert.match(
    css,
    /body\.pane-resizing\s+\.app-shell\s*{[^}]*transition:\s*none/s,
  );
  assert.match(
    css,
    /body\.pane-resizing\s+\.app-shell\.with-preview\s+\.right-workspace-slot\s*>\s*\.right-workspace-pane\s*{[^}]*animation:\s*none/s,
  );
});
