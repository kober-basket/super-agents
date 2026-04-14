import assert from "node:assert/strict";
import test from "node:test";

import type * as acp from "@agentclientprotocol/sdk";

import { createDesktopAcpClient } from "../../../electron/acp/client-factory";

test("createDesktopAcpClient auto-approves permissions and delegates session updates", async () => {
  const sessionUpdates: acp.SessionNotification[] = [];
  const permissionEvents: Array<{ sessionId: string; optionId: string | null }> = [];
  const client = createDesktopAcpClient({
    resolveWorkspaceRoot: () => "C:/workspace",
    terminalManager: {
      createTerminal: async () => ({ terminalId: "term-1" }),
      terminalOutput: async () => ({ output: "", truncated: false }),
      waitForTerminalExit: async () => ({ exitCode: 0, signal: null }),
      killTerminal: async () => ({}),
      releaseTerminal: async () => ({}),
    },
    onPermissionDecision: async ({ sessionId, selectedOption }) => {
      permissionEvents.push({ sessionId, optionId: selectedOption?.optionId ?? null });
    },
    onSessionUpdate: async (payload) => {
      sessionUpdates.push(payload);
    },
  });

  const permissionResponse = await client.requestPermission({
    sessionId: "session-1",
    options: [
      { optionId: "reject", kind: "reject_once", name: "Reject" },
      { optionId: "allow", kind: "allow_once", name: "Allow" },
    ],
    toolCall: {
      toolCallId: "tool-1",
      kind: "execute",
      status: "pending",
      title: "Run shell command",
      rawInput: {},
    },
  });

  await client.sessionUpdate({
    sessionId: "session-1",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "hello",
      },
    },
  });

  assert.deepEqual(permissionResponse, {
    outcome: {
      outcome: "selected",
      optionId: "allow",
    },
  });
  assert.deepEqual(permissionEvents, [{ sessionId: "session-1", optionId: "allow" }]);
  assert.equal(sessionUpdates.length, 1);
  assert.equal(sessionUpdates[0]?.sessionId, "session-1");
  assert.equal(sessionUpdates[0]?.update.sessionUpdate, "agent_message_chunk");
});
