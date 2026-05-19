import { randomUUID } from "node:crypto";

import type { ChatTurnEventLogEntry, ChatTurnEventLogType } from "../../src/types";
import type { AgentEvent } from "../agent-core/types";

function stringifyJson(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class TurnEventLog {
  private readonly entries: ChatTurnEventLogEntry[];

  constructor(entries: ChatTurnEventLogEntry[] = []) {
    this.entries = [...entries];
  }

  appendLifecycle(
    type: Extract<ChatTurnEventLogType, "turn_started" | "turn_failed" | "turn_cancelled">,
    payload: {
      sessionId?: string;
      agentId?: string;
      stopReason?: string;
      error?: string;
    } = {},
  ) {
    this.append({
      type,
      sessionId: payload.sessionId,
      agentId: payload.agentId,
      stopReason: payload.stopReason,
      error: payload.error,
    });
  }

  appendAgentEvent(event: AgentEvent) {
    if (event.type === "thought_delta" || event.type === "status_delta") {
      this.append({
        type: event.type,
        sessionId: event.sessionId,
        agentId: event.agentId,
        text: event.text,
      });
      return;
    }

    if (event.type === "message_delta" || event.type === "message_replace") {
      this.append({
        type: event.type,
        sessionId: event.sessionId,
        agentId: event.agentId,
        text: event.text,
      });
      return;
    }

    if (
      event.type === "tool_call_started" ||
      event.type === "permission_requested" ||
      event.type === "permission_denied"
    ) {
      this.append({
        type: event.type,
        sessionId: event.sessionId,
        agentId: event.agentId,
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        text: "reason" in event ? event.reason : undefined,
        inputJson: stringifyJson(event.toolCall.input),
      });
      return;
    }

    if (event.type === "tool_call_finished") {
      this.append({
        type: event.type,
        sessionId: event.sessionId,
        agentId: event.agentId,
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        inputJson: stringifyJson(event.toolCall.input),
        outputJson: stringifyJson(event.result),
      });
      return;
    }

    this.append({
      type: "turn_finished",
      sessionId: event.sessionId,
      agentId: event.agentId,
      stopReason: event.stopReason,
    });
  }

  snapshot() {
    return this.entries.map((entry) => ({ ...entry }));
  }

  private append(entry: Omit<ChatTurnEventLogEntry, "id" | "timestamp">) {
    this.entries.push({
      id: randomUUID(),
      timestamp: Date.now(),
      ...entry,
    });
  }
}
