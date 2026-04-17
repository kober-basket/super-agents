import { randomUUID } from "node:crypto";
import path from "node:path";

import type * as acp from "@agentclientprotocol/sdk";

import type {
  AppConfig,
  ChatConversation,
  ChatEvent,
  ChatMessageRuntimeTrace,
  ChatMessage,
  ChatPlanEntry,
  ChatSendInput,
  ChatTerminalOutput,
  ChatToolCall,
  ChatToolCallContent,
  ChatTurnStartResult,
  ChatVisual,
} from "../src/types";
import { parseChatMessageContent } from "../src/lib/chat-visuals";
import {
  AcpRuntimeManager,
  contentBlockToText,
  mapConfigToAcpMcpServers,
  toPromptBlocks,
} from "./acp-runtime-manager";
import { ConversationService } from "./conversation-service";
import { WorkspaceService } from "./workspace-service";

interface ActiveTurn {
  conversationId: string;
  turnId: string;
  sessionId: string;
  assistantMessageId: string;
  assistantRawText: string;
  assistantContent: string;
  assistantVisuals: ChatVisual[];
  assistantVisualsSignature: string;
  runtimeTrace: ChatMessageRuntimeTrace;
  completion: Deferred<ChatTurnCompletionResult>;
  unregisterSessionHandlers: () => void;
  closed: boolean;
}

interface PreparedPrompt {
  cwd: string;
  additionalDirectories: string[];
  mcpServers: acp.McpServer[];
  prompt: acp.ContentBlock[];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export interface ChatTurnCompletionResult {
  conversation: ChatConversation;
  assistantMessage: ChatMessage;
  stopReason: string;
}

export interface ChatTurnExecution {
  result: ChatTurnStartResult;
  completion: Promise<ChatTurnCompletionResult>;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function uniquePaths(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => path.resolve(value)),
    ),
  );
}

function stringifyJson(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createEmptyRuntimeTrace(): ChatMessageRuntimeTrace {
  return {
    planEntries: [],
    toolCalls: [],
    terminalOutputs: {},
    thoughtText: "",
  };
}

function mapPlanEntries(entries: acp.PlanEntry[]): ChatPlanEntry[] {
  return entries.map((entry) => ({
    content: entry.content,
    priority: entry.priority,
    status: entry.status,
  }));
}

function mapToolContent(content: acp.ToolCallContent[]): ChatToolCallContent[] {
  return content.map((entry) => {
    if (entry.type === "content") {
      return {
        type: "text",
        text: contentBlockToText(entry.content),
      };
    }

    if (entry.type === "diff") {
      return {
        type: "diff",
        path: entry.path,
        oldText: entry.oldText,
        newText: entry.newText,
      };
    }

    return {
      type: "terminal",
      terminalId: entry.terminalId,
    };
  });
}

function mapToolCall(toolCall: acp.ToolCall): ChatToolCall {
  return {
    toolCallId: toolCall.toolCallId,
    title: toolCall.title,
    status: toolCall.status,
    kind: toolCall.kind,
    content: toolCall.content ? mapToolContent(toolCall.content) : [],
    locations: toolCall.locations?.map((location) => ({
      path: location.path,
      line: location.line,
    })),
    rawInputJson: stringifyJson(toolCall.rawInput),
    rawOutputJson: stringifyJson(toolCall.rawOutput),
  };
}

function mapToolCallPatch(
  toolCall: acp.ToolCallUpdate,
): Partial<Omit<ChatToolCall, "toolCallId">> {
  const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {};

  if (toolCall.title !== undefined) {
    patch.title = toolCall.title;
  }
  if (toolCall.status !== undefined) {
    patch.status = toolCall.status;
  }
  if (toolCall.kind !== undefined) {
    patch.kind = toolCall.kind ?? undefined;
  }
  if (toolCall.content !== undefined) {
    patch.content = toolCall.content ? mapToolContent(toolCall.content) : [];
  }
  if (toolCall.locations !== undefined) {
    patch.locations =
      toolCall.locations?.map((location) => ({
        path: location.path,
        line: location.line,
      })) ?? [];
  }
  if (toolCall.rawInput !== undefined) {
    patch.rawInputJson = stringifyJson(toolCall.rawInput);
  }
  if (toolCall.rawOutput !== undefined) {
    patch.rawOutputJson = stringifyJson(toolCall.rawOutput);
  }

  return patch;
}

function buildKnowledgeContext(search: {
  query: string;
  results: Array<{
    pageContent: string;
    metadata: Record<string, unknown>;
    knowledgeBaseName: string;
  }>;
}) {
  if (search.results.length === 0) {
    return "";
  }

  const sections = search.results.map((result, index) => {
    const title =
      typeof result.metadata.title === "string" && result.metadata.title.trim()
        ? result.metadata.title.trim()
        : typeof result.metadata.source === "string" && result.metadata.source.trim()
          ? result.metadata.source.trim()
          : `Snippet ${index + 1}`;
    const excerpt = result.pageContent.trim().slice(0, 1_400);

    return `${index + 1}. [${result.knowledgeBaseName}] ${title}\n${excerpt}`;
  });

  return `Reference knowledge base excerpts for this request:\n${sections.join("\n\n")}`;
}

function collectAdditionalDirectories(cwd: string, input: ChatSendInput) {
  const attachmentDirectories = (input.attachments ?? [])
    .map((attachment) => attachment.path?.trim())
    .filter(Boolean)
    .map((attachmentPath) => path.dirname(attachmentPath));

  return uniquePaths(attachmentDirectories).filter((directoryPath) => directoryPath !== cwd);
}

function normalizeKnowledgeBaseIds(value: string[] | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function shouldSuggestInlineVisual(input: ChatSendInput) {
  const content = input.content.trim();
  const attachmentSignal = (input.attachments ?? []).some((attachment) => {
    const name = attachment.name.toLowerCase();
    const mimeType = attachment.mimeType.toLowerCase();
    return (
      /\.(csv|tsv|json|xlsx?|md)$/i.test(name) ||
      mimeType.includes("csv") ||
      mimeType.includes("json") ||
      mimeType.includes("spreadsheet")
    );
  });

  if (attachmentSignal) {
    return true;
  }

  return /(?:chart|diagram|timeline|flowchart|flow diagram|graph|plot|visual(?:ize|ise|ization)?|mermaid|architecture|sequence|trend|可视化|图表|流程图|架构图|时序图|关系图|画图|折线图|柱状图|趋势图)/i.test(
    content,
  );
}

function shouldSuggestInlineVisualStable(input: ChatSendInput) {
  const content = input.content.trim();
  const attachmentSignal = (input.attachments ?? []).some((attachment) => {
    const name = attachment.name.toLowerCase();
    const mimeType = attachment.mimeType.toLowerCase();
    return (
      /\.(csv|tsv|json|xlsx?|md)$/i.test(name) ||
      mimeType.includes("csv") ||
      mimeType.includes("json") ||
      mimeType.includes("spreadsheet")
    );
  });

  if (attachmentSignal) {
    return true;
  }

  return /(?:chart|diagram|timeline|flowchart|flow diagram|graph|plot|visual(?:ize|ise|ization)?|mermaid|architecture|sequence|trend|\u53ef\u89c6\u5316|\u56fe\u8868|\u6d41\u7a0b\u56fe|\u67b6\u6784\u56fe|\u65f6\u5e8f\u56fe|\u5173\u7cfb\u56fe|\u753b\u56fe|\u6298\u7ebf\u56fe|\u67f1\u72b6\u56fe|\u8d8b\u52bf\u56fe)/i.test(
    content,
  );
}

function buildInlineVisualInstruction(input: ChatSendInput) {
  if (!shouldSuggestInlineVisualStable(input)) {
    return "";
  }

  return [
    "If a visual would materially improve this answer, append one or more fenced code blocks after the prose using the language `super-agents-visual`.",
    "Only emit valid JSON inside that block. Do not emit HTML, CSS, JavaScript, or SVG.",
    "Supported payloads:",
    '1. Mermaid diagram: {"type":"diagram","style":"mermaid","title":"Optional title","description":"Optional note","code":"graph TD; A-->B;"}',
    '2. Vega-Lite chart: {"type":"chart","library":"vega-lite","title":"Optional title","description":"Optional note","spec":{...}}',
    "For Vega-Lite charts, you may include inline interactive controls through standard `params` and `bind` fields inside `spec` when sliders, selects, or toggles help exploration.",
    "You may output either one object or an array of objects in the fenced block.",
    "Keep all data inline in the JSON. Do not reference remote URLs or external assets.",
    "If no visual is needed, reply normally without a visual block.",
  ].join("\n");
}

function buildTurnPromptContent(input: ChatSendInput) {
  const content = input.content.trim();
  const visualInstruction = buildInlineVisualInstruction(input);
  if (!visualInstruction) {
    return content;
  }

  return [content, "Additional reply-format instructions:", visualInstruction]
    .filter(Boolean)
    .join("\n\n");
}

function serializeVisuals(visuals: ChatVisual[]) {
  return JSON.stringify(visuals);
}

const INTERRUPTED_ASSISTANT_REPLY = "已停止回复。你可以继续发送下一条消息。";

const INTERRUPTED_ASSISTANT_REPLY_TEXT = "已停止回复。你可以继续发送下一条消息。";

function looksLikeTurnCancellation(value?: string) {
  return Boolean(value && /(cancel|abort|interrupt|stop(ped)?)/i.test(value));
}

export class ChatOrchestrator {
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly agentCore = "opencode";

  constructor(
    private readonly conversationService: ConversationService,
    private readonly workspaceService: WorkspaceService,
    private readonly runtime: AcpRuntimeManager,
    private readonly emitEvent: (event: ChatEvent) => void,
  ) {}

  async startTurn(input: ChatSendInput): Promise<ChatTurnStartResult> {
    return (await this.startTurnWithCompletion(input)).result;
  }

  async startTurnAndWait(input: ChatSendInput): Promise<ChatTurnCompletionResult> {
    return await (await this.startTurnWithCompletion(input)).completion;
  }

  async startTurnWithCompletion(input: ChatSendInput): Promise<ChatTurnExecution> {
    const existingConversationId = input.conversationId?.trim();
    if (existingConversationId && this.activeTurns.has(existingConversationId)) {
      throw new Error("This conversation is already running.");
    }

    const started = await this.conversationService.startTurn(input, {
      agentCore: this.agentCore,
    });
    const turnId = randomUUID();
    const baseConversation = {
      ...started.conversation,
      agentCore: this.agentCore,
    };
    const completion = createDeferred<ChatTurnCompletionResult>();
    void completion.promise.catch(() => undefined);

    try {
      await this.runtime.ensureInitialized();
      const prepared = await this.preparePrompt(input, started.conversation.selectedKnowledgeBaseIds);
      const sessionId = started.conversation.agentSessionId?.trim()
        ? await this.runtime.ensureSession(started.conversation.agentSessionId, {
            cwd: prepared.cwd,
            additionalDirectories: prepared.additionalDirectories,
            mcpServers: prepared.mcpServers,
          })
        : (
            await this.runtime.createSession({
              cwd: prepared.cwd,
              additionalDirectories: prepared.additionalDirectories,
              mcpServers: prepared.mcpServers,
            })
          ).sessionId;

      await this.conversationService.setConversationAgentSession(started.conversation.id, {
        agentCore: this.agentCore,
        agentSessionId: sessionId,
      });

      const activeTurn: ActiveTurn = {
        conversationId: started.conversation.id,
        turnId,
        sessionId,
        assistantMessageId: started.assistantMessage.id,
        assistantRawText: started.assistantMessage.content,
        assistantContent: started.assistantMessage.content,
        assistantVisuals: started.assistantMessage.visuals ?? [],
        assistantVisualsSignature: serializeVisuals(started.assistantMessage.visuals ?? []),
        runtimeTrace: started.assistantMessage.runtimeTrace ?? createEmptyRuntimeTrace(),
        completion,
        unregisterSessionHandlers: () => undefined,
        closed: false,
      };

      activeTurn.unregisterSessionHandlers = this.runtime.registerSessionHandlers(sessionId, {
        onUpdate: async (update) => {
          await this.handleSessionUpdate(activeTurn, update);
        },
        onTerminalOutput: async (terminal) => {
          activeTurn.runtimeTrace.terminalOutputs[terminal.terminalId] = {
            terminalId: terminal.terminalId,
            output: terminal.output,
            truncated: terminal.truncated,
            exitCode: terminal.exitCode,
            signal: terminal.signal,
          };

          this.emitEvent({
            type: "terminal_output",
            conversationId: activeTurn.conversationId,
            turnId: activeTurn.turnId,
            terminal: {
              terminalId: terminal.terminalId,
              output: terminal.output,
              truncated: terminal.truncated,
              exitCode: terminal.exitCode,
              signal: terminal.signal,
            } satisfies ChatTerminalOutput,
          });
        },
      });

      this.activeTurns.set(started.conversation.id, activeTurn);

      queueMicrotask(() => {
        void this.runPrompt(activeTurn, started.userMessage.id, prepared.prompt);
      });

      return {
        result: {
          createdConversation: started.createdConversation,
          turnId,
          conversation: {
            ...baseConversation,
            agentSessionId: sessionId,
          },
        },
        completion: completion.promise,
      };
    } catch (error) {
      completion.reject(error);
      queueMicrotask(() => {
        this.emitEvent({
          type: "turn_failed",
          conversationId: started.conversation.id,
          turnId,
          error: error instanceof Error ? error.message : "Failed to start agent turn",
        });
      });

      return {
        result: {
          createdConversation: started.createdConversation,
          turnId,
          conversation: baseConversation,
        },
        completion: completion.promise,
      };
    }
  }

  async cancelTurn(conversationId: string) {
    const activeTurn = this.activeTurns.get(conversationId);
    if (!activeTurn) {
      return;
    }

    await this.runtime.cancel(activeTurn.sessionId);
  }

  private async preparePrompt(
    input: ChatSendInput,
    selectedKnowledgeBaseIds: string[],
  ): Promise<PreparedPrompt> {
    const config = await this.workspaceService.getConfigSnapshot();
    const cwd = path.resolve(config.workspaceRoot.trim() || process.cwd());
    const additionalDirectories = collectAdditionalDirectories(cwd, input);
    const mcpServers = mapConfigToAcpMcpServers(config.mcpServers);
    const [skillContext, knowledgeContext] = await Promise.all([
      this.workspaceService.getEnabledSkillPromptContext(config),
      this.resolveKnowledgeContext(config, input.content, selectedKnowledgeBaseIds),
    ]);
    const injectedContext = [skillContext, knowledgeContext].filter(Boolean).join("\n\n");

    return {
      cwd,
      additionalDirectories,
      mcpServers,
      prompt: toPromptBlocks(
        buildTurnPromptContent(input),
        input.attachments ?? [],
        this.runtime.promptCapabilities,
        injectedContext,
      ),
    };
  }

  private async resolveKnowledgeContext(
    config: AppConfig,
    content: string,
    selectedKnowledgeBaseIds: string[],
  ) {
    const effectiveKnowledgeBaseIds = normalizeKnowledgeBaseIds(selectedKnowledgeBaseIds);
    if (effectiveKnowledgeBaseIds.length === 0) {
      return "";
    }

    const query = content.trim();
    if (!query) {
      return "";
    }

    try {
      const search = await this.workspaceService.searchKnowledgeBases({
        query,
        knowledgeBaseIds: effectiveKnowledgeBaseIds,
        documentCount: config.knowledgeBase.documentCount,
      });

      return buildKnowledgeContext(search);
    } catch {
      return "";
    }
  }

  private async runPrompt(
    activeTurn: ActiveTurn,
    userMessageId: string,
    prompt: acp.ContentBlock[],
  ) {
    try {
      const response = await this.runtime.prompt({
        sessionId: activeTurn.sessionId,
        messageId: userMessageId,
        prompt,
      });
      await this.ensureInterruptedReplyHint(activeTurn, response.stopReason);
      activeTurn.runtimeTrace.stopReason = response.stopReason;
      activeTurn.runtimeTrace.error = undefined;
      try {
        await this.persistRuntimeTrace(activeTurn);
      } catch {
        // Preserve the main turn result even if trace persistence fails.
      }
      const conversation = await this.conversationService.getConversation(activeTurn.conversationId);
      const assistantMessage =
        conversation.messages.find((message) => message.id === activeTurn.assistantMessageId) ??
        ({
          id: activeTurn.assistantMessageId,
          role: "assistant",
          content: activeTurn.assistantContent,
          visuals: activeTurn.assistantVisuals,
          attachments: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } satisfies ChatMessage);

      activeTurn.completion.resolve({
        conversation,
        assistantMessage,
        stopReason: response.stopReason,
      });

      this.emitEvent({
        type: "turn_finished",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        stopReason: response.stopReason,
      });
    } catch (error) {
      await this.ensureInterruptedReplyHint(
        activeTurn,
        error instanceof Error ? error.message : String(error),
      );
      activeTurn.runtimeTrace.stopReason = undefined;
      activeTurn.runtimeTrace.error =
        error instanceof Error ? error.message : "Agent turn failed";
      try {
        await this.persistRuntimeTrace(activeTurn);
      } catch {
        // Best effort only; the original failure should still surface.
      }
      activeTurn.completion.reject(error);
      this.emitEvent({
        type: "turn_failed",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        error: error instanceof Error ? error.message : "Agent turn failed",
      });
    } finally {
      this.cleanupTurn(activeTurn);
    }
  }

  private async ensureInterruptedReplyHint(activeTurn: ActiveTurn, reason?: string) {
    if (!looksLikeTurnCancellation(reason) || activeTurn.assistantRawText.trim()) {
      return;
    }

    activeTurn.assistantRawText = INTERRUPTED_ASSISTANT_REPLY_TEXT;
    await this.persistAndEmitAssistantState(activeTurn);
  }

  private async persistAndEmitAssistantState(activeTurn: ActiveTurn) {
    const parsed = parseChatMessageContent(activeTurn.assistantRawText);
    const nextVisualsSignature = serializeVisuals(parsed.visuals);

    if (
      parsed.text === activeTurn.assistantContent &&
      nextVisualsSignature === activeTurn.assistantVisualsSignature
    ) {
      return;
    }

    activeTurn.assistantContent = parsed.text;
    activeTurn.assistantVisuals = parsed.visuals;
    activeTurn.assistantVisualsSignature = nextVisualsSignature;

    await this.conversationService.updateAssistantMessage(
      activeTurn.conversationId,
      activeTurn.assistantMessageId,
      activeTurn.assistantContent,
      activeTurn.assistantVisuals,
      activeTurn.runtimeTrace,
    );

    this.emitEvent({
      type: "message_updated",
      conversationId: activeTurn.conversationId,
      turnId: activeTurn.turnId,
      messageId: activeTurn.assistantMessageId,
      content: activeTurn.assistantContent,
      visuals: activeTurn.assistantVisuals,
    });
  }

  private async persistRuntimeTrace(activeTurn: ActiveTurn) {
    await this.conversationService.updateAssistantMessage(
      activeTurn.conversationId,
      activeTurn.assistantMessageId,
      activeTurn.assistantContent,
      activeTurn.assistantVisuals,
      activeTurn.runtimeTrace,
    );

    this.emitEvent({
      type: "message_runtime_trace_updated",
      conversationId: activeTurn.conversationId,
      turnId: activeTurn.turnId,
      messageId: activeTurn.assistantMessageId,
      runtimeTrace: activeTurn.runtimeTrace,
    });
  }

  private async handleSessionUpdate(activeTurn: ActiveTurn, update: acp.SessionUpdate) {
    if (activeTurn.closed) {
      return;
    }

    if (update.sessionUpdate === "agent_message_chunk") {
      const textDelta = contentBlockToText(update.content);
      if (!textDelta) {
        return;
      }

      activeTurn.assistantRawText += textDelta;
      await this.persistAndEmitAssistantState(activeTurn);
      return;
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      const textDelta = contentBlockToText(update.content);
      if (!textDelta) {
        return;
      }

      activeTurn.runtimeTrace.thoughtText += textDelta;

      this.emitEvent({
        type: "thought_delta",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        textDelta,
      });
      return;
    }

    if (update.sessionUpdate === "plan") {
      activeTurn.runtimeTrace.planEntries = mapPlanEntries(update.entries);

      this.emitEvent({
        type: "plan_updated",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        entries: activeTurn.runtimeTrace.planEntries,
      });
      return;
    }

    if (update.sessionUpdate === "tool_call") {
      activeTurn.runtimeTrace.toolCalls = [
        ...activeTurn.runtimeTrace.toolCalls.filter(
          (toolCall) => toolCall.toolCallId !== update.toolCallId,
        ),
        mapToolCall(update),
      ];

      this.emitEvent({
        type: "tool_call_started",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCall: activeTurn.runtimeTrace.toolCalls[activeTurn.runtimeTrace.toolCalls.length - 1],
      });
      return;
    }

    if (update.sessionUpdate === "tool_call_update") {
      const patch = mapToolCallPatch(update);
      activeTurn.runtimeTrace.toolCalls = activeTurn.runtimeTrace.toolCalls.map((toolCall) =>
        toolCall.toolCallId === update.toolCallId
          ? {
              ...toolCall,
              ...patch,
              content: patch.content ?? toolCall.content,
              locations: patch.locations ?? toolCall.locations,
            }
          : toolCall,
      );

      this.emitEvent({
        type: "tool_call_updated",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCallId: update.toolCallId,
        patch,
      });
    }
  }

  private cleanupTurn(activeTurn: ActiveTurn) {
    if (activeTurn.closed) {
      return;
    }

    activeTurn.closed = true;
    activeTurn.unregisterSessionHandlers();
    this.activeTurns.delete(activeTurn.conversationId);
  }
}
