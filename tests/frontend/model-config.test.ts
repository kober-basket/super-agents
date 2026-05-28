import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureActiveModelId,
  getSelectableModels,
} from "../../src/lib/model-config";
import type { ModelProviderConfig } from "../../src/types";

function createProvider(models: ModelProviderConfig["models"]): ModelProviderConfig {
  return {
    id: "qwen",
    name: "Qwen",
    kind: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "test-key",
    temperature: 0.2,
    maxTokens: 8192,
    enabled: true,
    models,
  };
}

test("chat model selection excludes non-chat endpoint models", () => {
  const providers = [
    createProvider([
      { id: "qwen3.6-plus", label: "Qwen3.6 Plus", enabled: true },
      { id: "text-embedding-v4", label: "Text Embedding V4", enabled: true },
      { id: "gte-rerank-v2", label: "GTE Rerank V2", enabled: true },
      { id: "qwen3-asr-flash", label: "Qwen3 ASR Flash", enabled: true },
      { id: "qwen-image", label: "Qwen Image", enabled: true },
      { id: "qwen3.5-omni-plus-realtime", label: "Qwen3.5 Omni Plus Realtime", enabled: true },
    ]),
  ];

  assert.deepEqual(
    getSelectableModels(providers).map((model) => model.modelId),
    ["qwen3.6-plus"],
  );
});

test("active chat model falls back when the stored active model is non-chat", () => {
  const providers = [
    createProvider([
      { id: "qwen3.6-plus", label: "Qwen3.6 Plus", enabled: true },
      { id: "text-embedding-v4", label: "Text Embedding V4", enabled: true },
    ]),
  ];

  assert.equal(ensureActiveModelId(providers, "qwen::text-embedding-v4"), "qwen::qwen3.6-plus");
});
