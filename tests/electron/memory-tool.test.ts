import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMemoryToolDefinition } from "../../electron/agent-core/builtin-tools/memory-tool";
import type { ToolContext } from "../../electron/agent-core";
import { MemoryService } from "../../electron/memory-service";

function createContext(workspaceRoot: string): ToolContext {
  return {
    sessionId: "session-1",
    agentId: "agent-1",
    workspaceRoot,
    toolCall: { id: "memory-call", name: "memory", input: {} },
  };
}

test("memory tool lists, adds, replaces, and removes memories through the store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-memory-tool-"));
  const service = new MemoryService(path.join(tempDir, "memory"));
  const tool = createMemoryToolDefinition(service);
  const approvals: string[] = [];
  const outputChunks: Array<{ stream: string; text: string }> = [];

  try {
    const context: ToolContext = {
      ...createContext(tempDir),
      emitOutput: (output) => {
        outputChunks.push(output);
      },
      requestApproval: async (request) => {
        approvals.push(request.reason);
        return { type: "allow" };
      },
    };

    const added = await tool.execute(
      {
        action: "add",
        type: "user_preference",
        title: "回答语言",
        content: "用户偏好中文回答。",
        tags: ["中文"],
      },
      context,
    );
    assert.match(added.content, /Saved memory/);
    const createdId = String(added.metadata?.id ?? "");
    assert.ok(createdId);
    assert.equal(approvals.length, 1);

    const listed = await tool.execute({ action: "list", query: "中文" }, context);
    assert.match(listed.content, /回答语言/);
    assert.equal((listed.metadata?.entries as unknown[]).length, 1);

    const replaced = await tool.execute(
      {
        action: "replace",
        id: createdId,
        title: "回答风格",
        content: "默认用中文，回答要简洁。",
        tags: ["style"],
      },
      context,
    );
    assert.match(replaced.content, /Updated memory/);

    const removed = await tool.execute({ action: "remove", id: createdId }, context);
    assert.match(removed.content, /Removed memory/);
    assert.equal(approvals.length, 3);
    const progressText = outputChunks.map((output) => output.text).join("");
    assert.match(progressText, /Running memory action add/);
    assert.match(progressText, /Waiting for memory write approval/);
    assert.match(progressText, /Saved memory/);
    assert.match(progressText, /Searching memories/);
    assert.match(progressText, /Waiting for memory update approval/);
    assert.match(progressText, /Waiting for memory delete approval/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
