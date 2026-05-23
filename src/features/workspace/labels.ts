export const DEFAULT_WORKSPACE_TITLE = "工作台";
export const NO_WORKSPACE_SELECTED_LABEL = "未选择工作区";
export const CONVERSATION_WORKSPACE_LABEL = "会话工作区";

export function workspaceLabel(value: string) {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return NO_WORKSPACE_SELECTED_LABEL;
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

export function conversationWorkspaceLabel(value: string, conversationId?: string | null) {
  const label = workspaceLabel(value);
  const normalizedConversationId = conversationId?.trim();
  if (normalizedConversationId && label === normalizedConversationId) {
    return CONVERSATION_WORKSPACE_LABEL;
  }
  return label;
}
