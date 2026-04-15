import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  Mic,
  Paperclip,
  Square,
  Sparkles,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { parseChatMessageContent } from "../../lib/chat-visuals";
import { formatBytes, markdownToHtml } from "../../lib/format";
import type {
  ChatConversation,
  ChatMessage,
  ChatConversationRuntimeState,
  ChatToolCall,
  FileDropEntry,
  KnowledgeBaseSummary,
  RuntimeModelOption,
} from "../../types";
import { ChatVisualBlock } from "./ChatVisualBlock";
import { fileKind, getFileExtension, isOfficeDocument } from "../shared/utils";

interface ChatWorkspaceProps {
  activeConversation: ChatConversation | null;
  activeModel: RuntimeModelOption | null;
  attachments: FileDropEntry[];
  busy: boolean;
  canCancel: boolean;
  cancelInFlight: boolean;
  composerModelId: string;
  draftMessage: string;
  knowledgeBases: KnowledgeBaseSummary[];
  knowledgeEnabled: boolean;
  knowledgeRefreshing: boolean;
  runtimeState?: ChatConversationRuntimeState | null;
  selectableModels: RuntimeModelOption[];
  selectedKnowledgeBaseIds: string[];
  onDraftMessageChange: (value: string) => void;
  onClearKnowledgeBases: () => void;
  onManageKnowledgeBases: () => void;
  onModelChange: (modelId: string) => void;
  onOpenAttachment: (file: FileDropEntry) => void;
  onOpenPreviewLink: (url: string) => void;
  onPickFiles: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onCancelMessage: () => void;
  onSendMessage: () => void;
  onToggleKnowledgeBase: (baseId: string) => void;
  onVoiceInput: () => void;
  voiceInputState: "idle" | "recording" | "transcribing";
  voiceInputSupported: boolean;
  scrollToBottomRequest: number;
}

const HOME_PROMPTS = [
  { label: "拆解需求", value: "帮我拆解这个需求" },
  { label: "写页面文案", value: "帮我写这页的文案" },
  { label: "规划任务", value: "帮我规划实现任务" },
  { label: "优化界面", value: "帮我优化这个界面" },
];

function formatCompactModelLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "选择模型";

  const parts = trimmed
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);

  return parts[parts.length - 1] ?? trimmed;
}

function statusClassName(status?: ChatToolCall["status"]) {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "pending" || status === "in_progress") {
    return "loading";
  }
  return "default";
}

function statusLabel(status?: ChatToolCall["status"]) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "pending") {
    return "待执行";
  }
  if (status === "in_progress") {
    return "执行中";
  }
  return "处理中";
}

function toolSummary(toolCall: ChatToolCall) {
  if (toolCall.locations?.length) {
    return toolCall.locations.map((location) => location.path).join(", ");
  }

  if (toolCall.kind) {
    return toolCall.kind.replaceAll("_", " ");
  }

  return "执行详情";
}

function hasVisibleText(value?: string | null) {
  return Boolean(value && value.trim());
}

function isTurnActiveStatus(status?: ChatConversationRuntimeState["status"]) {
  return status === "running" || status === "cancelling";
}

function parseJsonValue(value?: string | null) {
  if (!hasVisibleText(value)) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractCommandCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = normalizeInlineText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractCommandCandidates(entry, depth + 1));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directMatches = ["command", "cmd", "script"].flatMap((key) =>
    extractCommandCandidates(record[key], depth + 1),
  );
  if (directMatches.length > 0) {
    return directMatches;
  }

  const parameters = record.parameters;
  if (parameters && typeof parameters === "object") {
    const parameterRecord = parameters as Record<string, unknown>;
    const parameterMatches = ["command", "cmd", "script"].flatMap((key) =>
      extractCommandCandidates(parameterRecord[key], depth + 1),
    );
    if (parameterMatches.length > 0) {
      return parameterMatches;
    }
  }

  return [];
}

function extractExecuteLabel(toolCall: ChatToolCall) {
  const inlineText = toolCall.content.find(
    (content) =>
      content.type === "text" &&
      hasVisibleText(content.text) &&
      !content.text.includes("\n") &&
      !content.text.trim().startsWith("{") &&
      !content.text.trim().startsWith("["),
  );
  if (inlineText?.type === "text") {
    return normalizeInlineText(inlineText.text);
  }

  const parsedInput = parseJsonValue(toolCall.rawInputJson);
  const commandCandidate = extractCommandCandidates(parsedInput)[0];
  if (commandCandidate) {
    return commandCandidate;
  }

  return hasVisibleText(toolCall.title) ? toolCall.title : toolSummary(toolCall);
}

function shouldRenderToolTextAsMarkdown(toolCall: ChatToolCall, text: string) {
  if (toolCall.kind === "execute") {
    return false;
  }

  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|`[^`\n]+`|\|.+\|)/m.test(text);
}

export function ChatWorkspace({
  activeConversation,
  activeModel,
  attachments,
  busy,
  canCancel,
  cancelInFlight,
  composerModelId,
  draftMessage,
  knowledgeBases,
  knowledgeEnabled,
  knowledgeRefreshing,
  runtimeState,
  selectableModels,
  selectedKnowledgeBaseIds,
  onDraftMessageChange,
  onClearKnowledgeBases,
  onManageKnowledgeBases,
  onModelChange,
  onOpenAttachment,
  onOpenPreviewLink,
  onPickFiles,
  onRemoveAttachment,
  onCancelMessage,
  onSendMessage,
  onToggleKnowledgeBase,
  onVoiceInput,
  voiceInputState,
  voiceInputSupported,
  scrollToBottomRequest,
}: ChatWorkspaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const knowledgePickerRef = useRef<HTMLDivElement | null>(null);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollStateRef = useRef<{
    activeConversationId: string | null;
    messageCount: number;
    scrollRequest: number;
  }>({
    activeConversationId: null,
    messageCount: 0,
    scrollRequest: 0,
  });
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }, [draftMessage]);

  useEffect(() => {
    if (!knowledgePickerOpen && !modelPickerOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (knowledgePickerRef.current && !knowledgePickerRef.current.contains(target)) {
        setKnowledgePickerOpen(false);
      }

      if (modelPickerRef.current && !modelPickerRef.current.contains(target)) {
        setModelPickerOpen(false);
      }
    };

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setKnowledgePickerOpen(false);
        setModelPickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [knowledgePickerOpen, modelPickerOpen]);

  const isHome = activeConversation === null;
  const canSend = !busy && (draftMessage.trim().length > 0 || attachments.length > 0);
  const activeConversationId = activeConversation?.id ?? null;
  const messageCount = activeConversation?.messages.length ?? 0;
  const lastMessage = activeConversation?.messages[messageCount - 1] ?? null;
  const lastMessageId = lastMessage?.id ?? null;
  const lastMessageUpdatedAt = lastMessage?.updatedAt ?? 0;
  const activeModelId = activeModel?.id || composerModelId || selectableModels[0]?.id || "";
  const activeModelOption =
    selectableModels.find((model) => model.id === activeModelId) ?? activeModel ?? selectableModels[0] ?? null;
  const activeModelLabel = formatCompactModelLabel(activeModelOption?.modelLabel ?? "");
  const selectedKnowledgeBases = knowledgeBases.filter((base) => selectedKnowledgeBaseIds.includes(base.id));
  const selectedKnowledgeCount = knowledgeEnabled ? selectedKnowledgeBaseIds.length : 0;
  const runtimeInProgress = isTurnActiveStatus(runtimeState?.status);
  const runtimeFingerprint = JSON.stringify({
    status: runtimeState?.status,
    stopReason: runtimeState?.stopReason,
    error: runtimeState?.error,
    planEntries: runtimeState?.planEntries,
    toolCalls: runtimeState?.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      status: toolCall.status,
      content: toolCall.content.map((content) =>
        content.type === "terminal" ? `${content.type}:${content.terminalId}` : content.type,
      ),
    })),
    terminals: Object.values(runtimeState?.terminalOutputs ?? {}).map((terminal) => ({
      terminalId: terminal.terminalId,
      outputLength: terminal.output.length,
      exitCode: terminal.exitCode,
    })),
  });
  const runtimeToolCalls = runtimeState?.toolCalls ?? [];
  const executeToolCalls = runtimeToolCalls.filter((toolCall) => toolCall.kind === "execute");
  const selectedTerminalIds = new Set(
    runtimeToolCalls.flatMap((toolCall) =>
      toolCall.content
        .filter((content) => content.type === "terminal")
        .map((content) => content.terminalId),
    ),
  );
  const unlinkedTerminalOutputs = Object.values(runtimeState?.terminalOutputs ?? {}).filter(
    (terminal) => !selectedTerminalIds.has(terminal.terminalId),
  );
  const knowledgeLabel =
    selectedKnowledgeBases.length > 1
      ? `${selectedKnowledgeBases[0].name} +${selectedKnowledgeBases.length - 1}`
      : selectedKnowledgeBases[0]?.name ??
        (selectedKnowledgeCount > 0
          ? `已选择 ${selectedKnowledgeCount} 个知识库`
          : knowledgeRefreshing
            ? "正在加载知识库"
            : "未使用知识库");
  const knowledgeHint =
    selectedKnowledgeCount > 0
      ? `已启用 ${selectedKnowledgeCount} 个知识库`
      : knowledgeBases.length > 0
        ? "选择要在聊天中注入上下文的知识库"
        : knowledgeRefreshing
          ? "正在同步知识库列表"
          : "先去知识库页添加文档、目录或网页，再在这里选择";

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !activeConversationId) {
      autoScrollStateRef.current = {
        activeConversationId,
        messageCount,
        scrollRequest: scrollToBottomRequest,
      };
      return undefined;
    }

    const previousScrollState = autoScrollStateRef.current;
    const conversationChanged = previousScrollState.activeConversationId !== activeConversationId;
    const hasNewMessage =
      previousScrollState.activeConversationId === activeConversationId &&
      messageCount > previousScrollState.messageCount;
    const requestedManualScroll = previousScrollState.scrollRequest !== scrollToBottomRequest;
    const behavior: ScrollBehavior = !conversationChanged && (hasNewMessage || requestedManualScroll) ? "smooth" : "auto";

    autoScrollStateRef.current = {
      activeConversationId,
      messageCount,
      scrollRequest: scrollToBottomRequest,
    };

    const scrollToBottom = () => {
      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior,
      });
    };

    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeConversationId,
    lastMessageId,
    lastMessageUpdatedAt,
    messageCount,
    runtimeFingerprint,
    scrollToBottomRequest,
  ]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (busy) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSendMessage();
    }
  }

  function handleMessageClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const link = target.closest("a[data-preview-link='true']");
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }

    const href = link.getAttribute("href")?.trim();
    if (!href) {
      return;
    }

    event.preventDefault();
    onOpenPreviewLink(href);
  }

  function applySuggestedVisualPrompt(prompt: string) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return;
    }

    const nextDraft = draftMessage.trim()
      ? `${draftMessage.trim()}\n\n${normalizedPrompt}`
      : normalizedPrompt;

    onDraftMessageChange(nextDraft);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  }

  function renderKnowledgePicker() {
    return (
      <div ref={knowledgePickerRef} className="knowledge-picker chat-knowledge-picker">
        <button
          aria-label={selectedKnowledgeCount > 0 ? `已选择 ${selectedKnowledgeCount} 个知识库` : "选择知识库"}
          className={`chat-knowledge-trigger ${selectedKnowledgeCount > 0 ? "active" : ""}`}
          onClick={() => {
            setKnowledgePickerOpen((current) => !current);
            setModelPickerOpen(false);
          }}
          title={selectedKnowledgeCount > 0 ? knowledgeLabel : "选择知识库"}
          type="button"
        >
          <BookOpen size={15} />
        </button>

        {knowledgePickerOpen ? (
          <div className="knowledge-picker-panel chat-knowledge-panel">
            <div className="knowledge-picker-head">
              <div className="knowledge-picker-head-copy">
                <strong>选择知识库</strong>
                <span>{knowledgeHint}</span>
              </div>
              {selectedKnowledgeCount > 0 ? (
                <button className="knowledge-picker-clear" onClick={onClearKnowledgeBases} type="button">
                  清空
                </button>
              ) : null}
            </div>

            {knowledgeBases.length > 0 ? (
              <div className="knowledge-picker-list">
                {knowledgeBases.map((base) => {
                  const selected = knowledgeEnabled && selectedKnowledgeBaseIds.includes(base.id);

                  return (
                    <button
                      key={base.id}
                      className={`knowledge-picker-row ${selected ? "selected" : ""}`}
                      onClick={() => onToggleKnowledgeBase(base.id)}
                      type="button"
                    >
                      <div className="knowledge-picker-copy">
                        <strong>{base.name}</strong>
                        <span>
                          {base.itemCount} 条内容 · {base.chunkCount} 个分块
                        </span>
                      </div>
                      <span className={`knowledge-picker-check ${selected ? "selected" : ""}`}>
                        <Check size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="knowledge-picker-empty">
                <strong>还没有知识库</strong>
                <span>先去知识库页添加文档、目录或网页，这里就能直接在聊天里引用。</span>
              </div>
            )}

            <button
              className="knowledge-picker-manage"
              onClick={() => {
                setKnowledgePickerOpen(false);
                onManageKnowledgeBases();
              }}
              type="button"
            >
              管理知识库
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderActiveKnowledgeChips() {
    if (!selectedKnowledgeBases.length) {
      return null;
    }

    return (
      <div className="chat-knowledge-active-row">
        {selectedKnowledgeBases.map((base) => (
          <div key={base.id} className="chat-knowledge-active-chip">
            <BookOpen size={13} />
            <span title={base.name}>{base.name}</span>
            <button
              aria-label={`移除知识库 ${base.name}`}
              className="chat-knowledge-active-chip-remove"
              onClick={() => onToggleKnowledgeBase(base.id)}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  function renderModelPicker() {
    const disabled = busy || selectableModels.length === 0;
    const activeModelFullLabel = activeModelOption?.modelLabel?.trim() || activeModelLabel;

    return (
      <div ref={modelPickerRef} className="chat-model-picker">
        <button
          aria-label={disabled ? "未配置模型" : `当前模型 ${activeModelFullLabel}`}
          className={`chat-model-trigger ${modelPickerOpen ? "open" : ""}`}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setModelPickerOpen((current) => !current);
            setKnowledgePickerOpen(false);
          }}
          title={activeModelFullLabel || "选择模型"}
          type="button"
        >
          <span className="chat-model-trigger-text">
            {disabled && selectableModels.length === 0 ? "未配置模型" : activeModelLabel}
          </span>
          <ChevronDown size={14} />
        </button>

        {modelPickerOpen ? (
          <div className="chat-model-panel">
            <div className="chat-model-panel-head">
              <strong>选择模型</strong>
            </div>

            <div className="chat-model-list">
              {selectableModels.map((model) => {
                const selected = model.id === activeModelId;
                const fullLabel = model.modelLabel.trim() || model.label;

                return (
                  <button
                    key={model.id}
                    className={`chat-model-option ${selected ? "selected" : ""}`}
                    onClick={() => {
                      onModelChange(model.id);
                      setModelPickerOpen(false);
                    }}
                    type="button"
                  >
                    <div className="chat-model-option-copy">
                      <strong title={fullLabel}>{fullLabel}</strong>
                    </div>
                    <span className={`chat-model-option-check ${selected ? "selected" : ""}`}>
                      <Check size={13} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderAttachmentList(files: FileDropEntry[], removable = false) {
    if (files.length === 0) return null;

    if (!removable) {
      return (
        <div className="chat-attachment-card-list">
          {files.map((file) => {
            const kind = fileKind(file);
            const extension = getFileExtension(file.name || file.path);
            const badge = extension ? extension.toUpperCase().slice(0, 4) : "FILE";
            const office = isOfficeDocument(file.name || file.path, file.mimeType);
            const categoryLabel =
              kind === "pdf"
                ? "PDF 文档"
                : office
                  ? "办公文档"
                  : kind === "text"
                    ? "文本文件"
                    : kind === "markdown"
                      ? "Markdown 笔记"
                      : kind === "code"
                        ? "代码文件"
                        : kind === "image"
                          ? "图片文件"
                          : "文件";
            const toneClass =
              kind === "pdf"
                ? "tone-pdf"
                : office
                  ? "tone-office"
                  : kind === "text"
                    ? "tone-text"
                    : kind === "image"
                      ? "tone-image"
                      : "tone-file";

            return (
              <button
                key={file.id}
                className={`chat-attachment-card ${toneClass}`}
                onClick={() => onOpenAttachment(file)}
                type="button"
              >
                <div className="chat-attachment-card-badge">{badge}</div>
                <div className="chat-attachment-card-copy">
                  <strong title={file.name}>{file.name}</strong>
                  <span>{formatBytes(file.size)}</span>
                </div>
                <div className="chat-attachment-card-tag">{categoryLabel}</div>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="chat-attachment-list">
        {files.map((file) => (
          <div key={file.id} className="chat-attachment-chip">
            <button className="chat-attachment-trigger" onClick={() => onOpenAttachment(file)} type="button">
              <Paperclip size={14} />
              <span title={file.name}>{file.name}</span>
            </button>
            <button
              aria-label={`移除附件 ${file.name}`}
              className="chat-attachment-remove"
              onClick={() => onRemoveAttachment(file.id)}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  function renderPlanCard() {
    if (!runtimeState || runtimeState.planEntries.length === 0) {
      return null;
    }

    return (
      <details key="runtime-plan" className="activity-card tool-message-card">
        <summary className="activity-summary">
          <div className="activity-summary-main">
            <div className="activity-summary-title">
              <span className="activity-tool-icon">
                <Wrench size={14} />
              </span>
              <strong>执行计划</strong>
              <span className="activity-status-pill default">
                {runtimeState.planEntries.length} 个步骤
              </span>
            </div>
          </div>
          <div className="activity-summary-side">
            <ChevronDown size={14} />
          </div>
        </summary>
        <div className="activity-detail">
          {runtimeState.planEntries.map((entry, index) => (
            <div key={`${entry.content}-${index}`} className="activity-panel activity-panel-summary">
              <span className="activity-panel-label">
                {entry.priority} · {entry.status}
              </span>
              <div
                className="activity-markdown"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(entry.content) }}
                onClick={handleMessageClick}
              />
            </div>
          ))}
        </div>
      </details>
    );
  }

  function renderExecuteToolGroup() {
    if (executeToolCalls.length === 0) {
      return null;
    }

    return (
      <details key="runtime-execute-group" className="activity-card tool-message-card codex-command-group">
        <summary className="codex-command-group-summary">
          <span className="codex-command-group-title">
            已执行 {executeToolCalls.length} 条命令
          </span>
          <ChevronDown size={14} className="codex-command-group-chevron" />
        </summary>
        <div className="codex-command-group-body">
          {executeToolCalls.map((toolCall) => {
            const label = extractExecuteLabel(toolCall);
            const rowStatus = statusClassName(toolCall.status);
            const rowPrefix =
              toolCall.status === "failed"
                ? "失败"
                : toolCall.status === "pending"
                  ? "排队中"
                  : toolCall.status === "in_progress"
                    ? "执行中"
                    : "已执行";

            return (
              <div key={toolCall.toolCallId} className={`codex-command-row ${rowStatus}`} title={label}>
                <span className="codex-command-row-prefix">{rowPrefix}</span>
                <span className="codex-command-row-command">{label}</span>
              </div>
            );
          })}
        </div>
      </details>
    );
  }

  function renderToolCard(toolCall: ChatToolCall) {
    const visibleContent = toolCall.content.filter((content) => {
      if (content.type === "text") {
        return hasVisibleText(content.text);
      }

      if (content.type === "diff") {
        return hasVisibleText(content.newText) || hasVisibleText(content.oldText) || hasVisibleText(content.path);
      }

      const terminal = runtimeState?.terminalOutputs[content.terminalId];
      if (!terminal) {
        return runtimeInProgress;
      }

      return hasVisibleText(terminal.output) || terminal.exitCode !== null || terminal.signal !== null;
    });
    const hasRawInput = hasVisibleText(toolCall.rawInputJson);
    const hasRawOutput = hasVisibleText(toolCall.rawOutputJson);

    if (visibleContent.length === 0 && !hasRawInput && !hasRawOutput) {
      return null;
    }

    return (
      <details key={toolCall.toolCallId} className="activity-card tool-message-card">
        <summary className="activity-summary">
          <div className="activity-summary-main">
            <div className="activity-summary-title">
              <span className="activity-tool-icon">
                {toolCall.kind === "execute" ? <TerminalSquare size={14} /> : <Wrench size={14} />}
              </span>
              <strong>{toolCall.title}</strong>
              <span className={`activity-status-pill ${statusClassName(toolCall.status)}`}>
                {toolCall.status === "completed" ? <CheckCircle2 size={12} /> : null}
                {toolCall.status === "failed" ? <AlertCircle size={12} /> : null}
                {(toolCall.status === "pending" || toolCall.status === "in_progress") ? (
                  <LoaderCircle size={12} className="spin" />
                ) : null}
                {statusLabel(toolCall.status)}
              </span>
            </div>
            <p>{toolCall.kind === "execute" ? extractExecuteLabel(toolCall) : toolSummary(toolCall)}</p>
          </div>
          <div className="activity-summary-side">
            <ChevronDown size={14} />
          </div>
        </summary>
        <div className="activity-detail">
          {visibleContent.map((content, index) => {
            if (content.type === "text") {
              if (shouldRenderToolTextAsMarkdown(toolCall, content.text)) {
                return (
                  <div key={`${toolCall.toolCallId}-text-${index}`} className="activity-panel activity-panel-summary">
                    <span className="activity-panel-label">输出</span>
                    <div
                      className="activity-markdown"
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(content.text) }}
                      onClick={handleMessageClick}
                    />
                  </div>
                );
              }

              return (
                <div key={`${toolCall.toolCallId}-text-${index}`} className="activity-panel">
                  <span className="activity-panel-label">输出</span>
                  <pre>{content.text}</pre>
                </div>
              );
            }

            if (content.type === "diff") {
              return (
                <div key={`${toolCall.toolCallId}-diff-${index}`} className="activity-panel">
                  <span className="activity-panel-label">{content.path}</span>
                  <pre>{content.newText}</pre>
                </div>
              );
            }

            const terminal = runtimeState?.terminalOutputs[content.terminalId];
            return (
              <div key={`${toolCall.toolCallId}-terminal-${index}`} className="activity-panel">
                <span className="activity-panel-label">
                  终端 {content.terminalId.slice(0, 8)}
                </span>
                <pre>{terminal?.output || "等待终端输出..."}</pre>
              </div>
            );
          })}

          {hasRawInput ? (
            <div className="activity-panel">
              <span className="activity-panel-label">输入</span>
              <pre>{toolCall.rawInputJson}</pre>
            </div>
          ) : null}

          {hasRawOutput ? (
            <div className="activity-panel">
              <span className="activity-panel-label">原始输出</span>
              <pre>{toolCall.rawOutputJson}</pre>
            </div>
          ) : null}
        </div>
      </details>
    );
  }

  function renderUnlinkedTerminals() {
    const visibleTerminals = unlinkedTerminalOutputs.filter(
      (terminal) =>
        hasVisibleText(terminal.output) || terminal.exitCode !== null || terminal.signal !== null,
    );

    if (visibleTerminals.length === 0) {
      return null;
    }

    return visibleTerminals.map((terminal) => (
      <details key={terminal.terminalId} className="activity-card tool-message-card">
        <summary className="activity-summary">
          <div className="activity-summary-main">
            <div className="activity-summary-title">
              <span className="activity-tool-icon">
                <TerminalSquare size={14} />
              </span>
              <strong>{`终端 ${terminal.terminalId.slice(0, 8)}`}</strong>
              <span
                className={`activity-status-pill ${
                  terminal.exitCode === null && terminal.signal === null ? "loading" : "default"
                }`}
              >
                {terminal.exitCode === null && terminal.signal === null ? (
                  <LoaderCircle size={12} className="spin" />
                ) : (
                  <CheckCircle2 size={12} />
                )}
                {terminal.exitCode === null && terminal.signal === null ? "执行中" : "已结束"}
              </span>
            </div>
          </div>
          <div className="activity-summary-side">
            <ChevronDown size={14} />
          </div>
        </summary>
        <div className="activity-detail">
          <div className="activity-panel">
            <span className="activity-panel-label">输出</span>
            <pre>{terminal.output || "等待终端输出..."}</pre>
          </div>
        </div>
      </details>
    ));
  }

  function renderMessage(message: ChatMessage) {
    const parsedMessage =
      message.role === "assistant"
        ? parseChatMessageContent(message.content, message.visuals)
        : {
            text: message.content,
            visuals: message.visuals ?? [],
            hasPendingVisualBlock: false,
            invalidVisualCount: 0,
          };

    return (
      <div key={message.id} className={`message-row ${message.role === "user" ? "user" : ""}`}>
        <div className={`message-bubble ${message.role === "user" ? "user" : ""}`}>
          {message.attachments?.length ? renderAttachmentList(message.attachments) : null}
          {parsedMessage.text ? (
            message.role === "assistant" ? (
              <div
                className="message-text"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(parsedMessage.text) }}
                onClick={handleMessageClick}
              />
            ) : (
              <div className="message-text user">{parsedMessage.text}</div>
            )
          ) : null}
          {parsedMessage.visuals.length > 0 ? (
            <div className="message-visual-list">
              {parsedMessage.visuals.map((visual) => (
                <ChatVisualBlock
                  key={visual.id}
                  onSuggestPrompt={applySuggestedVisualPrompt}
                  visual={visual}
                />
              ))}
            </div>
          ) : null}
          {parsedMessage.hasPendingVisualBlock ? (
            <div className="message-visual-pending">正在生成可视化…</div>
          ) : null}
          {message.role === "assistant" && parsedMessage.invalidVisualCount > 0 ? (
            <div className="message-visual-warning">
              已跳过 {parsedMessage.invalidVisualCount} 个无效可视化块
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderRuntimeActivity(blocks: JSX.Element[]) {
    if (blocks.length === 0) {
      return null;
    }

    return (
      <div className="message-row">
        <div className="message-bubble">
          <div className="message-runtime-stack">{blocks}</div>
        </div>
      </div>
    );
  }

  function renderComposer(home = false) {
    const composerPlaceholder = cancelInFlight
      ? "正在停止当前回复..."
      : busy
        ? "智能体处理中..."
        : home
          ? "输入消息后按 Enter 发送"
          : "继续这段对话";
    const voiceInputActive = voiceInputState !== "idle";
    const voiceButtonTitle =
      voiceInputState === "transcribing"
        ? "正在转写语音"
        : voiceInputState === "recording"
          ? "结束录音并转写"
          : voiceInputSupported
            ? "开始语音输入"
            : "当前环境暂不支持语音输入";

    return (
      <div className={`chat-composer-card ${home ? "chat-composer-home" : ""}`}>
        {renderAttachmentList(attachments, true)}
        {renderActiveKnowledgeChips()}
        <textarea
          ref={textareaRef}
          disabled={busy}
          onChange={(event) => onDraftMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={composerPlaceholder}
          rows={1}
          value={draftMessage}
        />
        <div className="chat-composer-actions">
          <div className="chat-composer-left">
            <button className="chat-composer-icon" onClick={onPickFiles} title="添加附件" type="button">
              <Paperclip size={16} />
            </button>
            {renderKnowledgePicker()}
          </div>

          <div className="chat-composer-right">
            {renderModelPicker()}

            <button
              aria-label={voiceButtonTitle}
              aria-pressed={voiceInputActive}
              className={`chat-voice-button ${voiceInputActive ? "active" : ""} ${!voiceInputSupported ? "unsupported" : ""}`}
              onClick={onVoiceInput}
              title={voiceButtonTitle}
              type="button"
            >
              {voiceInputState === "transcribing" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Mic size={16} />
              )}
            </button>

            {canCancel ? (
              <button
                aria-label={cancelInFlight ? "正在停止当前回复" : "停止当前回复"}
                className="chat-send-button stop"
                disabled={cancelInFlight}
                onClick={onCancelMessage}
                title={cancelInFlight ? "正在停止..." : "停止回复"}
                type="button"
              >
                {cancelInFlight ? <LoaderCircle size={16} className="spin" /> : <Square size={15} />}
              </button>
            ) : (
              <button
                className="chat-send-button"
                disabled={!canSend}
                onClick={onSendMessage}
                title="发送消息"
                type="button"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderThread() {
    if (!activeConversation) {
      return null;
    }

    const runtimeBlocks: JSX.Element[] = [];
    const planCard = renderPlanCard();
    if (planCard) {
      runtimeBlocks.push(planCard);
    }

    const executeToolGroup = renderExecuteToolGroup();
    if (executeToolGroup) {
      runtimeBlocks.push(executeToolGroup);
    }

    runtimeToolCalls.forEach((toolCall) => {
      const toolCard = renderToolCard(toolCall);
      if (toolCard) {
        runtimeBlocks.push(toolCard);
      }
    });

    const unlinkedTerminalCards = renderUnlinkedTerminals();
    if (unlinkedTerminalCards) {
      runtimeBlocks.push(...unlinkedTerminalCards);
    }

    if (runtimeState?.status === "failed" && runtimeState.error) {
      runtimeBlocks.push(
        <div key="runtime-error" className="message-row">
          <div className="message-bubble">
            <div className="message-text error">
              <strong>智能体执行失败</strong>
              <p>{runtimeState.error}</p>
            </div>
          </div>
        </div>,
      );
    }

    const hasRuntimeActivity = runtimeBlocks.length > 0;
    const inlineAssistantMessage =
      hasRuntimeActivity && lastMessage?.role === "assistant" ? lastMessage : null;
    const leadingMessages = inlineAssistantMessage
      ? activeConversation.messages.slice(0, -1)
      : activeConversation.messages;
    const showLoadingBubble =
      runtimeInProgress &&
      !hasRuntimeActivity &&
      (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.content);

    return (
      <div className="chat-thread-layout">
        <div ref={messageListRef} className="message-list">
          {leadingMessages.map(renderMessage)}

          {showLoadingBubble ? (
            <div className="message-row">
              <div className="message-loading">
                <LoaderCircle size={14} className="spin" />
                <span>{cancelInFlight ? "正在停止..." : "智能体处理中..."}</span>
              </div>
            </div>
          ) : null}

          {renderRuntimeActivity(runtimeBlocks)}
          {inlineAssistantMessage ? renderMessage(inlineAssistantMessage) : null}
        </div>

        {renderComposer(false)}
      </div>
    );
  }

  return (
    <section className={`workspace-main ${isHome ? "is-home" : "is-thread"}`}>
      <div className="chat-column chat-workspace-shell">
        {isHome ? (
          <div className="chat-home chat-home-upgraded">
            <div className="chat-home-hero">
              <div className="chat-home-orb chat-home-orb-left" aria-hidden="true" />
              <div className="chat-home-orb chat-home-orb-right" aria-hidden="true" />
              <div className="chat-home-badge">
                <Sparkles size={14} />
                <span>开始新对话</span>
              </div>
              <div className="chat-home-copy">
                <h2>把问题说清楚</h2>
                <p>发出第一条消息后，会话会出现在左侧。</p>
              </div>
            </div>

            {renderComposer(true)}

            <div className="chat-home-prompt-grid">
              {HOME_PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  className="chat-home-prompt"
                  onClick={() => onDraftMessageChange(prompt.value)}
                  type="button"
                >
                  <strong>{prompt.label}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : (
          renderThread()
        )}
      </div>
    </section>
  );
}
