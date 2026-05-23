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
