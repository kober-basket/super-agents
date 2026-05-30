import type { ChatConversation, DesktopApprovalRequest } from "../types";

export function filterApprovalRequestsForConversation(
  requests: DesktopApprovalRequest[],
  conversation: Pick<ChatConversation, "agentSessionId"> | null,
) {
  if (!conversation?.agentSessionId) {
    return [];
  }

  return requests.filter((request) => request.sessionId === conversation.agentSessionId);
}
