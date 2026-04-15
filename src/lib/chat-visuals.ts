import type { ChatChartVisual, ChatDiagramVisual, ChatVisual } from "../types";

const VISUAL_BLOCK_LANGUAGES = new Set(["super-agents-visual", "super-agents-visuals"]);
const COMPLETE_VISUAL_BLOCK_PATTERN = /```([a-z0-9-]+)[^\S\r\n]*\r?\n([\s\S]*?)```/gi;
const PENDING_VISUAL_BLOCK_PATTERN = /```([a-z0-9-]+)[^\S\r\n]*\r?\n[\s\S]*$/i;

export interface ParsedChatMessageContent {
  text: string;
  visuals: ChatVisual[];
  hasPendingVisualBlock: boolean;
  invalidVisualCount: number;
}

function normalizeCopy(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeChartVisual(input: Record<string, unknown>, fallbackId: string): ChatChartVisual | null {
  const library = input.library;
  const spec = input.spec;

  if (library !== undefined && library !== "vega-lite") {
    return null;
  }

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return null;
  }

  return {
    id: normalizeCopy(input.id) ?? fallbackId,
    type: "chart",
    library: "vega-lite",
    title: normalizeCopy(input.title),
    description: normalizeCopy(input.description),
    spec: spec as Record<string, unknown>,
  };
}

function normalizeDiagramVisual(input: Record<string, unknown>, fallbackId: string): ChatDiagramVisual | null {
  const style = input.style;
  const code = input.code;

  if (style !== undefined && style !== "mermaid") {
    return null;
  }

  if (typeof code !== "string" || !code.trim()) {
    return null;
  }

  return {
    id: normalizeCopy(input.id) ?? fallbackId,
    type: "diagram",
    style: "mermaid",
    title: normalizeCopy(input.title),
    description: normalizeCopy(input.description),
    code: code.trim(),
  };
}

function normalizeVisual(input: unknown, fallbackId: string): ChatVisual | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;

  if (record.type === "chart") {
    return normalizeChartVisual(record, fallbackId);
  }

  if (record.type === "diagram") {
    return normalizeDiagramVisual(record, fallbackId);
  }

  return null;
}

function normalizeVisualPayload(input: unknown, blockIndex: number) {
  const items = Array.isArray(input) ? input : [input];
  const visuals: ChatVisual[] = [];
  let invalidVisualCount = 0;

  items.forEach((item, itemIndex) => {
    const visual = normalizeVisual(item, `vis-${blockIndex + 1}-${itemIndex + 1}`);
    if (visual) {
      visuals.push(visual);
      return;
    }

    invalidVisualCount += 1;
  });

  return { visuals, invalidVisualCount };
}

function cleanDisplayText(content: string) {
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

export function parseChatMessageContent(content: string, existingVisuals: ChatVisual[] = []): ParsedChatMessageContent {
  const visuals = [...existingVisuals];
  let invalidVisualCount = 0;
  let text = "";
  let lastIndex = 0;
  let blockIndex = 0;

  COMPLETE_VISUAL_BLOCK_PATTERN.lastIndex = 0;

  for (const match of content.matchAll(COMPLETE_VISUAL_BLOCK_PATTERN)) {
    const fullMatch = match[0];
    const language = match[1]?.trim().toLowerCase() ?? "";
    const payload = match[2] ?? "";
    const matchIndex = match.index ?? 0;

    text += content.slice(lastIndex, matchIndex);
    lastIndex = matchIndex + fullMatch.length;

    if (!VISUAL_BLOCK_LANGUAGES.has(language)) {
      text += fullMatch;
      continue;
    }

    blockIndex += 1;

    try {
      const parsed = JSON.parse(payload);
      const normalized = normalizeVisualPayload(parsed, blockIndex - 1);
      visuals.push(...normalized.visuals);
      invalidVisualCount += normalized.invalidVisualCount;
    } catch {
      invalidVisualCount += 1;
    }
  }

  const tail = content.slice(lastIndex);
  const pendingMatch = PENDING_VISUAL_BLOCK_PATTERN.exec(tail);
  const pendingLanguage = pendingMatch?.[1]?.trim().toLowerCase() ?? "";
  const hasPendingVisualBlock =
    pendingLanguage.length > 0 && VISUAL_BLOCK_LANGUAGES.has(pendingLanguage);

  text += hasPendingVisualBlock ? tail.slice(0, pendingMatch?.index ?? tail.length) : tail;

  return {
    text: cleanDisplayText(text),
    visuals,
    hasPendingVisualBlock,
    invalidVisualCount,
  };
}
