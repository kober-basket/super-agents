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

test("right pane toggle is pinned independently of the movable workspace folder button", () => {
  const appSource = readSource("src/App.tsx");
  const chatWorkspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");
  const css = readSource("src/styles.css");

  assert.match(appSource, /FolderOpen/);
  assert.match(appSource, /workspaceClient\.openFolder\(activeConversationWorkspaceRoot\)/);
  assert.match(appSource, /workspaceFolderControl=\{renderWorkspaceFolderButton\(\)\}/);
  assert.match(chatWorkspaceSource, /chat-fixed-right-pane-control/);
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
    /<div className="chat-fixed-right-pane-control">\s*\{rightPaneControl\}\s*<\/div>/s,
  );
  assert.match(chatWorkspaceSource, /chat-home-folder-control[\s\S]*chat-fixed-right-pane-control/);
  assert.match(
    css,
    /\.chat-fixed-right-pane-control\s*{[^}]*position:\s*fixed[^}]*right:\s*calc\(var\(--window-padding\)\s*\+\s*18px\)/s,
  );
  assert.match(css, /\.chat-thread-folder-control\s*{[^}]*margin-left:\s*auto[^}]*margin-right:\s*38px/s);
});

test("right workspace header leaves room for the pinned pane toggle", () => {
  const css = readSource("src/styles.css");

  assert.match(
    css,
    /\.app-shell\.with-preview\s+\.right-workspace-head\s*{[^}]*padding-right:\s*56px/s,
  );
});
