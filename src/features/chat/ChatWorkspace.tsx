import {
  ArrowUp,
  BookOpen,
  Box,
  Check,
  CircleCheckBig,
  CircleX,
  ChevronDown,
  Copy,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Mic,
  Plus,
  RefreshCw,
  Square,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";

import { parseChatMessageContent } from "../../lib/chat-visuals";
import {
  getComposerSkillTrigger,
  insertComposerSkillMention,
  splitComposerSkillMentions,
} from "../../lib/composer-skills";
import {
  buildComposerSlashCommandSuggestions,
  getComposerSlashCommandTrigger,
  removeComposerSlashCommandTrigger,
  type ComposerSlashSuggestion,
} from "../../lib/composer-slash-commands";
import { formatBytes } from "../../lib/format";
import { formatChatTokenUsageBadge } from "../../lib/token-cost";
import { chooseFloatingTooltipPlacement, type FloatingTooltipPlacement } from "../../lib/tooltip-placement";
import { shouldRenderRuntimeToolCard } from "../../lib/runtime-tool-visibility";
import {
  buildRuntimeTextDiffLines,
  buildRuntimeToolDiffs,
  getRuntimeDiffLineNumberColumns,
  getRuntimeToolDisplay,
  shouldRenderRuntimeToolCommandPreview,
  shouldShowRawToolPayload,
  type RuntimeToolDiff,
  type RuntimeToolDiffLine,
} from "../../lib/runtime-tool-display";
import {
  buildRuntimeLiveRenderItems,
  buildRuntimeTimelineRenderItems,
  isStreamingTimelineThoughtItem,
  runtimeActivityRenderMode,
  runtimeTraceGroupSummaryLabel,
  sanitizeTimelineStatusText,
  shouldOpenRuntimeTraceGroup,
  shouldRenderLiveThinkingPlaceholder,
  shouldRenderRuntimeLiveTimer,
  shouldRenderRuntimeStateBlocks,
  shouldShowRuntimeThinkingIndicator,
} from "../../lib/runtime-timeline";
import {
  buildRuntimeTodoSnapshot,
  getRuntimeTodoProgress,
  shouldRenderRuntimeTodoPanel,
  type RuntimeTodoSnapshot,
} from "../../lib/runtime-todos";
import {
  buildMessageListScrollRevision,
  buildRuntimeStateScrollFingerprint,
  isScrollAtBottom,
  isScrollNearBottom,
  scrollMessageListToBottom,
  shouldAutoScrollMessageList,
  shouldAutoScrollToolContent,
  shouldReleaseAutoScrollOnWheel,
} from "../../lib/chat-scroll";
import { copyTextToClipboard } from "./clipboard";
import { createComposerAttachmentsFromFiles } from "./attachment-files";
import { buildConversationCopyMarkdown } from "./conversation-markdown";
import { ComposerRichInput, type ComposerRichInputHandle } from "./ComposerRichInput";
import { MailAuthRequestCard } from "./MailAuthRequestCard";
import { QuestionRequestCard } from "./QuestionRequestCard";
import { RichMarkdown } from "../shared/RichMarkdown";
import type {
  ChatConversation,
  ChatMessage,
  ChatMessageRuntimeTrace,
  ChatConversationRuntimeState,
  ChatRuntimeTimelineItem,
  ChatToolCall,
  DesktopApprovalRequest,
  DesktopApprovalResponse,
  FileDropEntry,
  KnowledgeBaseSummary,
  MailAuthDesktopApprovalRequest,
  QuestionDesktopApprovalRequest,
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
  workspaceFolderControl?: ReactNode;
  selectableModels: RuntimeModelOption[];
  selectedKnowledgeBaseIds: string[];
  skills: SkillConfig[];
  onDraftMessageChange: (value: string) => void;
  onClearKnowledgeBases: () => void;
  onManageKnowledgeBases: () => void;
  onAddAttachments: (files: FileDropEntry[]) => void | Promise<void>;
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
  onToast: (message: string) => void;
  approvalRequests: DesktopApprovalRequest[];
  onResolveApproval: (response: DesktopApprovalResponse) => void | Promise<void>;
}

function isMailAuthApprovalRequest(request: DesktopApprovalRequest): request is MailAuthDesktopApprovalRequest {
  return request.kind === "mail_auth";
}

function isQuestionApprovalRequest(request: DesktopApprovalRequest): request is QuestionDesktopApprovalRequest {
  return request.kind === "question";
}

function scrollMetricsForElement(element: HTMLElement) {
  return {
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  };
}

function usePinnedToolContentScroll<TElement extends HTMLElement>(
  followKey: string,
  enabled: boolean,
) {
  const ref = useRef<TElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const previousFollowKeyRef = useRef<string | null>(null);

  const handleScroll = useCallback((event: UIEvent<TElement>) => {
    pinnedToBottomRef.current = isScrollNearBottom(scrollMetricsForElement(event.currentTarget));
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    const contentChanged = previousFollowKeyRef.current !== followKey;
    previousFollowKeyRef.current = followKey;
    if (
      !enabled ||
      !element ||
      !shouldAutoScrollToolContent({
        contentChanged,
        wasPinnedToBottom: pinnedToBottomRef.current,
      })
    ) {
      return undefined;
    }

    scrollMessageListToBottom(element);
    const frame = window.requestAnimationFrame(() => scrollMessageListToBottom(element));
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, followKey]);

  return {
    onScroll: handleScroll,
    ref,
  };
}

function AutoScrollPre({
  children,
  className,
  enabled,
  followKey,
}: {
  children: ReactNode;
  className?: string;
  enabled: boolean;
  followKey: string;
}) {
  const scroll = usePinnedToolContentScroll<HTMLPreElement>(followKey, enabled);

  return (
    <pre className={className} data-native-wheel-scroll="true" onScroll={scroll.onScroll} ref={scroll.ref}>
      {children}
    </pre>
  );
}

function AutoScrollDiv({
  children,
  className,
  enabled,
  followKey,
}: {
  children: ReactNode;
  className?: string;
  enabled: boolean;
  followKey: string;
}) {
  const scroll = usePinnedToolContentScroll<HTMLDivElement>(followKey, enabled);

  return (
    <div className={className} data-native-wheel-scroll="true" onScroll={scroll.onScroll} ref={scroll.ref}>
      {children}
    </div>
  );
}

function RuntimeTraceGroup({
  children,
  endedAt,
  hasAssistantText,
  hasError,
  isStreaming,
  startedAt,
}: {
  children: JSX.Element[];
  endedAt?: number;
  hasAssistantText?: boolean;
  hasError?: boolean;
  isStreaming?: boolean;
  startedAt?: number;
}) {
  const [open, setOpen] = useState(() =>
    shouldOpenRuntimeTraceGroup({ isStreaming, hasAssistantText }),
  );
  const fallbackStartedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setOpen(shouldOpenRuntimeTraceGroup({ isStreaming, hasAssistantText }));
  }, [hasAssistantText, isStreaming]);

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
        if (shouldOpenRuntimeTraceGroup({ isStreaming, hasAssistantText }) && !nextOpen) {
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

function RuntimeLiveStatus({
  blockCount,
  hasError,
  isStreaming,
  startedAt,
}: {
  blockCount: number;
  hasError?: boolean;
  isStreaming?: boolean;
  startedAt?: number;
}) {
  const fallbackStartedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) {
      return undefined;
    }

    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  if (!shouldRenderRuntimeLiveTimer({ blockCount, isStreaming })) {
    return null;
  }

  const start = startedAt ?? fallbackStartedAt.current;
  const durationMs = Math.max(0, now - start);
  const label = runtimeTraceGroupSummaryLabel({ isStreaming, hasError, durationMs });

  return (
    <div className="runtime-live-status" aria-live="polite">
      <span className="runtime-trace-summary-copy">{label}</span>
    </div>
  );
}

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
  if (status === "cancelled") {
    return "cancelled";
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
  if (status === "cancelled") {
    return "取消";
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

function diffPrefix(kind: RuntimeToolDiffLine["kind"]) {
  if (kind === "added") return "+";
  if (kind === "removed") return "-";
  return " ";
}

function renderRuntimeDiffLines(lines: RuntimeToolDiffLine[]) {
  const lineNumberColumns = getRuntimeDiffLineNumberColumns(lines);
  return lines.map((line, index) => (
    <span key={`diff-${index}`} className={`activity-diff-line ${line.kind}`}>
      {lineNumberColumns.includes("old") ? (
        <span className="activity-diff-line-number">{line.oldLineNumber ?? ""}</span>
      ) : null}
      {lineNumberColumns.includes("new") ? (
        <span className="activity-diff-line-number">{line.newLineNumber ?? ""}</span>
      ) : null}
      <span className="activity-diff-prefix">{diffPrefix(line.kind)}</span>
      <span className="activity-diff-content">{line.text || " "}</span>
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

const MESSAGE_USAGE_TOOLTIP_GAP = 8;
const MESSAGE_USAGE_TOOLTIP_PADDING = 12;
const MESSAGE_USAGE_TOOLTIP_DELAY_MS = 1_500;

function clampNumber(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

interface MessageUsageTooltipPosition {
  arrowLeft: number;
  left: number;
  placement: FloatingTooltipPlacement;
  top: number;
}

function splitMessageUsageTooltipSections(title: string) {
  return title
    .split(/\n{2,}/)
    .map((section) => section.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((section) => section.length > 0);
}

function renderMessageUsageTooltipLine(line: string, lineIndex: number, key: string) {
  const separatorIndex = line.indexOf("：");
  if (lineIndex === 0 || separatorIndex <= 0) {
    return (
      <span key={key} className={lineIndex === 0 ? "message-usage-tooltip-heading" : "message-usage-tooltip-note"}>
        {line}
      </span>
    );
  }

  return (
    <span key={key} className="message-usage-tooltip-row">
      <span className="message-usage-tooltip-key">{line.slice(0, separatorIndex)}</span>
      <span className="message-usage-tooltip-value">{line.slice(separatorIndex + 1)}</span>
    </span>
  );
}

function MessageUsageBadge({ id, label, title }: { id?: string; label: string; title: string }) {
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const showTooltipTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<MessageUsageTooltipPosition | null>(null);
  const tooltipSections = useMemo(() => splitMessageUsageTooltipSections(title), [title]);

  const updateTooltipPosition = useCallback(() => {
    const badge = badgeRef.current;
    const tooltip = tooltipRef.current;
    if (!badge || !tooltip) {
      return;
    }

    const badgeRect = badge.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const messageList = badge.closest(".message-list");
    const boundaryBottom =
      messageList instanceof HTMLElement ? messageList.getBoundingClientRect().bottom : undefined;
    const placement = chooseFloatingTooltipPlacement({
      anchorBottom: badgeRect.bottom,
      anchorTop: badgeRect.top,
      boundaryBottom,
      tooltipHeight: tooltipRect.height,
      viewportHeight: window.innerHeight,
    });
    const anchorCenter = badgeRect.left + badgeRect.width / 2;
    const maxLeft = window.innerWidth - tooltipRect.width - MESSAGE_USAGE_TOOLTIP_PADDING;
    const left = clampNumber(
      anchorCenter - tooltipRect.width / 2,
      MESSAGE_USAGE_TOOLTIP_PADDING,
      maxLeft,
    );
    const usableBottom = Math.min(window.innerHeight, boundaryBottom ?? window.innerHeight);
    const preferredTop =
      placement === "bottom"
        ? badgeRect.bottom + MESSAGE_USAGE_TOOLTIP_GAP
        : badgeRect.top - tooltipRect.height - MESSAGE_USAGE_TOOLTIP_GAP;
    const maxTop =
      placement === "bottom"
        ? usableBottom - tooltipRect.height - MESSAGE_USAGE_TOOLTIP_PADDING
        : window.innerHeight - tooltipRect.height - MESSAGE_USAGE_TOOLTIP_PADDING;
    const top = clampNumber(preferredTop, MESSAGE_USAGE_TOOLTIP_PADDING, maxTop);
    const arrowLeft = clampNumber(
      anchorCenter - left,
      MESSAGE_USAGE_TOOLTIP_PADDING,
      tooltipRect.width - MESSAGE_USAGE_TOOLTIP_PADDING,
    );

    setTooltipPosition({ arrowLeft, left, placement, top });
  }, []);
  const clearPendingShowTooltip = useCallback(() => {
    if (showTooltipTimerRef.current === null) {
      return;
    }
    window.clearTimeout(showTooltipTimerRef.current);
    showTooltipTimerRef.current = null;
  }, []);
  const showTooltip = useCallback(() => {
    clearPendingShowTooltip();
    setOpen(true);
  }, [clearPendingShowTooltip]);
  const scheduleTooltip = useCallback(() => {
    clearPendingShowTooltip();
    showTooltipTimerRef.current = window.setTimeout(() => {
      showTooltipTimerRef.current = null;
      setOpen(true);
    }, MESSAGE_USAGE_TOOLTIP_DELAY_MS);
  }, [clearPendingShowTooltip]);
  const hideTooltip = useCallback(() => {
    clearPendingShowTooltip();
    setOpen(false);
    setTooltipPosition(null);
  }, [clearPendingShowTooltip]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    updateTooltipPosition();
    const handleViewportChange = () => updateTooltipPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, title, updateTooltipPosition]);

  useEffect(() => clearPendingShowTooltip, [clearPendingShowTooltip]);

  const placement = tooltipPosition?.placement ?? "bottom";
  const tooltipStyle = {
    left: tooltipPosition?.left ?? 0,
    top: tooltipPosition?.top ?? 0,
    visibility: tooltipPosition ? "visible" : "hidden",
    "--message-usage-arrow-left": tooltipPosition ? `${tooltipPosition.arrowLeft}px` : "50%",
  } as CSSProperties;

  return (
    <span
      ref={badgeRef}
      className="message-usage"
      data-placement={placement}
      aria-describedby={id}
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onPointerEnter={scheduleTooltip}
      onPointerLeave={hideTooltip}
      tabIndex={0}
    >
      <span>{label}</span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              className={`message-usage-tooltip ${tooltipPosition ? "is-visible" : ""}`}
              data-placement={placement}
              id={id}
              role="tooltip"
              style={tooltipStyle}
            >
              {tooltipSections.map((section, sectionIndex) => (
                <span key={`section-${sectionIndex}`} className="message-usage-tooltip-section">
                  {section.map((line, lineIndex) =>
                    renderMessageUsageTooltipLine(line, lineIndex, `${sectionIndex}-${lineIndex}`),
                  )}
                </span>
              ))}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
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
  workspaceFolderControl,
  selectableModels,
  selectedKnowledgeBaseIds,
  skills,
  onDraftMessageChange,
  onClearKnowledgeBases,
  onManageKnowledgeBases,
  onAddAttachments,
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
  onToast,
  approvalRequests,
  onResolveApproval,
}: ChatWorkspaceProps) {
  const composerInputRef = useRef<ComposerRichInputHandle | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const knowledgePickerRef = useRef<HTMLDivElement | null>(null);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
  const autoScrollManuallyDetachedRef = useRef(false);
  const autoScrollPinnedToBottomRef = useRef(true);
  const autoScrollStateRef = useRef<{
    activeConversationId: string | null;
    messageCount: number;
    runtimeInProgress: boolean;
    scrollRequest: number;
  }>({
    activeConversationId: null,
    messageCount: 0,
    runtimeInProgress: false,
    scrollRequest: 0,
  });
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [threadActionMenuOpen, setThreadActionMenuOpen] = useState(false);
  const [runtimeTodoCollapsed, setRuntimeTodoCollapsed] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeSkillSuggestionIndex, setActiveSkillSuggestionIndex] = useState(0);
  const [activeSlashSuggestionIndex, setActiveSlashSuggestionIndex] = useState(0);
  const [dismissedSlashTriggerKey, setDismissedSlashTriggerKey] = useState<string | null>(null);
  const [messageListEdgeState, setMessageListEdgeState] = useState({
    hasBottomFade: false,
    hasTopFade: false,
  });
  const composerSkillTrigger = getComposerSkillTrigger(draftMessage);
  const composerSlashTrigger = getComposerSlashCommandTrigger(draftMessage);
  const slashTriggerKey = composerSlashTrigger
    ? `${composerSlashTrigger.start}:${composerSlashTrigger.end}:${composerSlashTrigger.query}`
    : null;
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
          skill.description.toLowerCase().includes(query) ||
          (skill.displayName ?? "").toLowerCase().includes(query) ||
          (skill.shortDescription ?? "").toLowerCase().includes(query)
        );
      })
      .slice(0, 6);
  }, [busy, composerSkillTrigger, skills]);
  const skillSuggestionsOpen = skillSuggestions.length > 0;
  const slashSuggestions = useMemo(() => {
    if (!composerSlashTrigger || busy) {
      return [];
    }

    return buildComposerSlashCommandSuggestions({
      skills,
      trigger: composerSlashTrigger,
    });
  }, [busy, composerSlashTrigger, skills]);
  const slashSuggestionsOpen =
    slashSuggestions.length > 0 && slashTriggerKey !== dismissedSlashTriggerKey && !skillSuggestionsOpen;

  useEffect(() => {
    setActiveSkillSuggestionIndex(0);
  }, [composerSkillTrigger?.query, skillSuggestions.length]);

  useEffect(() => {
    setActiveSlashSuggestionIndex(0);
    setDismissedSlashTriggerKey(null);
  }, [slashTriggerKey, slashSuggestions.length]);

  useEffect(() => {
    if (!knowledgePickerOpen && !modelPickerOpen && !threadActionMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (knowledgePickerRef.current && !knowledgePickerRef.current.contains(target)) {
        setKnowledgePickerOpen(false);
      }

      if (modelPickerRef.current && !modelPickerRef.current.contains(target)) {
        setModelPickerOpen(false);
      }

      if (threadActionMenuRef.current && !threadActionMenuRef.current.contains(target)) {
        setThreadActionMenuOpen(false);
      }
    };

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setKnowledgePickerOpen(false);
        setModelPickerOpen(false);
        setThreadActionMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [knowledgePickerOpen, modelPickerOpen, threadActionMenuOpen]);

  const isHome = activeConversation === null;
  const canSend = !busy && (draftMessage.trim().length > 0 || attachments.length > 0);
  const activeConversationId = activeConversation?.id ?? null;
  const messageCount = activeConversation?.messages.length ?? 0;
  const lastMessage = activeConversation?.messages[messageCount - 1] ?? null;
  const lastMessageId = lastMessage?.id ?? null;
  const lastMessageUpdatedAt = lastMessage?.updatedAt ?? 0;
  const lastMessageContentLength = lastMessage?.content.length ?? 0;
  const activeModelId = activeModel?.id || composerModelId || selectableModels[0]?.id || "";
  const activeModelOption =
    selectableModels.find((model) => model.id === activeModelId) ?? activeModel ?? selectableModels[0] ?? null;
  const activeModelLabel = formatCompactModelLabel(activeModelOption?.modelLabel ?? "");
  const selectedKnowledgeBases = knowledgeBases.filter((base) => selectedKnowledgeBaseIds.includes(base.id));
  const selectedKnowledgeCount = knowledgeEnabled ? selectedKnowledgeBaseIds.length : 0;
  const runtimeInProgress = isTurnActiveStatus(runtimeState?.status);

  useEffect(() => {
    if (!runtimeInProgress) {
      setRuntimeTodoCollapsed(false);
    }
  }, [runtimeInProgress]);

  const runtimeFingerprint = buildRuntimeStateScrollFingerprint(runtimeState);
  const messageListScrollRevision = buildMessageListScrollRevision({
    lastMessageContentLength,
    lastMessageId,
    lastMessageUpdatedAt,
    messageCount,
    runtimeFingerprint,
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
    const bottomDistance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;

    setMessageListEdgeState((current) => {
      const next = {
        hasBottomFade: bottomDistance > 2,
        hasTopFade: metrics.scrollTop > 2,
      };

      return current.hasBottomFade === next.hasBottomFade && current.hasTopFade === next.hasTopFade
        ? current
        : next;
    });

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
        runtimeInProgress,
        scrollRequest: scrollToBottomRequest,
      };
      return undefined;
    }

    const previousScrollState = autoScrollStateRef.current;
    const conversationChanged = previousScrollState.activeConversationId !== activeConversationId;
    const messageAdded = messageCount > previousScrollState.messageCount;
    const requestedManualScroll = previousScrollState.scrollRequest !== scrollToBottomRequest;
    const turnActiveOrRecentlyFinished = runtimeInProgress || previousScrollState.runtimeInProgress;
    const shouldScrollToBottom = shouldAutoScrollMessageList({
      conversationChanged,
      manuallyDetached: autoScrollManuallyDetachedRef.current,
      messageAdded,
      requestedManualScroll,
      turnActiveOrRecentlyFinished,
      wasPinnedToBottom: autoScrollPinnedToBottomRef.current,
    });
    autoScrollStateRef.current = {
      activeConversationId,
      messageCount,
      runtimeInProgress,
      scrollRequest: scrollToBottomRequest,
    };

    if (!shouldScrollToBottom) {
      updateMessageListPinnedState(messageList);
      return undefined;
    }

    const scrollBehavior = conversationChanged || requestedManualScroll ? "auto" : "instant";
    const scrollToBottom = () => {
      autoScrollManuallyDetachedRef.current = false;
      autoScrollPinnedToBottomRef.current = true;
      scrollMessageListToBottom(messageList, { behavior: scrollBehavior });
      updateMessageListPinnedState(messageList);
    };

    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeConversationId,
    messageListScrollRevision,
    runtimeInProgress,
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

    if (slashSuggestionsOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSlashSuggestionIndex((index) => (index + 1) % slashSuggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSlashSuggestionIndex((index) => (index - 1 + slashSuggestions.length) % slashSuggestions.length);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySlashSuggestion(slashSuggestions[activeSlashSuggestionIndex] ?? slashSuggestions[0]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedSlashTriggerKey(slashTriggerKey);
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

  function focusComposerAtEnd() {
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
    focusComposerAtEnd();
  }

  function applySlashSuggestion(item: ComposerSlashSuggestion | undefined) {
    if (!item || !composerSlashTrigger) {
      return;
    }

    if (item.kind === "skill") {
      const nextDraft = insertComposerSkillMention(draftMessage, composerSlashTrigger, item.skill);
      onDraftMessageChange(nextDraft);
      focusComposerAtEnd();
      return;
    }

    if (item.action === "open-model-picker") {
      const nextDraft = removeComposerSlashCommandTrigger(draftMessage, composerSlashTrigger);
      onDraftMessageChange(nextDraft);
      setKnowledgePickerOpen(false);
      setThreadActionMenuOpen(false);
      setModelPickerOpen(true);
      focusComposerAtEnd();
      return;
    }

    if (item.action === "open-skill-picker") {
      const before = draftMessage.slice(0, composerSlashTrigger.start);
      onDraftMessageChange(`${before}$`);
      focusComposerAtEnd();
      return;
    }

    const exhaustiveCheck: never = item.action;
    return exhaustiveCheck;
  }

  function renderSlashSuggestionIcon(item: ComposerSlashSuggestion) {
    if (item.kind === "skill") {
      return <BookOpen size={16} />;
    }

    if (item.id === "model") {
      return <Box size={16} />;
    }

    return <Wrench size={16} />;
  }

  function renderSlashCommandSuggestions() {
    if (!slashSuggestionsOpen) {
      return null;
    }

    const groups = (["快捷", "技能"] as const)
      .map((section) => ({
        section,
        items: slashSuggestions.filter((item) => item.section === section),
      }))
      .filter((group) => group.items.length > 0);
    let optionIndex = 0;

    return (
      <div className="chat-slash-suggestions" role="listbox" aria-label="/ 命令">
        {groups.map((group) => (
          <div key={group.section} className="chat-slash-suggestion-section">
            <div className="chat-slash-suggestion-section-label">{group.section}</div>
            {group.items.map((item) => {
              const index = optionIndex;
              optionIndex += 1;
              const active = index === activeSlashSuggestionIndex;
              const sourceLabel = item.kind === "skill" ? item.sourceLabel : "选择";

              return (
                <button
                  key={`${item.kind}-${item.id}`}
                  className={`chat-slash-suggestion ${active ? "active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySlashSuggestion(item);
                  }}
                  role="option"
                  aria-selected={active}
                  type="button"
                >
                  <span className="chat-slash-suggestion-icon">{renderSlashSuggestionIcon(item)}</span>
                  <span className="chat-slash-suggestion-copy">
                    <span className="chat-slash-suggestion-name">{item.label}</span>
                    <span className="chat-slash-suggestion-desc">{item.description}</span>
                  </span>
                  <span className="chat-slash-suggestion-source">{sourceLabel}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
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
            <span className="chat-skill-suggestion-name">{skill.displayName || `$${skill.name}`}</span>
            <span className="chat-skill-suggestion-desc">{skill.shortDescription || skill.description || "工作区技能"}</span>
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
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1200);
    } catch {
      onToast("复制失败");
    }
  }

  async function copyConversationMarkdown() {
    if (!activeConversation) {
      onToast("没有可复制内容");
      return;
    }

    try {
      await copyTextToClipboard(buildConversationCopyMarkdown(activeConversation));
      setThreadActionMenuOpen(false);
    } catch {
      onToast("复制失败");
    }
  }

  async function pasteAttachmentFiles(files: FileList) {
    try {
      const normalizedFiles = await createComposerAttachmentsFromFiles(files);
      if (normalizedFiles.length === 0) {
        return;
      }

      await onAddAttachments(normalizedFiles);
    } catch {
      onToast("粘贴附件失败");
    }
  }

  function renderThreadActions() {
    return (
      <div ref={threadActionMenuRef} className="chat-thread-actions">
        <button
          aria-expanded={threadActionMenuOpen}
          aria-haspopup="menu"
          aria-label="会话操作"
          className={`chat-thread-actions-trigger ${threadActionMenuOpen ? "open" : ""}`}
          onClick={() => setThreadActionMenuOpen((current) => !current)}
          title="会话操作"
          type="button"
        >
          <MoreHorizontal size={17} />
        </button>

        {threadActionMenuOpen ? (
          <div className="chat-thread-actions-panel" role="menu">
            <button
              className="chat-thread-actions-option"
              onClick={() => void copyConversationMarkdown()}
              role="menuitem"
              type="button"
            >
              <Copy size={15} />
              <span>复制为 Markdown</span>
            </button>
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
                    aria-current={selected ? "true" : undefined}
                    type="button"
                  >
                    <strong className="chat-model-option-name" title={fullLabel}>
                      {fullLabel}
                    </strong>
                    <span className="chat-model-option-provider" title={providerLabel}>
                      {providerLabel}
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

  function attachmentCardMeta(file: FileDropEntry) {
    const kind = fileKind(file);
    const extension = getFileExtension(file.name || file.path);
    const badge = extension ? extension.toUpperCase().slice(0, 4) : "FILE";
    const office = isOfficeDocument(file.name || file.path, file.mimeType);
    const isHtml = kind === "html" || extension === "html" || extension === "htm";
    const isSpreadsheet = ["csv", "xls", "xlsx"].includes(extension);
    const isPresentation = ["pps", "ppsx", "ppt", "pptx"].includes(extension);
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
          : kind === "text" || kind === "markdown" || kind === "code"
            ? "tone-text"
            : kind === "image"
              ? "tone-image"
              : "tone-file";
    const iconClass =
      kind === "pdf"
        ? "format-pdf"
        : isSpreadsheet
          ? "format-spreadsheet"
          : isPresentation
            ? "format-presentation"
            : office
              ? "format-office"
              : isHtml
                ? "format-html"
                : kind === "markdown"
                  ? "format-markdown"
                  : kind === "code"
                    ? "format-code"
                    : kind === "image"
                      ? "format-image"
                      : kind === "text"
                        ? "format-text"
                        : "format-file";
    const iconText =
      isHtml || kind === "code"
        ? "</>"
        : kind === "pdf"
          ? "PDF"
          : kind === "markdown"
            ? "MD"
            : office && extension
              ? extension.toUpperCase().slice(0, 4)
              : kind === "text"
                ? "TXT"
                : badge;

    return {
      badge,
      categoryLabel,
      extensionLabel: extension ? extension.toUpperCase() : categoryLabel,
      iconClass,
      iconText,
      kind,
      toneClass,
    };
  }

  function renderAttachmentList(files: FileDropEntry[], removable = false) {
    if (files.length === 0) return null;

    if (removable) {
      return (
        <div className="chat-attachment-card-list composer-attachment-card-list">
          {files.map((file) => {
            const meta = attachmentCardMeta(file);
            const imageSource = meta.kind === "image" ? file.dataUrl || file.url : "";

            if (imageSource) {
              return (
                <div key={file.id} className="composer-image-attachment-card">
                  <button
                    aria-label={`预览图片 ${file.name}`}
                    className="composer-image-attachment-main"
                    onClick={() => onOpenAttachment(file)}
                    type="button"
                  >
                    <img className="composer-image-attachment-thumb" src={imageSource} alt="" />
                  </button>
                  <button
                    aria-label={`移除附件 ${file.name}`}
                    className="chat-attachment-remove composer-attachment-remove"
                    onClick={() => onRemoveAttachment(file.id)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={file.id}
                className={`chat-attachment-card composer-attachment-card ${meta.toneClass}`}
              >
                <button className="composer-attachment-card-main" onClick={() => onOpenAttachment(file)} type="button">
                  <div className={`chat-attachment-card-badge composer-file-icon ${meta.iconClass}`}>
                    <span>{meta.iconText}</span>
                  </div>
                  <div className="chat-attachment-card-copy">
                    <strong title={file.name}>{file.name}</strong>
                    <span>{meta.extensionLabel}</span>
                  </div>
                </button>
                <button
                  aria-label={`移除附件 ${file.name}`}
                  className="chat-attachment-remove composer-attachment-remove"
                  onClick={() => onRemoveAttachment(file.id)}
                  type="button"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="chat-attachment-card-list">
        {files.map((file) => {
          const meta = attachmentCardMeta(file);

          return (
            <button
              key={file.id}
              className={`chat-attachment-card ${meta.toneClass}`}
              onClick={() => onOpenAttachment(file)}
              type="button"
            >
              <div className="chat-attachment-card-badge">{meta.badge}</div>
              <div className="chat-attachment-card-copy">
                <strong title={file.name}>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </div>
              <div className="chat-attachment-card-tag">{meta.categoryLabel}</div>
            </button>
          );
        })}
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
    const hasCommandOutput = visibleContent.some(
      (content) => content.type === "text" && display.kind === "execute",
    );
    const showCommandPreview = shouldRenderRuntimeToolCommandPreview(display, { hasCommandOutput });
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
      const lines = diff.lines?.length ? diff.lines : buildRuntimeTextDiffLines(diff.oldText, diff.newText);
      const followKey = [
        toolCall.toolCallId,
        keyPrefixValue,
        index,
        diff.oldText?.length ?? 0,
        diff.newText.length,
        lines.length,
        lines.at(-1)?.text.length ?? 0,
        toolCall.status ?? "",
      ].join(":");

      return (
        <div key={`${toolCall.toolCallId}-${keyPrefixValue}-${index}`} className="activity-panel activity-diff-panel">
          <span className="activity-panel-label">{diff.path}</span>
          <AutoScrollPre
            className="activity-diff-pre"
            enabled={runtimeInProgressForCard}
            followKey={followKey}
          >
            {renderRuntimeDiffLines(lines)}
          </AutoScrollPre>
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
              {toolCall.status === "completed" ? <CircleCheckBig size={12} strokeWidth={2.6} /> : null}
              {toolCall.status === "failed" ? <CircleX size={12} strokeWidth={2.6} /> : null}
              {toolCall.status === "cancelled" ? <X size={12} strokeWidth={2.6} /> : null}
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

          {showCommandPreview ? (
            <div
              key={`${toolCall.toolCallId}-command-preview`}
              className="activity-panel activity-command-panel activity-command-preview"
            >
              <AutoScrollDiv
                className="activity-command-shell"
                enabled={runtimeInProgressForCard}
                followKey={`${toolCall.toolCallId}:command-preview:${display.command?.length ?? 0}:${toolCall.status ?? ""}`}
              >
                <div className="activity-command-line">
                  <span>$</span>
                  <code>{display.command}</code>
                </div>
              </AutoScrollDiv>
            </div>
          ) : null}

          {visibleContent.map((content, index) => {
            if (content.type === "text") {
              if (display.kind === "execute") {
                return (
                  <div key={`${toolCall.toolCallId}-command-${index}`} className="activity-panel activity-command-panel">
                    <AutoScrollDiv
                      className="activity-command-shell"
                      enabled={runtimeInProgressForCard}
                      followKey={`${toolCall.toolCallId}:command:${index}:${content.text.length}:${toolCall.status ?? ""}`}
                    >
                      {display.command ? (
                        <div className="activity-command-line">
                          <span>$</span>
                          <code>{display.command}</code>
                        </div>
                      ) : null}
                      <pre className="activity-command-output">{content.text}</pre>
                    </AutoScrollDiv>
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
                  <AutoScrollPre
                    enabled={runtimeInProgressForCard}
                    followKey={`${toolCall.toolCallId}:text:${index}:${content.text.length}:${toolCall.status ?? ""}`}
                  >
                    {content.text}
                  </AutoScrollPre>
                </div>
              );
            }

            if (content.type === "diff") {
              return renderDiffPanel(content, index, "content-diff");
            }

            const terminal = terminalOutputs[content.terminalId];
            const terminalOutput = terminal?.output || "等待终端输出...";
            return (
              <div key={`${toolCall.toolCallId}-terminal-${index}`} className="activity-panel">
                <span className="activity-panel-label">终端 {content.terminalId.slice(0, 8)}</span>
                <AutoScrollPre
                  enabled={runtimeInProgressForCard}
                  followKey={`${toolCall.toolCallId}:terminal:${content.terminalId}:${terminalOutput.length}:${terminal?.exitCode ?? ""}:${terminal?.signal ?? ""}`}
                >
                  {terminalOutput}
                </AutoScrollPre>
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
                  <CircleCheckBig size={12} strokeWidth={2.6} />
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
            <AutoScrollPre
              enabled={terminal.exitCode === null && terminal.signal === null}
              followKey={`unlinked-terminal:${terminal.terminalId}:${terminal.output.length}:${terminal.exitCode ?? ""}:${terminal.signal ?? ""}`}
            >
              {terminal.output || "等待终端输出..."}
            </AutoScrollPre>
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

  function renderLiveRuntimeBlocks(
    trace: Pick<ChatConversationRuntimeState, "events" | "toolCalls" | "terminalOutputs"> | null | undefined,
  ) {
    if (!trace) {
      return [];
    }

    const blocks: JSX.Element[] = [];
    const toolCallsById = new Map(trace.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
    const linkedTerminalIds = new Set(
      trace.toolCalls.flatMap((toolCall) =>
        toolCall.content
          .filter((content) => content.type === "terminal")
          .map((content) => content.terminalId),
      ),
    );

    buildRuntimeLiveRenderItems(trace.events, trace.toolCalls).forEach((item) => {
      if (item.type === "text") {
        blocks.push(
          <RichMarkdown
            key={item.id}
            className="message-text"
            content={item.text}
            onClick={handleMessageClick}
          />,
        );
        return;
      }

      const toolCall = toolCallsById.get(item.toolCallId);
      if (!toolCall) {
        return;
      }

      const toolCard = renderToolCard(
        toolCall,
        trace.terminalOutputs,
        true,
        `runtime-${item.id}`,
      );
      if (toolCard) {
        blocks.push(toolCard);
      }
    });

    const unlinkedTerminalCards = renderUnlinkedTerminals(
      trace.terminalOutputs,
      linkedTerminalIds,
      "runtime-live",
    );
    if (unlinkedTerminalCards) {
      blocks.push(...unlinkedTerminalCards);
    }

    return blocks;
  }

  function renderMessage(message: ChatMessage, options?: { suppressRuntimeTrace?: boolean }) {
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
    const usageBadge =
      message.role === "assistant" ? formatChatTokenUsageBadge(message.runtimeTrace?.usage) : null;
    const usageTooltipId = usageBadge ? `message-usage-tooltip-${message.id}` : undefined;

    return (
      <div key={message.id} className={`message-row ${message.role === "user" ? "user" : ""}`}>
        <div className={`message-bubble ${message.role === "user" ? "user" : ""}`}>
          {message.role === "assistant" && message.runtimeTrace && !options?.suppressRuntimeTrace ? (
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
              className={`message-actions ${message.role === "assistant" ? "assistant" : "user"} ${
                copied ? "copied" : ""
              }`}
              aria-label={`${formatMessageTime(message.createdAt)} 消息操作`}
            >
              {message.role === "user" ? (
                <>
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
                </>
              ) : (
                <>
                  <button
                    aria-label={copied ? "已复制消息" : "复制消息"}
                    className={`message-action-button ${copied ? "copied" : ""}`}
                    onClick={() => void copyMessage(message)}
                    title={copied ? "已复制" : "复制"}
                    type="button"
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  {usageBadge ? (
                    <MessageUsageBadge id={usageTooltipId} label={usageBadge.label} title={usageBadge.title} />
                  ) : null}
                  <span className="message-time">{formatMessageTime(message.createdAt)}</span>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderRuntimeActivity(blocks: JSX.Element[], options?: {
    endedAt?: number;
    hasAssistantText?: boolean;
    hasError?: boolean;
    isStreaming?: boolean;
    startedAt?: number;
  }) {
    const mode = runtimeActivityRenderMode({
      blockCount: blocks.length,
      isStreaming: options?.isStreaming,
    });

    if (mode === "hidden") {
      return null;
    }

    if (mode === "live") {
      return (
        <div className="message-row">
          <div className="message-bubble live-runtime-bubble">
            <RuntimeLiveStatus
              blockCount={blocks.length}
              hasError={options?.hasError}
              isStreaming={options?.isStreaming}
              startedAt={options?.startedAt}
            />
            <div className="message-runtime-stack live-runtime-stack">{blocks}</div>
          </div>
        </div>
      );
    }

    return (
      <div className="message-row">
        <div className="message-bubble">
          <RuntimeTraceGroup
            endedAt={options?.endedAt}
            hasAssistantText={options?.hasAssistantText}
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

  function renderRuntimeTodoPanel(snapshot: RuntimeTodoSnapshot | null) {
    if (!snapshot || snapshot.items.length === 0) {
      return null;
    }

    const todoProgress = getRuntimeTodoProgress(snapshot.items);
    const progressStyle = {
      "--runtime-todo-progress": `${Math.round(todoProgress.ratio * 100)}%`,
    } as CSSProperties;

    return (
      <aside
        aria-label="待办进度"
        aria-live="polite"
        className={`runtime-todo-panel ${snapshot.isUpdating ? "updating" : ""} ${runtimeTodoCollapsed ? "collapsed" : ""}`}
      >
        <div className="runtime-todo-head">
          <span className="runtime-todo-title">
            <ListChecks size={15} />
            {!runtimeTodoCollapsed ? <strong>任务流</strong> : null}
          </span>
          {!runtimeTodoCollapsed ? (
            <span className="runtime-todo-count">
              {todoProgress.currentStep}/{todoProgress.total}
            </span>
          ) : null}
          <button
            aria-expanded={!runtimeTodoCollapsed}
            aria-label={runtimeTodoCollapsed ? "展开待办进度" : "收起待办进度"}
            className="runtime-todo-toggle"
            onClick={() => setRuntimeTodoCollapsed((current) => !current)}
            title={runtimeTodoCollapsed ? "展开" : "收起"}
            type="button"
          >
            {runtimeTodoCollapsed ? <ListChecks size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        {!runtimeTodoCollapsed ? (
          <>
            <span className="runtime-todo-subtitle">第 {todoProgress.currentStep} 项</span>
            <div
              aria-label="待办进度"
              aria-valuemax={todoProgress.total}
              aria-valuemin={0}
              aria-valuenow={todoProgress.currentStep}
              className="runtime-todo-progress"
              role="progressbar"
              style={progressStyle}
            >
              <span className="runtime-todo-progress-fill" />
            </div>
            <div className="runtime-todo-list">
              {snapshot.items.map((item) => (
                <div key={item.id} className={`runtime-todo-item ${item.status}`}>
                  <span className="runtime-todo-marker" aria-hidden="true">
                    {item.status === "completed" ? <Check size={11} strokeWidth={3} /> : null}
                    {item.status === "in_progress" ? (
                      <RefreshCw size={14} className="runtime-todo-refresh-icon" />
                    ) : null}
                  </span>
                  <span className="runtime-todo-copy">
                    <span title={item.content}>{item.content}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </aside>
    );
  }

  function renderComposer(home = false) {
    const composerPlaceholder = cancelInFlight
      ? "正在停止当前回复..."
      : busy
        ? "正在生成回复..."
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
        {renderSlashCommandSuggestions()}
        {renderSkillSuggestions()}
        {approvalRequests
          .filter(isQuestionApprovalRequest)
          .map((request) => (
            <QuestionRequestCard
              key={request.approvalId}
              request={request}
              onResolve={onResolveApproval}
            />
          ))}
        {approvalRequests
          .filter(isMailAuthApprovalRequest)
          .map((request) => (
            <MailAuthRequestCard
              key={request.approvalId}
              request={request}
              onResolve={onResolveApproval}
              onToast={onToast}
            />
          ))}
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
              onPasteFiles={(files) => void pasteAttachmentFiles(files)}
            />
          </div>
          <div className="chat-composer-actions">
            <div className="chat-composer-left">
              <button className="chat-composer-icon" onClick={onPickFiles} title="添加附件" type="button">
                <Plus size={17} />
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
    const showRuntimeStateBlocks = shouldRenderRuntimeStateBlocks({
      hasPersistedTrace: lastAssistantHasPersistedTrace,
      isStreaming: runtimeInProgress,
    });
    let runtimeBlocks =
      runtimeState && showRuntimeStateBlocks
        ? renderLiveRuntimeBlocks(runtimeState)
        : [];
    const liveThinkingPlaceholder = shouldRenderLiveThinkingPlaceholder({
      blockCount: runtimeBlocks.length,
      hasAssistantText: hasStreamingAssistantText,
      isStreaming: runtimeInProgress,
    })
      ? renderThinkingIndicator("runtime-live-thinking", {
          hasAssistantText: hasStreamingAssistantText,
          isStreaming: runtimeInProgress,
          isThinking: true,
        })
      : null;
    if (liveThinkingPlaceholder) {
      runtimeBlocks = [liveThinkingPlaceholder];
    }

    const hasRuntimeActivity = runtimeBlocks.length > 0;
    const streamingAssistantMessage =
      runtimeInProgress && lastMessage?.role === "assistant" ? lastMessage : null;
    const leadingMessages = streamingAssistantMessage
      ? activeConversation.messages.slice(0, -1)
      : activeConversation.messages;
    const showLoadingBubble =
      runtimeInProgress &&
      !hasRuntimeActivity &&
      (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.content);
    const messageListShellClassName = [
      "message-list-shell",
      messageListEdgeState.hasTopFade ? "has-top-fade" : "",
      messageListEdgeState.hasBottomFade ? "has-bottom-fade" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const todoSnapshot = buildRuntimeTodoSnapshot(runtimeState?.toolCalls ?? []);

    return (
      <div className="chat-thread-layout">
        <div className="chat-thread-toolbar">
          <div className="chat-thread-title" title={activeConversation.title}>
            {activeConversation.title}
          </div>
          {renderThreadActions()}
          {workspaceFolderControl ? (
            <div className="chat-thread-folder-control">
              {workspaceFolderControl}
            </div>
          ) : null}
        </div>
        <div className={messageListShellClassName}>
          <div
            ref={messageListRef}
            className="message-list"
            data-native-wheel-scroll="true"
            onScroll={handleMessageListScroll}
            onWheel={handleMessageListWheel}
          >
            {leadingMessages.map((message) => renderMessage(message))}

            {showLoadingBubble ? (
              <div className="message-row">
                <div className="message-loading">
                  <LoaderCircle size={14} className="spin" />
                  <span>{cancelInFlight ? "正在停止..." : "正在思考"}</span>
                </div>
              </div>
            ) : null}

            {renderRuntimeActivity(runtimeBlocks, {
              endedAt: streamingAssistantMessage?.updatedAt,
              hasAssistantText: hasStreamingAssistantText,
              hasError: runtimeState?.status === "failed",
              isStreaming: runtimeInProgress,
              startedAt: streamingAssistantMessage?.createdAt,
            })}
          </div>
        </div>

        {shouldRenderRuntimeTodoPanel(todoSnapshot, { isTurnActive: runtimeInProgress })
          ? renderRuntimeTodoPanel(todoSnapshot)
          : null}

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
      {isHome && workspaceFolderControl ? (
        <div className="chat-home-folder-control">
          {workspaceFolderControl}
        </div>
      ) : null}
    </section>
  );
}
