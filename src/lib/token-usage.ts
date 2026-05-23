import type { ChatModelTokenUsage, ChatTokenUsageSummary } from "../types";

function cleanString(value: string | undefined) {
  return value?.trim() || undefined;
}

function cleanTokenCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
}

function normalizeModelUsage(usage: ChatModelTokenUsage): ChatModelTokenUsage {
  const inputTokens = cleanTokenCount(usage.inputTokens) ?? 0;
  const outputTokens = cleanTokenCount(usage.outputTokens) ?? 0;
  const totalTokens = cleanTokenCount(usage.totalTokens) ?? inputTokens + outputTokens;
  const cachedInputTokens = cleanTokenCount(usage.cachedInputTokens);
  const reasoningOutputTokens = cleanTokenCount(usage.reasoningOutputTokens);

  return {
    providerId: cleanString(usage.providerId),
    providerName: cleanString(usage.providerName),
    modelId: cleanString(usage.modelId),
    modelLabel: cleanString(usage.modelLabel),
    inputTokens,
    ...(cachedInputTokens ? { cachedInputTokens } : {}),
    outputTokens,
    ...(reasoningOutputTokens ? { reasoningOutputTokens } : {}),
    totalTokens,
  };
}

function usageKey(usage: ChatModelTokenUsage) {
  return [
    usage.providerId ?? "",
    usage.providerName ?? "",
    usage.modelId ?? "",
    usage.modelLabel ?? "",
  ].join("\u0000");
}

function sumOptional(left: number | undefined, right: number | undefined) {
  const total = (left ?? 0) + (right ?? 0);
  return total > 0 ? total : undefined;
}

function mergeModelUsage(left: ChatModelTokenUsage, right: ChatModelTokenUsage): ChatModelTokenUsage {
  return {
    providerId: left.providerId ?? right.providerId,
    providerName: left.providerName ?? right.providerName,
    modelId: left.modelId ?? right.modelId,
    modelLabel: left.modelLabel ?? right.modelLabel,
    inputTokens: left.inputTokens + right.inputTokens,
    ...(sumOptional(left.cachedInputTokens, right.cachedInputTokens)
      ? { cachedInputTokens: sumOptional(left.cachedInputTokens, right.cachedInputTokens) }
      : {}),
    outputTokens: left.outputTokens + right.outputTokens,
    ...(sumOptional(left.reasoningOutputTokens, right.reasoningOutputTokens)
      ? { reasoningOutputTokens: sumOptional(left.reasoningOutputTokens, right.reasoningOutputTokens) }
      : {}),
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function summarizeModelUsages(modelUsages: ChatModelTokenUsage[]): ChatTokenUsageSummary {
  const inputTokens = modelUsages.reduce((sum, usage) => sum + usage.inputTokens, 0);
  const cachedInputTokens = modelUsages.reduce((sum, usage) => sum + (usage.cachedInputTokens ?? 0), 0);
  const outputTokens = modelUsages.reduce((sum, usage) => sum + usage.outputTokens, 0);
  const reasoningOutputTokens = modelUsages.reduce((sum, usage) => sum + (usage.reasoningOutputTokens ?? 0), 0);
  const totalTokens = modelUsages.reduce((sum, usage) => sum + usage.totalTokens, 0);

  return {
    inputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    outputTokens,
    ...(reasoningOutputTokens > 0 ? { reasoningOutputTokens } : {}),
    totalTokens,
    modelUsages,
  };
}

export function addChatTokenUsage(
  summary: ChatTokenUsageSummary | undefined,
  usage: ChatModelTokenUsage,
): ChatTokenUsageSummary | undefined {
  const normalized = normalizeModelUsage(usage);
  if (normalized.totalTokens <= 0 && normalized.inputTokens <= 0 && normalized.outputTokens <= 0) {
    return summary;
  }

  const modelUsages = [...(summary?.modelUsages ?? [])];
  const key = usageKey(normalized);
  const index = modelUsages.findIndex((candidate) => usageKey(candidate) === key);
  if (index >= 0) {
    modelUsages[index] = mergeModelUsage(modelUsages[index]!, normalized);
  } else {
    modelUsages.push(normalized);
  }

  return summarizeModelUsages(modelUsages);
}
