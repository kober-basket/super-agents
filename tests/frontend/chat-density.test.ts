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

test("assistant message blocks stay inside the padded transcript content column", () => {
  const css = readStyles();

  assert.match(css, /\.message-text\s*{[^}]*width:\s*100%[^}]*max-width:\s*760px/s);
  assert.match(css, /\.runtime-trace-group\s*{[^}]*width:\s*100%[^}]*max-width:\s*100%/s);
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

test("runtime tool status badges use distinct success cancellation and failure affordances", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(workspaceSource, /CircleCheckBig/);
  assert.match(workspaceSource, /CircleX/);
  assert.match(workspaceSource, /status === "cancelled"\)\s*{\s*return "取消";/);
  assert.doesNotMatch(workspaceSource, /已取消/);
  assert.match(css, /\.activity-status-pill\.success\s*{[^}]*background:\s*rgba\(18,\s*183,\s*106,\s*0\.16\)[^}]*border:\s*1px\s+solid\s+rgba\(18,\s*183,\s*106,\s*0\.36\)[^}]*color:\s*#027a48/s);
  assert.match(css, /\.activity-status-pill\.cancelled\s*{[^}]*background:\s*rgba\(245,\s*158,\s*11,\s*0\.16\)[^}]*border:\s*1px\s+solid\s+rgba\(245,\s*158,\s*11,\s*0\.36\)[^}]*color:\s*#b45309/s);
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

test("markdown task list checkboxes keep native inline sizing", () => {
  const css = readStyles();

  assert.match(
    css,
    /\.message-text\s+\.task-list-item\s+input\[type="checkbox"\],\s*\.preview-markdown\s+\.task-list-item\s+input\[type="checkbox"\],\s*\.activity-markdown\s+\.task-list-item\s+input\[type="checkbox"\]\s*{[^}]*width:\s*13px[^}]*height:\s*13px[^}]*padding:\s*0[^}]*flex:\s*0\s+0\s+13px[^}]*transform:\s*none/s,
  );
});

test("runtime tool output panels cap long content with internal scrolling", () => {
  const css = readStyles();

  assert.match(css, /\.activity-panel\s+pre\s*{[^}]*max-height:\s*min\(360px,\s*46vh\)[^}]*overflow:\s*auto/s);
  assert.match(css, /\.activity-diff-pre\s*{[^}]*max-height:\s*min\(420px,\s*48vh\)[^}]*overflow:\s*auto/s);
  assert.match(css, /\.activity-command-shell\s*{[^}]*max-height:\s*min\(320px,\s*46vh\)[^}]*overflow:\s*auto/s);
});

test("runtime tool output panels auto-follow only while pinned to the bottom", () => {
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(workspaceSource, /usePinnedToolContentScroll/);
  assert.match(workspaceSource, /shouldAutoScrollToolContent/);
  assert.match(workspaceSource, /isScrollNearBottom/);
  assert.match(workspaceSource, /<AutoScrollPre[\s\S]*className="activity-diff-pre"/);
  assert.match(workspaceSource, /<AutoScrollDiv[\s\S]*className="activity-command-shell"/);
});

test("todo tool progress renders as a floating live panel", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");
  const todoPanelBlock = css.match(/\.runtime-todo-panel\s*{(?<body>[\s\S]*?)\n}/)?.groups?.body ?? "";

  assert.match(workspaceSource, /renderRuntimeTodoPanel/);
  assert.match(workspaceSource, /runtimeTodoCollapsed/);
  assert.match(workspaceSource, /setRuntimeTodoCollapsed/);
  assert.match(workspaceSource, /shouldRenderRuntimeTodoPanel\(todoSnapshot,\s*\{\s*isTurnActive:\s*runtimeInProgress\s*\}\)/s);
  assert.match(workspaceSource, /aria-expanded=\{!runtimeTodoCollapsed\}/);
  assert.match(workspaceSource, /runtime-todo-toggle/);
  assert.match(workspaceSource, /runtime-todo-progress/);
  assert.match(workspaceSource, /<strong>任务流<\/strong>/);
  assert.match(workspaceSource, /第 \{todoProgress\.currentStep\} 项/);
  assert.match(workspaceSource, /RefreshCw/);
  assert.match(workspaceSource, /runtime-todo-refresh-icon/);
  assert.doesNotMatch(workspaceSource, /runtime-todo-running-indicator/);
  assert.doesNotMatch(workspaceSource, /正在第/);
  assert.doesNotMatch(workspaceSource, /todoStatusLabel/);
  assert.doesNotMatch(workspaceSource, /runtime-todo-copy[\\s\\S]*<em>/);
  assert.match(workspaceSource, /runtime-todo-panel/);
  assert.match(css, /\.runtime-todo-panel\s*{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*transform:\s*translateY\(-50%\)[^}]*right:\s*clamp\(18px,\s*4vw,\s*44px\)/s);
  assert.match(todoPanelBlock, /background:[\s\S]*var\(--panel\)/);
  assert.doesNotMatch(todoPanelBlock, /rgba\(255,\s*255,\s*255,\s*0\.(?:7|8|9)\d*\)/);
  assert.match(css, /\.runtime-todo-panel\.collapsed\s*{[^}]*width:\s*44px[^}]*padding:\s*8px/s);
  assert.match(css, /\.runtime-todo-toggle\s*{[^}]*width:\s*24px[^}]*height:\s*24px/s);
  assert.match(css, /\.runtime-todo-progress-fill\s*{[^}]*background:\s*linear-gradient\(90deg,\s*#2f6f5e,\s*#8ca36b\)/s);
  assert.match(css, /\.runtime-todo-item\.in_progress\s+\.runtime-todo-marker\s*{[^}]*border-color:\s*transparent[^}]*background:\s*transparent/s);
  assert.match(css, /\.runtime-todo-refresh-icon\s*{[^}]*animation:\s*spin\s+900ms\s+linear\s+infinite/s);
  assert.doesNotMatch(css, /runtime-todo-orbit|runtime-todo-sweep|runtime-todo-running-indicator/);
  assert.doesNotMatch(css, /#7c5cff|#6f6bff|rgba\(124,\s*92,\s*255/);
});

test("chat thread title sits on the left with a compact actions menu", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*justify-content:\s*flex-start/s);
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*min-height:\s*50px/s);
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*padding:\s*8px\s+18px\s+9px/s);
  assert.match(css, /\.chat-thread-toolbar\s*{[^}]*border-bottom:\s*1px\s+solid\s+var\(--line-soft\)/s);
  assert.match(css, /\.right-workspace-head\s*{[^}]*min-height:\s*50px/s);
  assert.match(css, /\.chat-thread-title\s*{[^}]*color:\s*var\(--text\)/s);
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
  assert.doesNotMatch(workspaceSource, /rightPaneControl/);
  assert.match(workspaceSource, /MoreHorizontal/);
  assert.match(workspaceSource, /复制为 Markdown/);
  assert.doesNotMatch(workspaceSource, /<Download\b/);
});
