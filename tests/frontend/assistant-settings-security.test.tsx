import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AssistantSettings } from "../../src/features/settings/AssistantSettings";
import type { ModelProviderConfig } from "../../src/types";

const provider: ModelProviderConfig = {
  id: "provider-1",
  name: "OpenAI",
  kind: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-secret-value",
  temperature: 0.7,
  maxTokens: 4096,
  enabled: true,
  models: [
    {
      id: "gpt-test",
      label: "GPT Test",
      enabled: true,
      capabilities: { tools: true },
    },
  ],
};

test("assistant settings masks provider API keys by default", () => {
  const html = renderToStaticMarkup(
    <AssistantSettings
      activeModel={null}
      composerModelId=""
      modelProviders={[provider]}
      providerRefreshingId={null}
      selectedModelProviderId={provider.id}
      selectableModels={[]}
      onAddModelProvider={() => undefined}
      onModelChange={() => undefined}
      onRefreshProviderModels={() => undefined}
      onRemoveModelProvider={() => undefined}
      onReorderModelProviders={() => undefined}
      onSelectProvider={() => undefined}
      onSetDefaultProviderModel={() => undefined}
      onSetProviderModelsEnabled={() => undefined}
      onToggleProviderModel={() => undefined}
      onUpdateModelProvider={() => undefined}
    />,
  );

  assert.match(html, /type="password"/);
  assert.match(html, /aria-label="显示接口密钥"/);
  assert.doesNotMatch(html, /type="text"[^>]*value="sk-secret-value"/);
});

test("assistant settings explains builtin providers cannot be renamed or removed", () => {
  const html = renderToStaticMarkup(
    <AssistantSettings
      activeModel={null}
      composerModelId=""
      modelProviders={[{ ...provider, system: true }]}
      providerRefreshingId={null}
      selectedModelProviderId={provider.id}
      selectableModels={[]}
      onAddModelProvider={() => undefined}
      onModelChange={() => undefined}
      onRefreshProviderModels={() => undefined}
      onRemoveModelProvider={() => undefined}
      onReorderModelProviders={() => undefined}
      onSelectProvider={() => undefined}
      onSetDefaultProviderModel={() => undefined}
      onSetProviderModelsEnabled={() => undefined}
      onToggleProviderModel={() => undefined}
      onUpdateModelProvider={() => undefined}
    />,
  );

  assert.match(html, /内置提供商，可配置，但不可删除或更名。/);
});
