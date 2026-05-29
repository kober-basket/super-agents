import assert from "node:assert/strict";
import test from "node:test";

import {
  generateConversationTitle,
  sanitizeGeneratedConversationTitle,
} from "../../electron/chat-title-generator";
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

  assert.equal(title, "Token refresh");
  assert.equal(capturedRequest?.toolChoice, "none");
  assert.deepEqual(capturedRequest?.tools, []);
  assert.match(capturedRequest?.system ?? "", /Return only the title/i);
  assert.notEqual(title, "Please inspect the login flow, che...");
});

test("AI conversation title generation keeps the saved title within 15 characters", async () => {
  const title = await generateConversationTitle(
    {
      userMessage: "帮我检查模型设置页面里图片识别模型的保存逻辑为什么不生效。",
      assistantMessage: "我已经定位到配置映射缺失，并修复了保存和恢复流程。",
    },
    {
      stream: async function* () {
        yield {
          type: "text_delta",
          text: "模型设置页面图片识别模型保存逻辑修复和回归验证",
        };
        yield { type: "done", stopReason: "stop" };
      },
    },
  );

  assert.equal(title, "模型设置页面图片识别模型保存逻");
  assert.ok(Array.from(title ?? "").length <= 15);
});

test("conversation title sanitization truncates by Unicode characters", () => {
  const title = sanitizeGeneratedConversationTitle("Title: 🚀模型设置页面图片识别模型保存逻辑修复。");

  assert.equal(title, "🚀模型设置页面图片识别模型保存");
  assert.ok(Array.from(title ?? "").length <= 15);
});
