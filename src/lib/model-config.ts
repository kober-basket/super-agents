import type { ModelProviderConfig, ProviderModelConfig, RuntimeModelOption } from "../types";

export function sanitizeModelProviderId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider";
}

export function createRuntimeModelId(providerId: string, modelId: string) {
  return `${sanitizeModelProviderId(providerId)}::${modelId.trim()}`;
}

export function normalizeProviderModels(models: ProviderModelConfig[]) {
  const seen = new Set<string>();
  const next: ProviderModelConfig[] = [];

  for (const item of models) {
    const modelId = item.id.trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    next.push({
      id: modelId,
      label: item.label.trim() || modelId,
      enabled: item.enabled !== false,
    });
  }

  return next.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function flattenModelProviders(modelProviders: ModelProviderConfig[]): RuntimeModelOption[] {
  return modelProviders.flatMap((provider) =>
    normalizeProviderModels(provider.models).map((model) => ({
      id: createRuntimeModelId(provider.id, model.id),
      label: `${provider.name} / ${model.label}`,
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      providerEnabled: provider.enabled !== false,
      modelId: model.id,
      modelLabel: model.label,
      enabled: provider.enabled !== false && model.enabled !== false,
    })),
  );
}

export function getSelectableModels(modelProviders: ModelProviderConfig[]) {
  const flattened = flattenModelProviders(modelProviders);
  const enabled = flattened.filter((item) => item.enabled);
  return enabled.length > 0 ? enabled : flattened;
}

export function getActiveModelOption(modelProviders: ModelProviderConfig[], activeModelId: string) {
  const flattened = flattenModelProviders(modelProviders);
  return flattened.find((item) => item.id === activeModelId) ?? flattened[0] ?? null;
}

export function ensureActiveModelId(modelProviders: ModelProviderConfig[], activeModelId: string) {
  const selectable = getSelectableModels(modelProviders);
  if (selectable.some((item) => item.id === activeModelId)) {
    return activeModelId;
  }
  return selectable[0]?.id ?? "";
}
