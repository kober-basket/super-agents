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

test("assistant markdown content uses uniform restrained transcript heading styles", () => {
  const css = readStyles();

  assert.match(css, /\.message-text\s+h1\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.message-text\s+h2\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.message-text\s+h3\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.message-text\s+h4\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.message-text\s+h5\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.message-text\s+h6\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.message-text\s+h1\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.message-text\s+h2\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.message-text\s+h3\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.message-text\s+h4\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.message-text\s+h5\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.message-text\s+h6\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.message-text\s+strong\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.doesNotMatch(css, /\.message-text\s+strong\s*{[^}]*color:/s);
  assert.doesNotMatch(css, /\.message-text\s+h1\s*{[^}]*font-size:\s*2em/s);
  assert.doesNotMatch(css, /\.message-text\s+h1\s*{[^}]*font-weight:\s*700/s);
});

test("thread composer input width matches the conversation content width", () => {
  const css = readStyles();

  assert.match(css, /--chat-thread-column-width:\s*820px/s);
  assert.match(css, /--chat-thread-content-gutter:\s*42px/s);
  assert.match(
    css,
    /\.workspace-main\.is-thread\s+\.message-list\s*{[^}]*width:\s*min\(100%,\s*var\(--chat-thread-column-width\)\)[^}]*padding:\s*10px\s+var\(--chat-thread-content-gutter\)\s+18px/s,
  );
  assert.match(
    css,
    /\.workspace-main\.is-thread\s+\.chat-composer-frame\s*{[^}]*width:\s*min\(100%,\s*var\(--chat-thread-column-width\)\)[^}]*padding:\s*0\s+var\(--chat-thread-content-gutter\)/s,
  );
  assert.match(css, /@media\s*\(max-width:\s*1080px\)\s*{[^}]*--chat-thread-content-gutter:\s*22px/s);
});

test("home composer input uses the same width rhythm as thread conversations", () => {
  const css = readStyles();

  assert.match(css, /\.chat-home-stage\s*{[^}]*padding:\s*0\s+0\s+18px/s);
  assert.match(
    css,
    /\.workspace-main\.is-home\s+\.chat-composer-frame\s*{[^}]*width:\s*min\(100%,\s*var\(--chat-thread-column-width\)\)[^}]*padding:\s*0\s+var\(--chat-thread-content-gutter\)/s,
  );
  assert.match(
    css,
    /\.chat-home-composer-shell\s*{[^}]*width:\s*min\(100%,\s*var\(--chat-thread-column-width\)\)/s,
  );
});

test("assistant standalone bold markdown lines keep body typography", () => {
  const css = readStyles();

  assert.doesNotMatch(
    css,
    /\.message-text\s+p:has\(\s*>\s*strong:only-child\s*\)\s*{[^}]*font-size:\s*var\(--font-size-ui\)/s,
  );
  assert.doesNotMatch(
    css,
    /\.message-text\s+p:has\(\s*>\s*strong:only-child\s*\)\s*{[^}]*color:\s*var\(--muted-strong\)/s,
  );
});

test("assistant markdown blockquotes reset browser margins to align with transcript content", () => {
  const css = readStyles();

  assert.match(
    css,
    /\.message-text\s+blockquote,\s*\.preview-markdown\s+blockquote\s*{[^}]*margin:\s*8px\s+0\s+12px/s,
  );
});

test("runtime transcript typography uses the same restrained text colors", () => {
  const css = readStyles();

  assert.match(css, /--chat-content-font-size:\s*var\(--font-size-content\)/s);
  assert.match(css, /--chat-content-line-height:\s*1\.64/s);
  assert.match(css, /\.message-text\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)[^}]*line-height:\s*var\(--chat-content-line-height\)/s);
  assert.match(css, /\.runtime-status-line\s*{[^}]*color:\s*var\(--text\)[^}]*font-size:\s*var\(--chat-content-font-size\)[^}]*line-height:\s*var\(--chat-content-line-height\)/s);
  assert.match(css, /\.activity-markdown\s*{[^}]*color:\s*var\(--text\)[^}]*font-size:\s*var\(--chat-content-font-size\)[^}]*line-height:\s*var\(--chat-content-line-height\)/s);
  assert.match(css, /\.runtime-status-line\s+strong\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.doesNotMatch(css, /\.runtime-status-line\s+strong\s*{[^}]*color:/s);
  assert.match(css, /\.activity-summary-title\s+strong\s*{[^}]*color:\s*var\(--text-strong\)[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.activity-status-pill\s*{[^}]*color:\s*var\(--muted-strong\)[^}]*font-weight:\s*var\(--font-weight-medium\)/s);
  assert.match(css, /\.preview-markdown\s+strong,\s*\.activity-markdown\s+strong\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.doesNotMatch(css, /\.preview-markdown\s+strong,\s*\.activity-markdown\s+strong\s*{[^}]*color:/s);
  assert.match(css, /\.message-text\s+code,\s*\.preview-markdown\s+code,\s*\.activity-markdown\s+code\s*{[^}]*color:\s*var\(--text\)[^}]*font-weight:\s*var\(--font-weight-medium\)/s);
});

test("runtime tool status badges use distinct success and failure affordances", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(workspaceSource, /CircleCheckBig/);
  assert.match(workspaceSource, /CircleX/);
  assert.match(css, /\.activity-status-pill\.success\s*{[^}]*background:\s*rgba\(18,\s*183,\s*106,\s*0\.16\)[^}]*border:\s*1px\s+solid\s+rgba\(18,\s*183,\s*106,\s*0\.36\)[^}]*color:\s*#027a48/s);
  assert.match(css, /\.activity-status-pill\.error\s*{[^}]*background:\s*rgba\(217,\s*45,\s*32,\s*0\.16\)[^}]*border:\s*1px\s+solid\s+rgba\(217,\s*45,\s*32,\s*0\.38\)[^}]*color:\s*#b42318/s);
});

test("chat transcript spacing keeps question-answer turns visually separated", () => {
  const css = readStyles();

  assert.match(css, /\.message-list\s*{[^}]*gap:\s*22px/s);
  assert.match(css, /\.message-row\s*{[^}]*padding-bottom:\s*10px/s);
  assert.match(css, /\.message-bubble\s*{[^}]*gap:\s*8px/s);
  assert.match(css, /\.message-runtime-stack\s*{[^}]*gap:\s*4px/s);
  assert.match(css, /\.activity-summary\s*{[^}]*padding:\s*5px 8px/s);
});

test("user text bubbles shrink to their own content beside attachments", () => {
  const css = readStyles();

  assert.match(css, /\.message-text\.user\s*{[^}]*width:\s*fit-content/s);
  assert.match(css, /\.message-text\.user\s*{[^}]*max-width:\s*min\(100%,\s*760px\)/s);
  assert.match(css, /\.message-text\.user\s*{[^}]*justify-self:\s*end/s);
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
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*min-height:\s*50px/s);
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*padding:\s*8px\s+18px\s+9px/s);
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*border-bottom:\s*1px\s+solid\s+var\(--line-soft\)/s);
  assert.match(css, /\.right-workspace-head\s*{[^}]*min-height:\s*50px/s);
  assert.match(css, /\.chat-thread-title\s*{[^}]*color:\s*#111827/s);
  assert.match(css, /\.chat-thread-title\s*{[^}]*font-size:\s*15px/s);
  assert.match(css, /\.chat-thread-folder-control\s*{[^}]*margin-left:\s*auto/s);
  assert.match(css, /\.workspace-main\.is-thread\s+\.chat-column\s*{[^}]*width:\s*100%/s);
  assert.match(css, /\.workspace-main\.is-thread\s+\.chat-column\s*{[^}]*margin:\s*0/s);
  assert.match(
    css,
    /\.workspace-main\.is-thread\s+\.message-list\s*{[^}]*width:\s*min\(100%,\s*var\(--chat-thread-column-width\)\)/s,
  );
  assert.match(css, /\.workspace-main\.is-thread\s+\.message-list\s*{[^}]*margin:\s*0 auto/s);
  assert.match(css, /\.chat-thread-actions\s*{[^}]*display:\s*flex/s);
  assert.match(workspaceSource, /rightPaneControl/);
  assert.match(workspaceSource, /MoreHorizontal/);
  assert.match(workspaceSource, /复制为 Markdown/);
  assert.doesNotMatch(workspaceSource, /<Download\b/);
});
