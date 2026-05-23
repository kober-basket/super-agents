import { randomUUID } from "node:crypto";

import type { ChatMessageRuntimeTrace, ChatToolCall } from "../../src/types";
import { buildRuntimeActivityItems } from "../../src/lib/runtime-activity";
import {
  appendTimelineTextItem,
  syncTimelineActivityItems,
  upsertTimelineToolItem,
} from "../../src/lib/runtime-timeline";
import type { ToolCall, ToolResult } from "../agent-core/types";

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

function toolResultIndicatesFailure(result: ToolResult) {
  const metadata = result.metadata ?? {};
  const exitCode = metadata.exitCode;
  const signal = metadata.signal;

  return (
    metadata.cancelled === true ||
    metadata.canceled === true ||
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
  const nextToolCall: ChatToolCall = {
    toolCallId: toolCall.id,
    title: toolCall.name,
    status: "in_progress",
    kind: "other",
    content: [],
    rawInputJson,
  };
  trace.toolCalls = [
    ...trace.toolCalls.filter((entry) => entry.toolCallId !== toolCall.id),
    nextToolCall,
  ];
  return nextToolCall;
}

export function markRuntimeToolCallFinished(
  trace: ChatMessageRuntimeTrace,
  toolCall: ToolCall,
  result: ToolResult,
  rawOutputJson?: string,
) {
  const patch: Partial<Omit<ChatToolCall, "toolCallId">> = {
    status: toolResultIndicatesFailure(result) ? "failed" : "completed",
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
