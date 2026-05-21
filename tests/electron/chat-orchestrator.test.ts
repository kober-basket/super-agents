import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ChatOrchestrator } from "../../electron/chat-orchestrator";
import { ConversationService } from "../../electron/conversation-service";
import type { AgentEvent } from "../../electron/agent-core";
import type { AppConfig, ChatEvent } from "../../src/types";
import type { WorkspaceService } from "../../electron/workspace-service";

function createConfig(workspaceRoot: string): AppConfig {
  return {
    workspaceRoot,
    bridgeUrl: "",
    environment: "local",
    defaultAgentMode: "general",
    activeModelId: "",
    contextTier: "medium",
    appearance: { theme: "porcelain" },
    proxy: { http: "", https: "", bypass: "" },
    modelProviders: [],
    mcpServers: [],
    skills: [],
    knowledgeBase: {
      enabled: false,
      embeddingProviderId: "",
      embeddingModel: "",
      selectedBaseIds: [],
      documentCount: 0,
      chunkSize: 800,
      chunkOverlap: 120,
    },
    remoteControl: {
      dingtalk: { enabled: false, clientId: "", clientSecret: "" },
      feishu: { enabled: false, appId: "", appSecret: "", domain: "feishu" },
      wechat: {
        enabled: false,
        baseUrl: "",
        cdnBaseUrl: "",
        botToken: "",
        accountId: "",
        userId: "",
        connectedAt: null,
      },
      wecom: { enabled: false, botId: "", secret: "", websocketUrl: "" },
    },
    security: { fullFileSystemAccess: false },
  };
}

function waitFor<T>(promise: Promise<T>, label: string, timeoutMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

test("chat orchestrator forwards agent thoughts into runtime trace and thought events", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
    }).nativeCore = {
      async *sendTurn() {
        yield { type: "thought_delta", sessionId: "s", agentId: "a", text: "Planning. " };
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "Answer." };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "hello" });
    await execution.completion;

    assert.deepEqual(
      events.filter((event) => event.type === "thought_delta").map((event) => event.textDelta),
      ["Planning. "],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "message_delta").map((event) => event.textDelta),
      ["Answer."],
    );

    const loaded = await conversationService.getConversation(execution.result.conversation.id);
    const assistantMessage = loaded.messages.find((message) => message.role === "assistant");
    assert.equal(assistantMessage?.content, "Answer.");
    assert.equal(assistantMessage?.runtimeTrace?.thoughtText, "Planning. ");
    assert.deepEqual(
      assistantMessage?.runtimeTrace?.events.map((event) => event.type),
      ["turn_started", "thought_delta", "message_delta", "turn_finished"],
    );
    assert.equal(assistantMessage?.runtimeTrace?.events[1]?.text, "Planning. ");
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("chat orchestrator updates a new conversation title from an AI summary after the first exchange", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    let resolveTitleUpdate!: (event: Extract<ChatEvent, { type: "conversation_updated" }>) => void;
    const titleUpdated = new Promise<Extract<ChatEvent, { type: "conversation_updated" }>>((resolve) => {
      resolveTitleUpdate = resolve;
    });
    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
      if (event.type === "conversation_updated") {
        resolveTitleUpdate(event);
      }
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
      titleGenerator: {
        generate(input: { userMessage: string; assistantMessage: string }): Promise<string | null>;
      };
    }).nativeCore = {
      async *sendTurn() {
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "I found the title-worthy intent." };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };
    (orchestrator as unknown as {
      titleGenerator: {
        generate(input: { userMessage: string; assistantMessage: string }): Promise<string | null>;
      };
    }).titleGenerator = {
      async generate(input) {
        assert.equal(input.userMessage, "make title smarter");
        assert.equal(input.assistantMessage, "I found the title-worthy intent.");
        return "AI title summary";
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "make title smarter" });

    assert.equal(execution.result.conversation.title, "新对话");
    await execution.completion;

    const updated = await waitFor(titleUpdated, "conversation title update");
    assert.equal(updated.conversation.title, "AI title summary");
    assert.equal(events.some((event) => event.type === "conversation_updated"), true);

    const loaded = await conversationService.getConversation(execution.result.conversation.id);
    assert.equal(loaded.title, "AI title summary");
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("chat orchestrator emits message deltas before a native turn finishes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    let releaseSecondDelta!: () => void;
    const secondDeltaMayStream = new Promise<void>((resolve) => {
      releaseSecondDelta = resolve;
    });
    let resolveFirstDelta!: () => void;
    const firstDeltaSeen = new Promise<void>((resolve) => {
      resolveFirstDelta = resolve;
    });
    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
      if (event.type === "message_delta" && event.textDelta === "Part 1 ") {
        resolveFirstDelta();
      }
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
    }).nativeCore = {
      async *sendTurn() {
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "Part 1 " };
        await secondDeltaMayStream;
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "Part 2" };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "hello" });
    await waitFor(firstDeltaSeen, "first message delta");

    assert.deepEqual(
      events.filter((event) => event.type === "message_delta").map((event) => event.textDelta),
      ["Part 1 "],
    );
    assert.equal(events.some((event) => event.type === "turn_finished"), false);

    releaseSecondDelta();
    await execution.completion;

    assert.deepEqual(
      events.filter((event) => event.type === "message_delta").map((event) => event.textDelta),
      ["Part 1 ", "Part 2"],
    );
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("chat orchestrator emits Codex-style activity summaries for native tool events", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
    }).nativeCore = {
      async *sendTurn() {
        const readCall = { id: "tool-read", name: "read", input: { path: "src/App.tsx" } };
        const grepCall = { id: "tool-grep", name: "grep", input: { query: "ChatEvent" } };
        const bashCall = { id: "tool-bash", name: "bash", input: { command: "npm test" } };

        yield { type: "tool_call_started", sessionId: "s", agentId: "a", toolCall: readCall };
        yield {
          type: "tool_call_finished",
          sessionId: "s",
          agentId: "a",
          toolCall: readCall,
          result: { content: "file content", metadata: { path: "src/App.tsx" } },
        };
        yield { type: "tool_call_started", sessionId: "s", agentId: "a", toolCall: grepCall };
        yield {
          type: "tool_call_finished",
          sessionId: "s",
          agentId: "a",
          toolCall: grepCall,
          result: { content: "matches", metadata: { path: ".", maxResults: 80 } },
        };
        yield { type: "tool_call_started", sessionId: "s", agentId: "a", toolCall: bashCall };
        yield {
          type: "tool_call_finished",
          sessionId: "s",
          agentId: "a",
          toolCall: bashCall,
          result: { content: "ok", metadata: { exitCode: 0 } },
        };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "inspect this" });
    await execution.completion;

    const activityEvents = events.filter(
      (event): event is Extract<ChatEvent, { type: "activity_summary" }> =>
        event.type === "activity_summary",
    );

    assert.deepEqual(
      activityEvents.at(-1)?.items.map((item) => item.text),
      ["已探索 1 个文件 1 次搜索", "已运行 1 条命令"],
    );

    const loaded = await conversationService.getConversation(execution.result.conversation.id);
    const assistantMessage = loaded.messages.find((message) => message.role === "assistant");
    assert.deepEqual(
      assistantMessage?.runtimeTrace?.activityItems.map((item) => item.text),
      ["已探索 1 个文件 1 次搜索", "已运行 1 条命令"],
    );
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("chat orchestrator preserves thought, tool, and status order in runtime timeline", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
    }).nativeCore = {
      async *sendTurn() {
        const readCall = { id: "tool-read", name: "read", input: { path: "src/App.tsx" } };
        yield { type: "thought_delta", sessionId: "s", agentId: "a", text: "Before tool. " };
        yield { type: "tool_call_started", sessionId: "s", agentId: "a", toolCall: readCall };
        yield {
          type: "tool_call_finished",
          sessionId: "s",
          agentId: "a",
          toolCall: readCall,
          result: { content: "file content", metadata: { path: "src/App.tsx" } },
        };
        yield { type: "thought_delta", sessionId: "s", agentId: "a", text: "After tool. " };
        yield { type: "status_delta", sessionId: "s", agentId: "a", text: "我已经读完关键路径。" };
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "Final answer." };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "inspect order" });
    await execution.completion;

    assert.deepEqual(
      events.filter((event) => event.type === "status_delta").map((event) => event.textDelta),
      ["我已经读完关键路径。"],
    );

    const loaded = await conversationService.getConversation(execution.result.conversation.id);
    const assistantMessage = loaded.messages.find((message) => message.role === "assistant");
    const timelineItems = assistantMessage?.runtimeTrace?.timelineItems ?? [];

    assert.deepEqual(
      timelineItems.map((item) => item.type),
      ["thought", "activity", "tool", "thought", "status"],
    );
    assert.equal(timelineItems[0]?.type === "thought" ? timelineItems[0].text : "", "Before tool. ");
    assert.equal(timelineItems[1]?.type === "activity" ? timelineItems[1].activity.text : "", "已探索 1 个文件");
    assert.equal(timelineItems[2]?.type === "tool" ? timelineItems[2].toolCallId : "", "tool-read");
    assert.equal(timelineItems[3]?.type === "thought" ? timelineItems[3].text : "", "After tool. ");
    assert.equal(timelineItems[4]?.type === "status" ? timelineItems[4].text : "", "我已经读完关键路径。");
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("chat orchestrator marks errored tool results as failed runtime tool calls", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
    }).nativeCore = {
      async *sendTurn() {
        const bashCall = { id: "tool-bash", name: "bash", input: { command: "exit 1" } };
        yield { type: "tool_call_started", sessionId: "s", agentId: "a", toolCall: bashCall };
        yield {
          type: "tool_call_finished",
          sessionId: "s",
          agentId: "a",
          toolCall: bashCall,
          result: { content: "command failed", metadata: { exitCode: 1 } },
        };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "run failing command" });
    await execution.completion;

    const updated = events.find(
      (event): event is Extract<ChatEvent, { type: "tool_call_updated" }> =>
        event.type === "tool_call_updated" && event.toolCallId === "tool-bash",
    );
    assert.equal(updated?.patch.status, "failed");

    const loaded = await conversationService.getConversation(execution.result.conversation.id);
    const assistantMessage = loaded.messages.find((message) => message.role === "assistant");
    assert.equal(assistantMessage?.runtimeTrace?.toolCalls[0]?.status, "failed");
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("chat orchestrator commits pre-tool assistant text into process timeline after turn completion", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-orchestrator-"));
  const conversationService = new ConversationService(path.join(tempDir, "data", "app.db"));
  await conversationService.initialize();

  try {
    const workspaceService = {
      async getConfigSnapshot() {
        return createConfig(tempDir);
      },
      async getEnabledSkillPromptContext() {
        return "";
      },
      async searchKnowledgeBases() {
        return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
      },
    } as unknown as WorkspaceService;

    const events: ChatEvent[] = [];
    const orchestrator = new ChatOrchestrator(conversationService, workspaceService, (event) => {
      events.push(event);
    });

    (orchestrator as unknown as {
      nativeCore: {
        sendTurn(): AsyncIterable<AgentEvent>;
      };
    }).nativeCore = {
      async *sendTurn() {
        const readCall = { id: "tool-read", name: "read", input: { path: "src/App.tsx" } };
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "Looking first. " };
        yield { type: "tool_call_started", sessionId: "s", agentId: "a", toolCall: readCall };
        yield {
          type: "tool_call_finished",
          sessionId: "s",
          agentId: "a",
          toolCall: readCall,
          result: { content: "file content", metadata: { path: "src/App.tsx" } },
        };
        yield { type: "message_delta", sessionId: "s", agentId: "a", text: "Final answer." };
        yield { type: "turn_finished", sessionId: "s", agentId: "a", stopReason: "end_turn" };
      },
    };

    const execution = await orchestrator.startTurnWithCompletion({ content: "inspect order" });
    await execution.completion;

    assert.deepEqual(
      events.filter((event) => event.type === "message_delta").map((event) => event.textDelta),
      ["Looking first. ", "Final answer."],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "status_delta").map((event) => event.textDelta),
      [],
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === "message_updated" &&
          event.messageId === execution.result.conversation.messages.at(-1)?.id &&
          event.content === "",
      ),
      false,
    );

    const loaded = await conversationService.getConversation(execution.result.conversation.id);
    const assistantMessage = loaded.messages.find((message) => message.role === "assistant");
    const timelineItems = assistantMessage?.runtimeTrace?.timelineItems ?? [];
    assert.equal(assistantMessage?.content, "Final answer.");
    assert.equal(timelineItems[0]?.type === "status" ? timelineItems[0].text : "", "Looking first. ");
    assert.equal(timelineItems[2]?.type === "tool" ? timelineItems[2].toolCallId : "", "tool-read");
  } finally {
    await conversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});
