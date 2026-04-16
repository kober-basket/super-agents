import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceService } from "../../electron/workspace-service";

async function createWorkspaceServiceTempDir(prefix: string) {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

test("workspace service bootstraps with provider presets by default", async () => {
  const tempDir = await createWorkspaceServiceTempDir("super-agents-workspace-");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    const config = await service.getConfigSnapshot();

    assert.deepEqual(
      config.modelProviders.map((provider) => provider.id),
      ["openai", "anthropic", "openrouter", "qwen", "z-ai", "deepseek", "volcengine", "ollama"],
    );
    assert.equal(config.modelProviders.every((provider) => provider.system === true), true);
    assert.equal(config.activeModelId, "openai::gpt-5-mini");
    assert.equal(config.knowledgeBase.embeddingProviderId, "openai");
    assert.equal(config.knowledgeBase.embeddingModel, "text-embedding-3-small");
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service migrates untouched legacy iflyrpa defaults to provider presets", async () => {
  const tempDir = await createWorkspaceServiceTempDir("super-agents-workspace-");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        config: {
          activeModelId: "iflyrpa::azure/gpt-5-mini",
          modelProviders: [
            {
              id: "iflyrpa",
              name: "iFlyRpa",
              kind: "openai-compatible",
              baseUrl: "https://oneapi.iflyrpa.com/v1",
              apiKey: "sk-legacy",
              temperature: 0.2,
              maxTokens: 8192,
              enabled: true,
              models: [
                { id: "azure/gpt-5", label: "GPT-5", enabled: true },
                { id: "azure/gpt-5-mini", label: "GPT-5 Mini", enabled: true },
                { id: "azure/gpt-5-nano", label: "GPT-5 Nano", enabled: true },
                { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", enabled: true },
                { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", enabled: true },
              ],
            },
          ],
          knowledgeBase: {
            embeddingProviderId: "iflyrpa",
            embeddingModel: "text-embedding-3-small",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const config = await service.getConfigSnapshot();

    assert.equal(config.modelProviders.some((provider) => provider.id === "iflyrpa"), false);
    assert.equal(config.modelProviders[0]?.id, "openai");
    assert.equal(config.activeModelId, "openai::gpt-5-mini");
    assert.equal(config.knowledgeBase.embeddingProviderId, "openai");
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service preserves existing providers and appends missing presets", async () => {
  const tempDir = await createWorkspaceServiceTempDir("super-agents-workspace-");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        config: {
          activeModelId: "iflyrpa::imodel/minimax-m2.7",
          modelProviders: [
            {
              id: "iflyrpa",
              name: "iFlyRpa",
              kind: "openai-compatible",
              baseUrl: "https://oneapi.iflyrpa.com/v1",
              apiKey: "sk-legacy",
              temperature: 0.2,
              maxTokens: 8192,
              enabled: true,
              models: [{ id: "imodel/minimax-m2.7", label: "MiniMax M2.7", enabled: true }],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const config = await service.getConfigSnapshot();

    assert.equal(config.modelProviders[0]?.id, "iflyrpa");
    assert.equal(config.modelProviders[0]?.system, false);
    assert.equal(config.modelProviders.some((provider) => provider.id === "openai"), true);
    assert.equal(config.modelProviders.find((provider) => provider.id === "openai")?.system, true);
    assert.equal(config.modelProviders.some((provider) => provider.id === "anthropic"), true);
    assert.equal(config.activeModelId, "iflyrpa::imodel/minimax-m2.7");
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});
