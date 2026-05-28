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
  lines?: RuntimeToolDiffLine[];
}

export type RuntimeToolDiffLineKind = "context" | "added" | "removed" | "meta";

export interface RuntimeToolDiffLine {
  kind: RuntimeToolDiffLineKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

export type RuntimeDiffLineNumberColumn = "old" | "new";

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJsonStringEscape(value: string, index: number) {
  const escaped = value[index];
  if (escaped === undefined) {
    return { value: "", nextIndex: index };
  }

  if (escaped === "n") return { value: "\n", nextIndex: index + 1 };
  if (escaped === "r") return { value: "\r", nextIndex: index + 1 };
  if (escaped === "t") return { value: "\t", nextIndex: index + 1 };
  if (escaped === "b") return { value: "\b", nextIndex: index + 1 };
  if (escaped === "f") return { value: "\f", nextIndex: index + 1 };
  if (escaped === "u") {
    const hex = value.slice(index + 1, index + 5);
    if (/^[0-9a-f]{4}$/i.test(hex)) {
      return { value: String.fromCharCode(Number.parseInt(hex, 16)), nextIndex: index + 5 };
    }
    return { value: "", nextIndex: index };
  }

  return { value: escaped, nextIndex: index + 1 };
}

function partialJsonStringField(rawJson: string | undefined | null, key: string) {
  if (!rawJson) {
    return "";
  }

  const match = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`).exec(rawJson);
  if (!match) {
    return "";
  }

  let result = "";
  for (let index = match.index + match[0].length; index < rawJson.length;) {
    const character = rawJson[index];
    if (character === '"') {
      return result;
    }
    if (character === "\\") {
      const escaped = readJsonStringEscape(rawJson, index + 1);
      if (escaped.nextIndex <= index + 1 && escaped.value === "") {
        return result;
      }
      result += escaped.value;
      index = escaped.nextIndex;
      continue;
    }
    result += character;
    index += 1;
  }

  return result;
}

function trimDisplayText(value: string) {
  if (value.length <= MAX_DISPLAY_TEXT) {
    return value;
  }

  return `${value.slice(0, MAX_DISPLAY_TEXT)}\n[display truncated]`;
}

function splitTextLines(value: string) {
  if (!value) {
    return [];
  }

  const lines = value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function buildAddedDiffLines(newText: string): RuntimeToolDiffLine[] {
  return splitTextLines(newText).map((text, index) => ({
    kind: "added",
    oldLineNumber: null,
    newLineNumber: index + 1,
    text,
  }));
}

function buildMiddleLineDiff(
  oldLines: string[],
  newLines: string[],
  oldLineOffset: number,
  newLineOffset: number,
): RuntimeToolDiffLine[] {
  if (oldLines.length === 0) {
    return newLines.map((text, index) => ({
      kind: "added",
      oldLineNumber: null,
      newLineNumber: newLineOffset + index,
      text,
    }));
  }

  if (newLines.length === 0) {
    return oldLines.map((text, index) => ({
      kind: "removed",
      oldLineNumber: oldLineOffset + index,
      newLineNumber: null,
      text,
    }));
  }

  const columnCount = newLines.length + 1;
  const cellCount = (oldLines.length + 1) * columnCount;
  if (cellCount > 2_000_000) {
    return [
      ...oldLines.map((text, index) => ({
        kind: "removed" as const,
        oldLineNumber: oldLineOffset + index,
        newLineNumber: null,
        text,
      })),
      ...newLines.map((text, index) => ({
        kind: "added" as const,
        oldLineNumber: null,
        newLineNumber: newLineOffset + index,
        text,
      })),
    ];
  }

  const table = new Uint32Array(cellCount);
  const tableIndex = (oldIndex: number, newIndex: number) => oldIndex * columnCount + newIndex;
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[tableIndex(oldIndex, newIndex)] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[tableIndex(oldIndex + 1, newIndex + 1)] + 1
          : Math.max(table[tableIndex(oldIndex + 1, newIndex)], table[tableIndex(oldIndex, newIndex + 1)]);
    }
  }

  const lines: RuntimeToolDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({
        kind: "context",
        oldLineNumber: oldLineOffset + oldIndex,
        newLineNumber: newLineOffset + newIndex,
        text: oldLines[oldIndex],
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (
      oldIndex < oldLines.length &&
      (newIndex >= newLines.length ||
        table[tableIndex(oldIndex + 1, newIndex)] >= table[tableIndex(oldIndex, newIndex + 1)])
    ) {
      lines.push({
        kind: "removed",
        oldLineNumber: oldLineOffset + oldIndex,
        newLineNumber: null,
        text: oldLines[oldIndex],
      });
      oldIndex += 1;
      continue;
    }

    lines.push({
      kind: "added",
      oldLineNumber: null,
      newLineNumber: newLineOffset + newIndex,
      text: newLines[newIndex],
    });
    newIndex += 1;
  }

  return lines;
}

export function buildRuntimeTextDiffLines(
  oldText: string | null | undefined,
  newText: string,
): RuntimeToolDiffLine[] {
  if (oldText === null || oldText === undefined) {
    return buildAddedDiffLines(newText);
  }

  const oldLines = splitTextLines(oldText);
  const newLines = splitTextLines(newText);
  let prefixLength = 0;
  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let oldSuffixStart = oldLines.length;
  let newSuffixStart = newLines.length;
  while (
    oldSuffixStart > prefixLength &&
    newSuffixStart > prefixLength &&
    oldLines[oldSuffixStart - 1] === newLines[newSuffixStart - 1]
  ) {
    oldSuffixStart -= 1;
    newSuffixStart -= 1;
  }

  const prefixLines = oldLines.slice(0, prefixLength).map((text, index) => ({
    kind: "context" as const,
    oldLineNumber: index + 1,
    newLineNumber: index + 1,
    text,
  }));
  const middleLines = buildMiddleLineDiff(
    oldLines.slice(prefixLength, oldSuffixStart),
    newLines.slice(prefixLength, newSuffixStart),
    prefixLength + 1,
    prefixLength + 1,
  );
  const suffixLines = oldLines.slice(oldSuffixStart).map((text, index) => ({
    kind: "context" as const,
    oldLineNumber: oldSuffixStart + index + 1,
    newLineNumber: newSuffixStart + index + 1,
    text,
  }));

  return [...prefixLines, ...middleLines, ...suffixLines];
}

export function getRuntimeDiffLineNumberColumns(lines: RuntimeToolDiffLine[]): RuntimeDiffLineNumberColumn[] {
  const columns: RuntimeDiffLineNumberColumn[] = [];
  if (lines.some((line) => line.oldLineNumber !== null)) {
    columns.push("old");
  }
  if (lines.some((line) => line.newLineNumber !== null)) {
    columns.push("new");
  }
  return columns;
}

function buildPatchDiffLines(patch: string): RuntimeToolDiffLine[] {
  let oldLineNumber = 1;
  let newLineNumber = 1;

  return splitTextLines(patch).map((line) => {
    if (line.startsWith("***") || line.startsWith("@@")) {
      if (/^\*\*\* (?:Add|Update|Delete) File: /.test(line)) {
        oldLineNumber = 1;
        newLineNumber = 1;
      }

      return {
        kind: "meta",
        oldLineNumber: null,
        newLineNumber: null,
        text: line,
      };
    }

    if (line.startsWith("+")) {
      const nextLineNumber = newLineNumber;
      newLineNumber += 1;
      return {
        kind: "added",
        oldLineNumber: null,
        newLineNumber: nextLineNumber,
        text: line.slice(1),
      };
    }

    if (line.startsWith("-")) {
      const nextLineNumber = oldLineNumber;
      oldLineNumber += 1;
      return {
        kind: "removed",
        oldLineNumber: nextLineNumber,
        newLineNumber: null,
        text: line.slice(1),
      };
    }

    const nextOldLineNumber = oldLineNumber;
    const nextNewLineNumber = newLineNumber;
    oldLineNumber += 1;
    newLineNumber += 1;
    return {
      kind: "context",
      oldLineNumber: nextOldLineNumber,
      newLineNumber: nextNewLineNumber,
      text: line.startsWith(" ") ? line.slice(1) : line,
    };
  });
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
    detail = stringField(record, "path") || partialJsonStringField(toolCall.rawInputJson, "path") || "写入文件";
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
  const rawInputJson = toolCall.rawInputJson ?? "";
  const input = parseJsonValue(toolCall.rawInputJson);

  if (toolName === "edit") {
    if (!isRecord(input)) {
      return [];
    }
    const path = stringField(input, "path");
    const oldText = trimDisplayText(rawStringField(input, "oldString"));
    const newText = trimDisplayText(rawStringField(input, "newString"));
    return path && (oldText || newText)
      ? [{
          path,
          oldText,
          newText,
          lines: buildRuntimeTextDiffLines(oldText, newText),
        }]
      : [];
  }

  if (toolName === "multi_edit") {
    if (!isRecord(input)) {
      return [];
    }
    const path = stringField(input, "path");
    const edits = Array.isArray(input.edits) ? input.edits : [];
    if (!path) {
      return [];
    }

    return edits
      .filter(isRecord)
      .map((edit) => {
        const oldText = trimDisplayText(rawStringField(edit, "oldString"));
        const newText = trimDisplayText(rawStringField(edit, "newString"));
        return {
          path,
          oldText,
          newText,
          lines: buildRuntimeTextDiffLines(oldText, newText),
        };
      })
      .filter((diff) => Boolean(diff.oldText || diff.newText));
  }

  if (WRITE_TOOLS.has(toolName)) {
    const record = isRecord(input) ? input : {};
    const path = stringField(record, "path") || partialJsonStringField(rawInputJson, "path");
    const content = trimDisplayText(rawStringField(record, "content") || partialJsonStringField(rawInputJson, "content"));
    return path && content
      ? [{ path, oldText: null, newText: content, lines: buildRuntimeTextDiffLines(null, content) }]
      : [];
  }

  if (toolName === "apply_patch") {
    if (!isRecord(input)) {
      return [];
    }
    const patch = trimDisplayText(rawStringField(input, "patch"));
    return patch
      ? [{ path: summarizePatchFiles(patch) || "Patch", newText: patch, lines: buildPatchDiffLines(patch) }]
      : [];
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

export function shouldRenderRuntimeToolCommandPreview(
  display: Pick<RuntimeToolDisplay, "kind" | "command">,
  options: {
    hasCommandOutput: boolean;
  },
) {
  return display.kind === "execute" && Boolean(display.command?.trim()) && !options.hasCommandOutput;
}
