import { randomUUID } from "node:crypto";

import type {
  ChatConversation,
  ChatEvent,
  ChatRuntimeTimelineItem,
  ChatMessageRuntimeTrace,
  ChatMessage,
  ChatSendInput,
  ChatTurnStartResult,
  ChatVisual,
} from "../src/types";
import { parseChatMessageContent } from "../src/lib/chat-visuals";
import { addChatTokenUsage } from "../src/lib/token-usage";
import {
  AgentCore,
  DEFAULT_AGENT_ID,
  OpenAICompatibleModelGateway,
  PersistentAgentSessionManager,
  SkillRegistry,
  ToolRegistry,
  createBuiltinToolDefinitions,
  createDefaultAgentRegistry,
  type AgentEvent,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./agent-core";
import { TurnEventLog } from "./chat/turn-event-log";
import { prepareChatPrompt, type PreparedPrompt } from "./chat/prompt-context";
import { createSkillToolDefinition } from "./chat/skill-tool";
import {
  appendRuntimeTextTimelineItem,
  appendRuntimeToolTimelineItem,
  createEmptyRuntimeTrace as createChatRuntimeTrace,
  markRuntimeToolCallFinished,
  refreshRuntimeTraceActivity,
  upsertRuntimePermissionToolCall,
  upsertRuntimeToolCallStarted,
} from "./chat/runtime-trace-recorder";
import { ModelConversationTitleGenerator, type ConversationTitleGenerator } from "./chat-title-generator";
import { ConversationService } from "./conversation-service";
import type { BrowserAutomationService } from "./browser-automation-service";
import { StreamingMessagePersister } from "./streaming-message-persister";
import { WorkspaceService } from "./workspace-service";

export { buildLocalDirectoryContext } from "./chat/prompt-context";

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
  eventLog: TurnEventLog;
  messagePersister: StreamingMessagePersister;
  shouldGenerateTitle: boolean;
  userMessageContent: string;
  completion: Deferred<ChatTurnCompletionResult>;
  unregisterSessionHandlers: () => void;
  closed: boolean;
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

function serializeVisuals(visuals: ChatVisual[]) {
  return JSON.stringify(visuals);
}

const INTERRUPTED_ASSISTANT_REPLY_TEXT = "已停止回复。你可以继续发送下一条消息。";

function looksLikeTurnCancellation(value?: string) {
  return Boolean(value && /(cancel|abort|interrupt|stop(ped)?)/i.test(value));
}

function isToolBoundaryEvent(
  event: ChatMessageRuntimeTrace["events"][number],
) {
  return (
    event.type === "tool_call_started" ||
    event.type === "tool_call_finished" ||
    event.type === "permission_requested" ||
    event.type === "permission_denied"
  );
}

export class ChatOrchestrator {
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly startingConversationIds = new Set<string>();
  private readonly agentCoreId = "native";
  private readonly defaultAgentId = DEFAULT_AGENT_ID;
  private readonly nativeCore: AgentCore;
  private titleGenerator: ConversationTitleGenerator;

  constructor(
    private readonly conversationService: ConversationService,
    private readonly workspaceService: WorkspaceService,
    private readonly emitEvent: (event: ChatEvent) => void,
    private readonly approvalHandler?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>,
    private readonly browserAutomation?: BrowserAutomationService,
  ) {
    const agents = createDefaultAgentRegistry();
    const skills = new SkillRegistry();
    const tools = new ToolRegistry();
    for (const tool of createBuiltinToolDefinitions({
      memoryStore: this.workspaceService,
      mailStore: this.workspaceService,
      browserAutomation: this.browserAutomation,
    })) {
      tools.register(tool);
    }
    tools.register(createSkillToolDefinition(this.workspaceService));

    const modelGateway = new OpenAICompatibleModelGateway(async () => await this.workspaceService.getConfigSnapshot());
    this.titleGenerator = new ModelConversationTitleGenerator(modelGateway);
    this.nativeCore = new AgentCore({
      agents,
      skills,
      tools,
      modelGateway,
      sessions: new PersistentAgentSessionManager(this.conversationService),
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
    if (
      existingConversationId &&
      (this.activeTurns.has(existingConversationId) ||
        this.startingConversationIds.has(existingConversationId))
    ) {
      throw new Error("This conversation is already running.");
    }

    if (existingConversationId) {
      this.startingConversationIds.add(existingConversationId);
    }

    let started: Awaited<ReturnType<ConversationService["startTurn"]>>;
    try {
      started = await this.conversationService.startTurn(input, {
        agentCore: this.agentCoreId,
      });
    } catch (error) {
      if (existingConversationId) {
        this.startingConversationIds.delete(existingConversationId);
      }
      throw error;
    }
    const turnId = randomUUID();
    const baseConversation = {
      ...started.conversation,
      agentCore: this.agentCoreId,
    };
    const completion = createDeferred<ChatTurnCompletionResult>();
    void completion.promise.catch(() => undefined);

    try {
      const prepared = await this.preparePrompt(
        input,
        started.conversation.selectedKnowledgeBaseIds,
        started.conversation.workspaceRoot,
      );
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
        runtimeTrace: started.assistantMessage.runtimeTrace ?? createChatRuntimeTrace(),
        eventLog: new TurnEventLog(started.assistantMessage.runtimeTrace?.events ?? []),
        messagePersister: null as unknown as StreamingMessagePersister,
        shouldGenerateTitle: started.createdConversation,
        userMessageContent: started.userMessage.content,
        completion,
        unregisterSessionHandlers: () => undefined,
        closed: false,
      } satisfies ActiveTurn;

      activeTurn.eventLog.appendLifecycle("turn_started", {
        sessionId,
        agentId: this.defaultAgentId,
      });
      activeTurn.runtimeTrace.events = activeTurn.eventLog.snapshot();

      activeTurn.messagePersister = new StreamingMessagePersister({
        intervalMs: STREAMING_MESSAGE_PERSIST_INTERVAL_MS,
        persist: async () => {
          await this.persistAssistantState(activeTurn, { emitUpdate: false });
        },
      });

      this.activeTurns.set(started.conversation.id, activeTurn);
      if (existingConversationId) {
        this.startingConversationIds.delete(existingConversationId);
      }

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
      if (existingConversationId) {
        this.startingConversationIds.delete(existingConversationId);
      }
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
    activeTurn.eventLog.appendLifecycle("turn_cancelled", {
      sessionId: activeTurn.sessionId,
      agentId: this.defaultAgentId,
      stopReason: "cancelled",
    });
    activeTurn.runtimeTrace.events = activeTurn.eventLog.snapshot();
    await this.persistRuntimeTrace(activeTurn);
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
    workspaceRoot: string,
  ): Promise<PreparedPrompt> {
    return await prepareChatPrompt({
      chatInput: input,
      selectedKnowledgeBaseIds,
      workspaceService: this.workspaceService,
      workspaceRoot,
    });
  }

  private async runPrompt(activeTurn: ActiveTurn, prepared: PreparedPrompt) {
    try {
      let stopReason = "end_turn";
      for await (const event of this.nativeCore.sendTurn({
        sessionId: activeTurn.sessionId,
        agentId: this.defaultAgentId,
        content: prepared.content,
        memoryPrompt: prepared.memoryPrompt,
        workspacePrompt: prepared.workspacePrompt,
        workspaceRoot: prepared.workspaceRoot,
        fullFileSystemAccess: prepared.fullFileSystemAccess,
      })) {
        if (activeTurn.closed) {
          return;
        }

        activeTurn.eventLog.appendAgentEvent(event);
        activeTurn.runtimeTrace.events = activeTurn.eventLog.snapshot();
        await this.handleAgentEvent(activeTurn, event);
        if (event.type === "turn_finished") {
          stopReason = event.stopReason;
        }
      }

      await activeTurn.messagePersister.flush();
      this.commitAssistantTextLayout(activeTurn);
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

      if (activeTurn.shouldGenerateTitle && stopReason !== "cancelled") {
        void this.generateTitleForCompletedTurn(activeTurn, assistantMessage.content);
      }

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
      activeTurn.eventLog.appendLifecycle("turn_failed", {
        sessionId: activeTurn.sessionId,
        agentId: this.defaultAgentId,
        error: activeTurn.runtimeTrace.error,
      });
      activeTurn.runtimeTrace.events = activeTurn.eventLog.snapshot();
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
    activeTurn.runtimeTrace.events = activeTurn.eventLog.snapshot();
    refreshRuntimeTraceActivity(activeTurn.runtimeTrace);
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
    appendRuntimeTextTimelineItem(activeTurn.runtimeTrace, type, text);
  }

  private appendToolTimelineItem(activeTurn: ActiveTurn, toolCallId: string) {
    appendRuntimeToolTimelineItem(activeTurn.runtimeTrace, toolCallId);
  }

  private commitAssistantTextLayout(activeTurn: ActiveTurn) {
    const events = activeTurn.eventLog.snapshot();
    const processSegments: Array<{ beforeToolCallId: string; text: string }> = [];
    let pendingAssistantText = "";
    let sawToolBoundary = false;

    for (const event of events) {
      if (event.type === "message_delta") {
        pendingAssistantText += event.text ?? "";
        continue;
      }

      if (event.type === "message_replace") {
        pendingAssistantText = event.text ?? "";
        continue;
      }

      if (isToolBoundaryEvent(event)) {
        sawToolBoundary = true;
        if (event.toolCallId && pendingAssistantText.trim()) {
          processSegments.push({
            beforeToolCallId: event.toolCallId,
            text: pendingAssistantText,
          });
        }
        pendingAssistantText = "";
      }
    }

    if (!sawToolBoundary) {
      return;
    }

    activeTurn.assistantRawText = pendingAssistantText;

    for (const segment of processSegments) {
      this.insertProcessTextBeforeTool(
        activeTurn.runtimeTrace,
        segment.beforeToolCallId,
        segment.text,
      );
    }
  }

  private insertProcessTextBeforeTool(
    trace: ChatMessageRuntimeTrace,
    toolCallId: string,
    text: string,
  ) {
    const item: ChatRuntimeTimelineItem = {
      id: `status-${randomUUID()}`,
      type: "status",
      text,
    };
    const toolIndex = trace.timelineItems.findIndex(
      (timelineItem) => timelineItem.type === "tool" && timelineItem.toolCallId === toolCallId,
    );

    if (toolIndex < 0) {
      trace.timelineItems = [...trace.timelineItems, item];
      return;
    }

    let insertionIndex = toolIndex;
    while (insertionIndex > 0 && trace.timelineItems[insertionIndex - 1]?.type === "activity") {
      insertionIndex -= 1;
    }

    trace.timelineItems = [
      ...trace.timelineItems.slice(0, insertionIndex),
      item,
      ...trace.timelineItems.slice(insertionIndex),
    ];
  }

  private emitActivitySummary(activeTurn: ActiveTurn) {
    const items = refreshRuntimeTraceActivity(activeTurn.runtimeTrace);
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

    if (event.type === "token_usage") {
      activeTurn.runtimeTrace.usage = addChatTokenUsage(activeTurn.runtimeTrace.usage, event.usage);
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
      const toolCall = upsertRuntimeToolCallStarted(
        activeTurn.runtimeTrace,
        event.toolCall,
        stringifyJson(event.toolCall.input),
      );

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
      const patch = markRuntimeToolCallFinished(
        activeTurn.runtimeTrace,
        event.toolCall,
        event.result,
        stringifyJson(event.result),
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
      const recorded = upsertRuntimePermissionToolCall(activeTurn.runtimeTrace, {
        toolCall: event.toolCall,
        status: event.type === "permission_denied" ? "failed" : "pending",
        reason: event.reason,
        rawInputJson: stringifyJson(event.toolCall.input),
      });

      if (recorded.existing) {
        this.emitEvent({
          type: "tool_call_updated",
          conversationId: activeTurn.conversationId,
          turnId: activeTurn.turnId,
          toolCallId: event.toolCall.id,
          patch: recorded.patch,
        });
        this.emitActivitySummary(activeTurn);
        return;
      }

      this.emitActivitySummary(activeTurn);
      this.appendToolTimelineItem(activeTurn, event.toolCall.id);
      this.emitEvent({
        type: "tool_call_started",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCall: recorded.toolCall,
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
    this.startingConversationIds.delete(activeTurn.conversationId);
    this.activeTurns.delete(activeTurn.conversationId);
  }

  private async generateTitleForCompletedTurn(activeTurn: ActiveTurn, assistantMessage: string) {
    try {
      const title = await this.titleGenerator.generate({
        userMessage: activeTurn.userMessageContent,
        assistantMessage,
      });
      if (!title) {
        return;
      }

      const conversation = await this.conversationService.updateConversationTitle(activeTurn.conversationId, title);
      this.emitEvent({
        type: "conversation_updated",
        conversation,
      });
    } catch {
      // Auto-title failures should never invalidate the completed chat turn.
    }
  }
}
