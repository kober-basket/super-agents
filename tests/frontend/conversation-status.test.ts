import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSidebarConversationRunStatus,
  shouldApplyStartedConversationAsActive,
} from "../../src/features/navigation/conversation-status";

test("sidebar status treats persisted completion as completed", () => {
  assert.equal(resolveSidebarConversationRunStatus(undefined, false, true), "completed");
  assert.equal(resolveSidebarConversationRunStatus(undefined, false, false), "idle");
});

test("active runtime state takes priority over persisted completion", () => {
  assert.equal(resolveSidebarConversationRunStatus({ status: "running" } as any, false, true), "running");
  assert.equal(resolveSidebarConversationRunStatus({ status: "failed" } as any, false, true), "completed");
  assert.equal(resolveSidebarConversationRunStatus({ status: "idle", stopReason: "cancelled" } as any, false, true), "completed");
});

test("a start response does not re-open conversation A after the user switched to B", () => {
  assert.equal(shouldApplyStartedConversationAsActive("conversation-a", "conversation-a"), true);
  assert.equal(shouldApplyStartedConversationAsActive("conversation-b", "conversation-a"), false);
});
