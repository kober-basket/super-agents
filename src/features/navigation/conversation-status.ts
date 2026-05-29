import type { ChatConversationRuntimeState } from "../../types";

export type SidebarConversationRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export function isConversationTurnActive(status?: ChatConversationRuntimeState["status"]) {
  return status === "running" || status === "cancelling";
}

export function resolveSidebarConversationRunStatus(
  runtimeState: ChatConversationRuntimeState | undefined,
  hasPendingApproval: boolean,
  hasCompletion: boolean,
): SidebarConversationRunStatus {
  if (isConversationTurnActive(runtimeState?.status) || hasPendingApproval) {
    return "running";
  }

  if (hasCompletion) {
    return "completed";
  }

  if (runtimeState?.status === "failed") {
    return "failed";
  }

  if (runtimeState?.stopReason === "cancelled") {
    return "cancelled";
  }

  return "idle";
}

export function shouldApplyStartedConversationAsActive(
  activeConversationId: string | null,
  optimisticConversationId: string,
) {
  return activeConversationId === optimisticConversationId;
}
