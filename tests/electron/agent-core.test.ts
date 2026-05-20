import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AgentCore,
  AgentRegistry,
  DEFAULT_AGENT_ID,
  OpenAICompatibleModelGateway,
  PersistentAgentSessionManager,
  PermissionManager,
  PromptComposer,
  SkillRegistry,
  ToolRegistry,
  createBuiltinToolDefinitions,
  createDefaultAgentRegistry,
  type ModelEvent,
  type ModelGateway,
  type ModelRequest,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
  type ToolDefinition,
} from "../../electron/agent-core";
import type { AppConfig } from "../../src/types";
import { buildLocalDirectoryContext } from "../../electron/chat-orchestrator";
import { ConversationService } from "../../electron/conversation-service";

class ScriptedModelGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly scripts: ModelEvent[][]) {}

  async *stream(input: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(input);
    const script = this.scripts.shift() ?? [{ type: "done", stopReason: "end_turn" }];
    for (const event of script) {
      yield event;
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toolConcurrencySafety(tool: ToolDefinition | undefined, input: unknown) {
  const value = tool?.isConcurrencySafe;
  return typeof value === "function" ? value(input) : value === true;
}

function createCore(
  modelGateway: ModelGateway,
  sessions?: ConstructorParameters<typeof AgentCore>[0]["sessions"],
) {
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();

  agents.register({
    id: "neutral",
    name: "Neutral Assistant",
    description: "A neutral non-coding assistant",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Answer directly without assuming a software engineering task.",
    model: "test-model",
    tools: ["lookup"],
    skills: ["brief"],
    permissionPolicy: {
      allowedTools: ["lookup"],
      allowRisk: ["read"],
      maxToolCallsPerTurn: 2,
    },
  });

  skills.register({
    id: "brief",
    name: "Brief Answers",
    description: "Prefer concise answers",
    instructions: "Keep answers concise unless the user asks for depth.",
  });

  tools.register({
    name: "lookup",
    description: "Look up a value from a test dictionary",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
    },
    risk: "read",
    async execute(input) {
      const key = typeof input === "object" && input && "key" in input ? String(input.key) : "";
      return { content: `value:${key}` };
    },
  });

  return new AgentCore({ agents, skills, tools, modelGateway, sessions });
}

function createDefaultCore(modelGateway: ModelGateway) {
  const agents = createDefaultAgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  for (const tool of createBuiltinToolDefinitions()) {
    tools.register(tool);
  }
  return new AgentCore({ agents, skills, tools, modelGateway });
}

function createSingleToolCore(
  modelGateway: ModelGateway,
  tool: ToolDefinition,
  approvalHandler?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>,
) {
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();

  agents.register({
    id: "tool-agent",
    name: "Tool Agent",
    description: "Tool test agent",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: [tool.name],
    permissionPolicy: {
      allowedTools: [tool.name],
      allowRisk: [tool.risk],
    },
  });
  tools.register(tool);

  return new AgentCore({ agents, skills, tools, modelGateway, approvalHandler });
}

function getBuiltinTool(name: string) {
  const tool = createBuiltinToolDefinitions().find((item) => item.name === name);
  assert.ok(tool, `Expected built-in tool ${name} to be registered`);
  return tool;
}

test("native agent core emits direct text once no tool call is present", async () => {
  const gateway = new ScriptedModelGateway([
    [
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，我是中立助手。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "session-1",
    agentId: "neutral",
    content: "你好",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["你好，我是中立助手。"],
  );
  assert.equal(events.at(-1)?.type, "turn_finished");
  assert.match(gateway.requests[0]?.system ?? "", /Answer directly without assuming/);
  assert.match(gateway.requests[0]?.system ?? "", /Keep answers concise/);
});

test("native agent core emits reasoning separately from assistant text", async () => {
  const gateway = new ScriptedModelGateway([
    [
      { type: "reasoning_delta", text: "I should inspect the request first. " },
      { type: "text_delta", text: "Visible answer." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "reasoning-session",
    agentId: "neutral",
    content: "think then answer",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "thought_delta").map((event) => event.text),
    ["I should inspect the request first. "],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Visible answer."],
  );
  assert.deepEqual(core.getSession("reasoning-session")?.messages.at(-1), {
    role: "assistant",
    content: "Visible answer.",
    toolCalls: [],
  });
});

test("native agent core persists and restores session messages", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-agent-session-"));
  const databasePath = path.join(tempDir, "data", "app.db");
  const firstConversationService = new ConversationService(databasePath);
  await firstConversationService.initialize();

  try {
    const firstGateway = new ScriptedModelGateway([
      [
        { type: "text_delta", text: "Persistent answer." },
        { type: "done", stopReason: "end_turn" },
      ],
    ]);
    const firstCore = createCore(
      firstGateway,
      new PersistentAgentSessionManager(firstConversationService),
    );

    for await (const _event of firstCore.sendTurn({
      sessionId: "persistent-session",
      agentId: "neutral",
      content: "remember this",
    })) {
      // Drain the turn.
    }
  } finally {
    await firstConversationService.shutdown();
  }

  const secondConversationService = new ConversationService(databasePath);
  await secondConversationService.initialize();
  try {
    const restoredSession = new PersistentAgentSessionManager(secondConversationService)
      .get("persistent-session");

    assert.deepEqual(restoredSession?.messages, [
      { role: "user", content: "remember this" },
      { role: "assistant", content: "Persistent answer.", toolCalls: [] },
    ]);
  } finally {
    await secondConversationService.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("native agent core continues when a model returns only hidden reasoning", async () => {
  const gateway = new ScriptedModelGateway([
    [
      { type: "reasoning_delta", text: "I need to gather evidence before answering. " },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-after-reasoning",
          name: "lookup",
          input: { key: "gold" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Gold report based on value:gold." },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-gold-status",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final gold report." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "reasoning-only-recovery-session",
    agentId: "neutral",
    content: "analyze gold",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_started").map((event) => event.toolCall.name),
    ["lookup"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final gold report."],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["Gold report based on value:gold."],
  );
  assert.equal(gateway.requests.length, 5);
  assert.match(
    gateway.requests[1]?.messages.at(-1)?.content ?? "",
    /only hidden reasoning and no visible answer or tool call/i,
  );
});

test("native agent core forwards visible status separately from assistant text", async () => {
  const gateway = new ScriptedModelGateway([
    [
      { type: "status_delta", text: "I have read the key files. " },
      { type: "text_delta", text: "Visible answer." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "status-session",
    agentId: "neutral",
    content: "report progress",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["I have read the key files. "],
  );
  assert.deepEqual(core.getSession("status-session")?.messages.at(-1), {
    role: "assistant",
    content: "Visible answer.",
    toolCalls: [],
  });
});

test("native agent core routes pre-tool visible text into process status", async () => {
  const gateway = new ScriptedModelGateway([
    [
      { type: "text_delta", text: "I will inspect the file first. " },
      {
        type: "tool_call",
        toolCall: {
          id: "tool-prelude",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-prelude",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final answer only." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "pre-tool-text-session",
    agentId: "neutral",
    content: "inspect then answer",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["I will inspect the file first. "],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final answer only."],
  );
  assert.deepEqual(core.getSession("pre-tool-text-session")?.messages.at(-3), {
    role: "assistant",
    content: "I will inspect the file first. ",
    toolCalls: [
      {
        id: "tool-prelude",
        name: "lookup",
        input: { key: "alpha" },
      },
    ],
  });
});

test("native agent core clears provisional text before the final-only phase", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-before-finish-preamble",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "I have enough information now." },
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-preamble",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final answer." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "finish-clears-provisional-session",
    agentId: "neutral",
    content: "look up then finish",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final answer."],
  );
  assert.deepEqual(events.filter((event) => event.type === "message_replace"), []);
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["I have enough information now."],
  );
  assert.deepEqual(core.getSession("finish-clears-provisional-session")?.messages.at(-1), {
    role: "assistant",
    content: "Final answer.",
    toolCalls: [],
  });
});

test("native agent core requires a tool choice after tool results until finish_task is called", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-before-required-choice",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-required-choice",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final answer." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  for await (const _event of core.sendTurn({
    sessionId: "required-tool-choice-session",
    agentId: "neutral",
    content: "look up then finish",
  })) {
    // Drain the turn.
  }

  assert.equal(gateway.requests[0]?.toolChoice, "auto");
  assert.equal(gateway.requests[1]?.toolChoice, "required");
  assert.ok(gateway.requests[1]?.tools.some((tool) => tool.name === "finish_task"));
  assert.equal(gateway.requests[2]?.tools.length, 0);
  assert.equal(gateway.requests[2]?.toolChoice, "none");
});

test("native agent core routes no-tool text after tools into process status and keeps executing", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-final-boundary",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "All requested " },
      { type: "text_delta", text: "lookups are complete." },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-post-tool-text",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final answer after the lookup." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "final-answer-boundary-session",
    agentId: "neutral",
    content: "look up then finish",
  })) {
    events.push(event);
  }

  assert.equal(gateway.requests.length, 4);
  assert.equal(gateway.requests.some((request) => request.tools.some((tool) => tool.name === "final_answer")), false);
  assert.match(
    gateway.requests[2]?.messages.at(-1)?.content ?? "",
    /previous execution-phase response did not call a tool/i,
  );
  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_started").map((event) => event.toolCall.name),
    ["lookup"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["All requested ", "lookups are complete."],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final answer after the lookup."],
  );
  assert.deepEqual(core.getSession("final-answer-boundary-session")?.messages.at(-1), {
    role: "assistant",
    content: "Final answer after the lookup.",
    toolCalls: [],
  });
});

test("native agent core streams the final-only phase immediately after a finish signal", async () => {
  let releaseFinal: (() => void) | undefined;
  const finalMayFinish = new Promise<void>((resolve) => {
    releaseFinal = resolve;
  });
  const gateway: ModelGateway & { requests: ModelRequest[] } = {
    requests: [],
    async *stream(input: ModelRequest): AsyncIterable<ModelEvent> {
      this.requests.push(input);
      if (this.requests.length === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "tool-before-finish",
            name: "lookup",
            input: { key: "alpha" },
          },
        };
        yield { type: "done", stopReason: "tool_use" };
        return;
      }
      if (this.requests.length === 2) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "finish-after-tool",
            name: "finish_task",
            input: {},
          },
        };
        yield { type: "done", stopReason: "tool_use" };
        return;
      }
      yield { type: "text_delta", text: "Final " };
      await finalMayFinish;
      yield { type: "text_delta", text: "answer." };
      yield { type: "done", stopReason: "end_turn" };
    },
  };
  const core = createCore(gateway);
  const iterator = core
    .sendTurn({
      sessionId: "finish-final-stream-session",
      agentId: "neutral",
      content: "look up then finish",
    })
    [Symbol.asyncIterator]();

  const events = [];
  let firstFinalDelta: Awaited<ReturnType<typeof iterator.next>> | undefined;
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }
    events.push(next.value);
    if (next.value.type === "message_delta") {
      firstFinalDelta = next;
      break;
    }
  }

  assert.equal(firstFinalDelta?.value.type, "message_delta");
  assert.equal(firstFinalDelta?.value.text, "Final ");
  assert.equal(gateway.requests.length, 3);
  assert.equal(gateway.requests[2]?.tools.length, 0);

  releaseFinal?.();
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }
    events.push(next.value);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final ", "answer."],
  );
  assert.deepEqual(core.getSession("finish-final-stream-session")?.messages.at(-1), {
    role: "assistant",
    content: "Final answer.",
    toolCalls: [],
  });
});

test("native agent core does not ask for final_answer after plain post-tool process text", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-post-text-boundary",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      {
        type: "text_delta",
        text: "Third lookup completed.\n\n",
      },
      {
        type: "text_delta",
        text: "All requested lookups are complete.",
      },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-plain-post-tool-text",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final answer after plain process text." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "plain-post-tool-text-session",
    agentId: "neutral",
    content: "look up then finish",
  })) {
    events.push(event);
  }

  assert.equal(gateway.requests.length, 4);
  assert.equal(gateway.requests.some((request) => request.tools.some((tool) => tool.name === "final_answer")), false);
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["Third lookup completed.\n\n", "All requested lookups are complete."],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final answer after plain process text."],
  );

  const sessionMessages = core.getSession("plain-post-tool-text-session")?.messages ?? [];
  assert.deepEqual(sessionMessages.at(-1), {
    role: "assistant",
    content: "Final answer after plain process text.",
    toolCalls: [],
  });
});

test("native agent core repairs bare file tool calls to explicit desktop path from the user request", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-list-desktop",
          name: "list",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "桌面里有 alpha.txt。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  const executedInputs: unknown[] = [];

  agents.register({
    id: "desktop-agent",
    name: "Desktop Agent",
    description: "Tests local directory repair",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["list"],
    permissionPolicy: {
      allowedTools: ["list"],
      allowRisk: ["read"],
    },
  });
  tools.register({
    name: "list",
    description: "List a directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
    },
    risk: "read",
    async execute(input) {
      executedInputs.push(input);
      return { content: "file\talpha.txt" };
    },
  });

  const core = new AgentCore({ agents, skills, tools, modelGateway: gateway });
  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "desktop-path-repair-session",
    agentId: "desktop-agent",
    content: "查看桌面文件",
    workspacePrompt: buildLocalDirectoryContext("/Users/kober"),
    workspaceRoot: "/Users/kober/Desktop/github/super-agents",
  })) {
    events.push(event);
  }

  assert.deepEqual(executedInputs, [{ path: "/Users/kober/Desktop" }]);
  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_started").map((event) => event.toolCall.input),
    [{ path: "/Users/kober/Desktop" }],
  );
});

test("native agent core supplies safe sample inputs for explicit tool self-tests", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-read-self-test",
          name: "read",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "read 工具测试完成。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  const executedInputs: unknown[] = [];

  agents.register({
    id: "tool-self-test-agent",
    name: "Tool Self Test Agent",
    description: "Tests self-test repairs",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["read"],
    permissionPolicy: {
      allowedTools: ["read"],
      allowRisk: ["read"],
    },
  });
  tools.register({
    name: "read",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    risk: "read",
    async execute(input) {
      executedInputs.push(input);
      return { content: "package file" };
    },
  });

  const core = new AgentCore({ agents, skills, tools, modelGateway: gateway });
  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "tool-self-test-session",
    agentId: "tool-self-test-agent",
    content: "给我测一遍工具，所有的测一遍",
    workspaceRoot: "/Users/kober/Desktop/github/super-agents",
  })) {
    events.push(event);
  }

  assert.deepEqual(executedInputs, [{ path: "package.json" }]);
  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_started").map((event) => event.toolCall.input),
    [{ path: "package.json" }],
  );
  assert.doesNotMatch(gateway.requests[1]?.messages.at(-1)?.content ?? "", /Invalid tool input/i);
});

test("native agent core skips unrepaired invalid calls during explicit tool self-tests", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-write-self-test",
          name: "write",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "write 工具需要具体文件，已跳过。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  let executeCount = 0;

  agents.register({
    id: "tool-self-test-skip-agent",
    name: "Tool Self Test Skip Agent",
    description: "Tests self-test skips",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["write"],
    permissionPolicy: {
      allowedTools: ["write"],
      allowRisk: ["write"],
    },
  });
  tools.register({
    name: "write",
    description: "Write a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    risk: "write",
    async execute() {
      executeCount += 1;
      return { content: "wrote" };
    },
  });

  const core = new AgentCore({ agents, skills, tools, modelGateway: gateway });
  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "tool-self-test-skip-session",
    agentId: "tool-self-test-skip-agent",
    content: "测试所有工具",
  })) {
    events.push(event);
  }

  assert.equal(executeCount, 0);
  assert.equal(events.some((event) => event.type === "tool_call_started"), false);
  assert.match(gateway.requests[1]?.messages.at(-1)?.content ?? "", /TOOL_SELF_TEST_SKIPPED/);
  assert.doesNotMatch(gateway.requests[1]?.messages.at(-1)?.content ?? "", /Invalid tool input/i);
});

test("native agent core grants extra turns for explicit tool self-tests", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-read-self-test",
          name: "read",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-grep-self-test",
          name: "grep",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "工具自测完成。" },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-tool-self-test",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "工具自测完成。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  const executedToolNames: string[] = [];

  agents.register({
    id: "tool-self-test-budget-agent",
    name: "Tool Self Test Budget Agent",
    description: "Tests self-test turn budget",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["read", "grep"],
    permissionPolicy: {
      allowedTools: ["read", "grep"],
      allowRisk: ["read"],
    },
    maxTurns: 1,
  });
  tools.register({
    name: "read",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    risk: "read",
    async execute() {
      executedToolNames.push("read");
      return { content: "package file" };
    },
  });
  tools.register({
    name: "grep",
    description: "Search text",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    risk: "read",
    async execute() {
      executedToolNames.push("grep");
      return { content: "matches" };
    },
  });

  const core = new AgentCore({ agents, skills, tools, modelGateway: gateway });
  const messageDeltas: string[] = [];
  for await (const event of core.sendTurn({
    sessionId: "tool-self-test-budget-session",
    agentId: "tool-self-test-budget-agent",
    content: "给我测一遍所有工具",
  })) {
    if (event.type === "message_delta") {
      messageDeltas.push(event.text);
    }
  }

  assert.deepEqual(executedToolNames, ["read", "grep"]);
  assert.equal(messageDeltas.join(""), "工具自测完成。");
});

test("native agent core reports max turns instead of forcing synthesis after tool budget exhaustion", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-lookup",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
  ]);
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();

  agents.register({
    id: "tool-budget-agent",
    name: "Tool Budget Agent",
    description: "Tests max turn fallback",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["lookup"],
    permissionPolicy: {
      allowedTools: ["lookup"],
      allowRisk: ["read"],
    },
    maxTurns: 1,
  });
  tools.register({
    name: "lookup",
    description: "Lookup a value",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    risk: "read",
    async execute() {
      return { content: "lookup result" };
    },
  });

  const core = new AgentCore({ agents, skills, tools, modelGateway: gateway });
  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "max-turn-budget-session",
    agentId: "tool-budget-agent",
    content: "look something up",
  })) {
    events.push(event);
  }

  const finalText = events.filter((event) => event.type === "message_delta").map((event) => event.text).join("");
  assert.match(finalText, /最大执行轮次/);
  assert.match(finalText, /继续发送消息/);
  assert.equal(gateway.requests.length, 1);
  const turnFinished = events.at(-1);
  assert.equal(turnFinished?.type, "turn_finished");
  assert.equal(turnFinished?.stopReason, "max_turns");
});

test("native agent core reuses duplicate tool calls within the same turn and keeps post-tool text in status", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-first",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-second",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final after reuse." },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-duplicate-reuse",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final after reuse." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "duplicate-tool-session",
    agentId: "neutral",
    content: "look this up",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_started").map((event) => event.toolCall.id),
    ["tool-first"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_finished").map((event) => event.toolCall.id),
    ["tool-first"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["Final after reuse."],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["Final after reuse."],
  );

  const toolMessages = core
    .getSession("duplicate-tool-session")
    ?.messages.filter((message) => message.role === "tool");
  assert.equal(toolMessages?.length, 2);
  assert.equal(toolMessages?.[0]?.toolCallId, "tool-first");
  assert.equal(toolMessages?.[0]?.content, "value:alpha");
  assert.equal(toolMessages?.[1]?.toolCallId, "tool-second");
  assert.match(toolMessages?.[1]?.content ?? "", /DUPLICATE_TOOL_CALL/);
  assert.match(toolMessages?.[1]?.content ?? "", /value:alpha/);
});

test("native agent core makes provider-reused tool call ids unique within one turn", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "reused-tool-id",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "reused-tool-id",
          name: "lookup",
          input: { key: "beta" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final after both tools." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "provider-reused-tool-id-session",
    agentId: "neutral",
    content: "look up both values",
  })) {
    events.push(event);
  }

  const startedIds = events
    .filter((event) => event.type === "tool_call_started")
    .map((event) => event.toolCall.id);
  const finishedIds = events
    .filter((event) => event.type === "tool_call_finished")
    .map((event) => event.toolCall.id);

  assert.equal(startedIds.length, 2);
  assert.equal(new Set(startedIds).size, 2);
  assert.deepEqual(finishedIds, startedIds);

  const session = core.getSession("provider-reused-tool-id-session");
  const assistantToolIds = session?.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.toolCalls?.map((toolCall) => toolCall.id) ?? []);
  const toolMessageIds = session?.messages
    .filter((message) => message.role === "tool")
    .map((message) => message.toolCallId);

  assert.deepEqual(assistantToolIds, startedIds);
  assert.deepEqual(toolMessageIds, startedIds);
});

test("native agent core runs concurrency-safe tool calls in parallel while preserving tool message order", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-alpha",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "tool-beta",
          name: "lookup",
          input: { key: "beta" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "Final after parallel tools." },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();

  agents.register({
    id: "parallel-agent",
    name: "Parallel Agent",
    description: "Tests safe parallel tool execution",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["lookup"],
    permissionPolicy: {
      allowedTools: ["lookup"],
      allowRisk: ["read"],
      maxToolCallsPerTurn: 4,
    },
  });
  tools.register({
    name: "lookup",
    description: "Look up a value from a test dictionary",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
    },
    risk: "read",
    isConcurrencySafe: () => true,
    async execute(input) {
      const key = typeof input === "object" && input && "key" in input ? String(input.key) : "";
      await delay(key === "alpha" ? 30 : 5);
      return { content: `value:${key}` };
    },
  });

  const core = new AgentCore({ agents, skills, tools, modelGateway: gateway });
  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "parallel-safe-tools-session",
    agentId: "parallel-agent",
    content: "look up both values",
  })) {
    events.push(event);
  }

  const toolEvents = events
    .flatMap((event) => {
      if (event.type !== "tool_call_started" && event.type !== "tool_call_finished") {
        return [];
      }
      const input = event.toolCall.input;
      const key = typeof input === "object" && input && "key" in input ? String(input.key) : "";
      return [`${event.type === "tool_call_started" ? "start" : "finish"}:${key}`];
    });
  assert.deepEqual(toolEvents.slice(0, 2), ["start:alpha", "start:beta"]);
  assert.deepEqual(toolEvents.slice(2, 4), ["finish:beta", "finish:alpha"]);

  const toolMessages = core
    .getSession("parallel-safe-tools-session")
    ?.messages.filter((message) => message.role === "tool")
    .map((message) => message.content);
  assert.deepEqual(toolMessages, ["value:alpha", "value:beta"]);
});

test("native agent core retries an empty no-tool response after tools until finish signal", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-first",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [{ type: "done", stopReason: "end_turn" }],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-empty-tool-response",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "最终结论。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "empty-no-tool-after-tool-session",
    agentId: "neutral",
    content: "look this up",
  })) {
    events.push(event);
  }

  const messageDeltas = events.filter((event) => event.type === "message_delta").map((event) => event.text);
  assert.deepEqual(messageDeltas, ["最终结论。"]);
  assert.equal(gateway.requests.length, 4);
  assert.ok((gateway.requests[1]?.tools.length ?? 0) > 0);
  assert.match(
    gateway.requests[2]?.messages.at(-1)?.content ?? "",
    /previous execution-phase response did not call a tool/i,
  );
  const turnFinished = events.at(-1);
  assert.equal(turnFinished?.type, "turn_finished");
  assert.equal(turnFinished?.stopReason, "end_turn");
  assert.equal(core.getSession("empty-no-tool-after-tool-session")?.messages.at(-1)?.content, "最终结论。");
});

test("native agent core treats first no-tool text after tools as process text", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-first",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "当前登录用户是 kober。\n\n" },
      { type: "text_delta", text: "三个命令执行完毕，汇总如下。" },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-first-no-tool-text",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "最终结论。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "empty-after-tool-session",
    agentId: "neutral",
    content: "look this up",
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["当前登录用户是 kober。\n\n", "三个命令执行完毕，汇总如下。"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["最终结论。"],
  );
  assert.equal(gateway.requests.length, 4);
  assert.equal(core.getSession("empty-after-tool-session")?.messages.at(-1)?.content, "最终结论。");
});

test("openai-compatible gateway maps streamed reasoning fields to reasoning deltas", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            reasoning_content: "Check assumptions. ",
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            reasoning: "Compare options. ",
            content: "Final answer.",
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::reasoning-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "reasoning-model",
              label: "Reasoning Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "reasoning-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    assert.deepEqual(
      events.filter((event) => event.type === "reasoning_delta").map((event) => event.text),
      ["Check assumptions. ", "Compare options. "],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      ["Final answer."],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway requests automatic tool choice when tools are available", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: "No tool needed.",
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    for await (const _event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    })) {
      // Drain the stream so the request body is captured.
    }

    assert.equal(requestBody?.tool_choice, "auto");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway can request required tool choice for execution phases", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    for await (const _event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "finish_task",
          description: "Finish",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
      toolChoice: "required",
    })) {
      // Drain the stream so the request body is captured.
    }

    assert.equal(requestBody?.tool_choice, "required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway parses GLM arg-key pseudo tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: "<tool_call>web_search<arg_key>query</arg_key><arg_value>gold price today</arg_value></tool_call>",
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    assert.deepEqual(
      events.filter((event) => event.type === "tool_call").map((event) => event.toolCall),
      [
        {
          id: "tool-0-1",
          name: "web_search",
          input: { query: "gold price today" },
        },
      ],
    );
    assert.equal(events.some((event) => event.type === "text_delta"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway repairs compact GLM arg-key pseudo tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: "web_search<arg_key>query\": \"黄金价格走势 最新行情\"}",
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势 最新行情" });
    assert.equal(events.some((event) => event.type === "text_delta"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway gives fallback tool ids unique values across requests", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  name: "lookup",
                  arguments: "{\"key\":\"alpha\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);
    const request = {
      model: "tool-model",
      system: "system",
      messages: [{ role: "user" as const, content: "hello" }],
      tools: [
        {
          name: "lookup",
          description: "Lookup values",
          inputSchema: { type: "object" },
        },
      ],
    };

    const firstEvents = [];
    for await (const event of gateway.stream(request)) {
      firstEvents.push(event);
    }
    const secondEvents = [];
    for await (const event of gateway.stream(request)) {
      secondEvents.push(event);
    }

    const firstTool = firstEvents.find((event) => event.type === "tool_call");
    const secondTool = secondEvents.find((event) => event.type === "tool_call");
    assert.equal(firstTool?.type, "tool_call");
    assert.equal(secondTool?.type, "tool_call");
    assert.notEqual(firstTool?.toolCall.id, secondTool?.toolCall.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway merges streamed tool arguments by index when the first chunk has an id", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-with-id",
                function: {
                  name: "bash",
                  arguments: "",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: "{\"command\":\"pwd\",\"description\":\"print working directory\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "bash",
          description: "Run shell",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
              description: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    assert.deepEqual(
      events.filter((event) => event.type === "tool_call").map((event) => event.toolCall),
      [
        {
          id: "call-with-id",
          name: "bash",
          input: {
            command: "pwd",
            description: "print working directory",
          },
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway surfaces streamed tool-call deltas before final tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: "I will inspect first. ",
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "early-tool-delta",
                function: {
                  name: "lookup",
                  arguments: "{\"key\":\"alpha\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "lookup",
          description: "Lookup values",
          inputSchema: {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    assert.deepEqual(events.map((event) => event.type), ["text_delta", "tool_call_delta", "tool_call", "done"]);
    const toolDelta = events.find((event) => event.type === "tool_call_delta");
    assert.equal(toolDelta?.type, "tool_call_delta");
    assert.equal(toolDelta.toolCallId, "early-tool-delta");
    assert.equal(toolDelta.name, "lookup");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway keeps same-chunk anonymous tool calls separate", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: {
                  name: "list",
                  arguments: "{\"path\":\".\"}",
                },
              },
              {
                function: {
                  name: "bash",
                  arguments: "{\"command\":\"pwd\"}",
                },
              },
              {
                function: {
                  name: "glob",
                  arguments: "{\"pattern\":\"**/*.ts\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    const toolCalls = events
      .filter((event) => event.type === "tool_call")
      .map((event) => (event.type === "tool_call" ? event.toolCall : null))
      .filter(Boolean);

    assert.deepEqual(toolCalls.map((toolCall) => toolCall?.name), ["list", "bash", "glob"]);
    assert.equal(new Set(toolCalls.map((toolCall) => toolCall?.id)).size, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway accepts object tool arguments from provider streams", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call-object-args",
                function: {
                  name: "bash",
                  arguments: { command: "pwd" },
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { command: "pwd" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway repairs tool arguments that leak into content after a structured tool name", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call-web-search",
                index: 0,
                function: {
                  name: "web_search",
                  arguments: "",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            content: 'web_searchquery": "黄金价格走势分析 2026"',
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway converts text-only pseudo tool calls into structured tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: 'web_searchquery": "黄金价格走势分析 2026"',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway converts compact list pseudo tool calls into structured tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: 'listpath": "/Users/kober/Desktop"',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "list",
          description: "List files",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { path: "/Users/kober/Desktop" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway converts named XML pseudo tool calls into structured tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: '<function name="web_search">{"query":"黄金价格走势分析 2026"}</function>',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway converts multiple named XML pseudo tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: [
              "<tool_calls>",
              '<tool_call name="web_search">{"query":"黄金价格走势分析 2026"}</tool_call>',
              '<tool_call name="web_fetch">{"url":"https://example.test/report"}</tool_call>',
              "</tool_calls>",
            ].join(""),
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
        {
          name: "web_fetch",
          description: "Fetch a URL",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
            },
            required: ["url"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCalls = events.filter((event) => event.type === "tool_call");
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0].toolCall.name, "web_search");
    assert.deepEqual(toolCalls[0].toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.equal(toolCalls[1].toolCall.name, "web_fetch");
    assert.deepEqual(toolCalls[1].toolCall.input, { url: "https://example.test/report" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway converts pseudo tool_calls arrays into structured tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content:
              '<tool_calls>[{"name":"web_search","arguments":{"query":"黄金价格走势分析 2026"}},{"name":"web_fetch","arguments":{"url":"https://example.test/report"}}]</tool_calls>',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
        {
          name: "web_fetch",
          description: "Fetch a URL",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
            },
            required: ["url"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCalls = events
      .filter((event) => event.type === "tool_call")
      .map((event) => (event.type === "tool_call" ? event.toolCall : null))
      .filter(Boolean);
    assert.deepEqual(toolCalls.map((toolCall) => toolCall?.name), ["web_search", "web_fetch"]);
    assert.deepEqual(toolCalls[0]?.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(toolCalls[1]?.input, { url: "https://example.test/report" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway preserves top-level pseudo tool arguments beside the tool name", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: '{"name":"web_search","query":"黄金价格走势分析 2026"}',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway repairs compact pseudo tool calls with array arguments", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content:
              'todo_writeitems": [{"content":"tool self-test item","status":"completed"}]',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "todo_write",
          description: "Update todos",
          inputSchema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    content: { type: "string" },
                    status: { type: "string" },
                  },
                  required: ["content", "status"],
                },
              },
            },
            required: ["items"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, {
      items: [{ content: "tool self-test item", status: "completed" }],
    });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway holds JSON pseudo tool_calls wrappers instead of streaming them as text", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content:
              '{"tool_calls":[{"function":{"name":"web_search","arguments":"{\\"query\\":\\"黄金价格走势分析 2026\\"}"}}]}',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible gateway buffers split pseudo tool-call prefixes across content chunks", async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    {
      choices: [
        {
          delta: {
            content: "web",
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            content: '_searchquery": "黄金价格走势分析 2026"',
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  globalThis.fetch = (async () =>
    new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
    })) as typeof fetch;

  try {
    const gateway = new OpenAICompatibleModelGateway(async () => ({
      activeModelId: "test-provider::tool-model",
      modelProviders: [
        {
          id: "test-provider",
          name: "Test Provider",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          apiKey: "test-key",
          temperature: 0,
          maxTokens: 256,
          enabled: true,
          models: [
            {
              id: "tool-model",
              label: "Tool Model",
              enabled: true,
            },
          ],
        },
      ],
    }) as AppConfig);

    const events = [];
    for await (const event of gateway.stream({
      model: "tool-model",
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
    })) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "tool_call");
    assert.equal(toolCall?.type, "tool_call");
    assert.deepEqual(toolCall.toolCall.input, { query: "黄金价格走势分析 2026" });
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta").map((event) => event.text),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("default native assistant exposes practical built-in tools to the model", async () => {
  const gateway = new ScriptedModelGateway([[{ type: "done", stopReason: "end_turn" }]]);
  const core = createDefaultCore(gateway);

  for await (const _event of core.sendTurn({
    sessionId: "default-tools-session",
    agentId: DEFAULT_AGENT_ID,
    content: "看看这个项目",
    workspaceRoot: process.cwd(),
  })) {
    // Drain the turn.
  }

  const toolNames = gateway.requests[0]?.tools.map((tool) => tool.name).sort() ?? [];
  assert.deepEqual(toolNames, [
    "apply_patch",
    "bash",
    "edit",
    "glob",
    "grep",
    "list",
    "multi_edit",
    "question",
    "read",
    "todo_read",
    "todo_write",
    "web_fetch",
    "web_search",
    "write",
  ]);
  assert.equal(toolNames.some((toolName) => toolName.startsWith("workspace_")), false);
});

test("default read tools tell the model to use absolute paths for explicit local folders", async () => {
  const gateway = new ScriptedModelGateway([[{ type: "done", stopReason: "end_turn" }]]);
  const core = createDefaultCore(gateway);

  for await (const _event of core.sendTurn({
    sessionId: "default-tool-description-session",
    agentId: DEFAULT_AGENT_ID,
    content: "查看桌面文件列表",
    workspaceRoot: process.cwd(),
  })) {
    // Drain the turn.
  }

  const tools = gateway.requests[0]?.tools ?? [];
  for (const toolName of ["read", "list", "grep", "glob"]) {
    const tool = tools.find((item) => item.name === toolName);
    assert.ok(tool, `Expected ${toolName} to be exposed`);
    assert.match(tool.description, /absolute path/i);
    assert.doesNotMatch(tool.description, /must stay inside/i);
  }
});

test("default read and web tools declare conservative concurrency safety", () => {
  const tools = new Map(createBuiltinToolDefinitions().map((tool) => [tool.name, tool]));
  const externalPath = path.join(os.tmpdir(), "outside-workspace.txt");

  for (const toolName of ["read", "list", "grep", "glob"]) {
    const tool = tools.get(toolName);
    assert.equal(toolConcurrencySafety(tool, { path: "src" }), true);
    assert.equal(toolConcurrencySafety(tool, { path: externalPath }), false);
  }

  assert.equal(toolConcurrencySafety(tools.get("web_search"), { query: "gold price" }), true);
  assert.equal(toolConcurrencySafety(tools.get("web_fetch"), { url: "https://example.com" }), true);
});

test("local directory context maps desktop requests to the real home directory", () => {
  const context = buildLocalDirectoryContext("/Users/kober");

  assert.match(context, /Desktop \/ 桌面: \/Users\/kober\/Desktop/);
  assert.match(context, /absolute target/i);
  assert.match(context, /Use the workspace root only/i);
});

test("legacy workspace tool aliases resolve without being exposed to the model", async () => {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinToolDefinitions()) {
    tools.register(tool);
  }

  assert.equal(tools.get("workspace_read_file")?.name, "read");
  assert.equal(tools.get("workspace_list_directory")?.name, "list");
  assert.equal(tools.get("workspace_search_text")?.name, "grep");
  assert.equal(tools.get("workspace_write_file")?.name, "write");
  assert.equal(tools.get("workspace_shell")?.name, "bash");
  assert.deepEqual(tools.list().map((tool) => tool.name).sort(), [
    "apply_patch",
    "bash",
    "edit",
    "glob",
    "grep",
    "list",
    "multi_edit",
    "question",
    "read",
    "todo_read",
    "todo_write",
    "web_fetch",
    "web_search",
    "write",
  ]);
});

test("prompt composer follows Claude-Code-style override and agent prompt priority", () => {
  const composer = new PromptComposer("runtime contract", "default behavior");
  const baseAgent = {
    id: "specialist",
    name: "Specialist",
    description: "Specialist agent",
    role: "specialist" as const,
    prompt: "specialist instructions",
    model: "test-model",
  };

  assert.equal(
    composer.compose({
      agent: baseAgent,
      skills: [],
      overrideSystemPrompt: "absolute override",
      workspacePrompt: "workspace",
      appendSystemPrompt: "append",
    }),
    "absolute override",
  );

  const replaced = composer.compose({
    agent: baseAgent,
    skills: [],
  });
  assert.match(replaced, /runtime contract/);
  assert.match(replaced, /specialist instructions/);
  assert.doesNotMatch(replaced, /default behavior/);

  const appended = composer.compose({
    agent: {
      ...baseAgent,
      promptMode: "append-default" as const,
    },
    skills: [],
  });
  assert.match(appended, /default behavior/);
  assert.match(appended, /specialist instructions/);
});

test("permission manager supports deny and ask modes at agent level", () => {
  const tool: ToolDefinition = {
    name: "read_note",
    description: "Read a note",
    inputSchema: { type: "object" },
    risk: "read",
    async execute() {
      return { content: "note" };
    },
  };
  const manager = new PermissionManager();
  const baseAgent = {
    id: "agent",
    name: "Agent",
    description: "Agent",
    role: "assistant" as const,
    prompt: "prompt",
    model: "test-model",
    tools: ["read_note"],
    permissionPolicy: {
      allowedTools: ["read_note"],
      allowRisk: ["read" as const],
    },
  };

  assert.deepEqual(
    manager.check({
      agent: { ...baseAgent, permissionMode: "deny" as const },
      tool,
      toolCall: { id: "call-1", name: "read_note", input: {} },
      toolCallsThisTurn: 0,
    }),
    { type: "deny", reason: 'Agent "agent" is not allowed to use tools.' },
  );

  assert.deepEqual(
    manager.check({
      agent: { ...baseAgent, permissionMode: "ask" as const },
      tool,
      toolCall: { id: "call-2", name: "read_note", input: {} },
      toolCallsThisTurn: 0,
    }),
    { type: "ask", reason: 'Agent "agent" requires approval before using tools.' },
  );
});

test("native agent core skips approval gates when full filesystem access is enabled", async () => {
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-shell",
          name: "shell_probe",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "done" },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-full-access",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "done" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  let approvalRequestCount = 0;

  agents.register({
    id: "full-access-agent",
    name: "Full Access Agent",
    description: "Exercises full access approvals",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["shell_probe"],
    permissionPolicy: {
      allowedTools: ["shell_probe"],
      allowRisk: ["read"],
      requireApprovalFor: ["shell_probe"],
    },
  });
  tools.register({
    name: "shell_probe",
    description: "Shell-like probe",
    inputSchema: { type: "object" },
    risk: "shell",
    async execute() {
      return { content: "ran" };
    },
  });
  const core = new AgentCore({
    agents,
    skills,
    tools,
    modelGateway: gateway,
    approvalHandler: async () => {
      approvalRequestCount += 1;
      return { type: "deny", reason: "should not ask" };
    },
  });

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "full-access-approval-session",
    agentId: "full-access-agent",
    content: "run probe",
    fullFileSystemAccess: true,
  })) {
    events.push(event);
  }

  assert.equal(approvalRequestCount, 0);
  assert.equal(events.some((event) => event.type === "permission_requested"), false);
  assert.deepEqual(
    events.filter((event) => event.type === "tool_call_finished").map((event) => event.result.content),
    ["ran"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["done"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["done"],
  );
});

test("native agent core rejects invalid required tool inputs before approval or execution", async () => {
  const agents = new AgentRegistry();
  const skills = new SkillRegistry();
  const tools = new ToolRegistry();
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "invalid-shell-1",
          name: "shell_probe",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "参数无效，已停止。" },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-invalid-input",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "参数无效，已停止。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  let approvalRequestCount = 0;
  let executeCount = 0;

  agents.register({
    id: "invalid-input-agent",
    name: "Invalid Input Agent",
    description: "Exercises tool input validation",
    role: "assistant",
    promptMode: "replace-default",
    prompt: "Use tools when needed.",
    model: "test-model",
    tools: ["shell_probe"],
    permissionPolicy: {
      allowedTools: ["shell_probe"],
      requireApprovalFor: ["shell_probe"],
    },
  });
  tools.register({
    name: "shell_probe",
    description: "Run a shell probe",
    risk: "shell",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    async execute() {
      executeCount += 1;
      return { content: "executed" };
    },
  });
  const core = new AgentCore({
    agents,
    skills,
    tools,
    modelGateway: gateway,
    approvalHandler: async () => {
      approvalRequestCount += 1;
      return { type: "allow" };
    },
  });

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "invalid-input-session",
    agentId: "invalid-input-agent",
    content: "run it",
  })) {
    events.push(event);
  }

  assert.equal(approvalRequestCount, 0);
  assert.equal(executeCount, 0);
  assert.equal(events.some((event) => event.type === "permission_requested"), false);
  assert.equal(events.some((event) => event.type === "tool_call_started"), false);
  assert.equal(events.some((event) => event.type === "tool_call_finished"), false);
  assert.match(gateway.requests[1]?.messages.at(-1)?.content ?? "", /Invalid tool input/i);
  assert.match(gateway.requests[1]?.messages.at(-1)?.content ?? "", /command is required/i);
  assert.deepEqual(
    events.filter((event) => event.type === "message_delta").map((event) => event.text),
    ["参数无效，已停止。"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "status_delta").map((event) => event.text),
    ["参数无效，已停止。"],
  );
});

test("native agent core executes an allowed tool and feeds the result back to the model", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-1",
          name: "lookup",
          input: { key: "alpha" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "查到 value:alpha" },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-allowed-tool",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "查到 value:alpha" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "session-2",
    agentId: "neutral",
    content: "查 alpha",
  })) {
    events.push(event);
  }

  assert.equal(events.some((event) => event.type === "tool_call_started"), true);
  assert.equal(events.some((event) => event.type === "tool_call_finished"), true);
  assert.equal(gateway.requests.length, 4);
  assert.deepEqual(gateway.requests[1]?.messages.at(-1), {
    role: "tool",
    name: "lookup",
    toolCallId: "tool-1",
    content: "value:alpha",
  });
});

test("native agent core denies tools outside the agent permission policy", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "tool-2",
          name: "shell",
          input: { command: "rm -rf /tmp/example" },
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "我不能执行这个工具。" },
      { type: "done", stopReason: "end_turn" },
    ],
    [
      {
        type: "tool_call",
        toolCall: {
          id: "finish-after-denied-tool",
          name: "finish_task",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "我不能执行这个工具。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createCore(gateway);

  const events = [];
  for await (const event of core.sendTurn({
    sessionId: "session-3",
    agentId: "neutral",
    content: "执行 shell",
  })) {
    events.push(event);
  }

  const denied = events.find((event) => event.type === "permission_denied");
  assert.equal(denied?.type, "permission_denied");
  assert.match(denied?.reason ?? "", /not registered|not allowed/);
  assert.equal(gateway.requests.length, 4);
  assert.match(gateway.requests[1]?.messages.at(-1)?.content ?? "", /Permission denied/);
});

test("write tool writes UTF-8 content inside the workspace only", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-write-"));
  try {
    const tool = getBuiltinTool("write");
    const result = await tool.execute(
      {
        path: "notes/output.txt",
        content: "hello native core",
      },
      { sessionId: "s", agentId: "a", workspaceRoot },
    );

    assert.match(result.content, /Wrote notes\/output\.txt/);
    assert.equal(await readFile(path.join(workspaceRoot, "notes/output.txt"), "utf8"), "hello native core");

    await assert.rejects(
      () =>
        tool.execute(
          {
            path: "../escape.txt",
            content: "nope",
          },
          { sessionId: "s", agentId: "a", workspaceRoot },
        ),
      /outside the workspace root/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("glob tool matches files inside the workspace only", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-glob-"));
  try {
    await writeFile(path.join(workspaceRoot, "alpha.test.ts"), "alpha", "utf8");
    await writeFile(path.join(workspaceRoot, "beta.ts"), "beta", "utf8");
    const tool = getBuiltinTool("glob");
    const result = await tool.execute(
      {
        pattern: "*.test.ts",
      },
      { sessionId: "s", agentId: "a", workspaceRoot },
    );

    assert.match(result.content, /alpha\.test\.ts/);
    assert.doesNotMatch(result.content, /beta\.ts/);

    await assert.rejects(
      () =>
        tool.execute(
          {
            pattern: "*",
            path: "../",
          },
          { sessionId: "s", agentId: "a", workspaceRoot },
        ),
      /outside the workspace root/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("grep tool falls back to a Node search when ripgrep is unavailable", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-grep-fallback-"));
  const originalPath = process.env.PATH;
  try {
    await writeFile(path.join(workspaceRoot, "alpha.txt"), "first line\nneedle here\n");
    await writeFile(path.join(workspaceRoot, "beta.txt"), "no match\n");
    process.env.PATH = "";

    const tool = getBuiltinTool("grep");
    const result = await tool.execute(
      {
        query: "needle",
        path: ".",
        maxResults: 10,
      },
      { sessionId: "s", agentId: "a", workspaceRoot },
    );

    assert.match(result.content, /alpha\.txt:2:1:needle here/);
    assert.doesNotMatch(result.content, /spawn rg ENOENT/);
    assert.equal(result.metadata?.fallback, "node");
  } finally {
    process.env.PATH = originalPath;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("glob tool falls back to a Node glob when ripgrep is unavailable", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-glob-fallback-"));
  const originalPath = process.env.PATH;
  try {
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "src", "alpha.ts"), "export const alpha = 1;\n");
    await writeFile(path.join(workspaceRoot, "src", "beta.md"), "# beta\n");
    process.env.PATH = "";

    const tool = getBuiltinTool("glob");
    const result = await tool.execute(
      {
        pattern: "**/*.ts",
        path: ".",
        maxResults: 10,
      },
      { sessionId: "s", agentId: "a", workspaceRoot },
    );

    assert.equal(result.content.trim(), "src/alpha.ts");
    assert.equal(result.metadata?.fallback, "node");
  } finally {
    process.env.PATH = originalPath;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("built-in read tools request approval before accessing external directories", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-external-"));
  try {
    await writeFile(path.join(externalRoot, "desktop-note.txt"), "hello from desktop", "utf8");
    const approvalRequests: ToolApprovalRequest[] = [];
    const gateway = new ScriptedModelGateway([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "external-list-1",
            name: "list",
            input: { path: externalRoot },
          },
        },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "看到 desktop-note.txt" },
        { type: "done", stopReason: "end_turn" },
      ],
    ]);
    const core = createSingleToolCore(gateway, getBuiltinTool("list"), async (request) => {
      approvalRequests.push(request);
      return { type: "allow" };
    });

    for await (const _event of core.sendTurn({
      sessionId: "external-allow-session",
      agentId: "tool-agent",
      content: "list external",
      workspaceRoot,
    })) {
      // Drain the turn.
    }

    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0]?.kind, "external_directory");
    assert.equal(approvalRequests[0]?.targetPath, externalRoot);
    assert.equal(approvalRequests[0]?.metadata?.directory, externalRoot);
    const toolMessage = gateway.requests[1]?.messages.at(-1);
    assert.equal(toolMessage?.role, "tool");
    assert.match(toolMessage?.content ?? "", /desktop-note\.txt/);
    assert.doesNotMatch(toolMessage?.content ?? "", /^\[TOOL_ERROR\]/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test("external directory denial is returned as a permission result instead of a tool error", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-external-"));
  try {
    const gateway = new ScriptedModelGateway([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "external-list-denied-1",
            name: "list",
            input: { path: externalRoot },
          },
        },
        { type: "done", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "无法访问外部目录。" },
        { type: "done", stopReason: "end_turn" },
      ],
    ]);
    const core = createSingleToolCore(gateway, getBuiltinTool("list"), async () => ({
      type: "deny",
      reason: "User denied external directory access.",
    }));

    const events = [];
    for await (const event of core.sendTurn({
      sessionId: "external-deny-session",
      agentId: "tool-agent",
      content: "list external",
      workspaceRoot,
    })) {
      events.push(event);
    }

    const toolMessage = gateway.requests[1]?.messages.at(-1);
    assert.equal(toolMessage?.role, "tool");
    assert.match(toolMessage?.content ?? "", /Permission denied: User denied external directory access\./);
    assert.doesNotMatch(toolMessage?.content ?? "", /^\[TOOL_ERROR\]/);
    const finished = events.find((event) => event.type === "tool_call_finished");
    assert.equal(finished?.type, "tool_call_finished");
    assert.equal(finished?.result.metadata?.permissionDenied, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test("full filesystem access allows external directories without prompting", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-external-"));
  try {
    await writeFile(path.join(externalRoot, "desktop-note.txt"), "hello from desktop", "utf8");
    let approvalRequestCount = 0;
    const tool = getBuiltinTool("list");
    const result = await tool.execute(
      {
        path: externalRoot,
      },
      {
        sessionId: "s",
        agentId: "a",
        workspaceRoot,
        fullFileSystemAccess: true,
        toolCall: { id: "full-access-list-1", name: "list", input: { path: externalRoot } },
        requestApproval: async () => {
          approvalRequestCount += 1;
          return { type: "deny", reason: "should not ask" };
        },
      },
    );

    assert.equal(approvalRequestCount, 0);
    assert.match(result.content, /desktop-note\.txt/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test("edit tool replaces text inside the workspace only", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-edit-"));
  try {
    const filePath = path.join(workspaceRoot, "notes.txt");
    await writeFile(filePath, "hello world\nhello again\n", "utf8");
    const tool = getBuiltinTool("edit");
    const result = await tool.execute(
      {
        path: "notes.txt",
        oldString: "hello",
        newString: "hi",
      },
      { sessionId: "s", agentId: "a", workspaceRoot },
    );

    assert.match(result.content, /Edit applied/);
    assert.equal(await readFile(filePath, "utf8"), "hi world\nhello again\n");

    await assert.rejects(
      () =>
        tool.execute(
          {
            path: "../notes.txt",
            oldString: "hello",
            newString: "hi",
          },
          { sessionId: "s", agentId: "a", workspaceRoot },
        ),
      /outside the workspace root/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("bash tool runs inside the workspace and caps output", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-shell-"));
  try {
    const tool = getBuiltinTool("bash");
    const result = await tool.execute(
      {
        command: "printf 'abc'; printf '%0500d' 0",
        maxOutputBytes: 80,
      },
      { sessionId: "s", agentId: "a", workspaceRoot },
    );

    assert.match(result.content, /^abc/);
    assert.match(result.content, /\[truncated/);
    assert.equal(result.metadata?.truncated, true);

    await assert.rejects(
      () =>
        tool.execute(
          {
            command: "rm -rf .",
          },
          { sessionId: "s", agentId: "a", workspaceRoot },
        ),
      /Refusing to run potentially destructive command/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("agent core converts thrown tool errors into sanitized tool messages", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "explode-1",
          name: "explode",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "工具失败已处理。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createSingleToolCore(gateway, {
    name: "explode",
    description: "Throw an unsafe-looking error",
    inputSchema: { type: "object" },
    risk: "read",
    async execute() {
      throw new Error("</tool_call>```json\n{\"oops\":true}\n```" + "x".repeat(5_000));
    },
  });

  for await (const _event of core.sendTurn({
    sessionId: "error-session",
    agentId: "tool-agent",
    content: "run explode",
  })) {
    // Drain the turn.
  }

  const toolMessage = gateway.requests[1]?.messages.at(-1);
  assert.equal(toolMessage?.role, "tool");
  assert.match(toolMessage?.content ?? "", /^\[TOOL_ERROR\]/);
  assert.doesNotMatch(toolMessage?.content ?? "", /<\/tool_call>|```/);
  assert.equal((toolMessage?.content.length ?? 0) < 2_200, true);
});

test("agent core truncates oversized successful tool results before the next model call", async () => {
  const gateway = new ScriptedModelGateway([
    [
      {
        type: "tool_call",
        toolCall: {
          id: "large-1",
          name: "large_result",
          input: {},
        },
      },
      { type: "done", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "大结果已处理。" },
      { type: "done", stopReason: "end_turn" },
    ],
  ]);
  const core = createSingleToolCore(gateway, {
    name: "large_result",
    description: "Return a large result",
    inputSchema: { type: "object" },
    risk: "read",
    async execute() {
      return { content: "a".repeat(40_000) };
    },
  });

  for await (const _event of core.sendTurn({
    sessionId: "large-session",
    agentId: "tool-agent",
    content: "run large",
  })) {
    // Drain the turn.
  }

  const toolMessage = gateway.requests[1]?.messages.at(-1);
  assert.equal(toolMessage?.role, "tool");
  assert.match(toolMessage?.content ?? "", /\[truncated/);
  assert.equal((toolMessage?.content.length ?? 0) < 31_000, true);
});
