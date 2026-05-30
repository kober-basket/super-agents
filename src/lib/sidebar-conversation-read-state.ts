import type { ChatTurnStatus } from "../types";

export type SidebarConversationReadState = "idle" | "running" | "unread" | "attention";

export interface SidebarConversationReadStateInput {
  conversationId: string;
  activeConversationId: string | null;
  runtimeStatus?: ChatTurnStatus;
  hasPendingInteraction?: boolean;
  unreadConversationIds: ReadonlySet<string>;
}

export function resolveSidebarConversationReadState({
  conversationId,
  activeConversationId,
  runtimeStatus,
  hasPendingInteraction = false,
  unreadConversationIds,
}: SidebarConversationReadStateInput): SidebarConversationReadState {
  if (hasPendingInteraction || runtimeStatus === "failed") {
    return "attention";
  }

  if (runtimeStatus === "running" || runtimeStatus === "cancelling") {
    return "running";
  }

  if (conversationId !== activeConversationId && unreadConversationIds.has(conversationId)) {
    return "unread";
  }

  return "idle";
}
