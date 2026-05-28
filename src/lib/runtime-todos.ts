import type { ChatToolCall, ChatToolCallStatus } from "../types";

export type RuntimeTodoStatus = "pending" | "in_progress" | "completed";

export interface RuntimeTodoItem {
  id: string;
  content: string;
  status: RuntimeTodoStatus;
}

export interface RuntimeTodoSnapshot {
  activeToolCallId: string;
  isUpdating: boolean;
  items: RuntimeTodoItem[];
}

export interface RuntimeTodoCounts {
  completed: number;
  inProgress: number;
  pending: number;
  total: number;
}

export interface RuntimeTodoProgress {
  currentStep: number;
  ratio: number;
  total: number;
}

export interface RuntimeTodoPanelVisibilityOptions {
  isTurnActive: boolean;
}

const TODO_STATUSES = new Set<RuntimeTodoStatus>(["pending", "in_progress", "completed"]);

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

function normalizeToolName(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "_");
}

function normalizeTodoItems(value: unknown): RuntimeTodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }

    const content = typeof item.content === "string" ? item.content.trim() : "";
    const status = typeof item.status === "string" ? item.status : "";
    if (!content || !TODO_STATUSES.has(status as RuntimeTodoStatus)) {
      return [];
    }

    const id = typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : `todo-${index + 1}`;

    return [{ id, content, status: status as RuntimeTodoStatus }];
  });
}

function extractTodoItems(toolCall: Pick<ChatToolCall, "rawInputJson" | "rawOutputJson">) {
  const input = parseJsonValue(toolCall.rawInputJson);
  const inputItems = isRecord(input) ? normalizeTodoItems(input.items) : [];
  if (inputItems.length > 0) {
    return inputItems;
  }

  const output = parseJsonValue(toolCall.rawOutputJson);
  const metadata = isRecord(output) && isRecord(output.metadata) ? output.metadata : null;
  return metadata ? normalizeTodoItems(metadata.items) : [];
}

function isUpdatingStatus(status?: ChatToolCallStatus) {
  return status === "pending" || status === "in_progress";
}

export function buildRuntimeTodoSnapshot(
  toolCalls: Pick<ChatToolCall, "rawInputJson" | "rawOutputJson" | "status" | "title" | "toolCallId">[],
): RuntimeTodoSnapshot | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];
    if (normalizeToolName(toolCall.title) !== "todo_write") {
      continue;
    }

    const items = extractTodoItems(toolCall);
    if (items.length === 0) {
      continue;
    }

    return {
      activeToolCallId: toolCall.toolCallId,
      isUpdating: isUpdatingStatus(toolCall.status),
      items,
    };
  }

  return null;
}

export function summarizeRuntimeTodoCounts(items: RuntimeTodoItem[]): RuntimeTodoCounts {
  return items.reduce<RuntimeTodoCounts>(
    (counts, item) => {
      if (item.status === "completed") {
        counts.completed += 1;
      } else if (item.status === "in_progress") {
        counts.inProgress += 1;
      } else {
        counts.pending += 1;
      }
      counts.total += 1;
      return counts;
    },
    {
      completed: 0,
      inProgress: 0,
      pending: 0,
      total: 0,
    },
  );
}

export function getRuntimeTodoProgress(items: RuntimeTodoItem[]): RuntimeTodoProgress {
  const total = items.length;
  if (total === 0) {
    return {
      currentStep: 0,
      ratio: 0,
      total,
    };
  }

  const activeIndex = items.findIndex((item) => item.status === "in_progress");
  const completedCount = items.filter((item) => item.status === "completed").length;
  const fallbackStep = completedCount < total ? completedCount + 1 : total;
  const currentStep = Math.min(total, Math.max(1, activeIndex >= 0 ? activeIndex + 1 : fallbackStep));

  return {
    currentStep,
    ratio: currentStep / total,
    total,
  };
}

export function shouldRenderRuntimeTodoPanel(
  snapshot: RuntimeTodoSnapshot | null,
  options: RuntimeTodoPanelVisibilityOptions,
) {
  return Boolean(options.isTurnActive && snapshot && snapshot.items.length > 0);
}
