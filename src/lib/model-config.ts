import type { ModelProviderConfig, ProviderModelConfig, RuntimeModelOption } from "../types";
import { enrichProviderModel } from "./model-metadata";

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

export function normalizeProviderModels(models: ProviderModelConfig[], providerId?: string) {
  const seen = new Set<string>();
  const next: ProviderModelConfig[] = [];

  for (const item of models) {
    const modelId = item.id.trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    next.push(
      enrichProviderModel({
        id: modelId,
        label: item.label.trim() || modelId,
        enabled: item.enabled !== false,
        vendor: item.vendor?.trim() || undefined,
        group: item.group?.trim() || undefined,
        description: item.description?.trim() || undefined,
        capabilities: item.capabilities
          ? {
              vision: item.capabilities.vision === true,
              tools: item.capabilities.tools === true,
              reasoning: item.capabilities.reasoning === true,
              webSearch: item.capabilities.webSearch === true,
              embedding: item.capabilities.embedding === true,
              rerank: item.capabilities.rerank === true,
              free: item.capabilities.free === true,
            }
          : undefined,
      }, { providerId }),
    );
  }

  return next.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function isEmbeddingModel(model: ProviderModelConfig) {
  if (model.capabilities?.embedding === true) {
    return true;
  }

  const haystack = `${model.id} ${model.label} ${model.description ?? ""}`.toLowerCase();
  return /embedding|embeddings|text-embedding|bge-|e5-|gte-|voyage/.test(haystack);
}

export function flattenModelProviders(modelProviders: ModelProviderConfig[]): RuntimeModelOption[] {
  return modelProviders.flatMap((provider) =>
    normalizeProviderModels(provider.models, provider.id).map((model) => ({
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
  return flattened.filter((item) => item.enabled);
}

export function getActiveModelOption(modelProviders: ModelProviderConfig[], activeModelId: string) {
  const flattened = flattenModelProviders(modelProviders);
  return flattened.find((item) => item.id === activeModelId) ?? flattened.find((item) => item.enabled) ?? null;
}

export function ensureActiveModelId(modelProviders: ModelProviderConfig[], activeModelId: string) {
  const selectable = getSelectableModels(modelProviders);
  if (selectable.some((item) => item.id === activeModelId)) {
    return activeModelId;
  }
  return selectable[0]?.id ?? "";
}
