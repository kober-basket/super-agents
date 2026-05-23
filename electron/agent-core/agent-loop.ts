import { AgentRegistry, SkillRegistry, ToolRegistry } from "./registries";
import { DEFAULT_AGENTIC_MAX_TURNS } from "./default-agents";
import { PermissionManager } from "./permission-manager";
import { PromptComposer } from "./prompt-composer";
import { InMemoryAgentSessionManager, type AgentSessionManager } from "./session-manager";
import { ToolPermissionDeniedError } from "./types";
import type {
  AgentEvent,
  AgentMessage,
  ModelGateway,
  ToolCall,
  ToolDefinition,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolResult,
} from "./types";

const MAX_TOOL_RESULT_CHARS = 30_000;
const MAX_TOOL_ERROR_CHARS = 2_000;
const NO_ACTION_CONTINUATION_INSTRUCTION =
  "Your previous response contained only hidden reasoning and no visible answer or tool call. Continue now: if the task needs evidence, call the available tools; otherwise provide the user-facing answer. Do not respond with hidden reasoning only.";
const REQUIRED_TOOL_ACTION_CONTINUATION_INSTRUCTION =
  "Your previous response did not call a tool or write a visible answer. Continue now: call the next required tool if more work is needed; otherwise write the final user-facing answer.";
const TOOL_COMPLETION_PROTOCOL = [
  "If more evidence or actions are needed, call the available tools.",
  "If the task is complete, write the final user-facing answer directly.",
].join("\n");

type SendTurnInput = {
  sessionId: string;
  agentId: string;
  content: string;
  overrideSystemPrompt?: string;
  memoryPrompt?: string;
  workspacePrompt?: string;
  workspaceRoot?: string;
  fullFileSystemAccess?: boolean;
};

interface PreparedToolExecution {
  tool: ToolDefinition;
  toolCall: ToolCall;
  signature: string;
  slotIndex: number;
  concurrencySafe: boolean;
}

interface PendingDuplicateToolResult {
  toolCall: ToolCall;
  signature: string;
  slotIndex: number;
}

function createMaxTurnsReachedMessage(maxTurns: number) {
  return `已达到本轮最大执行轮次（${maxTurns}）。上面的工具结果已经保留；你可以继续发送消息让我接着执行或基于现有结果整理结论。`;
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const omitted = text.length - maxChars;
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated ${omitted} chars]`,
    truncated: true,
  };
}

function sanitizeToolError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(/<\/?(?:tool_call|function_call|result|response|output|input|system|assistant|user)>/gi, "")
    .replace(/```[a-z0-9_-]*\s*/gi, "")
    .trim();
  const { text, truncated } = truncateText(cleaned || "Tool execution failed.", MAX_TOOL_ERROR_CHARS);
  return `[TOOL_ERROR] ${text}${truncated ? " [error truncated]" : ""}`;
}

function normalizeToolResult(result: ToolResult): ToolResult {
  const { text, truncated } = truncateText(result.content, MAX_TOOL_RESULT_CHARS);
  if (!truncated) {
    return result;
  }

  return {
    ...result,
    content: text,
    metadata: {
      ...result.metadata,
      truncated: true,
    },
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function createToolCallSignature(toolCall: ToolCall) {
  return `${toolCall.name}:${stableStringify(toolCall.input ?? {})}`;
}

function createDuplicateToolResultMessage(toolCall: ToolCall, previousResult: ToolResult) {
  return [
    `[DUPLICATE_TOOL_CALL] The same "${toolCall.name}" call with the same input already ran earlier in this turn.`,
    "Use the previous result below instead of calling the tool again.",
    "",
    "Previous result:",
    previousResult.content,
  ].join("\n");
}

function createUniqueToolCallId(
  toolCall: ToolCall,
  usedIds: Set<string>,
  createCollisionSuffix: () => number,
): ToolCall {
  const baseId = toolCall.id.trim() || "tool-call";
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId === toolCall.id ? toolCall : { ...toolCall, id: baseId };
  }

  let nextId = "";
  do {
    nextId = `${baseId}-${createCollisionSuffix()}`;
  } while (usedIds.has(nextId));
  usedIds.add(nextId);
  return { ...toolCall, id: nextId };
}

const LOCAL_DIRECTORY_TOOL_NAMES = new Set(["list", "grep", "glob", "workspace_list_directory", "workspace_search_text"]);
const TOOL_SELF_TEST_DEFAULT_INPUTS: Record<string, Record<string, unknown>> = {
  bash: {
    command: "pwd",
    description: "Print the current working directory for a tool self-test.",
  },
  glob: {
    pattern: "**/*.ts",
    path: ".",
  },
  grep: {
    query: "name",
    path: ".",
  },
  list: {
    path: ".",
  },
  read: {
    path: "package.json",
  },
  todo_write: {
    items: [
      {
        id: "tool-self-test",
        content: "Tool self-test item",
        status: "completed",
      },
    ],
  },
  web_fetch: {
    url: "https://example.com",
    maxBytes: 4_000,
  },
  web_search: {
    query: "OpenAI",
    limit: 1,
  },
};
const COMMON_LOCAL_DIRECTORIES = [
  {
    label: "Desktop / 桌面",
    keywords: [/desktop/i, /桌面/],
  },
  {
    label: "Downloads / 下载",
    keywords: [/downloads?/i, /下载/],
  },
  {
    label: "Documents / 文档",
    keywords: [/documents?/i, /文档/],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExplicitToolSelfTestRequest(value: string) {
  return /(?:工具|tool).*(?:测|测试|test)|(?:测|测试|test).*(?:工具|tool)|all\s+tools/i.test(value);
}

function missingToolField(input: unknown, key: string) {
  if (!isRecord(input)) {
    return true;
  }
  const value = input[key];
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function getToolInputPath(input: unknown) {
  if (!isRecord(input)) {
    return "";
  }
  const value = input.path;
  return typeof value === "string" ? value.trim() : "";
}

function isImplicitWorkspacePath(input: unknown) {
  const pathValue = getToolInputPath(input);
  return !pathValue || pathValue === "." || pathValue === "./";
}

function parseLocalDirectoryPaths(workspacePrompt: string) {
  const paths = new Map<string, string>();

  for (const line of workspacePrompt.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*(Home \/ 家目录|Desktop \/ 桌面|Downloads \/ 下载|Documents \/ 文档):\s*(.+?)\s*$/);
    if (match?.[1] && match[2]) {
      paths.set(match[1], match[2]);
    }
  }

  return paths;
}

function inferExplicitLocalDirectoryPath(userContent: string, workspacePrompt: string) {
  const directoryPaths = parseLocalDirectoryPaths(workspacePrompt);
  for (const directory of COMMON_LOCAL_DIRECTORIES) {
    if (directory.keywords.some((pattern) => pattern.test(userContent))) {
      return directoryPaths.get(directory.label) ?? "";
    }
  }
  return "";
}

function repairImplicitLocalDirectoryToolCall(
  toolCall: ToolCall,
  userContent: string,
  workspacePrompt: string | undefined,
): ToolCall {
  if (!LOCAL_DIRECTORY_TOOL_NAMES.has(toolCall.name) || !isImplicitWorkspacePath(toolCall.input)) {
    return toolCall;
  }

  const inferredPath = inferExplicitLocalDirectoryPath(userContent, workspacePrompt ?? "");
  if (!inferredPath) {
    return toolCall;
  }

  return {
    ...toolCall,
    input: {
      ...(isRecord(toolCall.input) ? toolCall.input : {}),
      path: inferredPath,
    },
  };
}

function repairToolSelfTestToolCall(
  toolCall: ToolCall,
  tool: ToolDefinition | undefined,
  userContent: string,
): ToolCall {
  if (!tool || !isExplicitToolSelfTestRequest(userContent)) {
    return toolCall;
  }

  const defaults = TOOL_SELF_TEST_DEFAULT_INPUTS[tool.name];
  if (!defaults) {
    return toolCall;
  }

  const schema = tool.inputSchema;
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
  if (required.length > 0 && required.every((key) => !missingToolField(toolCall.input, key))) {
    return toolCall;
  }

  const nextInput = isRecord(toolCall.input) ? { ...toolCall.input } : {};
  for (const [key, value] of Object.entries(defaults)) {
    if (missingToolField(nextInput, key)) {
      nextInput[key] = value;
    }
  }

  return {
    ...toolCall,
    input: nextInput,
  };
}

function createSelfTestSkippedToolResult(toolCall: ToolCall, invalidInputReason: string): ToolResult {
  return {
    content: [
      `[TOOL_SELF_TEST_SKIPPED] Tool "${toolCall.name}" was called without safe self-test arguments.`,
      `Missing or invalid input: ${invalidInputReason}`,
      "Do not retry this tool with empty arguments during this self-test; continue with the remaining tools or summarize the result.",
    ].join("\n"),
    metadata: {
      selfTestSkipped: true,
      invalidInput: true,
    },
  };
}

function jsonSchemaType(value: unknown) {
  return isRecord(value) && typeof value.type === "string" ? value.type : "";
}

function matchesJsonSchemaType(value: unknown, type: string) {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "object") {
    return isRecord(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "string") {
    return typeof value === "string";
  }
  return true;
}

function validateToolInput(tool: ToolDefinition, input: unknown) {
  const schema = tool.inputSchema;
  if (!isRecord(schema)) {
    return "";
  }

  if (jsonSchemaType(schema) === "object" && !isRecord(input)) {
    return "input must be an object.";
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : [];
  const inputRecord = isRecord(input) ? input : {};

  for (const key of required) {
    const value = inputRecord[key];
    const propertySchema = properties[key];
    const propertyType = jsonSchemaType(propertySchema);
    if (value === undefined || value === null || (propertyType === "string" && typeof value === "string" && !value.trim())) {
      return `${key} is required.`;
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in inputRecord) || inputRecord[key] === undefined || inputRecord[key] === null) {
      continue;
    }

    const propertyType = jsonSchemaType(propertySchema);
    if (propertyType && !matchesJsonSchemaType(inputRecord[key], propertyType)) {
      return `${key} must be ${propertyType}.`;
    }

    if (isRecord(propertySchema) && Array.isArray(propertySchema.enum) && !propertySchema.enum.includes(inputRecord[key])) {
      return `${key} must be one of ${propertySchema.enum.map((item) => JSON.stringify(item)).join(", ")}.`;
    }
  }

  return "";
}

function isToolCallConcurrencySafe(tool: ToolDefinition, input: unknown) {
  const { isConcurrencySafe } = tool;
  if (typeof isConcurrencySafe === "function") {
    try {
      return isConcurrencySafe(input) === true;
    } catch {
      return false;
    }
  }
  return isConcurrencySafe === true;
}

function partitionPreparedToolExecutions(preparedToolCalls: PreparedToolExecution[]) {
  const batches: PreparedToolExecution[][] = [];
  for (const prepared of preparedToolCalls) {
    const lastBatch = batches.at(-1);
    const lastBatchIsParallel = lastBatch?.every((item) => item.concurrencySafe) === true;
    if (prepared.concurrencySafe && lastBatch && lastBatchIsParallel) {
      lastBatch.push(prepared);
      continue;
    }
    batches.push([prepared]);
  }
  return batches;
}

function createToolMessage(toolCall: ToolCall, result: ToolResult): AgentMessage {
  return {
    role: "tool",
    name: toolCall.name,
    toolCallId: toolCall.id,
    content: result.content,
  };
}

export interface AgentCoreOptions {
  agents: AgentRegistry;
  skills: SkillRegistry;
  tools: ToolRegistry;
  modelGateway: ModelGateway;
  promptComposer?: PromptComposer;
  permissionManager?: PermissionManager;
  sessions?: AgentSessionManager;
  approvalHandler?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
}

export class AgentCore {
  private readonly promptComposer: PromptComposer;
  private readonly permissionManager: PermissionManager;
  private readonly sessions: AgentSessionManager;

  constructor(private readonly options: AgentCoreOptions) {
    this.promptComposer = options.promptComposer ?? new PromptComposer();
    this.permissionManager = options.permissionManager ?? new PermissionManager();
    this.sessions = options.sessions ?? new InMemoryAgentSessionManager();
  }

  private async executePreparedToolCall(
    prepared: PreparedToolExecution,
    input: SendTurnInput,
    agentId: string,
  ): Promise<ToolResult> {
    try {
      return normalizeToolResult(
        await prepared.tool.execute(prepared.toolCall.input, {
          sessionId: input.sessionId,
          agentId,
          workspaceRoot: input.workspaceRoot ?? process.cwd(),
          fullFileSystemAccess: input.fullFileSystemAccess === true,
          toolCall: prepared.toolCall,
          requestApproval: async (request) => {
            return this.options.approvalHandler
              ? await this.options.approvalHandler(request)
              : { type: "deny", reason: "No approval handler is configured." };
          },
        }),
      );
    } catch (error) {
      if (error instanceof ToolPermissionDeniedError) {
        return {
          content: `Permission denied: ${error.message}`,
          metadata: {
            isError: true,
            permissionDenied: true,
          },
        };
      }
      return {
        content: sanitizeToolError(error),
        metadata: {
          isError: true,
        },
      };
    }
  }

  private async *executePreparedToolCalls(input: {
    turnInput: SendTurnInput;
    agentId: string;
    preparedToolCalls: PreparedToolExecution[];
    completedToolResults: Map<string, ToolResult>;
    toolMessageSlots: Array<AgentMessage | undefined>;
  }): AsyncIterable<AgentEvent> {
    const batches = partitionPreparedToolExecutions(input.preparedToolCalls);

    for (const batch of batches) {
      for (const prepared of batch) {
        yield {
          type: "tool_call_started",
          sessionId: input.turnInput.sessionId,
          agentId: input.agentId,
          toolCall: prepared.toolCall,
        };
      }

      const pending = batch.map((prepared) => ({
        prepared,
        promise: this.executePreparedToolCall(prepared, input.turnInput, input.agentId).then((result) => ({
          prepared,
          result,
        })),
      }));

      while (pending.length > 0) {
        const completed = await Promise.race(pending.map((item) => item.promise));
        const index = pending.findIndex((item) => item.prepared === completed.prepared);
        if (index >= 0) {
          pending.splice(index, 1);
        }

        input.completedToolResults.set(completed.prepared.signature, completed.result);
        input.toolMessageSlots[completed.prepared.slotIndex] = createToolMessage(
          completed.prepared.toolCall,
          completed.result,
        );

        yield {
          type: "tool_call_finished",
          sessionId: input.turnInput.sessionId,
          agentId: input.agentId,
          toolCall: completed.prepared.toolCall,
          result: completed.result,
        };
      }
    }
  }

  async *sendTurn(input: SendTurnInput): AsyncIterable<AgentEvent> {
    const agent = this.options.agents.get(input.agentId);
    if (!agent) {
      throw new Error(`Agent "${input.agentId}" is not registered.`);
    }

    const session = this.sessions.getOrCreate(input.sessionId, input.agentId);
    session.messages.push({ role: "user", content: input.content });
    this.sessions.save(session);

    const availableTools = this.options.tools.getMany(agent.tools);
    const baseMaxTurns = agent.maxTurns ?? DEFAULT_AGENTIC_MAX_TURNS;
    const maxTurns = isExplicitToolSelfTestRequest(input.content)
      ? Math.max(baseMaxTurns, Math.min(24, availableTools.length + 4))
      : baseMaxTurns;
    let stopReason = "max_turns";
    const completedToolResults = new Map<string, ToolResult>();
    let sawToolResultThisTurn = false;
    let noActionRetries = 0;
    const toolCallIdsThisTurn = new Set<string>();
    let toolCallIdCollisionSequence = 0;

    for (let step = 0; step < maxTurns; step += 1) {
      const skills = this.options.skills.getMany(agent.skills);
      const tools = availableTools;
      const system = this.promptComposer.compose({
        agent,
        skills,
        overrideSystemPrompt: input.overrideSystemPrompt,
        memoryPrompt: input.memoryPrompt,
        workspacePrompt: input.workspacePrompt,
        appendSystemPrompt: sawToolResultThisTurn ? TOOL_COMPLETION_PROTOCOL : undefined,
      });
      const modelTools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      let assistantText = "";
      let reasoningContent = "";
      let toolCallsThisStep = 0;
      let calledTool = false;
      const assistantToolCalls: ToolCall[] = [];
      const toolMessageSlots: Array<AgentMessage | undefined> = [];
      const preparedToolCalls: PreparedToolExecution[] = [];
      const pendingDuplicateToolResults: PendingDuplicateToolResult[] = [];

      for await (const event of this.options.modelGateway.stream({
        model: agent.model,
        system,
        messages: [...session.messages],
        tools: modelTools,
        toolChoice: "auto",
      })) {
        if (event.type === "reasoning_delta") {
          if (event.reasoningContent !== undefined) {
            reasoningContent += event.reasoningContent;
          }
          yield {
            type: "thought_delta",
            sessionId: input.sessionId,
            agentId: agent.id,
            text: event.text,
          };
          continue;
        }

        if (event.type === "status_delta") {
          yield {
            type: "status_delta",
            sessionId: input.sessionId,
            agentId: agent.id,
            text: event.text,
          };
          continue;
        }

        if (event.type === "usage") {
          yield {
            type: "token_usage",
            sessionId: input.sessionId,
            agentId: agent.id,
            usage: event.usage,
          };
          continue;
        }

        if (event.type === "text_delta") {
          assistantText += event.text;
          yield {
            type: "message_delta",
            sessionId: input.sessionId,
            agentId: agent.id,
            text: event.text,
          };
          continue;
        }

        if (event.type === "tool_call_delta") {
          continue;
        }

        if (event.type === "tool_call") {
          let toolCall = repairImplicitLocalDirectoryToolCall(
            event.toolCall,
            input.content,
            input.workspacePrompt,
          );
          calledTool = true;
          let tool = this.options.tools.get(toolCall.name);
          toolCall = repairToolSelfTestToolCall(toolCall, tool, input.content);
          toolCall = createUniqueToolCallId(toolCall, toolCallIdsThisTurn, () => {
            toolCallIdCollisionSequence += 1;
            return toolCallIdCollisionSequence;
          });
          tool = this.options.tools.get(toolCall.name);
          const toolMessageSlotIndex = assistantToolCalls.length;
          assistantToolCalls.push(toolCall);
          toolMessageSlots.push(undefined);
          const toolCallSignature = createToolCallSignature(toolCall);
          const previousResult = completedToolResults.get(toolCallSignature);
          if (previousResult) {
            toolMessageSlots[toolMessageSlotIndex] = {
              role: "tool",
              name: toolCall.name,
              toolCallId: toolCall.id,
              content: createDuplicateToolResultMessage(toolCall, previousResult),
            };
            continue;
          }
          if (preparedToolCalls.some((prepared) => prepared.signature === toolCallSignature)) {
            pendingDuplicateToolResults.push({
              toolCall,
              signature: toolCallSignature,
              slotIndex: toolMessageSlotIndex,
            });
            continue;
          }

          const invalidInputReason = tool ? validateToolInput(tool, toolCall.input) : "";
          if (invalidInputReason) {
            const result: ToolResult = isExplicitToolSelfTestRequest(input.content)
              ? createSelfTestSkippedToolResult(toolCall, invalidInputReason)
              : {
                  content: [
                    `[TOOL_ERROR] Invalid tool input: ${invalidInputReason}`,
                    `Retry "${toolCall.name}" with valid JSON arguments matching its schema.`,
                    "Do not write tool calls or tool arguments as plain text.",
                  ].join("\n"),
                  metadata: {
                    isError: true,
                    invalidInput: true,
                  },
            };
            toolCallsThisStep += 1;
            completedToolResults.set(toolCallSignature, result);
            toolMessageSlots[toolMessageSlotIndex] = createToolMessage(toolCall, result);
            continue;
          }

          const decision = this.permissionManager.check({
            agent,
            tool,
            toolCall,
            toolCallsThisTurn: toolCallsThisStep,
            fullFileSystemAccess: input.fullFileSystemAccess === true,
          });

          if (decision.type === "deny") {
            const result: ToolResult = {
              content: `Permission denied: ${decision.reason}`,
              metadata: {
                isError: true,
                permissionDenied: true,
              },
            };
            completedToolResults.set(toolCallSignature, result);
            toolMessageSlots[toolMessageSlotIndex] = createToolMessage(toolCall, result);
            yield {
              type: "permission_denied",
              sessionId: input.sessionId,
              agentId: agent.id,
              toolCall,
              reason: decision.reason,
            };
            continue;
          }

          if (decision.type === "ask") {
            yield {
              type: "permission_requested",
              sessionId: input.sessionId,
              agentId: agent.id,
              toolCall,
              reason: decision.reason,
            };
            const approval = this.options.approvalHandler
              ? await this.options.approvalHandler({
                  sessionId: input.sessionId,
                  agentId: agent.id,
                  toolCall,
                  reason: decision.reason,
                  kind: "tool",
                })
              : { type: "deny", reason: "No approval handler is configured." };

            if (approval.type === "deny") {
              const result: ToolResult = {
                content: `Permission denied: ${approval.reason}`,
                metadata: {
                  isError: true,
                  permissionDenied: true,
                },
              };
              completedToolResults.set(toolCallSignature, result);
              toolMessageSlots[toolMessageSlotIndex] = createToolMessage(toolCall, result);
              yield {
                type: "permission_denied",
                sessionId: input.sessionId,
                agentId: agent.id,
                toolCall,
                reason: approval.reason,
              };
              continue;
            }
          }

          const approvalRequired = decision.type === "ask";
          toolCallsThisStep += 1;
          preparedToolCalls.push({
            tool: tool!,
            toolCall,
            signature: toolCallSignature,
            slotIndex: toolMessageSlotIndex,
            concurrencySafe: !approvalRequired && isToolCallConcurrencySafe(tool!, toolCall.input),
          });
          continue;
        }

        stopReason = event.stopReason;
      }

      for await (const toolEvent of this.executePreparedToolCalls({
        turnInput: input,
        agentId: agent.id,
        preparedToolCalls,
        completedToolResults,
        toolMessageSlots,
      })) {
        yield toolEvent;
      }

      for (const duplicate of pendingDuplicateToolResults) {
        const previousResult = completedToolResults.get(duplicate.signature);
        const result: ToolResult = previousResult
          ? {
              content: createDuplicateToolResultMessage(duplicate.toolCall, previousResult),
              metadata: {
                duplicateToolCall: true,
              },
            }
          : {
              content: `[TOOL_ERROR] Duplicate tool call "${duplicate.toolCall.name}" could not reuse a completed result.`,
              metadata: {
                isError: true,
                duplicateToolCall: true,
              },
            };
        toolMessageSlots[duplicate.slotIndex] = createToolMessage(duplicate.toolCall, result);
      }

      const pendingToolMessages = toolMessageSlots.filter((message): message is AgentMessage => Boolean(message));

      if (assistantToolCalls.length > 0 || assistantText) {
        const assistantMessage: AgentMessage = {
          role: "assistant",
          content: assistantText,
          toolCalls: assistantToolCalls,
        };
        if (assistantToolCalls.length > 0 && reasoningContent.length > 0) {
          assistantMessage.reasoningContent = reasoningContent;
        }
        session.messages.push(assistantMessage);
        this.sessions.save(session);
      }
      session.messages.push(...pendingToolMessages);
      if (pendingToolMessages.length > 0) {
        this.sessions.save(session);
        sawToolResultThisTurn = true;
      }

      if (calledTool && step + 1 >= maxTurns) {
        stopReason = "max_turns";
        const maxTurnsText = createMaxTurnsReachedMessage(maxTurns);
        session.messages.push({
          role: "assistant",
          content: maxTurnsText,
          toolCalls: [],
        });
        this.sessions.save(session);
        yield {
          type: "message_delta",
          sessionId: input.sessionId,
          agentId: agent.id,
          text: maxTurnsText,
        };
        yield {
          type: "turn_finished",
          sessionId: input.sessionId,
          agentId: agent.id,
          stopReason,
        };
        return;
      }

      if (!calledTool) {
        if (assistantText.trim()) {
          yield {
            type: "turn_finished",
            sessionId: input.sessionId,
            agentId: agent.id,
            stopReason,
          };
          return;
        }
        if (sawToolResultThisTurn) {
          if (noActionRetries >= 2) {
            yield {
              type: "turn_finished",
              sessionId: input.sessionId,
              agentId: agent.id,
              stopReason,
            };
            return;
          }
          noActionRetries += 1;
          session.messages.push({
            role: "user",
            content: REQUIRED_TOOL_ACTION_CONTINUATION_INSTRUCTION,
          });
          this.sessions.save(session);
          continue;
        }
        if (!assistantText.trim() && assistantToolCalls.length === 0 && noActionRetries < 2) {
          noActionRetries += 1;
          session.messages.push({
            role: "user",
            content: NO_ACTION_CONTINUATION_INSTRUCTION,
          });
          this.sessions.save(session);
          continue;
        }
        yield {
          type: "turn_finished",
          sessionId: input.sessionId,
          agentId: agent.id,
          stopReason,
        };
        return;
      }
    }

    yield {
      type: "turn_finished",
      sessionId: input.sessionId,
      agentId: agent.id,
      stopReason,
    };
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }
}
