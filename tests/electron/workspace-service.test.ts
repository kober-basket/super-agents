import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getAudioTranscriptionModelCandidates, WorkspaceService } from "../../electron/workspace-service";

test("audio transcription candidates prefer configured speech models before fallbacks", () => {
  const candidates = getAudioTranscriptionModelCandidates({
    id: "openai",
    name: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    temperature: 0.2,
    maxTokens: 4096,
    enabled: true,
    models: [
      { id: "gpt-5", label: "GPT-5", enabled: true },
      { id: "whisper-large-v3", label: "Whisper Large V3", enabled: true },
    ],
  });

  assert.equal(candidates[0], "whisper-large-v3");
  assert.deepEqual(candidates.slice(1, 4), [
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe",
    "whisper-1",
  ]);
});

test("workspace service imports a local skill into the workspace skill directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const sourceSkillDir = path.join(tempDir, "local-skill");
  const workspaceRoot = path.join(tempDir, "workspace");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  await mkdir(sourceSkillDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    path.join(sourceSkillDir, "SKILL.md"),
    ["---", "name: local-helper", "description: Imported from disk", "---", "", "# local-helper"].join("\n"),
    "utf8",
  );

  try {
    await service.updateConfig({ workspaceRoot });

    const result = await service.importLocalSkill(sourceSkillDir);
    const importedPath = path.join(workspaceRoot, ".codex", "skills", "local-skill", "SKILL.md");

    await access(importedPath);
    assert.equal(result.importedSkillName, "local-helper");
    assert.equal(result.importedTo, path.dirname(importedPath));
    assert.equal(
      result.bootstrap.config.skills.some(
        (skill) => skill.kind === "codex" && skill.name === "local-helper" && skill.sourcePath === path.dirname(importedPath),
      ),
      true,
    );
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service rejects local skill directories without SKILL.md", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const sourceSkillDir = path.join(tempDir, "invalid-skill");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  await mkdir(sourceSkillDir, { recursive: true });
  await writeFile(path.join(sourceSkillDir, "README.md"), "# not a skill", "utf8");

  try {
    await assert.rejects(
      service.importLocalSkill(sourceSkillDir),
      /SKILL\.md/,
    );
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});
