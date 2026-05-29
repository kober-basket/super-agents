import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageRecognitionSettings } from "../../src/features/settings/ImageRecognitionSettings";
import type { RuntimeModelOption } from "../../src/types";

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

test("image recognition settings expose a dedicated fallback model selector", () => {
  const html = renderToStaticMarkup(
    <ImageRecognitionSettings
      fallbackModelId="vision::vision-model"
      selectableModels={models}
      onFallbackModelChange={() => undefined}
    />,
  );

  assert.match(html, /智能识图/);
  assert.match(html, /兜底识图模型/);
  assert.match(html, /Vision Model/);
  assert.match(html, /selected=""/);
  assert.doesNotMatch(html, /仅选择视觉模型/);
});
