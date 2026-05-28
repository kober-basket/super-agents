import { randomUUID } from "node:crypto";

import type { ChatMessageRuntimeTrace, ChatToolCall } from "../../src/types";
import { buildRuntimeActivityItems } from "../../src/lib/runtime-activity";
import {
  appendTimelineTextItem,
  syncTimelineActivityItems,
  upsertTimelineToolItem,
} from "../../src/lib/runtime-timeline";
import type { ToolCall, ToolResult } from "../agent-core/types";

const MAX_LIVE_TOOL_OUTPUT_CHARS = 60_000;

export function createEmptyRuntimeTrace(): ChatMessageRuntimeTrace {
  return {
    events: [],
    activityItems: [],
    timelineItems: [],
    planEntries: [],
    toolCalls: [],
    terminalOutputs: {},
    thoughtText: "",
  };
}

export function refreshRuntimeTraceActivity(trace: ChatMessageRuntimeTrace) {
  trace.activityItems = buildRuntimeActivityItems(trace.toolCalls);
  trace.timelineItems = syncTimelineActivityItems(
    trace.timelineItems,
    trace.activityItems,
    (activity) => `activity-${activity.id}-${randomUUID()}`,
  );
  return trace.activityItems;
}

export function appendRuntimeTextTimelineItem(
  trace: ChatMessageRuntimeTrace,
  type: "thought" | "status",
  text: string,
) {
  trace.timelineItems = appendTimelineTextItem(
    trace.timelineItems,
    type,
    text,
    `${type}-${randomUUID()}`,
  );
}

export function appendRuntimeToolTimelineItem(trace: ChatMessageRuntimeTrace, toolCallId: string) {
  trace.timelineItems = upsertTimelineToolItem(
    trace.timelineItems,
    toolCallId,
    `tool-${toolCallId}-${randomUUID()}`,
  );
}

function toolResultIndicatesCancellation(result: ToolResult) {
  const metadata = result.metadata ?? {};
  return metadata.cancelled === true || metadata.canceled === true;
}

function toolResultIndicatesFailure(result: ToolResult) {
  const metadata = result.metadata ?? {};
  const exitCode = metadata.exitCode;
  const signal = metadata.signal;

  return (
    metadata.isError === true ||
    metadata.timedOut === true ||
    (typeof exitCode === "number" && exitCode !== 0) ||
    (typeof signal === "string" && signal.trim().length > 0)
  );
}

export function upsertRuntimeToolCallStarted(
  trace: ChatMessageRuntimeTrace,
  toolCall: ToolCall,
  rawInputJson?: string,
) {
  const existing = trace.toolCalls.find((entry) => entry.toolCallId === toolCall.id);
  const nextToolCall: ChatToolCall = {
    toolCallId: toolCall.id,
    title: toolCall.name,
    status: "in_progress",
    kind: existing?.kind ?? "other",
    content: existing?.content ?? [],
    rawInputJson,
  };
  trace.toolCalls = [
    ...trace.toolCalls.filter((entry) => entry.toolCallId !== toolCall.id),
    nextToolCall,
  ];
  return nextToolCall;
}

export function appendRuntimeToolCallInputDelta(
  trace: ChatMessageRuntimeTrace,
  input: {
    toolCallId: string;
    toolName?: string;
    inputJsonDelta?: string;
  },
): { existing: true; patch: Partial<Omit<ChatToolCall, "toolCallId">> } | { existing: false; toolCall: ChatToolCall } {
  const existing = trace.toolCalls.find((entry) => entry.toolCallId === input.toolCallId);
  const nextRawInputJson = `${existing?.rawInputJson ?? ""}${input.inputJsonDelta ?? ""}`;
  const title = input.toolName?.trim() || existing?.title || "tool";
  const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
    title,
    status: "in_progress",
    kind: existing?.kind ?? "other",
    rawInputJson: nextRawInputJson,
  };

  if (existing) {
    trace.toolCalls = trace.toolCalls.map((toolCall) =>
      toolCall.toolCallId === input.toolCallId
        ? {
            ...toolCall,
            ...patch,
            content: toolCall.content,
          }
        : toolCall,
    );
    return { existing: true, patch };
  }

  const toolCall: ChatToolCall = {
    toolCallId: input.toolCallId,
    title,
    status: "in_progress",
    kind: "other",
    content: [],
    rawInputJson: nextRawInputJson,
  };
  trace.toolCalls = [...trace.toolCalls, toolCall];
  return { existing: false, toolCall };
}

function appendLiveToolOutputText(current: string, delta: string) {
  if (!delta) {
    return current;
  }
  if (current.includes("[live output truncated]")) {
    return current;
  }

  const next = `${current}${delta}`;
  if (next.length <= MAX_LIVE_TOOL_OUTPUT_CHARS) {
    return next;
  }

  return `${next.slice(0, MAX_LIVE_TOOL_OUTPUT_CHARS)}\n[live output truncated]`;
}

export function markRuntimeToolCallFinished(
  trace: ChatMessageRuntimeTrace,
  toolCall: ToolCall,
  result: ToolResult,
  rawOutputJson?: string,
) {
  const status: ChatToolCall["status"] = toolResultIndicatesCancellation(result)
    ? "cancelled"
    : toolResultIndicatesFailure(result)
      ? "failed"
      : "completed";
  const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
    status,
    content: [{ type: "text", text: result.content }],
    rawOutputJson,
  };
  trace.toolCalls = trace.toolCalls.map((entry) =>
    entry.toolCallId === toolCall.id
      ? {
          ...entry,
          ...patch,
          content: patch.content ?? entry.content,
        }
      : entry,
  );
  return patch;
}

export function appendRuntimeToolCallOutputDelta(
  trace: ChatMessageRuntimeTrace,
  toolCall: ToolCall,
  text: string,
) {
  const existing = trace.toolCalls.find((entry) => entry.toolCallId === toolCall.id);
  if (!existing || !text) {
    return null;
  }

  const content = [...existing.content];
  const textIndex = content.findIndex((entry) => entry.type === "text");
  if (textIndex >= 0) {
    const entry = content[textIndex];
    content[textIndex] = {
      type: "text",
      text: appendLiveToolOutputText(entry.type === "text" ? entry.text : "", text),
    };
  } else {
    content.push({ type: "text", text: appendLiveToolOutputText("", text) });
  }

  const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
    status: "in_progress",
    content,
  };
  trace.toolCalls = trace.toolCalls.map((entry) =>
    entry.toolCallId === toolCall.id
      ? {
          ...entry,
          ...patch,
          content,
        }
      : entry,
  );
  return patch;
}

export function upsertRuntimePermissionToolCall(
  trace: ChatMessageRuntimeTrace,
  input: {
    toolCall: ToolCall;
    status: Extract<ChatToolCall["status"], "failed" | "pending">;
    reason: string;
    rawInputJson?: string;
  },
): { existing: true; patch: Partial<Omit<ChatToolCall, "toolCallId">> } | { existing: false; toolCall: ChatToolCall } {
  const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
    title: input.toolCall.name,
    status: input.status,
    kind: "other",
    content: [{ type: "text", text: input.reason }],
    rawInputJson: input.rawInputJson,
  };
  const existing = trace.toolCalls.some((toolCall) => toolCall.toolCallId === input.toolCall.id);

  if (existing) {
    trace.toolCalls = trace.toolCalls.map((toolCall) =>
      toolCall.toolCallId === input.toolCall.id
        ? {
            ...toolCall,
            ...patch,
            content: patch.content ?? toolCall.content,
          }
        : toolCall,
    );
    return { existing: true, patch };
  }

  const toolCall: ChatToolCall = {
    toolCallId: input.toolCall.id,
    title: input.toolCall.name,
    status: patch.status,
    kind: "other",
    content: patch.content ?? [],
    rawInputJson: patch.rawInputJson,
  };
  trace.toolCalls = [...trace.toolCalls, toolCall];
  return { existing: false, toolCall };
}
