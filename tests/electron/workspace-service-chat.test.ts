import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SendMessageInput } from "../../src/types";
import { WorkspaceService } from "../../electron/workspace-service";
import type { OpencodeSessionInfo, OpencodeSessionMessage } from "../../electron/opencode-runtime";

class FakeOpencodeRuntime {
  public abortSessionCalls = 0;
  public createSessionCalls = 0;
  public disposed = false;
  public listSessionsCalls = 0;
  private readonly sessions = new Map<string, OpencodeSessionInfo>();
  private readonly messages = new Map<string, OpencodeSessionMessage[]>();

  seedSession(session: OpencodeSessionInfo, messages: OpencodeSessionMessage[] = []) {
    this.sessions.set(session.id, session);
    this.messages.set(session.id, messages);
  }

  async dispose() {
    this.disposed = true;
  }

  async createSession(_config: unknown, title?: string) {
    this.createSessionCalls += 1;
    const session: OpencodeSessionInfo = {
      id: "session-1",
      title: title ?? "New chat",
      directory: "C:/workspace",
      time: {
        created: 1,
        updated: 1,
      },
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    return session;
  }

  async getSession(_config: unknown, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    return session;
  }

  async listMessages(_config: unknown, sessionId: string) {
    return this.messages.get(sessionId) ?? [];
  }

  async listSessions() {
    this.listSessionsCalls += 1;
    return Array.from(this.sessions.values()).sort((left, right) => right.time.updated - left.time.updated);
  }

  async listSessionStatuses() {
    return {
      "session-1": {
        type: "idle" as const,
      },
    };
  }

  async listQuestions() {
    return [];
  }

  async abortSession() {
    this.abortSessionCalls += 1;
    return true;
  }

  async listSkills() {
    return [];
  }

  async listMcpStatuses() {
    return [];
  }

  async promptAsync(_config: unknown, sessionId: string, message: string, _attachments: SendMessageInput["attachments"]) {
    const sessionMessages = this.messages.get(sessionId) ?? [];
    sessionMessages.push(
      {
        info: {
          id: "user-1",
          role: "user",
          sessionID: sessionId,
          time: { created: 10, completed: 10 },
        },
        parts: [{ id: "user-text", type: "text", text: message }],
      },
      {
        info: {
          id: "assistant-1",
          role: "assistant",
          sessionID: sessionId,
          time: { created: 11, completed: 12 },
        },
        parts: [{ id: "assistant-text", type: "text", text: "OK" }],
      },
    );
    this.messages.set(sessionId, sessionMessages);
  }
}

test("WorkspaceService creates and exposes a current ACP chat session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-chat-"));
  const statePath = path.join(tempRoot, "workspace.json");
  await writeFile(statePath, JSON.stringify({ config: { workspaceRoot: tempRoot } }), "utf8");

  const runtime = new FakeOpencodeRuntime();
  const service = new WorkspaceService(statePath, runtime);

  const initial = await service.bootstrap();
  assert.equal(initial.currentChat.sessionId, null);
  assert.equal(initial.currentChat.messages.length, 0);

  await service.sendMessage({
    message: "hello ACP",
    attachments: [],
  });

  const updated = await service.bootstrap();
  assert.equal(runtime.createSessionCalls, 1);
  assert.equal(updated.currentChat.sessionId, "session-1");
  assert.deepEqual(
    updated.chatSessions.map((session) => [session.id, session.title]),
    [["session-1", "hello ACP"]],
  );
  assert.deepEqual(
    updated.currentChat.messages.map((message) => [message.role, message.text]),
    [
      ["user", "hello ACP"],
      ["assistant", "OK"],
    ],
  );

  await service.shutdown();
  assert.equal(runtime.disposed, true);
});

test("WorkspaceService keeps new chat lazy until the first prompt is sent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-chat-"));
  const statePath = path.join(tempRoot, "workspace.json");
  await writeFile(
    statePath,
    JSON.stringify({
      config: { workspaceRoot: tempRoot },
      currentChatSessionId: "session-existing",
    }),
    "utf8",
  );

  const runtime = new FakeOpencodeRuntime();
  runtime.seedSession(
    {
      id: "session-existing",
      title: "Existing chat",
      directory: tempRoot,
      time: {
        created: 1,
        updated: 20,
      },
    },
    [
      {
        info: {
          id: "assistant-existing",
          role: "assistant",
          sessionID: "session-existing",
          time: { created: 5, completed: 6 },
        },
        parts: [{ id: "assistant-existing-text", type: "text", text: "Previous reply" }],
      },
    ],
  );
  const service = new WorkspaceService(statePath, runtime);

  const reset = await service.resetCurrentChat();
  assert.equal(runtime.createSessionCalls, 0);
  assert.equal(runtime.abortSessionCalls, 0);
  assert.equal(reset.currentChat.sessionId, null);
  assert.equal(reset.currentChat.messages.length, 0);

  const afterReset = await service.bootstrap();
  assert.equal(afterReset.currentChat.sessionId, null);
  assert.equal(afterReset.currentChat.messages.length, 0);
  assert.deepEqual(afterReset.chatSessions.map((session) => session.id), ["session-existing"]);

  await service.sendMessage({
    message: "fresh start",
    attachments: [],
  });

  const updated = await service.bootstrap();
  assert.equal(runtime.createSessionCalls, 1);
  assert.equal(updated.currentChat.sessionId, "session-1");
});

test("WorkspaceService lists sessions and switches the active chat to a selected session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-chat-"));
  const statePath = path.join(tempRoot, "workspace.json");
  await writeFile(statePath, JSON.stringify({ config: { workspaceRoot: tempRoot } }), "utf8");

  const runtime = new FakeOpencodeRuntime();
  runtime.seedSession(
    {
      id: "session-older",
      title: "Older chat",
      directory: tempRoot,
      time: {
        created: 1,
        updated: 10,
      },
    },
    [
      {
        info: {
          id: "older-user",
          role: "user",
          sessionID: "session-older",
          time: { created: 10, completed: 10 },
        },
        parts: [{ id: "older-user-text", type: "text", text: "First thread" }],
      },
    ],
  );
  runtime.seedSession(
    {
      id: "session-newer",
      title: "Newer chat",
      directory: tempRoot,
      time: {
        created: 2,
        updated: 20,
      },
    },
    [
      {
        info: {
          id: "newer-assistant",
          role: "assistant",
          sessionID: "session-newer",
          time: { created: 20, completed: 21 },
        },
        parts: [{ id: "newer-assistant-text", type: "text", text: "Latest thread" }],
      },
    ],
  );
  const service = new WorkspaceService(statePath, runtime);

  const initial = await service.bootstrap();
  assert.deepEqual(
    initial.chatSessions.map((session) => session.id),
    ["session-newer", "session-older"],
  );
  assert.equal(initial.currentChat.sessionId, null);

  const switched = await service.selectCurrentChatSession("session-older");
  assert.equal(switched.currentChat.sessionId, "session-older");
  assert.equal(switched.currentChat.messages[0]?.text, "First thread");
});
