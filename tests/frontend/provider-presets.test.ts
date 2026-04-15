import assert from "node:assert/strict";
import test from "node:test";

import {
  getDefaultModelProviders,
  getNextModelProvider,
} from "../../src/lib/provider-presets";

test("default provider presets cover popular hosted and local providers", () => {
  const providers = getDefaultModelProviders();

  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["openai", "anthropic", "openrouter", "qwen", "z-ai", "deepseek", "volcengine", "ollama"],
  );
  assert.equal(providers[0]?.baseUrl, "https://api.openai.com/v1");
  assert.equal(providers[1]?.baseUrl, "https://api.anthropic.com/v1");
  assert.equal(providers[7]?.baseUrl, "http://localhost:11434/v1");
});

test("next provider helper prefers the next missing preset before falling back to custom", () => {
  const defaults = getDefaultModelProviders();

  const nextPreset = getNextModelProvider([defaults[0]!], "provider-123");
  assert.equal(nextPreset.id, "anthropic");

  const custom = getNextModelProvider(defaults, "provider-123");
  assert.equal(custom.id, "provider-123");
  assert.equal(custom.name, "Custom Provider");
  assert.equal(custom.baseUrl, "https://api.example.com/v1");
});

