import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { KnowledgeService } from "../../electron/knowledge-service";

test("knowledge service updates base name and description", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-knowledge-"));
  const service = new KnowledgeService(path.join(tempDir, "knowledge"));

  try {
    const created = await service.createBase({
      name: "旧知识库",
      description: "旧描述",
    });
    const baseId = created.knowledgeBases[0]!.id;

    const updated = await service.updateBase({
      id: baseId,
      name: "产品知识库",
      description: "修改名称、描述",
    });

    assert.equal(updated.knowledgeBases[0]?.id, baseId);
    assert.equal(updated.knowledgeBases[0]?.name, "产品知识库");
    assert.equal(updated.knowledgeBases[0]?.description, "修改名称、描述");
    assert.ok(updated.knowledgeBases[0]!.updatedAt >= created.knowledgeBases[0]!.updatedAt);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
