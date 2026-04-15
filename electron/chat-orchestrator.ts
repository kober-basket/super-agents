import { randomUUID } from "node:crypto";
import path from "node:path";

import type * as acp from "@agentclientprotocol/sdk";

import type {
  AppConfig,
  ChatConversation,
  ChatEvent,
  ChatMessage,
  ChatPlanEntry,
  ChatSendInput,
  ChatTerminalOutput,
  ChatToolCall,
  ChatToolCallContent,
  ChatTurnStartResult,
} from "../src/types";
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
  assistantText: string;
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

function buildKnowledgeContext(
  config: AppConfig,
  search: {
    query: string;
    results: Array<{
      pageContent: string;
      metadata: Record<string, unknown>;
      knowledgeBaseName: string;
    }>;
  },
) {
  if (!config.knowledgeBase.enabled || config.knowledgeBase.selectedBaseIds.length === 0) {
    return "";
  }

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
      const prepared = await this.preparePrompt(input);
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
        assistantText: started.assistantMessage.content,
        completion,
        unregisterSessionHandlers: () => undefined,
        closed: false,
      };

      activeTurn.unregisterSessionHandlers = this.runtime.registerSessionHandlers(sessionId, {
        onUpdate: async (update) => {
          await this.handleSessionUpdate(activeTurn, update);
        },
        onTerminalOutput: async (terminal) => {
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

  private async preparePrompt(input: ChatSendInput): Promise<PreparedPrompt> {
    const config = await this.workspaceService.getConfigSnapshot();
    const cwd = path.resolve(config.workspaceRoot.trim() || process.cwd());
    const additionalDirectories = collectAdditionalDirectories(cwd, input);
    const mcpServers = mapConfigToAcpMcpServers(config.mcpServers);
    const injectedContext = await this.resolveKnowledgeContext(config, input.content);

    return {
      cwd,
      additionalDirectories,
      mcpServers,
      prompt: toPromptBlocks(
        input.content,
        input.attachments ?? [],
        this.runtime.promptCapabilities,
        injectedContext,
      ),
    };
  }

  private async resolveKnowledgeContext(config: AppConfig, content: string) {
    if (!config.knowledgeBase.enabled || config.knowledgeBase.selectedBaseIds.length === 0) {
      return "";
    }

    const query = content.trim();
    if (!query) {
      return "";
    }

    try {
      const search = await this.workspaceService.searchKnowledgeBases({
        query,
        knowledgeBaseIds: config.knowledgeBase.selectedBaseIds,
        documentCount: config.knowledgeBase.documentCount,
      });

      return buildKnowledgeContext(config, search);
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
      const conversation = await this.conversationService.getConversation(activeTurn.conversationId);
      const assistantMessage =
        conversation.messages.find((message) => message.id === activeTurn.assistantMessageId) ??
        ({
          id: activeTurn.assistantMessageId,
          role: "assistant",
          content: activeTurn.assistantText,
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

  private async handleSessionUpdate(activeTurn: ActiveTurn, update: acp.SessionUpdate) {
    if (activeTurn.closed) {
      return;
    }

    if (update.sessionUpdate === "agent_message_chunk") {
      const textDelta = contentBlockToText(update.content);
      if (!textDelta) {
        return;
      }

      activeTurn.assistantText += textDelta;
      await this.conversationService.updateAssistantMessageContent(
        activeTurn.conversationId,
        activeTurn.assistantMessageId,
        activeTurn.assistantText,
      );
      this.emitEvent({
        type: "message_delta",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        messageId: activeTurn.assistantMessageId,
        textDelta,
      });
      return;
    }

    if (update.sessionUpdate === "plan") {
      this.emitEvent({
        type: "plan_updated",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        entries: mapPlanEntries(update.entries),
      });
      return;
    }

    if (update.sessionUpdate === "tool_call") {
      this.emitEvent({
        type: "tool_call_started",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCall: mapToolCall(update),
      });
      return;
    }

    if (update.sessionUpdate === "tool_call_update") {
      this.emitEvent({
        type: "tool_call_updated",
        conversationId: activeTurn.conversationId,
        turnId: activeTurn.turnId,
        toolCallId: update.toolCallId,
        patch: mapToolCallPatch(update),
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
