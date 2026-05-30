import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppTitleBar } from "../../src/features/navigation/AppTitleBar";
import { PrimarySidebar } from "../../src/features/navigation/PrimarySidebar";
import { resolveSidebarConversationReadState } from "../../src/lib/sidebar-conversation-read-state";

test("primary sidebar no longer renders report or emergency modules", () => {
  const html = renderToStaticMarkup(
    <PrimarySidebar
      view="chat"
      conversations={[]}
      activeConversationId={null}
      onCreateConversation={() => undefined}
      onDeleteConversation={() => undefined}
      onOpenConversation={() => undefined}
      onSetView={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /报告生成/);
  assert.doesNotMatch(html, /应急预案/);
});

test("conversation rows swap time for delete in the same action slot on hover", () => {
  const html = renderToStaticMarkup(
    <PrimarySidebar
      view="chat"
      conversations={[
        {
          id: "conversation-1",
          title: "需求讨论",
          createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
        },
      ]}
      activeConversationId="conversation-1"
      onCreateConversation={() => undefined}
      onDeleteConversation={() => undefined}
      onOpenConversation={() => undefined}
      onSetView={() => undefined}
    />,
  );

  assert.match(html, /sidebar-conversation-action/);
  assert.match(html, /<span class="sidebar-conversation-time">[\s\S]*?<\/span><button/);
  assert.match(html, /aria-label="删除会话 需求讨论"/);

  const css = readFileSync(path.resolve(process.cwd(), "..", "src/styles.css"), "utf8");
  assert.match(css, /\.sidebar-conversation-trigger\s*{[^}]*padding:\s*7px\s+76px\s+7px\s+10px/s);
  assert.match(css, /\.sidebar-conversation-trigger\s*{[^}]*grid-template-columns:\s*8px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.sidebar-conversation-action\s*{[^}]*position:\s*absolute/s);
  assert.match(css, /\.sidebar-conversation-action\s*{[^}]*width:\s*64px/s);
  assert.match(css, /\.sidebar-conversation-action\s*{[^}]*justify-items:\s*end/s);
  assert.match(
    css,
    /\.sidebar-conversation-copy\s+strong,\s*\.sidebar-conversation-copy\s+span\s*{[^}]*display:\s*block/s,
  );
  assert.match(css, /\.sidebar-conversation-time\s*{[^}]*max-width:\s*64px/s);
  assert.match(css, /\.sidebar-conversation-time\s*{[^}]*text-align:\s*right/s);
  assert.match(
    css,
    /\.sidebar-conversation-item:hover\s+\.sidebar-conversation-time,\s*\.sidebar-conversation-item:focus-within\s+\.sidebar-conversation-time\s*{[^}]*opacity:\s*0/s,
  );
  assert.match(
    css,
    /\.sidebar-conversation-item:hover\s+\.sidebar-conversation-delete,\s*\.sidebar-conversation-item:focus-within\s+\.sidebar-conversation-delete\s*{[^}]*opacity:\s*1/s,
  );
});

test("conversation sidebar renders weighted idle, running, unread, and attention indicators", () => {
  const html = renderToStaticMarkup(
    <PrimarySidebar
      view="chat"
      conversations={[
        {
          id: "conversation-1",
          title: "普通会话",
          createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
          readState: "idle",
        },
        {
          id: "conversation-2",
          title: "正在输出",
          createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
          readState: "running",
        },
        {
          id: "conversation-3",
          title: "未读输出",
          createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
          readState: "unread",
        },
        {
          id: "conversation-4",
          title: "需要处理",
          createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
          readState: "attention",
        },
      ]}
      activeConversationId={null}
      onCreateConversation={() => undefined}
      onDeleteConversation={() => undefined}
      onOpenConversation={() => undefined}
      onSetView={() => undefined}
    />,
  );

  assert.match(html, /sidebar-conversation-dot state-idle/);
  assert.match(html, /sidebar-conversation-dot state-running/);
  assert.match(html, /sidebar-conversation-dot state-unread/);
  assert.match(html, /sidebar-conversation-dot state-attention/);
  assert.match(html, /aria-label="会话状态：默认"/);
  assert.match(html, /aria-label="会话状态：输出中"/);
  assert.match(html, /aria-label="会话状态：未读"/);
  assert.match(html, /aria-label="会话状态：需要处理"/);

  const css = readFileSync(path.resolve(process.cwd(), "..", "src/styles.css"), "utf8");
  assert.match(css, /\.sidebar-conversation-dot\s*{[^}]*border-radius:\s*999px/s);
  assert.match(css, /\.sidebar-conversation-dot\s*{[^}]*align-self:\s*center/s);
  assert.match(css, /\.sidebar-conversation-copy\s*{(?=[^}]*display:\s*flex;)(?=[^}]*align-items:\s*center;)[^}]*}/s);
  assert.match(css, /\.sidebar-conversation-dot\.state-idle\s*{(?=[^}]*width:\s*5px;)(?=[^}]*height:\s*5px;)(?=[^}]*background:\s*#d0d0cc;)[^}]*}/s);
  assert.match(css, /\.sidebar-conversation-dot\.state-running\s*{(?=[^}]*width:\s*11px;)(?=[^}]*height:\s*11px;)(?=[^}]*background:\s*conic-gradient\()(?=[^}]*animation:\s*sidebar-conversation-spin\s+2s\s+linear\s+infinite;)[^}]*}/s);
  assert.match(css, /\.sidebar-conversation-dot\.state-running::after\s*{(?=[^}]*inset:\s*2px;)(?=[^}]*background:\s*var\(--sidebar\);)[^}]*}/s);
  assert.match(css, /\.sidebar-conversation-dot\.state-unread\s*{(?=[^}]*width:\s*8px;)(?=[^}]*height:\s*8px;)(?=[^}]*background:\s*#3b82f6;)[^}]*}/s);
  assert.match(html, /lucide-circle-alert/);
  assert.match(css, /\.sidebar-conversation-dot\.state-attention\s*{(?=[^}]*width:\s*12px;)(?=[^}]*height:\s*12px;)(?=[^}]*color:\s*#f97316;)(?=[^}]*background:\s*transparent;)[^}]*}/s);
  assert.match(css, /\.sidebar-conversation-dot\.state-attention\s+svg\s*{(?=[^}]*width:\s*12px;)(?=[^}]*height:\s*12px;)[^}]*}/s);
  assert.doesNotMatch(css, /\.sidebar-conversation-dot\.state-attention::before/);
  assert.match(css, /@keyframes\s+sidebar-conversation-spin/);
  assert.doesNotMatch(css, /@keyframes\s+sidebar-conversation-running-pulse/);
});

test("sidebar conversation read state prioritizes attention before running and unread rules", () => {
  assert.equal(
    resolveSidebarConversationReadState({
      conversationId: "conversation-1",
      activeConversationId: "conversation-2",
      runtimeStatus: "running",
      hasPendingInteraction: true,
      unreadConversationIds: new Set(),
    }),
    "attention",
  );
  assert.equal(
    resolveSidebarConversationReadState({
      conversationId: "conversation-1",
      activeConversationId: "conversation-2",
      runtimeStatus: "failed",
      unreadConversationIds: new Set(),
    }),
    "attention",
  );
  assert.equal(
    resolveSidebarConversationReadState({
      conversationId: "conversation-1",
      activeConversationId: "conversation-2",
      runtimeStatus: "running",
      unreadConversationIds: new Set(),
    }),
    "running",
  );
  assert.equal(
    resolveSidebarConversationReadState({
      conversationId: "conversation-1",
      activeConversationId: "conversation-1",
      runtimeStatus: "idle",
      hasPendingInteraction: false,
      unreadConversationIds: new Set(["conversation-1"]),
    }),
    "idle",
  );
  assert.equal(
    resolveSidebarConversationReadState({
      conversationId: "conversation-1",
      activeConversationId: "conversation-2",
      runtimeStatus: "idle",
      unreadConversationIds: new Set(["conversation-1"]),
    }),
    "unread",
  );
});

test("conversation completion state is kept as local sidebar read state", () => {
  const appSource = readFileSync(path.resolve(process.cwd(), "..", "src/App.tsx"), "utf8");
  const serviceSource = readFileSync(path.resolve(process.cwd(), "..", "electron/conversation-service.ts"), "utf8");
  const orchestratorSource = readFileSync(path.resolve(process.cwd(), "..", "electron/chat-orchestrator.ts"), "utf8");
  const typesSource = readFileSync(path.resolve(process.cwd(), "..", "src/types.ts"), "utf8");

  assert.doesNotMatch(serviceSource, /latest_completed_turn_id|viewed_completed_turn_id/);
  assert.doesNotMatch(serviceSource, /markConversationTurnCompleted|markConversationViewed/);
  assert.doesNotMatch(orchestratorSource, /markConversationTurnCompleted|completedConversation/);
  assert.doesNotMatch(appSource, /markConversationViewed|completedTurnId/);
  assert.doesNotMatch(appSource, /resolveSidebarConversationRunStatus|conversation-status|runStatus|isGenerating/);
  assert.match(appSource, /unreadConversationIds/);
  assert.match(appSource, /resolveSidebarConversationReadState/);
  assert.doesNotMatch(typesSource, /completedTurnId|conversation\?: ChatConversation/);
});

test("primary sidebar leaves browser out of the left navigation", () => {
  const html = renderToStaticMarkup(
    <PrimarySidebar
      view="chat"
      conversations={[]}
      activeConversationId={null}
      onCreateConversation={() => undefined}
      onDeleteConversation={() => undefined}
      onOpenConversation={() => undefined}
      onSetView={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /打开右侧浏览器/);
  assert.doesNotMatch(html, />浏览器/);
});

test("primary sidebar places memory between tools and knowledge", () => {
  const html = renderToStaticMarkup(
    <PrimarySidebar
      view="memory"
      conversations={[]}
      activeConversationId={null}
      onCreateConversation={() => undefined}
      onDeleteConversation={() => undefined}
      onOpenConversation={() => undefined}
      onSetView={() => undefined}
    />,
  );

  const toolsIndex = html.indexOf(">工具<");
  const memoryIndex = html.indexOf(">记忆<");
  const knowledgeIndex = html.indexOf(">知识库<");

  assert.ok(toolsIndex >= 0);
  assert.ok(memoryIndex > toolsIndex);
  assert.ok(knowledgeIndex > memoryIndex);
  assert.match(html, /class="sidebar-link active"/);
});

test("window chrome keeps controls in a dedicated top bar", () => {
  const html = renderToStaticMarkup(
    <AppTitleBar
      view="chat"
      sidebarWidth={280}
      windowState={{ platform: "win32", maximized: false }}
      onClose={() => undefined}
      onMinimize={() => undefined}
      onToggleMaximize={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /window-titlebar-copy/);
  assert.doesNotMatch(html, /super-agents/);
  assert.match(html, /window-titlebar/);
  assert.match(html, /window-controls-overlay/);

  const css = readFileSync(path.resolve(process.cwd(), "..", "src/styles.css"), "utf8");
  assert.match(css, /--window-chrome-height:\s*38px/);
  assert.match(
    css,
    /\.window-frame\s*{[^}]*grid-template-rows:\s*var\(--window-chrome-height\)\s+minmax\(0,\s*1fr\)/s,
  );
  assert.match(css, /\.window-titlebar\s*{[^}]*grid-row:\s*1/s);
  assert.match(css, /\.app-shell\s*{[^}]*grid-row:\s*2/s);
  assert.doesNotMatch(css, /\.window-controls-overlay\s*{[^}]*position:\s*absolute/s);
});
