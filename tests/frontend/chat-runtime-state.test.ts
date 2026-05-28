import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyConversationRuntimeState,
  mergeStartedConversationRuntimeState,
  resetConversationRuntimeStateForTurn,
} from "../../src/lib/chat-runtime-state";
import type { ChatConversationRuntimeState } from "../../src/types";

function runningStateWithTool(): ChatConversationRuntimeState {
  return {
    ...createEmptyConversationRuntimeState("running"),
    events: [
      {
        id: "tool-start-event",
        timestamp: 1,
        type: "tool_call_started",
        toolCallId: "tool-write",
        toolName: "write",
      },
    ],
    timelineItems: [
      {
        id: "tool-start-timeline",
        type: "tool",
        toolCallId: "tool-write",
      },
    ],
    toolCalls: [
      {
        toolCallId: "tool-write",
        title: "write",
        status: "in_progress",
        kind: "other",
        content: [],
        rawInputJson: JSON.stringify({ path: "note.txt", content: "ok" }),
      },
    ],
  };
}

test("started conversation runtime state preserves early tool events for real conversation id", () => {
  const earlyState = runningStateWithTool();
  const merged = mergeStartedConversationRuntimeState(
    {
      "real-conversation": earlyState,
    },
    {
      conversationId: "real-conversation",
      replaceConversationId: "temp-conversation",
    },
  );

  assert.equal(merged["real-conversation"]?.toolCalls[0]?.toolCallId, "tool-write");
  assert.equal(merged["real-conversation"]?.events[0]?.type, "tool_call_started");
  assert.equal(merged["real-conversation"]?.status, "running");
});

test("new turn runtime state reset drops stale live message deltas", () => {
  const previousState: ChatConversationRuntimeState = {
    ...createEmptyConversationRuntimeState("idle"),
    events: [
      {
        id: "old-message",
        timestamp: 1,
        type: "message_delta",
        text: "Previous reply must not appear in the next turn.",
      },
    ],
    timelineItems: [
      {
        id: "old-status",
        type: "status",
        text: "Previous status",
      },
    ],
  };

  const reset = resetConversationRuntimeStateForTurn(
    {
      "same-conversation": previousState,
    },
    "same-conversation",
  );

  assert.equal(reset["same-conversation"]?.status, "running");
  assert.deepEqual(reset["same-conversation"]?.events, []);
  assert.deepEqual(reset["same-conversation"]?.timelineItems, []);
  assert.deepEqual(reset["same-conversation"]?.toolCalls, []);
});

test("started conversation runtime state moves optimistic temp state to real conversation id", () => {
  const tempState = runningStateWithTool();
  const merged = mergeStartedConversationRuntimeState(
    {
      "temp-conversation": tempState,
    },
    {
      conversationId: "real-conversation",
      replaceConversationId: "temp-conversation",
    },
  );

  assert.equal(merged["temp-conversation"], undefined);
  assert.equal(merged["real-conversation"]?.toolCalls[0]?.toolCallId, "tool-write");
  assert.equal(merged["real-conversation"]?.timelineItems[0]?.type, "tool");
});
