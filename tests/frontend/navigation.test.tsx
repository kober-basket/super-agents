import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppTitleBar } from "../../src/features/navigation/AppTitleBar";
import { PrimarySidebar } from "../../src/features/navigation/PrimarySidebar";

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
  assert.match(html, /<span class="sidebar-conversation-time">[\s\S]*?<\/span><button aria-label="删除会话 需求讨论"/);
  assert.match(html, /aria-label="删除会话 需求讨论"/);

  const css = readFileSync(path.resolve(process.cwd(), "..", "src/styles.css"), "utf8");
  assert.match(css, /\.sidebar-conversation-trigger\s*{[^}]*padding:\s*7px\s+76px\s+7px\s+10px/s);
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

test("conversation status dots use blue running green completed red failure and gray idle colors", () => {
  const html = renderToStaticMarkup(
    <PrimarySidebar
      view="chat"
      conversations={[
        {
          id: "conversation-running",
          title: "运行任务",
          createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
          runStatus: "running",
        },
        {
          id: "conversation-completed",
          title: "完成任务",
          createdAt: Date.UTC(2026, 4, 17, 8, 1, 0),
          runStatus: "completed",
        },
        {
          id: "conversation-read",
          title: "已读任务",
          createdAt: Date.UTC(2026, 4, 17, 8, 2, 0),
          runStatus: "idle",
        },
        {
          id: "conversation-failed",
          title: "失败任务",
          createdAt: Date.UTC(2026, 4, 17, 8, 3, 0),
          runStatus: "failed",
        },
      ] as any}
      activeConversationId={null}
      onCreateConversation={() => undefined}
      onDeleteConversation={() => undefined}
      onOpenConversation={() => undefined}
      onSetView={() => undefined}
    />,
  );

  assert.match(html, /status-running/);
  assert.match(html, /status-completed/);
  assert.doesNotMatch(html, /status-needs_attention/);
  assert.match(html, /status-failed/);
  assert.match(html, /aria-label="会话状态：执行中"/);
  assert.match(html, /aria-label="会话状态：已完成"/);
  assert.match(html, /aria-label="会话状态：空闲"/);
  assert.match(html, /aria-label="会话状态：执行出错"/);

  const css = readFileSync(path.resolve(process.cwd(), "..", "src/styles.css"), "utf8");
  assert.match(css, /\.sidebar-conversation-item\.status-running\s+\.sidebar-conversation-dot\s*{[^}]*background:\s*#2563eb/s);
  assert.match(css, /\.sidebar-conversation-item\.status-completed\s+\.sidebar-conversation-dot\s*{[^}]*background:\s*#12b76a/s);
  assert.match(css, /\.sidebar-conversation-item\.status-failed\s+\.sidebar-conversation-dot\s*{[^}]*background:\s*#d92d20/s);
  assert.doesNotMatch(css, /\.sidebar-conversation-item\.active\s+\.sidebar-conversation-dot\s*{[^}]*background:/s);
  assert.doesNotMatch(css, /\.sidebar-conversation-item\.status-needs_attention/);
  assert.doesNotMatch(css, /\.sidebar-conversation-item\.status-completed\s+\.sidebar-conversation-dot\s*{[^}]*animation:/s);
  assert.doesNotMatch(css, /\.sidebar-conversation-item\.status-failed\s+\.sidebar-conversation-dot\s*{[^}]*animation:/s);
});

test("conversation A turns green after finishing while the user is reading conversation B", () => {
  const appSource = readFileSync(path.resolve(process.cwd(), "..", "src/App.tsx"), "utf8");
  const serviceSource = readFileSync(path.resolve(process.cwd(), "..", "electron/conversation-service.ts"), "utf8");
  const orchestratorSource = readFileSync(path.resolve(process.cwd(), "..", "electron/chat-orchestrator.ts"), "utf8");

  assert.match(serviceSource, /latest_completed_turn_id/);
  assert.doesNotMatch(serviceSource, /viewed_completed_turn_id/);
  assert.match(orchestratorSource, /markConversationTurnCompleted\(activeTurn\.conversationId/);
  assert.match(orchestratorSource, /conversation:\s*completedConversation/);
  assert.match(appSource, /workspaceClient\s*\.\s*markConversationViewed\(event\.conversationId\)/);
  assert.match(appSource, /const\s+completedConversation\s*=\s*event\.conversation/);
  assert.match(appSource, /workspaceClient\s*\.\s*getConversation\(event\.conversationId\)/);
  assert.match(appSource, /workspaceClient\.markConversationViewed\(conversationId\)/);
  assert.match(appSource, /const\s+hasCompletion\s*=\s*conversation\.id\s*!==\s*activeConversationId\s*&&\s*Boolean\(conversation\.completedTurnId\)/);
  assert.match(appSource, /shouldApplyStartedConversationAsActive\(activeConversationIdRef\.current,\s*nextConversationId\)/);
  assert.doesNotMatch(appSource, /UNREAD_COMPLETED_CONVERSATIONS_STORAGE_KEY/);
  assert.doesNotMatch(appSource, /unreadCompletedConversations/);
  assert.doesNotMatch(appSource, /localStorage\.setItem\([^)]*unread-completed-conversations/s);
  assert.doesNotMatch(appSource, /activeConversation\?\.(?:id|lastMessageAt)/);
  assert.match(
    appSource,
    /resolveSidebarConversationRunStatus\(\s*runtimeState,\s*hasPendingApproval,\s*hasCompletion,\s*\)/s,
  );
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
  assert.doesNotMatch(html, />浏览器</);
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
