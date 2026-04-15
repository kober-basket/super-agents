import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProviderModels } from "../../src/lib/model-config";
import { getDefaultProviderModelGroup } from "../../src/lib/model-metadata";

test("model groups follow Cherry Studio slash-first grouping", () => {
  const models = normalizeProviderModels(
    [
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", enabled: true },
      { id: "qwen/qwen3-32b", label: "Qwen3 32B", enabled: true },
      { id: "BAAI/bge-m3", label: "BGE M3", enabled: true },
    ],
    "openrouter",
  );

  const groups = new Map(models.map((model) => [model.id, model.group]));
  assert.equal(groups.get("openai/gpt-5.4-mini"), "openai");
  assert.equal(groups.get("qwen/qwen3-32b"), "qwen");
  assert.equal(groups.get("BAAI/bge-m3"), "BAAI");
});

test("model groups fall back to provider id when ids have no slash", () => {
  const models = normalizeProviderModels(
    [
      { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", enabled: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", enabled: true },
    ],
    "iflyrpa",
  );

  assert.equal(models[0]?.group, "iflyrpa");
  assert.equal(models[1]?.group, "iflyrpa");
});

test("explicit stored groups are preserved", () => {
  const models = normalizeProviderModels(
    [{ id: "gpt-4.1-mini", label: "GPT-4.1 Mini", enabled: true, group: "custom-openai" }],
    "openai",
  );

  assert.equal(models[0]?.group, "custom-openai");
});

test("default group helper matches Cherry Studio's fetched-model behavior", () => {
  assert.equal(getDefaultProviderModelGroup("Pro/MiniMaxAI/MiniMax-M2.5", "silicon"), "Pro");
  assert.equal(getDefaultProviderModelGroup("deepseek-ai/DeepSeek-V3.2", "silicon"), "deepseek-ai");
  assert.equal(getDefaultProviderModelGroup("claude-4.5-sonnet", "iflyrpa"), "iflyrpa");
});
