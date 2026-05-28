import type { ChatConversationRuntimeState } from "../types";

export function createEmptyConversationRuntimeState(
  status: ChatConversationRuntimeState["status"] = "idle",
): ChatConversationRuntimeState {
  return {
    status,
    events: [],
    activityItems: [],
    timelineItems: [],
    planEntries: [],
    toolCalls: [],
    terminalOutputs: {},
    thoughtText: "",
  };
}

export function resetConversationRuntimeStateForTurn(
  current: Record<string, ChatConversationRuntimeState>,
  conversationId: string,
): Record<string, ChatConversationRuntimeState> {
  return {
    ...current,
    [conversationId]: createEmptyConversationRuntimeState("running"),
  };
}

export function mergeStartedConversationRuntimeState(
  current: Record<string, ChatConversationRuntimeState>,
  options: {
    conversationId: string;
    replaceConversationId?: string | null;
  },
): Record<string, ChatConversationRuntimeState> {
  const replacementId = options.replaceConversationId?.trim() || "";
  const existing = current[options.conversationId];
  const replacement = replacementId ? current[replacementId] : undefined;
  const preserved = existing ?? replacement ?? createEmptyConversationRuntimeState("running");
  const next = { ...current };

  if (replacementId && replacementId !== options.conversationId) {
    delete next[replacementId];
  }

  next[options.conversationId] = {
    ...preserved,
    status: "running",
    error: undefined,
    stopReason: undefined,
  };

  return next;
}
