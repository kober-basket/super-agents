import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryService } from "../../electron/memory-service";

test("memory service creates, searches, updates, deletes, and formats enabled memories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-memory-"));
  const service = new MemoryService(path.join(tempDir, "memory"));

  try {
    let catalog = await service.createMemory({
      type: "user_preference",
      scope: "global",
      title: "回答语言",
      content: "用户偏好中文回答，除非明确要求英文。",
      tags: ["中文", "reply"],
    });
    catalog = await service.createMemory({
      type: "feedback_rule",
      scope: "workspace",
      workspaceRoot: tempDir,
      title: "验证规则",
      content: "声称完成前要先运行验证命令。",
      tags: ["verification"],
    });
    const disabled = await service.createMemory({
      type: "project_context",
      scope: "global",
      title: "停用背景",
      content: "这条不应进入 prompt。",
      enabled: false,
    });

    assert.equal(catalog.entries.length, 2);

    const search = await service.searchMemories({ query: "中文", workspaceRoot: tempDir });
    assert.equal(search.total, 1);
    assert.equal(search.entries[0]?.title, "回答语言");

    const workspacePrompt = await service.buildPromptContext({
      query: "完成前怎么验证？",
      workspaceRoot: tempDir,
    });
    assert.match(workspacePrompt, /Long-term memory/);
    assert.match(workspacePrompt, /回答语言/);
    assert.match(workspacePrompt, /验证规则/);
    assert.doesNotMatch(workspacePrompt, /停用背景/);

    const created = catalog.entries.find((entry) => entry.title === "验证规则");
    assert.ok(created);
    const updated = await service.updateMemory({
      id: created.id,
      title: "完成验证",
      content: "完成前必须运行对应验证。",
      tags: ["verification", "done"],
    });
    assert.equal(updated.entries.find((entry) => entry.id === created.id)?.title, "完成验证");

    const afterDelete = await service.deleteMemory(disabled.entries[0]!.id);
    assert.equal(afterDelete.entries.some((entry) => entry.title === "停用背景"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("memory service rejects secret-like memory content", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-memory-secret-"));
  const service = new MemoryService(path.join(tempDir, "memory"));

  try {
    await assert.rejects(
      () =>
        service.createMemory({
          type: "external_reference",
          scope: "global",
          title: "API key",
          content: "OPENAI_API_KEY=sk-1234567890abcdef1234567890abcdef",
        }),
      /secret|密钥/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
