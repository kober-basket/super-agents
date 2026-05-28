import type { ChatConversationRuntimeState } from "../types";

export interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export interface MessageListScrollTarget {
  scrollHeight: number;
  scrollTop: number;
  style?: {
    scrollBehavior: string;
  };
  scrollTo?: (options: ScrollToOptions) => void;
}

export interface MessageListScrollRevisionInput {
  lastMessageContentLength: number;
  lastMessageId: string | null;
  lastMessageUpdatedAt: number;
  messageCount: number;
  runtimeFingerprint: string;
}

const DEFAULT_BOTTOM_THRESHOLD_PX = 16;
const DEFAULT_BOTTOM_RESUME_THRESHOLD_PX = 4;

function scrollDistanceFromBottom(metrics: ScrollMetrics) {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
}

export function isScrollNearBottom(
  metrics: ScrollMetrics,
  thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
) {
  return scrollDistanceFromBottom(metrics) <= thresholdPx;
}

export function isScrollAtBottom(
  metrics: ScrollMetrics,
  thresholdPx = DEFAULT_BOTTOM_RESUME_THRESHOLD_PX,
) {
  return scrollDistanceFromBottom(metrics) <= thresholdPx;
}

export function shouldAutoScrollMessageList(options: {
  conversationChanged: boolean;
  manuallyDetached: boolean;
  messageAdded: boolean;
  requestedManualScroll: boolean;
  turnActiveOrRecentlyFinished: boolean;
  wasPinnedToBottom: boolean;
}) {
  if (options.conversationChanged || options.messageAdded || options.requestedManualScroll) {
    return true;
  }

  if (options.manuallyDetached) {
    return false;
  }

  return options.wasPinnedToBottom || options.turnActiveOrRecentlyFinished;
}

export function buildMessageListScrollRevision(options: MessageListScrollRevisionInput) {
  return [
    options.lastMessageId ?? "",
    options.lastMessageUpdatedAt,
    options.lastMessageContentLength,
    options.messageCount,
    options.runtimeFingerprint,
  ].join(":");
}

export function buildRuntimeStateScrollFingerprint(
  runtimeState: ChatConversationRuntimeState | null | undefined,
) {
  return JSON.stringify({
    status: runtimeState?.status,
    stopReason: runtimeState?.stopReason,
    error: runtimeState?.error,
    liveMessageEvents: runtimeState?.events
      .filter((event) => event.type === "message_delta" || event.type === "message_replace")
      .map((event) => ({
        id: event.id,
        type: event.type,
        textLength: event.text?.length ?? 0,
      })),
    activityItems: runtimeState?.activityItems,
    timelineItems: runtimeState?.timelineItems,
    thoughtTextLength: runtimeState?.thoughtText.length ?? 0,
    planEntries: runtimeState?.planEntries,
    toolCalls: runtimeState?.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      status: toolCall.status,
      content: toolCall.content.map((content) =>
        content.type === "terminal"
          ? `${content.type}:${content.terminalId}`
          : content.type === "text"
            ? `${content.type}:${content.text.length}`
            : `${content.type}:${content.newText.length}`,
      ),
    })),
    terminals: Object.values(runtimeState?.terminalOutputs ?? {}).map((terminal) => ({
      terminalId: terminal.terminalId,
      outputLength: terminal.output.length,
      exitCode: terminal.exitCode,
    })),
  });
}

export function scrollMessageListToBottom(
  target: MessageListScrollTarget,
  options: { behavior?: ScrollBehavior | "instant" } = {},
) {
  const behavior = options.behavior ?? "instant";
  if (behavior !== "instant") {
    if (target.scrollTo) {
      target.scrollTo({
        top: target.scrollHeight,
        behavior,
      });
      return;
    }

    target.scrollTop = target.scrollHeight;
    return;
  }

  if (!target.style) {
    target.scrollTop = target.scrollHeight;
    return;
  }

  const previousScrollBehavior = target.style.scrollBehavior;
  target.style.scrollBehavior = "auto";
  try {
    target.scrollTop = target.scrollHeight;
  } finally {
    target.style.scrollBehavior = previousScrollBehavior;
  }
}

export function shouldReleaseAutoScrollOnWheel(deltaY: number) {
  return deltaY < 0;
}

export function shouldAutoScrollToolContent(options: {
  contentChanged: boolean;
  wasPinnedToBottom: boolean;
}) {
  return options.contentChanged && options.wasPinnedToBottom;
}
