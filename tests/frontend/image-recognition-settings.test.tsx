import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AssistantSettings } from "../../src/features/settings/AssistantSettings";
import type { ModelProviderConfig, RuntimeModelOption } from "../../src/types";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

const models: RuntimeModelOption[] = [
  {
    id: "main::text-model",
    label: "Main / Text Model",
    providerId: "main",
    providerName: "Main",
    providerKind: "openai-compatible",
    providerEnabled: true,
    modelId: "text-model",
    modelLabel: "Text Model",
    enabled: true,
  },
  {
    id: "vision::vision-model",
    label: "Vision / Vision Model",
    providerId: "vision",
    providerName: "Vision",
    providerKind: "openai-compatible",
    providerEnabled: true,
    modelId: "vision-model",
    modelLabel: "Vision Model",
    enabled: true,
  },
];

const provider: ModelProviderConfig = {
  id: "vision",
  name: "Vision",
  kind: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 4096,
  enabled: true,
  models: [
    {
      id: "vision-model",
      label: "Vision Model",
      enabled: true,
      capabilities: { vision: true },
    },
  ],
};

const customProvider: ModelProviderConfig = {
  ...provider,
  id: "custom-vision",
  name: "Custom Vision",
  system: false,
};

test("assistant settings expose image parsing as a simple model selector", () => {
  const html = renderToStaticMarkup(
    <AssistantSettings
      activeModel={models[0]}
      composerModelId={models[0].id}
      fallbackModelId="vision::vision-model"
      modelProviders={[provider]}
      providerRefreshingId={null}
      selectedModelProviderId={provider.id}
      selectableModels={models}
      onAddModelProvider={() => undefined}
      onFallbackModelChange={() => undefined}
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

  assert.match(html, /<h1>模型<\/h1>/);
  assert.match(html, /图片解析模型/);
  assert.match(html, /aria-label="图片解析模型"/);
  assert.match(html, /assistant-image-model-control/);
  assert.match(html, /用于非视觉模型处理图片前的内容识别/);
  assert.match(html, /Vision Model/);
  assert.doesNotMatch(html, /Vision \/ Vision Model/);
  assert.match(html, /surface-select-trigger/);
  assert.doesNotMatch(html, /未配置/);
  assert.doesNotMatch(html, /仅选择视觉模型/);
  assert.doesNotMatch(html, /智能识图/);
  assert.doesNotMatch(html, /视觉兜底/);
  assert.doesNotMatch(html, /识图接力流程/);
});

test("assistant settings use a styled model selector and source badges", () => {
  const html = renderToStaticMarkup(
    <AssistantSettings
      activeModel={models[0]}
      composerModelId={models[0].id}
      fallbackModelId="vision::vision-model"
      modelProviders={[{ ...provider, system: true }, customProvider]}
      providerRefreshingId={null}
      selectedModelProviderId={provider.id}
      selectableModels={models}
      onAddModelProvider={() => undefined}
      onFallbackModelChange={() => undefined}
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

  assert.doesNotMatch(html, /<select/);
  assert.match(html, /assistant-image-model-select/);
  assert.match(html, /provider-source-badge builtin/);
  assert.match(html, /provider-source-badge custom/);

  const source = readSource("src/features/settings/AssistantSettings.tsx");
  assert.match(source, /align="left"/);
  assert.match(source, /panelTitle="选择图片解析模型"/);
  assert.match(source, /showCheck=\{false\}/);

  const styles = readSource("src/styles.css");
  assert.match(styles, /\.assistant-image-model-control/);
  assert.match(styles, /\.assistant-title-model-hint/);
  assert.match(styles, /\.assistant-image-model-select-panel/);
  assert.match(styles, /max-height: min\(330px, 52vh\)/);
});
