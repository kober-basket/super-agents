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
