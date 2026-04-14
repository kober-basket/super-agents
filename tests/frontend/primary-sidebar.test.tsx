import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PrimarySidebar } from "../../src/features/navigation/PrimarySidebar";

test("PrimarySidebar renders ACP chat sessions", () => {
  const markup = renderToStaticMarkup(
    <PrimarySidebar
      activeChatSessionId="session-1"
      chatSessions={[
        {
          id: "session-1",
          title: "你好",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]}
      view="chat"
      onNewChat={() => undefined}
      onSelectChatSession={() => undefined}
      onSetView={() => undefined}
    />,
  );

  assert.match(markup, /你好/);
  assert.match(markup, /会话/);
});
