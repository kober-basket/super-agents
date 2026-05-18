import type {
  ChatRuntimeActivityItem,
  ChatRuntimeActivityStatus,
  ChatToolCall,
} from "../types";

const READ_TOOLS = new Set(["read", "workspace_read_file"]);
const SEARCH_TOOLS = new Set([
  "grep",
  "glob",
  "list",
  "web_fetch",
  "web_search",
  "workspace_search_text",
  "workspace_list_directory",
]);
const COMMAND_TOOLS = new Set(["bash", "workspace_shell", "exec", "shell"]);

function normalizeToolName(toolCall: Pick<ChatToolCall, "title">) {
  return toolCall.title.trim().toLowerCase().replaceAll(/\s+/g, "_");
}

function groupStatus(toolCalls: ChatToolCall[]): ChatRuntimeActivityStatus {
  if (toolCalls.some((toolCall) => toolCall.status === "failed")) {
    return "failed";
  }

  if (toolCalls.some((toolCall) => toolCall.status === "pending" || toolCall.status === "in_progress")) {
    return "running";
  }

  return "completed";
}

function explorationText(fileCount: number, searchCount: number) {
  const parts = [
    fileCount > 0 ? `${fileCount} 个文件` : "",
    searchCount > 0 ? `${searchCount} 次搜索` : "",
  ].filter(Boolean);

  return `已探索 ${parts.join(" ")}`;
}

export function buildRuntimeActivityItems(toolCalls: ChatToolCall[]): ChatRuntimeActivityItem[] {
  const explorationCalls: ChatToolCall[] = [];
  const commandCalls: ChatToolCall[] = [];
  const otherCalls: ChatToolCall[] = [];
  let fileCount = 0;
  let searchCount = 0;

  for (const toolCall of toolCalls) {
    const toolName = normalizeToolName(toolCall);

    if (READ_TOOLS.has(toolName)) {
      explorationCalls.push(toolCall);
      fileCount += 1;
      continue;
    }

    if (SEARCH_TOOLS.has(toolName)) {
      explorationCalls.push(toolCall);
      searchCount += 1;
      continue;
    }

    if (COMMAND_TOOLS.has(toolName) || toolCall.kind === "execute") {
      commandCalls.push(toolCall);
      continue;
    }

    otherCalls.push(toolCall);
  }

  const items: ChatRuntimeActivityItem[] = [];
  if (explorationCalls.length > 0) {
    items.push({
      id: "exploration",
      kind: "exploration",
      text: explorationText(fileCount, searchCount),
      status: groupStatus(explorationCalls),
      fileCount,
      searchCount,
    });
  }

  if (commandCalls.length > 0) {
    items.push({
      id: "commands",
      kind: "command",
      text: `已运行 ${commandCalls.length} 条命令`,
      status: groupStatus(commandCalls),
      commandCount: commandCalls.length,
    });
  }

  if (otherCalls.length > 0) {
    items.push({
      id: "tools",
      kind: "tool",
      text: `已调用 ${otherCalls.length} 个工具`,
      status: groupStatus(otherCalls),
      toolCount: otherCalls.length,
    });
  }

  return items;
}
