import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readStyles() {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");

  return readFileSync(cssPath, "utf8");
}

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("assistant markdown content uses compact transcript heading sizes", () => {
  const css = readStyles();

  assert.match(css, /\.message-text\s+h1\s*{[^}]*font-size:\s*18px/s);
  assert.match(css, /\.message-text\s+h2\s*{[^}]*font-size:\s*16px/s);
  assert.match(css, /\.message-text\s+h3\s*{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.message-text\s+strong\s*{[^}]*font-weight:\s*650/s);
  assert.doesNotMatch(css, /\.message-text\s+h1\s*{[^}]*font-size:\s*2em/s);
});

test("chat transcript spacing is tighter for work logs", () => {
  const css = readStyles();

  assert.match(css, /\.message-list\s*{[^}]*gap:\s*14px/s);
  assert.match(css, /\.message-bubble\s*{[^}]*gap:\s*8px/s);
  assert.match(css, /\.message-runtime-stack\s*{[^}]*gap:\s*4px/s);
  assert.match(css, /\.activity-summary\s*{[^}]*padding:\s*5px 8px/s);
});

test("runtime process summary has readable size and more breathing room", () => {
  const css = readStyles();

  assert.match(css, /\.runtime-trace-summary-copy\s*{[^}]*font-size:\s*13px/s);
  assert.match(css, /\.runtime-trace-group\s*>\s*\.message-runtime-stack\s*{[^}]*margin-top:\s*10px/s);
  assert.match(css, /\.message-bubble:has\(>\s*\.runtime-trace-group\)\s*{[^}]*gap:\s*14px/s);
});

test("chat thread title sits on the left with a compact actions menu", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*justify-content:\s*flex-start/s);
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*padding:\s*16px\s+18px\s+0/s);
  assert.match(css, /\.chat-thread-title\s*{[^}]*color:\s*#111827/s);
  assert.match(css, /\.chat-thread-title\s*{[^}]*font-size:\s*15px/s);
  assert.match(css, /\.workspace-main\.is-thread\s+\.chat-column\s*{[^}]*width:\s*100%/s);
  assert.match(css, /\.workspace-main\.is-thread\s+\.chat-column\s*{[^}]*margin:\s*0/s);
  assert.match(css, /\.workspace-main\.is-thread\s+\.message-list\s*{[^}]*width:\s*min\(100%,\s*820px\)/s);
  assert.match(css, /\.workspace-main\.is-thread\s+\.message-list\s*{[^}]*margin:\s*0 auto/s);
  assert.match(css, /\.chat-thread-actions\s*{[^}]*display:\s*flex/s);
  assert.match(workspaceSource, /MoreHorizontal/);
  assert.match(workspaceSource, /复制为 Markdown/);
  assert.doesNotMatch(workspaceSource, /<Download\b/);
});
