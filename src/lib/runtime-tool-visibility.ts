import type { ChatToolCall } from "../types";

export function shouldRenderRuntimeToolCard(
  toolCall: Pick<ChatToolCall, "status">,
  options: {
    hasVisibleContent: boolean;
    hasRawInput: boolean;
    hasRawOutput: boolean;
    isStreaming: boolean;
  },
) {
  if (options.hasVisibleContent || options.hasRawInput || options.hasRawOutput) {
    return true;
  }

  return options.isStreaming && (toolCall.status === "pending" || toolCall.status === "in_progress");
}
