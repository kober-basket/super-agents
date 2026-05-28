import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeTodoSnapshot,
  getRuntimeTodoProgress,
  shouldRenderRuntimeTodoPanel,
  summarizeRuntimeTodoCounts,
} from "../../src/lib/runtime-todos";
import type { ChatToolCall } from "../../src/types";

function toolCall(title: string, input: unknown, overrides: Partial<ChatToolCall> = {}): ChatToolCall {
  return {
    toolCallId: `${title}-1`,
    title,
    status: "completed",
    content: [],
    rawInputJson: JSON.stringify(input),
    ...overrides,
  };
}

test("runtime todo snapshot uses the latest todo_write input for progress", () => {
  const snapshot = buildRuntimeTodoSnapshot([
    toolCall("todo_write", {
      items: [
        { id: "setup", content: "Prepare fixtures", status: "completed" },
      ],
    }),
    toolCall("bash", { command: "npm test" }),
    toolCall("todo_write", {
      items: [
        { id: "setup", content: "Prepare fixtures", status: "completed" },
        { id: "impl", content: "Implement progress panel", status: "in_progress" },
        { id: "verify", content: "Run focused tests", status: "pending" },
      ],
    }, { toolCallId: "todo-write-latest", status: "in_progress" }),
  ]);

  assert.deepEqual(snapshot?.items, [
    { id: "setup", content: "Prepare fixtures", status: "completed" },
    { id: "impl", content: "Implement progress panel", status: "in_progress" },
    { id: "verify", content: "Run focused tests", status: "pending" },
  ]);
  assert.equal(snapshot?.activeToolCallId, "todo-write-latest");
  assert.equal(snapshot?.isUpdating, true);
});

test("runtime todo counts summarize each status", () => {
  const counts = summarizeRuntimeTodoCounts([
    { id: "one", content: "One", status: "completed" },
    { id: "two", content: "Two", status: "in_progress" },
    { id: "three", content: "Three", status: "pending" },
    { id: "four", content: "Four", status: "pending" },
  ]);

  assert.deepEqual(counts, {
    completed: 1,
    inProgress: 1,
    pending: 2,
    total: 4,
  });
});

test("runtime todo progress follows the active step position", () => {
  const progress = getRuntimeTodoProgress([
    { id: "one", content: "One", status: "completed" },
    { id: "two", content: "Two", status: "in_progress" },
    { id: "three", content: "Three", status: "pending" },
    { id: "four", content: "Four", status: "pending" },
    { id: "five", content: "Five", status: "pending" },
  ]);

  assert.deepEqual(progress, {
    currentStep: 2,
    ratio: 0.4,
    total: 5,
  });
});

test("runtime todo panel only renders while a turn is active", () => {
  const snapshot = buildRuntimeTodoSnapshot([
    toolCall("todo_write", {
      items: [{ id: "one", content: "One", status: "in_progress" }],
    }),
  ]);

  assert.equal(shouldRenderRuntimeTodoPanel(snapshot, { isTurnActive: true }), true);
  assert.equal(shouldRenderRuntimeTodoPanel(snapshot, { isTurnActive: false }), false);
  assert.equal(shouldRenderRuntimeTodoPanel(null, { isTurnActive: true }), false);
});
