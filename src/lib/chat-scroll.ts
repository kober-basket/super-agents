export interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

const DEFAULT_BOTTOM_THRESHOLD_PX = 16;

export function isScrollNearBottom(
  metrics: ScrollMetrics,
  thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
) {
  const distanceFromBottom = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distanceFromBottom <= thresholdPx;
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
