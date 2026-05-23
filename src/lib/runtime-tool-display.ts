import type { ChatToolCall, ChatToolKind } from "../types";

export interface RuntimeToolDisplay {
  title: string;
  detail: string;
  kind: ChatToolKind;
  command?: string;
  isKnownTool: boolean;
}

export interface RuntimeToolDiff {
  path: string;
  oldText?: string | null;
  newText: string;
}

const READ_TOOLS = new Set(["read", "workspace_read_file"]);
const LIST_TOOLS = new Set(["list", "workspace_list_directory"]);
const SEARCH_TOOLS = new Set(["grep", "workspace_search_text", "glob"]);
const COMMAND_TOOLS = new Set(["bash", "workspace_shell", "exec", "shell"]);
const WRITE_TOOLS = new Set(["write", "workspace_write_file"]);
const EDIT_TOOLS = new Set(["edit", "multi_edit", "apply_patch"]);
const WEB_TOOLS = new Set(["web_fetch", "web_search"]);
const TODO_TOOLS = new Set(["todo_read", "todo_write"]);
const SKILL_TOOLS = new Set(["skill", "load_skill", "use_skill"]);
const MAX_DISPLAY_TEXT = 40_000;

function normalizeToolName(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "_");
}

function parseJsonValue(value?: string | null): unknown {
  if (!value?.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function rawStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function trimDisplayText(value: string) {
  if (value.length <= MAX_DISPLAY_TEXT) {
    return value;
  }

  return `${value.slice(0, MAX_DISPLAY_TEXT)}\n[display truncated]`;
}

function inferKind(toolName: string): ChatToolKind {
  if (READ_TOOLS.has(toolName) || LIST_TOOLS.has(toolName)) {
    return "read";
  }
  if (SEARCH_TOOLS.has(toolName)) {
    return "search";
  }
  if (COMMAND_TOOLS.has(toolName)) {
    return "execute";
  }
  if (WRITE_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName)) {
    return "edit";
  }
  if (WEB_TOOLS.has(toolName)) {
    return "fetch";
  }
  if (TODO_TOOLS.has(toolName)) {
    return "think";
  }
  if (SKILL_TOOLS.has(toolName)) {
    return "think";
  }

  return "other";
}

function summarizePatchFiles(patch: string) {
  const files = Array.from(
    patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm),
    (match) => match[1]?.trim(),
  ).filter((value): value is string => Boolean(value));

  if (files.length === 0) {
    return "";
  }

  if (files.length === 1) {
    return files[0];
  }

  return `${files.length} 个文件`;
}

function summarizeUnknownTool(toolCall: Pick<ChatToolCall, "kind" | "locations">) {
  if (toolCall.locations?.length) {
    return toolCall.locations.map((location) => location.path).join(", ");
  }

  if (toolCall.kind && toolCall.kind !== "other") {
    return toolCall.kind.replaceAll("_", " ");
  }

  return "执行详情";
}

export function getRuntimeToolDisplay(
  toolCall: Pick<ChatToolCall, "title" | "kind" | "locations" | "rawInputJson">,
): RuntimeToolDisplay {
  const title = toolCall.title.trim() || "tool";
  const toolName = normalizeToolName(title);
  const input = parseJsonValue(toolCall.rawInputJson);
  const record = isRecord(input) ? input : {};
  const inferredKind = inferKind(toolName);
  const kind = toolCall.kind && toolCall.kind !== "other" ? toolCall.kind : inferredKind;
  let detail = "";
  let command = "";
  let isKnownTool = true;

  if (READ_TOOLS.has(toolName)) {
    detail = stringField(record, "path") || "读取文件";
  } else if (LIST_TOOLS.has(toolName)) {
    const target = stringField(record, "path");
    detail = target ? `列出 ${target}` : "列出工作区";
  } else if (toolName === "grep" || toolName === "workspace_search_text") {
    const query = stringField(record, "query");
    const target = stringField(record, "path");
    detail = [query || "搜索文本", target].filter(Boolean).join(" · ");
  } else if (toolName === "glob") {
    const pattern = stringField(record, "pattern");
    const target = stringField(record, "path");
    detail = [pattern || "匹配文件", target].filter(Boolean).join(" · ");
  } else if (COMMAND_TOOLS.has(toolName)) {
    command = stringField(record, "command");
    detail = stringField(record, "description") || command || "运行命令";
  } else if (WRITE_TOOLS.has(toolName)) {
    detail = stringField(record, "path") || "写入文件";
  } else if (toolName === "edit" || toolName === "multi_edit") {
    detail = stringField(record, "path") || "编辑文件";
  } else if (toolName === "apply_patch") {
    detail = summarizePatchFiles(stringField(record, "patch")) || "应用补丁";
  } else if (toolName === "web_fetch") {
    detail = stringField(record, "url") || "抓取网页";
  } else if (toolName === "web_search") {
    detail = stringField(record, "query") || "搜索网页";
  } else if (toolName === "todo_write") {
    const items = Array.isArray(record.items) ? record.items.length : 0;
    detail = items > 0 ? `${items} 个任务` : "更新任务";
  } else if (toolName === "todo_read") {
    detail = "读取任务";
  } else if (SKILL_TOOLS.has(toolName)) {
    const skillName = stringField(record, "name");
    detail = skillName ? `加载 ${skillName} 技能` : "加载技能";
  } else {
    detail = summarizeUnknownTool(toolCall);
    isKnownTool = false;
  }

  return {
    title,
    detail,
    kind,
    command: command || undefined,
    isKnownTool,
  };
}

export function buildRuntimeToolDiffs(
  toolCall: Pick<ChatToolCall, "title" | "rawInputJson">,
): RuntimeToolDiff[] {
  const toolName = normalizeToolName(toolCall.title);
  const input = parseJsonValue(toolCall.rawInputJson);
  if (!isRecord(input)) {
    return [];
  }

  if (toolName === "edit") {
    const path = stringField(input, "path");
    const oldText = rawStringField(input, "oldString");
    const newText = rawStringField(input, "newString");
    return path && (oldText || newText)
      ? [{ path, oldText: trimDisplayText(oldText), newText: trimDisplayText(newText) }]
      : [];
  }

  if (toolName === "multi_edit") {
    const path = stringField(input, "path");
    const edits = Array.isArray(input.edits) ? input.edits : [];
    if (!path) {
      return [];
    }

    return edits
      .filter(isRecord)
      .map((edit) => ({
        path,
        oldText: trimDisplayText(rawStringField(edit, "oldString")),
        newText: trimDisplayText(rawStringField(edit, "newString")),
      }))
      .filter((diff) => Boolean(diff.oldText || diff.newText));
  }

  if (WRITE_TOOLS.has(toolName)) {
    const path = stringField(input, "path");
    const content = rawStringField(input, "content");
    return path && content ? [{ path, oldText: null, newText: trimDisplayText(content) }] : [];
  }

  if (toolName === "apply_patch") {
    const patch = rawStringField(input, "patch");
    return patch ? [{ path: summarizePatchFiles(patch) || "Patch", newText: trimDisplayText(patch) }] : [];
  }

  return [];
}

export function shouldShowRawToolPayload(
  display: Pick<RuntimeToolDisplay, "detail" | "command" | "isKnownTool">,
  options: {
    hasReadableContent: boolean;
    hasGeneratedDiffs: boolean;
  },
) {
  if (options.hasReadableContent || options.hasGeneratedDiffs) {
    return false;
  }

  if (!display.isKnownTool) {
    return true;
  }

  return !(display.detail.trim() || display.command?.trim());
}
