export interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
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

export function shouldReleaseAutoScrollOnWheel(deltaY: number) {
  return deltaY < 0;
}
