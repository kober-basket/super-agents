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

import { formatBytes, markdownToHtml } from "../../lib/format";
import type {
  ChatConversation,
  ChatConversationRuntimeState,
  ChatToolCall,
  FileDropEntry,
  KnowledgeBaseSummary,
  RuntimeModelOption,
} from "../../types";
import { fileKind, getFileExtension, isOfficeDocument } from "../shared/utils";

interface ChatWorkspaceProps {
  activeConversation: ChatConversation | null;
  activeModel: RuntimeModelOption | null;
  attachments: FileDropEntry[];
  busy: boolean;
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
  onSendMessage: () => void;
  onToggleKnowledgeBase: (baseId: string) => void;
  onVoiceInput: () => void;
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
    return "Completed";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "pending") {
    return "Pending";
  }
  if (status === "in_progress") {
    return "Running";
  }
  return "Working";
}

function toolSummary(toolCall: ChatToolCall) {
  if (toolCall.locations?.length) {
    return toolCall.locations.map((location) => location.path).join(", ");
  }

  if (toolCall.kind) {
    return toolCall.kind.replaceAll("_", " ");
  }

  return "Execution details";
}

function hasVisibleText(value?: string | null) {
  return Boolean(value && value.trim());
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
  onSendMessage,
  onToggleKnowledgeBase,
  onVoiceInput,
  scrollToBottomRequest,
}: ChatWorkspaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const knowledgePickerRef = useRef<HTMLDivElement | null>(null);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
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
  const selectedTerminalIds = new Set(
    (runtimeState?.toolCalls ?? []).flatMap((toolCall) =>
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
    if (!messageList || !activeConversationId) return undefined;

    const scrollToBottom = () => {
      messageList.scrollTop = messageList.scrollHeight;
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

    return (
      <div ref={modelPickerRef} className="chat-model-picker">
        <button
          aria-label={disabled ? "未配置模型" : `当前模型 ${activeModelOption?.label ?? activeModelLabel}`}
          className={`chat-model-trigger ${modelPickerOpen ? "open" : ""}`}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setModelPickerOpen((current) => !current);
            setKnowledgePickerOpen(false);
          }}
          title={activeModelOption?.label ?? "选择模型"}
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
              <span>{selectableModels.length} 个可用模型</span>
            </div>

            <div className="chat-model-list">
              {selectableModels.map((model) => {
                const selected = model.id === activeModelId;
                const compactLabel = formatCompactModelLabel(model.modelLabel);
                const meta =
                  model.providerName && model.providerName !== compactLabel
                    ? `${model.providerName} · ${model.modelLabel}`
                    : model.modelLabel;

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
                      <strong>{compactLabel}</strong>
                      <span>{meta}</span>
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
                ? "PDF document"
                : office
                  ? "Office document"
                  : kind === "text"
                    ? "Text document"
                    : kind === "markdown"
                      ? "Markdown note"
                      : kind === "code"
                        ? "Code file"
                        : kind === "image"
                          ? "Image file"
                          : "File";
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
      <details className="activity-card tool-message-card" open>
        <summary className="activity-summary">
          <div className="activity-summary-main">
            <div className="activity-summary-title">
              <span className="activity-tool-icon">
                <Wrench size={14} />
              </span>
              <strong>Execution plan</strong>
              <span className="activity-status-pill default">
                {runtimeState.planEntries.length} steps
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
        return runtimeState?.status === "running";
      }

      return hasVisibleText(terminal.output) || terminal.exitCode !== null || terminal.signal !== null;
    });
    const hasRawInput = hasVisibleText(toolCall.rawInputJson);
    const hasRawOutput = hasVisibleText(toolCall.rawOutputJson);

    if (visibleContent.length === 0 && !hasRawInput && !hasRawOutput) {
      return null;
    }

    return (
      <details key={toolCall.toolCallId} className="activity-card tool-message-card" open>
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
            <p>{toolSummary(toolCall)}</p>
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
                    <span className="activity-panel-label">Output</span>
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
                  <span className="activity-panel-label">Output</span>
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
                  Terminal {content.terminalId.slice(0, 8)}
                </span>
                <pre>{terminal?.output || "Waiting for terminal output..."}</pre>
              </div>
            );
          })}

          {hasRawInput ? (
            <div className="activity-panel">
              <span className="activity-panel-label">Input</span>
              <pre>{toolCall.rawInputJson}</pre>
            </div>
          ) : null}

          {hasRawOutput ? (
            <div className="activity-panel">
              <span className="activity-panel-label">Raw output</span>
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
      <details key={terminal.terminalId} className="activity-card tool-message-card" open>
        <summary className="activity-summary">
          <div className="activity-summary-main">
            <div className="activity-summary-title">
              <span className="activity-tool-icon">
                <TerminalSquare size={14} />
              </span>
              <strong>Terminal {terminal.terminalId.slice(0, 8)}</strong>
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
                {terminal.exitCode === null && terminal.signal === null ? "Running" : "Finished"}
              </span>
            </div>
          </div>
          <div className="activity-summary-side">
            <ChevronDown size={14} />
          </div>
        </summary>
        <div className="activity-detail">
          <div className="activity-panel">
            <span className="activity-panel-label">Output</span>
            <pre>{terminal.output || "Waiting for terminal output..."}</pre>
          </div>
        </div>
      </details>
    ));
  }

  function renderComposer(home = false) {
    return (
      <div className={`chat-composer-card ${home ? "chat-composer-home" : ""}`}>
        {renderAttachmentList(attachments, true)}
        {renderActiveKnowledgeChips()}
        <textarea
          ref={textareaRef}
          disabled={busy}
          onChange={(event) => onDraftMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={busy ? "Agent 正在执行..." : home ? "输入消息，Enter 发送" : "继续输入消息"}
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

            <button className="chat-voice-button" onClick={onVoiceInput} title="语音输入" type="button">
              <Mic size={16} />
            </button>

            <button
              className="chat-send-button"
              disabled={!canSend}
              onClick={onSendMessage}
              title="发送消息"
              type="button"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderThread() {
    if (!activeConversation) {
      return null;
    }

    const showLoadingBubble = busy && (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.content);

    return (
      <div className="chat-thread-layout">
        <div ref={messageListRef} className="message-list">
          {activeConversation.messages.map((message) => (
            <div key={message.id} className={`message-row ${message.role === "user" ? "user" : ""}`}>
              <div className={`message-bubble ${message.role === "user" ? "user" : ""}`}>
                {message.attachments?.length ? renderAttachmentList(message.attachments) : null}
                {message.content ? (
                  message.role === "assistant" ? (
                    <div
                      className="message-text"
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
                      onClick={handleMessageClick}
                    />
                  ) : (
                    <div className="message-text user">{message.content}</div>
                  )
                ) : null}
              </div>
            </div>
          ))}

          {showLoadingBubble ? (
            <div className="message-row">
              <div className="message-loading">
                <LoaderCircle size={14} className="spin" />
                <span>Agent is working...</span>
              </div>
            </div>
          ) : null}

          {renderPlanCard()}
          {(runtimeState?.toolCalls ?? []).map(renderToolCard)}
          {renderUnlinkedTerminals()}

          {runtimeState?.status === "failed" && runtimeState.error ? (
            <div className="message-row">
              <div className="message-bubble">
                <div className="message-text error">
                  <strong>Agent failed</strong>
                  <p>{runtimeState.error}</p>
                </div>
              </div>
            </div>
          ) : null}
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
