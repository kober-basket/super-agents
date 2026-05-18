import assert from "node:assert/strict";
import test from "node:test";

import { shouldRenderRuntimeToolCard } from "../../src/lib/runtime-tool-visibility";
import type { ChatToolCall } from "../../src/types";

function toolCall(status: ChatToolCall["status"]): ChatToolCall {
  return {
    toolCallId: "tool-1",
    title: "read",
    status,
    content: [],
  };
}

test("runtime tool cards stay visible while a tool is running even before output arrives", () => {
  assert.equal(
    shouldRenderRuntimeToolCard(toolCall("in_progress"), {
      hasRawInput: false,
      hasRawOutput: false,
      hasVisibleContent: false,
      isStreaming: true,
    }),
    true,
  );
});

test("empty completed tool cards remain hidden when no details exist", () => {
  assert.equal(
    shouldRenderRuntimeToolCard(toolCall("completed"), {
      hasRawInput: false,
      hasRawOutput: false,
      hasVisibleContent: false,
      isStreaming: false,
    }),
    false,
  );
});
