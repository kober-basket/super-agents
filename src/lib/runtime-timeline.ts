import type {
  ChatRuntimeActivityItem,
  ChatRuntimeTimelineItem,
  ChatToolCall,
} from "../types";

const INTERNAL_DUPLICATE_TOOL_STATUS_PATTERN =
  /^Skipped duplicate tool call "[^"]+"; reused the previous result\.$/;

export function appendTimelineTextItem(
  items: ChatRuntimeTimelineItem[],
  type: "thought" | "status",
  text: string,
  id: string,
): ChatRuntimeTimelineItem[] {
  if (!text) {
    return items;
  }

  const lastItem = items.at(-1);
  if (lastItem?.type === type) {
    return [
      ...items.slice(0, -1),
      {
        ...lastItem,
        text: `${lastItem.text}${text}`,
      },
    ];
  }

  return [...items, { id, type, text }];
}

export function upsertTimelineToolItem(
  items: ChatRuntimeTimelineItem[],
  toolCallId: string,
  id: string,
): ChatRuntimeTimelineItem[] {
  if (items.some((item) => item.type === "tool" && item.toolCallId === toolCallId)) {
    return items;
  }

  return [...items, { id, type: "tool", toolCallId }];
}

export function syncTimelineActivityItems(
  items: ChatRuntimeTimelineItem[],
  activityItems: ChatRuntimeActivityItem[],
  createId: (activity: ChatRuntimeActivityItem) => string,
): ChatRuntimeTimelineItem[] {
  let nextItems = items;

  for (const activity of activityItems) {
    const existingIndex = nextItems.findIndex(
      (item) => item.type === "activity" && item.activity.id === activity.id,
    );

    if (existingIndex >= 0) {
      nextItems = nextItems.map((item, index) =>
        index === existingIndex && item.type === "activity" ? { ...item, activity } : item,
      );
      continue;
    }

    nextItems = [...nextItems, { id: createId(activity), type: "activity", activity }];
  }

  return nextItems;
}

export function buildRuntimeTimelineRenderItems(
  timelineItems: ChatRuntimeTimelineItem[],
  toolCalls: Pick<ChatToolCall, "toolCallId">[],
): ChatRuntimeTimelineItem[] {
  const visibleTimelineItems = timelineItems.filter((item) => item.type !== "activity");
  const referencedToolCallIds = new Set(
    visibleTimelineItems
      .filter((item) => item.type === "tool")
      .map((item) => item.toolCallId),
  );
  const missingToolItems: ChatRuntimeTimelineItem[] = toolCalls
    .filter((toolCall) => !referencedToolCallIds.has(toolCall.toolCallId))
    .map((toolCall) => ({
      id: `tool-${toolCall.toolCallId}-fallback`,
      type: "tool",
      toolCallId: toolCall.toolCallId,
    }));

  return [...visibleTimelineItems, ...missingToolItems];
}

export function isStreamingTimelineThoughtItem(
  timelineItems: ChatRuntimeTimelineItem[],
  index: number,
  isStreaming: boolean | undefined,
) {
  return (
    Boolean(isStreaming) &&
    timelineItems[index]?.type === "thought" &&
    index === timelineItems.length - 1
  );
}

export function shouldOpenRuntimeTraceGroup(
  options: boolean | { isStreaming?: boolean; hasAssistantText?: boolean } | undefined,
) {
  const isStreaming =
    typeof options === "boolean" || options === undefined ? options : options.isStreaming;
  const hasAssistantText =
    typeof options === "object" && options !== null ? options.hasAssistantText : false;

  return Boolean(isStreaming && !hasAssistantText);
}

export function shouldAutoScrollReasoningContent(options: {
  isOpen: boolean;
  isStreaming: boolean;
}) {
  return options.isOpen && options.isStreaming;
}

export function shouldShowRuntimeThinkingIndicator(options: {
  hasAssistantText?: boolean;
  isStreaming?: boolean;
  isThinking?: boolean;
}) {
  return Boolean(options.isStreaming && options.isThinking && !options.hasAssistantText);
}

export function formatRuntimeTraceDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function runtimeTraceGroupSummaryLabel(options: {
  isStreaming?: boolean;
  hasError?: boolean;
  durationMs?: number;
}) {
  const duration = options.durationMs === undefined
    ? ""
    : ` ${formatRuntimeTraceDuration(options.durationMs)}`;

  if (options.hasError) {
    return `执行失败${duration}`;
  }

  return `${options.isStreaming ? "处理中" : "已处理"}${duration}`;
}

export function sanitizeTimelineStatusText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_DUPLICATE_TOOL_STATUS_PATTERN.test(line))
    .join("\n");
}
