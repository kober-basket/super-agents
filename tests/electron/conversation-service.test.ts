import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConversationService } from "../../electron/conversation-service";

test("conversation service persists conversations and messages", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const initialList = await service.listConversations();
    assert.equal(initialList.conversations.length, 0);

    const created = await service.sendMessage({
      content: "请帮我整理这份需求",
      attachments: [
        {
          id: "file-1",
          name: "spec.md",
          path: "C:/workspace/spec.md",
          size: 128,
          mimeType: "text/markdown",
          kind: "markdown",
          content: "# spec",
        },
      ],
    });

    assert.equal(created.createdConversation, true);
    assert.equal(created.conversation.messages.length, 2);
    assert.equal(created.conversation.messages[0]?.role, "user");
    assert.equal(created.conversation.messages[1]?.role, "assistant");
    assert.equal(created.conversation.messages[0]?.attachments?.[0]?.name, "spec.md");

    const loaded = await service.getConversation(created.conversation.id);
    assert.equal(loaded.id, created.conversation.id);
    assert.equal(loaded.messages.length, 2);
    assert.equal(loaded.messages[0]?.content, "请帮我整理这份需求");

    const listAfterCreate = await service.listConversations();
    assert.equal(listAfterCreate.conversations.length, 1);
    assert.equal(listAfterCreate.conversations[0]?.id, created.conversation.id);

    const listAfterDelete = await service.deleteConversation(created.conversation.id);
    assert.equal(listAfterDelete.conversations.length, 0);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation service keeps knowledge base selection per conversation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Use the product docs for this thread",
        selectedKnowledgeBaseIds: ["kb-product", "kb-faq", "kb-product"],
      },
      { agentCore: "opencode" },
    );

    assert.deepEqual(started.conversation.selectedKnowledgeBaseIds, ["kb-product", "kb-faq"]);

    const continued = await service.startTurn(
      {
        conversationId: started.conversation.id,
        content: "Keep going without changing the knowledge bases",
      },
      { agentCore: "opencode" },
    );

    assert.deepEqual(continued.conversation.selectedKnowledgeBaseIds, ["kb-product", "kb-faq"]);

    const switched = await service.startTurn(
      {
        conversationId: started.conversation.id,
        content: "Switch this thread to another knowledge base",
        selectedKnowledgeBaseIds: ["kb-release-notes"],
      },
      { agentCore: "opencode" },
    );

    assert.deepEqual(switched.conversation.selectedKnowledgeBaseIds, ["kb-release-notes"]);

    const loaded = await service.getConversation(started.conversation.id);
    assert.deepEqual(loaded.selectedKnowledgeBaseIds, ["kb-release-notes"]);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});
