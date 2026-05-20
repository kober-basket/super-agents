import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  Mic,
  Paperclip,
  Square,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
  type WheelEvent,
} from "react";

import { parseChatMessageContent } from "../../lib/chat-visuals";
import {
  getComposerSkillTrigger,
  insertComposerSkillMention,
  splitComposerSkillMentions,
} from "../../lib/composer-skills";
import { formatBytes } from "../../lib/format";
import { shouldRenderRuntimeToolCard } from "../../lib/runtime-tool-visibility";
import {
  buildRuntimeToolDiffs,
  getRuntimeToolDisplay,
  shouldShowRawToolPayload,
  type RuntimeToolDiff,
} from "../../lib/runtime-tool-display";
import {
  buildRuntimeTimelineRenderItems,
  isStreamingTimelineThoughtItem,
  runtimeTraceGroupSummaryLabel,
  sanitizeTimelineStatusText,
  shouldOpenRuntimeTraceGroup,
  shouldShowRuntimeThinkingIndicator,
} from "../../lib/runtime-timeline";
import {
  isScrollAtBottom,
  isScrollNearBottom,
  shouldReleaseAutoScrollOnWheel,
  shouldAutoScrollMessageList,
} from "../../lib/chat-scroll";
import { copyTextToClipboard } from "./clipboard";
import { ComposerRichInput, type ComposerRichInputHandle } from "./ComposerRichInput";
import { RichMarkdown } from "../shared/RichMarkdown";
import type {
  ChatConversation,
  ChatConversationExportFormat,
  ChatMessage,
  ChatMessageRuntimeTrace,
  ChatConversationRuntimeState,
  ChatRuntimeTimelineItem,
  ChatToolCall,
  FileDropEntry,
  KnowledgeBaseSummary,
  RuntimeModelOption,
  SkillConfig,
} from "../../types";
import { ChatVisualBlock } from "./ChatVisualBlock";
import { shouldSubmitComposerKeyDown } from "./composer-keyboard";
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
  skills: SkillConfig[];
  onDraftMessageChange: (value: string) => void;
  onExportConversation: (format: ChatConversationExportFormat) => void;
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
  exportingConversationFormat: ChatConversationExportFormat | null;
  onToast: (message: string) => void;
}

function RuntimeTraceGroup({
  children,
  endedAt,
  hasError,
  isStreaming,
  startedAt,
}: {
  children: JSX.Element[];
  endedAt?: number;
  hasError?: boolean;
  isStreaming?: boolean;
  startedAt?: number;
}) {
  const [open, setOpen] = useState(() => shouldOpenRuntimeTraceGroup(isStreaming));
  const fallbackStartedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setOpen(shouldOpenRuntimeTraceGroup(isStreaming));
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming) {
      setNow(Date.now());
      return undefined;
    }

    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  if (children.length === 0 && !isStreaming) {
    return null;
  }

  const start = startedAt ?? fallbackStartedAt.current;
  const end = isStreaming ? now : endedAt ?? now;
  const durationMs = Math.max(0, end - start);
  const label = runtimeTraceGroupSummaryLabel({ isStreaming, hasError, durationMs });

  return (
    <details
      className={`runtime-trace-group ${open ? "open" : ""} ${isStreaming ? "streaming" : ""}`}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (isStreaming && !nextOpen) {
          setOpen(true);
          return;
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <summary className="runtime-trace-summary">
        <span className="runtime-trace-summary-copy">{label}</span>
        <ChevronDown size={14} />
      </summary>
      {children.length > 0 ? <div className="message-runtime-stack">{children}</div> : null}
    </details>
  );
}

const CONVERSATION_EXPORT_OPTIONS: Array<{
  format: ChatConversationExportFormat;
  label: string;
  detail: string;
}> = [
  { format: "pdf", label: "PDF", detail: ".pdf" },
  { format: "markdown", label: "Markdown", detail: ".md" },
  { format: "word", label: "Word", detail: ".docx" },
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
    return "完成";
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

function hasVisibleText(value?: string | null) {
  return Boolean(value && value.trim());
}

function isTurnActiveStatus(status?: ChatConversationRuntimeState["status"]) {
  return status === "running" || status === "cancelling";
}

function shouldRenderToolTextAsMarkdown(
  toolCall: ChatToolCall,
  text: string,
  displayKind: ChatToolCall["kind"] = toolCall.kind,
) {
  if (displayKind === "execute") {
    return false;
  }

  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```|`[^`\n]+`|\|.+\|)/m.test(text);
}

function formatMessageTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function visualCopyText(visual: NonNullable<ChatMessage["visuals"]>[number], index: number) {
  const title = visual.title?.trim() || visual.description?.trim() || `可视化 ${index + 1}`;
  if (visual.type === "diagram") {
    return [`可视化：${title}`, visual.code].join("\n");
  }

  return [`可视化：${title}`, JSON.stringify(visual.spec, null, 2)].join("\n");
}

function splitDiffLines(value: string) {
  return value.split("\n");
}

function renderPrefixedDiffLines(text: string, prefix: "+" | "-", className: string) {
  return splitDiffLines(text).map((line, index) => (
    <span key={`${className}-${index}`} className={`activity-diff-line ${className}`}>
      <span className="activity-diff-prefix">{prefix}</span>
      <span>{line || " "}</span>
    </span>
  ));
}

function patchLineClassName(line: string) {
  if (line.startsWith("***") || line.startsWith("@@")) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "added";
  }
  if (line.startsWith("-")) {
    return "removed";
  }
  return "context";
}

function renderPatchLines(text: string) {
  return splitDiffLines(text).map((line, index) => (
    <span key={`patch-${index}`} className={`activity-diff-line ${patchLineClassName(line)}`}>
      {line || " "}
    </span>
  ));
}

function buildMessageCopyText(message: ChatMessage) {
  const parsedMessage =
    message.role === "assistant"
      ? parseChatMessageContent(message.content, message.visuals)
      : {
          text: message.content.trim(),
          visuals: message.visuals ?? [],
          hasPendingVisualBlock: false,
          invalidVisualCount: 0,
        };
  const blocks: string[] = [];

  if (message.attachments?.length) {
    blocks.push(
      [
        "附件：",
        ...message.attachments.map((attachment) => `- ${attachment.name} (${formatBytes(attachment.size)})`),
      ].join("\n"),
    );
  }

  if (parsedMessage.text.trim()) {
    blocks.push(parsedMessage.text.trim());
  }

  parsedMessage.visuals.forEach((visual, index) => {
    blocks.push(visualCopyText(visual, index));
  });

  return blocks.join("\n\n").trim();
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
  skills,
  onDraftMessageChange,
  onExportConversation,
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
  exportingConversationFormat,
  onToast,
}: ChatWorkspaceProps) {
  const composerInputRef = useRef<ComposerRichInputHandle | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const knowledgePickerRef = useRef<HTMLDivElement | null>(null);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const autoScrollManuallyDetachedRef = useRef(false);
  const autoScrollPinnedToBottomRef = useRef(true);
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeSkillSuggestionIndex, setActiveSkillSuggestionIndex] = useState(0);
  const composerSkillTrigger = getComposerSkillTrigger(draftMessage);
  const skillSuggestions = useMemo(() => {
    if (!composerSkillTrigger || busy) {
      return [];
    }

    const query = composerSkillTrigger.query.toLowerCase();
    return skills
      .filter((skill) => skill.enabled)
      .filter((skill) => {
        if (!query) {
          return true;
        }
        return (
          skill.name.toLowerCase().includes(query) ||
          skill.id.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query)
        );
      })
      .slice(0, 6);
  }, [busy, composerSkillTrigger, skills]);
  const skillSuggestionsOpen = skillSuggestions.length > 0;

  useEffect(() => {
    setActiveSkillSuggestionIndex(0);
  }, [composerSkillTrigger?.query, skillSuggestions.length]);

  useEffect(() => {
    if (!knowledgePickerOpen && !modelPickerOpen && !exportMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (knowledgePickerRef.current && !knowledgePickerRef.current.contains(target)) {
        setKnowledgePickerOpen(false);
      }

      if (modelPickerRef.current && !modelPickerRef.current.contains(target)) {
        setModelPickerOpen(false);
      }

      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setExportMenuOpen(false);
      }
    };

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setKnowledgePickerOpen(false);
        setModelPickerOpen(false);
        setExportMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [exportMenuOpen, knowledgePickerOpen, modelPickerOpen]);

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
    activityItems: runtimeState?.activityItems,
    timelineItems: runtimeState?.timelineItems,
    thoughtTextLength: runtimeState?.thoughtText.length ?? 0,
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
  const reasoningText = runtimeState?.thoughtText.trim() ?? "";
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

  function updateMessageListPinnedState(messageList: HTMLDivElement) {
    const metrics = {
      clientHeight: messageList.clientHeight,
      scrollHeight: messageList.scrollHeight,
      scrollTop: messageList.scrollTop,
    };

    if (autoScrollManuallyDetachedRef.current) {
      const isAtBottom = isScrollAtBottom(metrics);
      autoScrollManuallyDetachedRef.current = !isAtBottom;
      autoScrollPinnedToBottomRef.current = isAtBottom;
      return;
    }

    autoScrollPinnedToBottomRef.current = isScrollNearBottom(metrics);
  }

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
    const requestedManualScroll = previousScrollState.scrollRequest !== scrollToBottomRequest;
    const shouldScrollToBottom = shouldAutoScrollMessageList({
      conversationChanged,
      requestedManualScroll,
      wasPinnedToBottom: autoScrollPinnedToBottomRef.current,
    });
    const behavior: ScrollBehavior = "auto";

    autoScrollStateRef.current = {
      activeConversationId,
      messageCount,
      scrollRequest: scrollToBottomRequest,
    };

    if (!shouldScrollToBottom) {
      updateMessageListPinnedState(messageList);
      return undefined;
    }

    const scrollToBottom = () => {
      autoScrollManuallyDetachedRef.current = false;
      autoScrollPinnedToBottomRef.current = true;
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

  function handleMessageListScroll(event: UIEvent<HTMLDivElement>) {
    updateMessageListPinnedState(event.currentTarget);
  }

  function handleMessageListWheel(event: WheelEvent<HTMLDivElement>) {
    if (shouldReleaseAutoScrollOnWheel(event.deltaY)) {
      autoScrollManuallyDetachedRef.current = true;
      autoScrollPinnedToBottomRef.current = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (busy) {
      return;
    }

    if (skillSuggestionsOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSkillSuggestionIndex((index) => (index + 1) % skillSuggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSkillSuggestionIndex((index) => (index - 1 + skillSuggestions.length) % skillSuggestions.length);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySkillSuggestion(skillSuggestions[activeSkillSuggestionIndex] ?? skillSuggestions[0]);
        return;
      }
    }

    if (shouldSubmitComposerKeyDown(event)) {
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
      composerInputRef.current?.focus();
      composerInputRef.current?.moveCursorToEnd();
    });
  }

  function applyHomePrompt(prompt: string) {
    const nextDraft = prompt.trim();
    if (!nextDraft) {
      return;
    }

    onDraftMessageChange(nextDraft);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.moveCursorToEnd();
    });
  }

  function applySkillSuggestion(skill: SkillConfig | undefined) {
    if (!skill || !composerSkillTrigger) {
      return;
    }

    const nextDraft = insertComposerSkillMention(draftMessage, composerSkillTrigger, skill);
    onDraftMessageChange(nextDraft);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.moveCursorToEnd();
    });
  }

  function renderSkillSuggestions() {
    if (!skillSuggestionsOpen) {
      return null;
    }

    return (
      <div className="chat-skill-suggestions" role="listbox" aria-label="可调用技能">
        {skillSuggestions.map((skill, index) => (
          <button
            key={skill.id}
            className={`chat-skill-suggestion ${index === activeSkillSuggestionIndex ? "active" : ""}`}
            onMouseDown={(event) => {
              event.preventDefault();
              applySkillSuggestion(skill);
            }}
            role="option"
            aria-selected={index === activeSkillSuggestionIndex}
            type="button"
          >
            <span className="chat-skill-suggestion-name">${skill.name}</span>
            <span className="chat-skill-suggestion-desc">{skill.description || "工作区技能"}</span>
          </button>
        ))}
      </div>
    );
  }

  function renderUserMessageContent(content: string) {
    const segments = splitComposerSkillMentions(content);
    const hasMention = segments.some((segment) => segment.type === "mention");

    if (!hasMention) {
      return <div className="message-text user">{content}</div>;
    }

    return (
      <div className="message-text user message-text-with-skill-mentions">
        {segments.map((segment, index) =>
          segment.type === "mention" ? (
            <span key={`${segment.raw}-${index}`} className="message-inline-skill-chip">
              <BookOpen size={13} />
              <strong>${segment.name}</strong>
            </span>
          ) : (
            <span key={`text-${index}`}>{segment.text}</span>
          ),
        )}
      </div>
    );
  }

  async function copyMessage(message: ChatMessage) {
    const text = buildMessageCopyText(message);
    if (!text) {
      onToast("没有可复制内容");
      return;
    }

    try {
      await copyTextToClipboard(text);
      setCopiedMessageId(message.id);
      onToast("已复制");
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1200);
    } catch {
      onToast("复制失败");
    }
  }

  function renderExportMenu() {
    const exporting = Boolean(exportingConversationFormat);

    return (
      <div ref={exportMenuRef} className="chat-export-menu">
        <button
          aria-expanded={exportMenuOpen}
          aria-haspopup="menu"
          aria-label={exporting ? "正在导出会话" : "导出会话"}
          className={`chat-export-trigger ${exportMenuOpen ? "open" : ""}`}
          disabled={exporting}
          onClick={() => setExportMenuOpen((current) => !current)}
          title={exporting ? "正在导出" : "导出会话"}
          type="button"
        >
          {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
        </button>

        {exportMenuOpen ? (
          <div className="chat-export-panel" role="menu">
            {CONVERSATION_EXPORT_OPTIONS.map((option) => {
              const optionExporting = exportingConversationFormat === option.format;
              return (
                <button
                  key={option.format}
                  className="chat-export-option"
                  disabled={exporting}
                  onClick={() => {
                    setExportMenuOpen(false);
                    onExportConversation(option.format);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FileText size={15} />
                  <span>{option.label}</span>
                  <small>{optionExporting ? "导出中" : option.detail}</small>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
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
                const providerLabel = model.providerName.trim();

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
                      <span>{providerLabel}</span>
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

  function renderThinkingIndicator(
    key: string,
    options: {
      hasAssistantText?: boolean;
      isStreaming?: boolean;
      isThinking?: boolean;
    },
  ) {
    if (!shouldShowRuntimeThinkingIndicator(options)) {
      return null;
    }

    return (
      <div key={key} className="runtime-thinking-indicator" aria-live="polite">
        正在思考
      </div>
    );
  }

  function renderStatusBlock(text: string, key: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    return (
      <RichMarkdown
        key={key}
        className="runtime-status-line"
        content={trimmed}
        onClick={handleMessageClick}
      />
    );
  }

  function renderToolCard(
    toolCall: ChatToolCall,
    terminalOutputs: Record<string, NonNullable<ChatMessageRuntimeTrace["terminalOutputs"]>[string]>,
    runtimeInProgressForCard: boolean,
    keyPrefix: string,
  ) {
    const display = getRuntimeToolDisplay(toolCall);
    const generatedDiffs = buildRuntimeToolDiffs(toolCall);
    const visibleContent = toolCall.content.filter((content) => {
      if (content.type === "text") {
        return hasVisibleText(content.text);
      }

      if (content.type === "diff") {
        return hasVisibleText(content.newText) || hasVisibleText(content.oldText) || hasVisibleText(content.path);
      }

      const terminal = terminalOutputs[content.terminalId];
      if (!terminal) {
        return runtimeInProgressForCard;
      }

      return hasVisibleText(terminal.output) || terminal.exitCode !== null || terminal.signal !== null;
    });
    const hasFriendlySummary = display.isKnownTool && hasVisibleText(display.detail);
    const showRawPayload = shouldShowRawToolPayload(display, {
      hasReadableContent: visibleContent.length > 0,
      hasGeneratedDiffs: generatedDiffs.length > 0,
    });
    const hasRawInput = showRawPayload && hasVisibleText(toolCall.rawInputJson);
    const hasRawOutput = showRawPayload && hasVisibleText(toolCall.rawOutputJson);

    if (
      !shouldRenderRuntimeToolCard(toolCall, {
        hasVisibleContent: visibleContent.length > 0 || generatedDiffs.length > 0 || hasFriendlySummary,
        hasRawInput,
        hasRawOutput,
        isStreaming: runtimeInProgressForCard,
      })
    ) {
      return null;
    }

    const renderDiffPanel = (diff: RuntimeToolDiff, index: number, keyPrefixValue: string) => {
      const isPatch = diff.oldText === undefined && diff.newText.trim().startsWith("*** Begin Patch");

      return (
        <div key={`${toolCall.toolCallId}-${keyPrefixValue}-${index}`} className="activity-panel activity-diff-panel">
          <span className="activity-panel-label">{diff.path}</span>
          <pre className="activity-diff-pre">
            {isPatch ? renderPatchLines(diff.newText) : null}
            {!isPatch && diff.oldText !== undefined && diff.oldText !== null
              ? renderPrefixedDiffLines(diff.oldText, "-", "removed")
              : null}
            {!isPatch ? renderPrefixedDiffLines(diff.newText, "+", "added") : null}
          </pre>
        </div>
      );
    };

    return (
      <details key={`${keyPrefix}-${toolCall.toolCallId}`} className="activity-card tool-message-card">
        <summary className="activity-summary">
          <div className="activity-summary-main">
            <div className="activity-summary-title">
              <span className="activity-tool-icon">
                {display.kind === "execute" ? <TerminalSquare size={14} /> : <Wrench size={14} />}
              </span>
              <strong>{display.title}</strong>
              <em>{display.detail}</em>
            </div>
          </div>
          <div className="activity-summary-side">
            <span className={`activity-status-pill ${statusClassName(toolCall.status)}`}>
              {toolCall.status === "completed" ? <CheckCircle2 size={12} /> : null}
              {toolCall.status === "failed" ? <AlertCircle size={12} /> : null}
              {(toolCall.status === "pending" || toolCall.status === "in_progress") ? (
                <LoaderCircle size={12} className="spin" />
              ) : null}
              <span className="activity-status-text">{statusLabel(toolCall.status)}</span>
            </span>
            <ChevronDown size={14} />
          </div>
        </summary>
        <div className="activity-detail">
          {generatedDiffs.map((diff, index) => renderDiffPanel(diff, index, "generated-diff"))}

          {visibleContent.map((content, index) => {
            if (content.type === "text") {
              if (display.kind === "execute") {
                return (
                  <div key={`${toolCall.toolCallId}-command-${index}`} className="activity-panel activity-command-panel">
                    <div className="activity-command-shell">
                      {display.command ? (
                        <div className="activity-command-line">
                          <span>$</span>
                          <code>{display.command}</code>
                        </div>
                      ) : null}
                      <pre className="activity-command-output">{content.text}</pre>
                    </div>
                  </div>
                );
              }

              if (shouldRenderToolTextAsMarkdown(toolCall, content.text, display.kind)) {
                return (
                  <div key={`${toolCall.toolCallId}-text-${index}`} className="activity-panel activity-panel-summary">
                    <span className="activity-panel-label">输出</span>
                    <RichMarkdown
                      className="activity-markdown"
                      content={content.text}
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
              return renderDiffPanel(content, index, "content-diff");
            }

            const terminal = terminalOutputs[content.terminalId];
            return (
              <div key={`${toolCall.toolCallId}-terminal-${index}`} className="activity-panel">
                <span className="activity-panel-label">终端 {content.terminalId.slice(0, 8)}</span>
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

  function renderUnlinkedTerminals(
    terminalOutputs: Record<string, NonNullable<ChatMessageRuntimeTrace["terminalOutputs"]>[string]>,
    linkedTerminalIds: Set<string>,
    keyPrefix: string,
  ) {
    const visibleTerminals = Object.values(terminalOutputs)
      .filter((terminal) => !linkedTerminalIds.has(terminal.terminalId))
      .filter(
        (terminal) =>
          hasVisibleText(terminal.output) || terminal.exitCode !== null || terminal.signal !== null,
      );

    if (visibleTerminals.length === 0) {
      return null;
    }

    return visibleTerminals.map((terminal) => (
      <details key={`${keyPrefix}-${terminal.terminalId}`} className="activity-card tool-message-card">
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
                <span className="activity-status-text">
                  {terminal.exitCode === null && terminal.signal === null ? "执行中" : "结束"}
                </span>
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

  function renderTraceBlocks(
    trace: Pick<
      ChatMessageRuntimeTrace,
      "activityItems" | "timelineItems" | "thoughtText" | "toolCalls" | "terminalOutputs" | "error"
    > | null | undefined,
    options: {
      hasAssistantText?: boolean;
      keyPrefix: string;
      isStreaming?: boolean;
      fallbackText?: string;
    },
  ) {
    if (!trace) {
      return [];
    }

    const blocks: JSX.Element[] = [];
    const timelineItems = trace.timelineItems ?? [];
    const toolCallsById = new Map(trace.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
    const linkedTerminalIds = new Set(
      trace.toolCalls.flatMap((toolCall) =>
        toolCall.content
          .filter((content) => content.type === "terminal")
          .map((content) => content.terminalId),
      ),
    );
    const hasVisibleActivity =
      timelineItems.length > 0 ||
      trace.toolCalls.length > 0 ||
      Object.keys(trace.terminalOutputs).length > 0;
    const showThinkingPlaceholder =
      Boolean(options.isStreaming) && !trace.thoughtText.trim() && !hasVisibleActivity;

    if (timelineItems.length > 0) {
      const renderItems = buildRuntimeTimelineRenderItems(timelineItems, trace.toolCalls);
      renderItems.forEach((item: ChatRuntimeTimelineItem, index) => {
        if (item.type === "activity") {
          return;
        }

        if (item.type === "thought") {
          const isPreviewing = isStreamingTimelineThoughtItem(renderItems, index, options.isStreaming);
          const thinkingIndicator = renderThinkingIndicator(
            `${options.keyPrefix}-${item.id}-thinking`,
            {
              hasAssistantText: options.hasAssistantText,
              isStreaming: options.isStreaming,
              isThinking: isPreviewing,
            },
          );
          if (thinkingIndicator) {
            blocks.push(thinkingIndicator);
          }
          return;
        }

        if (item.type === "status") {
          const statusBlock = renderStatusBlock(
            sanitizeTimelineStatusText(item.text),
            `${options.keyPrefix}-${item.id}`,
          );
          if (statusBlock) {
            blocks.push(statusBlock);
          }
          return;
        }

        const toolCall = toolCallsById.get(item.toolCallId);
        if (!toolCall) {
          return;
        }

        const toolCard = renderToolCard(
          toolCall,
          trace.terminalOutputs,
          Boolean(options.isStreaming),
          `${options.keyPrefix}-${item.id}`,
        );
        if (toolCard) {
          blocks.push(toolCard);
        }
      });

      const unlinkedTerminalCards = renderUnlinkedTerminals(
        trace.terminalOutputs,
        linkedTerminalIds,
        options.keyPrefix,
      );
      if (unlinkedTerminalCards) {
        blocks.push(...unlinkedTerminalCards);
      }

      if (trace.error) {
        blocks.push(
          <div key={`${options.keyPrefix}-error`} className="message-text error">
            <strong>智能体执行失败</strong>
            <p>{trace.error}</p>
          </div>,
        );
      }

      return blocks;
    }

    const thinkingIndicator = renderThinkingIndicator(
      `${options.keyPrefix}-thinking`,
      {
        hasAssistantText: options.hasAssistantText,
        isStreaming: options.isStreaming,
        isThinking: Boolean(trace.thoughtText.trim()) || showThinkingPlaceholder,
      },
    );
    if (thinkingIndicator) {
      blocks.push(thinkingIndicator);
    }

    trace.toolCalls
      .forEach((toolCall) => {
        const toolCard = renderToolCard(
          toolCall,
          trace.terminalOutputs,
          Boolean(options.isStreaming),
          options.keyPrefix,
        );
        if (toolCard) {
          blocks.push(toolCard);
        }
      });

    const unlinkedTerminalCards = renderUnlinkedTerminals(
      trace.terminalOutputs,
      linkedTerminalIds,
      options.keyPrefix,
    );
    if (unlinkedTerminalCards) {
      blocks.push(...unlinkedTerminalCards);
    }

    if (trace.error) {
      blocks.push(
        <div key={`${options.keyPrefix}-error`} className="message-text error">
          <strong>智能体执行失败</strong>
          <p>{trace.error}</p>
        </div>,
      );
    }

    return blocks;
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
    const messageCopyText = buildMessageCopyText(message);
    const copied = copiedMessageId === message.id;

    return (
      <div key={message.id} className={`message-row ${message.role === "user" ? "user" : ""}`}>
        <div className={`message-bubble ${message.role === "user" ? "user" : ""}`}>
          {message.role === "assistant" && message.runtimeTrace ? (
            <RuntimeTraceGroup
              endedAt={message.updatedAt}
              hasError={Boolean(message.runtimeTrace.error)}
              isStreaming={false}
              startedAt={message.createdAt}
            >
              {renderTraceBlocks(message.runtimeTrace, {
                keyPrefix: `message-${message.id}`,
              })}
            </RuntimeTraceGroup>
          ) : null}
          {message.attachments?.length ? renderAttachmentList(message.attachments) : null}
          {parsedMessage.text ? (
            message.role === "assistant" ? (
              <RichMarkdown
                className="message-text"
                content={parsedMessage.text}
                onClick={handleMessageClick}
              />
            ) : (
              renderUserMessageContent(parsedMessage.text)
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
          {messageCopyText ? (
            <div
              className={`message-actions ${copied ? "copied" : ""}`}
              aria-label={`${formatMessageTime(message.createdAt)} 消息操作`}
            >
              <span className="message-time">{formatMessageTime(message.createdAt)}</span>
              <button
                aria-label={copied ? "已复制消息" : "复制消息"}
                className={`message-action-button ${copied ? "copied" : ""}`}
                onClick={() => void copyMessage(message)}
                title={copied ? "已复制" : "复制"}
                type="button"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderRuntimeActivity(blocks: JSX.Element[], options?: {
    endedAt?: number;
    hasError?: boolean;
    isStreaming?: boolean;
    startedAt?: number;
  }) {
    if (blocks.length === 0 && !options?.isStreaming) {
      return null;
    }

    return (
      <div className="message-row">
        <div className="message-bubble">
          <RuntimeTraceGroup
            endedAt={options?.endedAt}
            hasError={options?.hasError}
            isStreaming={options?.isStreaming}
            startedAt={options?.startedAt}
          >
            {blocks}
          </RuntimeTraceGroup>
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
      <div className="chat-composer-frame">
        {renderSkillSuggestions()}
        <div className="chat-composer-card">
          {renderAttachmentList(attachments, true)}
          {renderActiveKnowledgeChips()}
          <div className="chat-composer-input-area">
            <ComposerRichInput
              ref={composerInputRef}
              disabled={busy}
              onChange={onDraftMessageChange}
              onKeyDown={handleKeyDown}
              placeholder={composerPlaceholder}
              value={draftMessage}
            />
          </div>
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
      </div>
    );
  }

  function renderThread() {
    if (!activeConversation) {
      return null;
    }

    const lastAssistantHasPersistedTrace = Boolean(
      lastMessage?.role === "assistant" && lastMessage.runtimeTrace,
    );
    const hasStreamingAssistantText = Boolean(
      runtimeInProgress && lastMessage?.role === "assistant" && hasVisibleText(lastMessage.content),
    );
    const runtimeBlocks =
      runtimeState && (runtimeInProgress || !lastAssistantHasPersistedTrace)
        ? renderTraceBlocks(
            {
              activityItems: runtimeState.activityItems,
              timelineItems: runtimeState.timelineItems,
              thoughtText: runtimeState.thoughtText,
              toolCalls: runtimeState.toolCalls,
              terminalOutputs: runtimeState.terminalOutputs,
              error: runtimeState.status === "failed" ? runtimeState.error : undefined,
            },
            {
              hasAssistantText: hasStreamingAssistantText,
              keyPrefix: "runtime",
              isStreaming: runtimeInProgress,
              fallbackText: cancelInFlight ? "Stopping current reply..." : "Generating reasoning...",
            },
          )
        : [];

    const hasRuntimeActivity = runtimeBlocks.length > 0 || runtimeInProgress;
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
        <div className="chat-thread-toolbar">
          <div className="chat-thread-title" title={activeConversation.title}>
            {activeConversation.title}
          </div>
          {renderExportMenu()}
        </div>
        <div
          ref={messageListRef}
          className="message-list"
          data-native-wheel-scroll="true"
          onScroll={handleMessageListScroll}
          onWheel={handleMessageListWheel}
        >
          {leadingMessages.map(renderMessage)}

          {showLoadingBubble ? (
            <div className="message-row">
              <div className="message-loading">
                <LoaderCircle size={14} className="spin" />
                <span>{cancelInFlight ? "正在停止..." : "智能体处理中..."}</span>
              </div>
            </div>
          ) : null}

          {renderRuntimeActivity(runtimeBlocks, {
            endedAt: inlineAssistantMessage?.updatedAt,
            hasError: runtimeState?.status === "failed",
            isStreaming: runtimeInProgress,
            startedAt: inlineAssistantMessage?.createdAt,
          })}
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
              <div className="chat-home-stage">
                <div className="chat-home-center-copy">
                  <h1>开始新的对话</h1>
                </div>
                <div className="chat-home-composer-shell">
                  {renderComposer(true)}
              </div>
            </div>
          </div>
        ) : (
          renderThread()
        )}
      </div>
    </section>
  );
}
