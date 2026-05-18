import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

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
