import assert from "node:assert/strict";
import test from "node:test";

import { upsertConversationSummaryList } from "../../src/features/chat/conversation-list";
import type { ChatConversationSummary } from "../../src/types";

function summary(
  id: string,
  title: string,
  lastMessageAt: number,
): ChatConversationSummary {
  return {
    id,
    title,
    createdAt: lastMessageAt,
    updatedAt: lastMessageAt,
    lastMessageAt,
    preview: title,
    messageCount: 2,
    selectedKnowledgeBaseIds: [],
  };
}

test("conversation summary upsert replaces a temporary optimistic row with the real conversation", () => {
  const temp = summary("temp-local", "向我提问一个问题，用question工具", 10);
  const older = summary("older", "查看桌面文件", 1);
  const real = summary("real-server", "向我提问一个问题，用question工具", 20);

  const result = upsertConversationSummaryList([temp, older], real, {
    replaceConversationId: temp.id,
  });

  assert.deepEqual(
    result.map((conversation) => conversation.id),
    ["real-server", "older"],
  );
});
