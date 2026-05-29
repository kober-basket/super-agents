import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
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
      { agentCore: "native" },
    );

    assert.deepEqual(started.conversation.selectedKnowledgeBaseIds, ["kb-product", "kb-faq"]);

    const continued = await service.startTurn(
      {
        conversationId: started.conversation.id,
        content: "Keep going without changing the knowledge bases",
      },
      { agentCore: "native" },
    );

    assert.deepEqual(continued.conversation.selectedKnowledgeBaseIds, ["kb-product", "kb-faq"]);

    const switched = await service.startTurn(
      {
        conversationId: started.conversation.id,
        content: "Switch this thread to another knowledge base",
        selectedKnowledgeBaseIds: ["kb-release-notes"],
      },
      { agentCore: "native" },
    );

    assert.deepEqual(switched.conversation.selectedKnowledgeBaseIds, ["kb-release-notes"]);

    const loaded = await service.getConversation(started.conversation.id);
    assert.deepEqual(loaded.selectedKnowledgeBaseIds, ["kb-release-notes"]);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation service creates a persisted workspace directory for new conversations", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Start a workspace-backed conversation",
      },
      { agentCore: "native" },
    );
    const workspaceRoot = started.conversation.workspaceRoot;

    assert.equal(path.dirname(workspaceRoot), path.join(tempDir, "workspaces"));
    assert.match(path.basename(workspaceRoot), /^[a-f0-9-]{36}$/);
    assert.equal((await stat(workspaceRoot)).isDirectory(), true);

    const continued = await service.startTurn(
      {
        conversationId: started.conversation.id,
        content: "Keep using the same workspace",
      },
      { agentCore: "native" },
    );
    assert.equal(continued.conversation.workspaceRoot, workspaceRoot);

    const listed = await service.listConversations();
    assert.equal(listed.conversations[0]?.workspaceRoot, workspaceRoot);

    const loaded = await service.getConversation(started.conversation.id);
    assert.equal(loaded.workspaceRoot, workspaceRoot);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation service uses a requested workspace directory for new conversations", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));
  const selectedWorkspace = path.join(tempDir, "selected-workspace");

  await mkdir(selectedWorkspace, { recursive: true });
  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Start this conversation in the selected project",
        workspaceRoot: selectedWorkspace,
      },
      { agentCore: "native" },
    );

    assert.equal(started.conversation.workspaceRoot, selectedWorkspace);

    const listed = await service.listConversations();
    assert.equal(listed.conversations[0]?.workspaceRoot, selectedWorkspace);

    const loaded = await service.getConversation(started.conversation.id);
    assert.equal(loaded.workspaceRoot, selectedWorkspace);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation service updates the workspace directory for existing conversations", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));
  const selectedWorkspace = path.join(tempDir, "existing-workspace");

  await mkdir(selectedWorkspace, { recursive: true });
  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Start with the generated workspace",
      },
      { agentCore: "native" },
    );

    const updated = await service.updateConversationWorkspaceRoot(started.conversation.id, selectedWorkspace);

    assert.equal(updated.workspaceRoot, selectedWorkspace);
    assert.equal(updated.updatedAt, started.conversation.updatedAt);
    assert.equal(updated.lastMessageAt, started.conversation.lastMessageAt);

    const listed = await service.listConversations();
    assert.equal(listed.conversations[0]?.workspaceRoot, selectedWorkspace);

    const loaded = await service.getConversation(started.conversation.id);
    assert.equal(loaded.workspaceRoot, selectedWorkspace);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation title updates do not move the conversation in the message timeline", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Help me debug the login flow",
      },
      { agentCore: "native" },
    );
    const before = await service.getConversation(started.conversation.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const renamed = await service.updateConversationTitle(started.conversation.id, "Login flow debug");

    assert.equal(renamed.title, "Login flow debug");
    assert.equal(renamed.updatedAt, before.updatedAt);
    assert.equal(renamed.lastMessageAt, before.lastMessageAt);

    const listed = await service.listConversations();
    assert.equal(listed.conversations[0]?.updatedAt, before.updatedAt);
    assert.equal(listed.conversations[0]?.lastMessageAt, before.lastMessageAt);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("assistant message updates do not move the conversation in the message timeline", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const older = await service.startTurn(
      {
        content: "First question",
      },
      { agentCore: "native" },
    );
    const before = await service.getConversation(older.conversation.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await service.startTurn(
      {
        content: "Second question",
      },
      { agentCore: "native" },
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.updateAssistantMessage(
      older.conversation.id,
      older.assistantMessage.id,
      "Finished the first answer",
    );

    const updatedOlder = await service.getConversation(older.conversation.id);
    assert.equal(updatedOlder.lastMessageAt, before.lastMessageAt);
    assert.notEqual(updatedOlder.updatedAt, before.updatedAt);

    const listed = await service.listConversations();
    assert.deepEqual(
      listed.conversations.map((conversation) => conversation.id),
      [newer.conversation.id, older.conversation.id],
    );
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation service clears completed turn markers after the conversation is viewed", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Run this in the background",
      },
      { agentCore: "native" },
    );

    await service.markConversationTurnCompleted(started.conversation.id, {
      turnId: "turn-background-1",
      stopReason: "end_turn",
    });

    const completedList = await service.listConversations();
    assert.equal(completedList.conversations[0]?.completedTurnId, "turn-background-1");

    const completedConversation = await service.getConversation(started.conversation.id);
    assert.equal(completedConversation.completedTurnId, "turn-background-1");

    const viewedConversation = await service.markConversationViewed(started.conversation.id);
    assert.equal(viewedConversation.completedTurnId, undefined);

    const viewedList = await service.listConversations();
    assert.equal(viewedList.conversations[0]?.completedTurnId, undefined);

    await service.markConversationTurnCompleted(started.conversation.id, {
      turnId: "turn-background-2",
      stopReason: "end_turn",
    });

    await service.markConversationTurnCompleted(started.conversation.id, {
      turnId: "turn-cancelled",
      stopReason: "cancelled",
    });

    const cancelledList = await service.listConversations();
    assert.equal(cancelledList.conversations[0]?.completedTurnId, "turn-background-2");

    const cancelledOnly = await service.startTurn(
      {
        content: "Cancel this before any successful completion",
      },
      { agentCore: "native" },
    );

    await service.markConversationTurnCompleted(cancelledOnly.conversation.id, {
      turnId: "turn-cancelled-only",
      stopReason: "cancelled",
    });

    const cancelledOnlyConversation = await service.getConversation(cancelledOnly.conversation.id);
    assert.equal(cancelledOnlyConversation.completedTurnId, undefined);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation service persists assistant visuals separately from text", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-conversations-"));
  const service = new ConversationService(path.join(tempDir, "data", "app.db"));

  await service.initialize();

  try {
    const started = await service.startTurn(
      {
        content: "Show me the execution flow",
      },
      { agentCore: "native" },
    );

    await service.updateAssistantMessage(
      started.conversation.id,
      started.assistantMessage.id,
      "",
      [
        {
          id: "vis-1",
          type: "diagram",
          style: "mermaid",
          title: "Execution flow",
          code: "graph TD; User-->API; API-->Worker;",
        },
      ],
    );

    const loaded = await service.getConversation(started.conversation.id);
    const assistantMessage = loaded.messages.find((message) => message.id === started.assistantMessage.id);
    assert.equal(assistantMessage?.content, "");
    assert.equal(assistantMessage?.visuals?.length, 1);
    assert.equal(assistantMessage?.visuals?.[0]?.type, "diagram");

    const listed = await service.listConversations();
    assert.equal(listed.conversations[0]?.preview, "Execution flow");
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});
