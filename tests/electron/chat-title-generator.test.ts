import assert from "node:assert/strict";
import test from "node:test";

import { generateConversationTitle } from "../../electron/chat-title-generator";
import type { ModelRequest } from "../../electron/agent-core";

test("AI conversation title generation uses the model output instead of truncating the first prompt", async () => {
  let capturedRequest: ModelRequest | undefined;

  const title = await generateConversationTitle(
    {
      userMessage:
        "Please inspect the login flow, check how token refresh currently works, and then make the failing test pass.",
      assistantMessage: "I traced the refresh path and fixed the stale token retry branch.",
    },
    {
      stream: async function* (request: ModelRequest) {
        capturedRequest = request;
        yield { type: "text_delta", text: 'Title: Token refresh fix.' };
        yield { type: "done", stopReason: "stop" };
      },
    },
  );

  assert.equal(title, "Token refresh fix");
  assert.equal(capturedRequest?.toolChoice, "none");
  assert.deepEqual(capturedRequest?.tools, []);
  assert.match(capturedRequest?.system ?? "", /Return only the title/i);
  assert.notEqual(title, "Please inspect the login flow, che...");
});
