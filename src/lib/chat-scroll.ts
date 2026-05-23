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
  requestedManualScroll: boolean;
  wasPinnedToBottom: boolean;
}) {
  return (
    options.conversationChanged ||
    options.requestedManualScroll ||
    options.wasPinnedToBottom
  );
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
