import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeActivityItems } from "../../src/lib/runtime-activity";
import type { ChatToolCall } from "../../src/types";

function toolCall(title: string, status: ChatToolCall["status"] = "completed"): ChatToolCall {
  return {
    toolCallId: title,
    title,
    status,
    content: [],
  };
}

test("runtime activity groups exploration and command work into Codex-style summaries", () => {
  const items = buildRuntimeActivityItems([
    toolCall("read"),
    toolCall("grep"),
    toolCall("bash"),
  ]);

  assert.deepEqual(
    items.map((item) => item.text),
    ["已探索 1 个文件 1 次搜索", "已运行 1 条命令"],
  );
});

test("runtime activity keeps active summaries in a running state until every grouped tool finishes", () => {
  const items = buildRuntimeActivityItems([
    toolCall("read", "completed"),
    toolCall("grep", "in_progress"),
  ]);

  assert.equal(items[0]?.status, "running");
});
