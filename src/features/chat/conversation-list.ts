import type { ChatConversationSummary } from "../../types";

export interface UpsertConversationSummaryOptions {
  replaceConversationId?: string | null;
}

export function upsertConversationSummaryList(
  current: ChatConversationSummary[],
  summary: ChatConversationSummary,
  options: UpsertConversationSummaryOptions = {},
) {
  const replaceConversationId = options.replaceConversationId?.trim();
  return [
    summary,
    ...current.filter(
      (conversation) =>
        conversation.id !== summary.id &&
        (!replaceConversationId || conversation.id !== replaceConversationId),
    ),
  ].sort((left, right) => right.lastMessageAt - left.lastMessageAt || right.createdAt - left.createdAt);
}
