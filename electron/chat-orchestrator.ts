import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import type {
  AppConfig,
  ChatConversation,
  ChatEvent,
  ChatMessageRuntimeTrace,
  ChatMessage,
  ChatSendInput,
  ChatToolCall,
  ChatTurnStartResult,
  ChatVisual,
} from "../src/types";
import { parseChatMessageContent } from "../src/lib/chat-visuals";
import { buildRuntimeActivityItems } from "../src/lib/runtime-activity";
import {
  appendTimelineTextItem,
  syncTimelineActivityItems,
  upsertTimelineToolItem,
} from "../src/lib/runtime-timeline";
import {
  AgentCore,
  DEFAULT_AGENT_ID,
  OpenAICompatibleModelGateway,
  SkillRegistry,
  ToolRegistry,
  createBuiltinToolDefinitions,
  createDefaultAgentRegistry,
  type AgentEvent,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./agent-core";
import { ConversationService } from "./conversation-service";
import { StreamingMessagePersister } from "./streaming-message-persister";
import { WorkspaceService } from "./workspace-service";

const STREAMING_MESSAGE_PERSIST_INTERVAL_MS = 200;

interface ActiveTurn {
  conversationId: string;
  turnId: string;
  sessionId: string;
  assistantMessageId: string;
  assistantRawText: string;
  assistantContent: string;
  assistantVisuals: ChatVisual[];
  assistantVisualsSignature: string;
  assistantLastEmittedContent: string;
  assistantLastEmittedVisualsSignature: string;
  runtimeTrace: ChatMessageRuntimeTrace;
  messagePersister: StreamingMessagePersister;
  completion: Deferred<ChatTurnCompletionResult>;
  unregisterSessionHandlers: () => void;
  closed: boolean;
}

interface PreparedPrompt {
  content: string;
  workspacePrompt: string;
  workspaceRoot: string;
  fullFileSystemAccess: boolean;
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
    activityItems: [],
    timelineItems: [],
    planEntries: [],
    toolCalls: [],
    terminalOutputs: {},
    thoughtText: "",
  };
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

export function buildLocalDirectoryContext(homeDirectory = os.homedir()) {
  const home = path.resolve(homeDirectory);
  const directories = [
    ["Home / 家目录", home],
    ["Desktop / 桌面", path.join(home, "Desktop")],
    ["Downloads / 下载", path.join(home, "Downloads")],
    ["Documents / 文档", path.join(home, "Documents")],
  ];

  return [
    `User home directory: ${home}`,
    "Common local directories:",
    ...directories.map(([label, directoryPath]) => `- ${label}: ${directoryPath}`),
    "Path selection rule: when the user asks for a named local directory such as Desktop/桌面, Downloads/下载, Documents/文档, or provides an absolute path, call file tools with that absolute target. Use the workspace root only for project/workspace requests or when no target is specified.",
  ].join("\n");
}

function buildAttachmentContext(input: ChatSendInput) {
  const sections = (input.attachments ?? []).map((attachment, index) => {
    const header = `${index + 1}. ${attachment.name} (${attachment.mimeType || "unknown"})`;
    if (attachment.content?.trim()) {
      return `${header}\n${attachment.content.trim()}`;
    }
    return `${header}\nAttached file path: ${attachment.path}`;
  });

  if (sections.length === 0) {
    return "";
  }

  return `Attached files:\n${sections.join("\n\n")}`;
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
  private readonly agentCoreId = "native";
  private readonly defaultAgentId = DEFAULT_AGENT_ID;
  private readonly nativeCore: AgentCore;

  constructor(
    private readonly conversationService: ConversationService,
    private readonly workspaceService: WorkspaceService,
    private readonly emitEvent: (event: ChatEvent) => void,
    private readonly approvalHandler?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>,
  ) {
    const agents = createDefaultAgentRegistry();
    const skills = new SkillRegistry();
    const tools = new ToolRegistry();
    for (const tool of createBuiltinToolDefinitions()) {
      tools.register(tool);
    }

    this.nativeCore = new AgentCore({
      agents,
      skills,
      tools,
      modelGateway: new OpenAICompatibleModelGateway(async () => await this.workspaceService.getConfigSnapshot()),
      approvalHandler: this.approvalHandler,
    });
  }

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
      agentCore: this.agentCoreId,
    });
    const turnId = randomUUID();
    const baseConversation = {
      ...started.conversation,
      agentCore: this.agentCoreId,
    };
    const completion = createDeferred<ChatTurnCompletionResult>();
    void completion.promise.catch(() => undefined);

    try {
      const prepared = await this.preparePrompt(input, started.conversation.selectedKnowledgeBaseIds);
      const sessionId = started.conversation.agentSessionId?.trim() || randomUUID();

      await this.conversationService.setConversationAgentSession(started.conversation.id, {
        agentCore: this.agentCoreId,
        agentSessionId: sessionId,
      });

      const activeTurn = {
        conversationId: started.conversation.id,
        turnId,
        sessionId,
        assistantMessageId: started.assistantMessage.id,
        assistantRawText: started.assistantMessage.content,
        assistantContent: started.assistantMessage.content,
        assistantVisuals: started.assistantMessage.visuals ?? [],
        assistantVisualsSignature: serializeVisuals(started.assistantMessage.visuals ?? []),
        assistantLastEmittedContent: started.assistantMessage.content,
        assistantLastEmittedVisualsSignature: serializeVisuals(started.assistantMessage.visuals ?? []),
        runtimeTrace: started.assistantMessage.runtimeTrace ?? createEmptyRuntimeTrace(),
        messagePersister: null as unknown as StreamingMessagePersister,
        completion,
        unregisterSessionHandlers: () => undefined,
        closed: false,
      } satisfies ActiveTurn;

      activeTurn.messagePersister = new StreamingMessagePersister({
        intervalMs: STREAMING_MESSAGE_PERSIST_INTERVAL_MS,
        persist: async () => {
          await this.persistAssistantState(activeTurn, { emitUpdate: false });
        },
      });

      this.activeTurns.set(started.conversation.id, activeTurn);

      queueMicrotask(() => {
        void this.runPrompt(activeTurn, prepared);
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

    activeTurn.assistantRawText = activeTurn.assistantRawText.trim()
      ? activeTurn.assistantRawText
      : INTERRUPTED_ASSISTANT_REPLY_TEXT;
    await this.persistAndEmitAssistantState(activeTurn);
    activeTurn.runtimeTrace.stopReason = "cancelled";
    activeTurn.completion.resolve({
      conversation: await this.conversationService.getConversation(activeTurn.conversationId),
      assistantMessage: {
        id: activeTurn.assistantMessageId,
        role: "assistant",
        content: activeTurn.assistantContent,
        visuals: activeTurn.assistantVisuals,
        attachments: [],
        runtimeTrace: activeTurn.runtimeTrace,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      stopReason: "cancelled",
    });
    this.emitEvent({
      type: "turn_finished",
      conversationId: activeTurn.conversationId,
      turnId: activeTurn.turnId,
      stopReason: "cancelled",
    });
    this.cleanupTurn(activeTurn);
  }

  private async preparePrompt(
    input: ChatSendInput,
    selectedKnowledgeBaseIds: string[],
  ): Promise<PreparedPrompt> {
    const config = await this.workspaceService.getConfigSnapshot();
    const cwd = path.resolve(config.workspaceRoot.trim() || process.cwd());
    const additionalDirectories = collectAdditionalDirectories(cwd, input);
    const [skillContext, knowledgeContext] = await Promise.all([
      this.workspaceService.getEnabledSkillPromptContext(config),
      this.resolveKnowledgeContext(config, input.content, selectedKnowledgeBaseIds),
    ]);
    const attachmentContext = buildAttachmentContext(input);
    const workspacePrompt = [
      `Workspace root: ${cwd}`,
      buildLocalDirectoryContext(),
      additionalDirectories.length > 0
        ? `Additional attachment directories:\n${additionalDirectories.join("\n")}`
        : "",
      skillContext,
      knowledgeContext,
      attachmentContext,
    ].filter(Boolean).join("\n\n");

    return {
      content: buildTurnPromptContent(input),
      workspacePrompt,
      workspaceRoot: cwd,
      fullFileSystemAccess: config.security.fullFileSystemAccess === true,
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

  private async runPrompt(activeTurn: ActiveTurn, prepared: PreparedPrompt) {
    try {
      let stopReason = "end_turn";
      for await (const event of this.nativeCore.sendTurn({
        sessionId: activeTurn.sessionId,
        agentId: this.defaultAgentId,
        content: prepared.content,
        workspacePrompt: prepared.workspacePrompt,
        workspaceRoot: prepared.workspaceRoot,
        fullFileSystemAccess: prepared.fullFileSystemAccess,
      })) {
        if (activeTurn.closed) {
          return;
        }

        await this.handleAgentEvent(activeTurn, event);
        if (event.type === "turn_finished") {
          stopReason = event.stopReason;
        }
      }

      await activeTurn.messagePersister.flush();
      await this.ensureInterruptedReplyHint(activeTurn, stopReason);
      activeTurn.runtimeTrace.stopReason = stopReason;
      activeTurn.runtimeTrace.error = undefined;
      await this.persistAssistantState(activeTurn, { emitUpdate: true });
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
        stopReason,
      });

      this.emitEvent({
        type: "turn_finished",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        stopReason,
      });
    } catch (error) {
      await activeTurn.messagePersister.flush();
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
    await this.persistAssistantState(activeTurn, { emitUpdate: true });
  }

  private async persistAssistantState(
    activeTurn: ActiveTurn,
    options: { emitUpdate: boolean; forceEmitUpdate?: boolean },
  ) {
    const parsed = parseChatMessageContent(activeTurn.assistantRawText);
    const nextVisualsSignature = serializeVisuals(parsed.visuals);
    const stateChanged =
      parsed.text !== activeTurn.assistantContent ||
      nextVisualsSignature !== activeTurn.assistantVisualsSignature;

    if (stateChanged || options.forceEmitUpdate) {
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
    }

    if (
      !options.emitUpdate ||
      (!options.forceEmitUpdate &&
        activeTurn.assistantContent === activeTurn.assistantLastEmittedContent &&
        activeTurn.assistantVisualsSignature === activeTurn.assistantLastEmittedVisualsSignature)
    ) {
      return;
    }

    activeTurn.assistantLastEmittedContent = activeTurn.assistantContent;
    activeTurn.assistantLastEmittedVisualsSignature = activeTurn.assistantVisualsSignature;

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
    activeTurn.runtimeTrace.activityItems = buildRuntimeActivityItems(activeTurn.runtimeTrace.toolCalls);
    activeTurn.runtimeTrace.timelineItems = syncTimelineActivityItems(
      activeTurn.runtimeTrace.timelineItems,
      activeTurn.runtimeTrace.activityItems,
      (activity) => `activity-${activity.id}-${randomUUID()}`,
    );
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

  private appendTextTimelineItem(activeTurn: ActiveTurn, type: "thought" | "status", text: string) {
    activeTurn.runtimeTrace.timelineItems = appendTimelineTextItem(
      activeTurn.runtimeTrace.timelineItems,
      type,
      text,
      `${type}-${randomUUID()}`,
    );
  }

  private appendToolTimelineItem(activeTurn: ActiveTurn, toolCallId: string) {
    activeTurn.runtimeTrace.timelineItems = upsertTimelineToolItem(
      activeTurn.runtimeTrace.timelineItems,
      toolCallId,
      `tool-${toolCallId}-${randomUUID()}`,
    );
  }

  private async sealAssistantCandidateAsProcess(activeTurn: ActiveTurn) {
    const processText = activeTurn.assistantRawText;
    if (!processText.trim()) {
      return;
    }

    activeTurn.assistantRawText = "";
    this.appendTextTimelineItem(activeTurn, "status", processText);
    this.emitEvent({
      type: "status_delta",
      conversationId: activeTurn.conversationId,
      turnId: activeTurn.turnId,
      textDelta: processText,
    });
    await this.persistAssistantState(activeTurn, { emitUpdate: true, forceEmitUpdate: true });
  }

  private emitActivitySummary(activeTurn: ActiveTurn) {
    const items = buildRuntimeActivityItems(activeTurn.runtimeTrace.toolCalls);
    activeTurn.runtimeTrace.activityItems = items;
    activeTurn.runtimeTrace.timelineItems = syncTimelineActivityItems(
      activeTurn.runtimeTrace.timelineItems,
      items,
      (activity) => `activity-${activity.id}-${randomUUID()}`,
    );
    if (items.length === 0) {
      return;
    }

    this.emitEvent({
      type: "activity_summary",
      conversationId: activeTurn.conversationId,
      turnId: activeTurn.turnId,
      items,
    });
  }

  private async handleAgentEvent(activeTurn: ActiveTurn, event: AgentEvent) {
    if (activeTurn.closed) {
      return;
    }

    if (event.type === "message_delta") {
      const textDelta = event.text;
      if (!textDelta) {
        return;
      }

      activeTurn.assistantRawText += textDelta;
      this.emitEvent({
        type: "message_delta",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        messageId: activeTurn.assistantMessageId,
        textDelta,
      });
      activeTurn.messagePersister.schedule();
      return;
    }

    if (event.type === "message_replace") {
      activeTurn.assistantRawText = event.text;
      await this.persistAndEmitAssistantState(activeTurn);
      return;
    }

    if (event.type === "thought_delta") {
      const textDelta = event.text;
      if (!textDelta) {
        return;
      }

      activeTurn.runtimeTrace.thoughtText += textDelta;
      this.appendTextTimelineItem(activeTurn, "thought", textDelta);
      this.emitEvent({
        type: "thought_delta",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        textDelta,
      });
      return;
    }

    if (event.type === "status_delta") {
      const textDelta = event.text;
      if (!textDelta) {
        return;
      }

      this.appendTextTimelineItem(activeTurn, "status", textDelta);
      this.emitEvent({
        type: "status_delta",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        textDelta,
      });
      return;
    }

    if (event.type === "tool_call_started") {
      await this.sealAssistantCandidateAsProcess(activeTurn);
      const toolCall: ChatToolCall = {
        toolCallId: event.toolCall.id,
        title: event.toolCall.name,
        status: "in_progress",
        kind: "other",
        content: [],
        rawInputJson: stringifyJson(event.toolCall.input),
      };
      activeTurn.runtimeTrace.toolCalls = [
        ...activeTurn.runtimeTrace.toolCalls.filter(
          (entry) => entry.toolCallId !== event.toolCall.id,
        ),
        toolCall,
      ];

      this.emitActivitySummary(activeTurn);
      this.appendToolTimelineItem(activeTurn, event.toolCall.id);
      this.emitEvent({
        type: "tool_call_started",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCall,
      });
      return;
    }

    if (event.type === "tool_call_finished") {
      const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
        status: "completed",
        content: [{ type: "text", text: event.result.content }],
        rawOutputJson: stringifyJson(event.result),
      };
      activeTurn.runtimeTrace.toolCalls = activeTurn.runtimeTrace.toolCalls.map((toolCall) =>
        toolCall.toolCallId === event.toolCall.id
          ? {
              ...toolCall,
              ...patch,
              content: patch.content ?? toolCall.content,
            }
          : toolCall,
      );

      this.emitEvent({
        type: "tool_call_updated",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCallId: event.toolCall.id,
        patch,
      });
      this.emitActivitySummary(activeTurn);
      return;
    }

    if (event.type === "permission_denied" || event.type === "permission_requested") {
      await this.sealAssistantCandidateAsProcess(activeTurn);
      const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
        title: event.toolCall.name,
        status: event.type === "permission_denied" ? "failed" : "pending",
        kind: "other",
        content: [{ type: "text", text: event.reason }],
        rawInputJson: stringifyJson(event.toolCall.input),
      };
      const existing = activeTurn.runtimeTrace.toolCalls.some(
        (toolCall) => toolCall.toolCallId === event.toolCall.id,
      );

      if (existing) {
        activeTurn.runtimeTrace.toolCalls = activeTurn.runtimeTrace.toolCalls.map((toolCall) =>
          toolCall.toolCallId === event.toolCall.id
            ? {
                ...toolCall,
                ...patch,
                content: patch.content ?? toolCall.content,
              }
            : toolCall,
        );
        this.emitEvent({
          type: "tool_call_updated",
          conversationId: activeTurn.conversationId,
          turnId: activeTurn.turnId,
          toolCallId: event.toolCall.id,
          patch,
        });
        this.emitActivitySummary(activeTurn);
        return;
      }

      const toolCall: ChatToolCall = {
        toolCallId: event.toolCall.id,
        title: event.toolCall.name,
        status: patch.status,
        kind: "other",
        content: patch.content ?? [],
        rawInputJson: patch.rawInputJson,
      };
      activeTurn.runtimeTrace.toolCalls = [...activeTurn.runtimeTrace.toolCalls, toolCall];
      this.emitActivitySummary(activeTurn);
      this.appendToolTimelineItem(activeTurn, event.toolCall.id);
      this.emitEvent({
        type: "tool_call_started",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCall,
      });
    }
  }

  private cleanupTurn(activeTurn: ActiveTurn) {
    if (activeTurn.closed) {
      return;
    }

    activeTurn.closed = true;
    activeTurn.messagePersister.cancel();
    activeTurn.unregisterSessionHandlers();
    this.activeTurns.delete(activeTurn.conversationId);
  }
}
