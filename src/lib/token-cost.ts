import type { ChatModelTokenUsage, ChatTokenUsageSummary } from "../types";

interface TokenPrice {
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  outputPerMillion: number;
}

interface TokenCostEstimate {
  costCny: number;
  knownInputTokens: number;
  knownOutputTokens: number;
  unknownTokens: number;
}

const USD_TO_CNY_RATE = 6.8;

const PRICE_RULES: Array<{ match: RegExp; price: TokenPrice }> = [
  { match: /\bgpt-5\.5\b/, price: { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 } },
  { match: /\bgpt-5\.4-mini\b/, price: { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 } },
  { match: /\bgpt-5\.4-nano\b/, price: { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.2 } },
  { match: /\bgpt-5\.4\b/, price: { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 } },
  { match: /\bgpt-5\.2(?:-chat-latest|-codex)?\b/, price: { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, outputPerMillion: 14 } },
  { match: /\bgpt-5\.1-codex-mini\b/, price: { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2 } },
  { match: /\bgpt-5\.1(?:-chat-latest|-codex(?:-max|-mini)?)?\b/, price: { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 } },
  { match: /\bgpt-5-mini\b/, price: { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2 } },
  { match: /\bgpt-5-nano\b/, price: { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.4 } },
  { match: /\bgpt-5(?:-chat-latest|-codex)?\b/, price: { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 } },
  { match: /\bgpt-4\.1-mini\b/, price: { inputPerMillion: 0.4, cachedInputPerMillion: 0.1, outputPerMillion: 1.6 } },
  { match: /\bgpt-4\.1-nano\b/, price: { inputPerMillion: 0.1, cachedInputPerMillion: 0.025, outputPerMillion: 0.4 } },
  { match: /\bgpt-4\.1\b/, price: { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 } },
  { match: /\bgpt-4o-mini\b/, price: { inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.6 } },
  { match: /\bgpt-4o\b/, price: { inputPerMillion: 2.5, cachedInputPerMillion: 1.25, outputPerMillion: 10 } },
  { match: /\bo4-mini\b/, price: { inputPerMillion: 1.1, cachedInputPerMillion: 0.275, outputPerMillion: 4.4 } },
  { match: /\bo3\b/, price: { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 } },
  { match: /\bcodex-mini-latest\b/, price: { inputPerMillion: 1.5, cachedInputPerMillion: 0.375, outputPerMillion: 6 } },
  { match: /\bclaude[-\s]+opus[-\s]+4[-.]?(?:7|6|5)\b/, price: { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 25 } },
  { match: /\bclaude[-\s]+opus[-\s]+4\b/, price: { inputPerMillion: 15, cachedInputPerMillion: 1.5, outputPerMillion: 75 } },
  { match: /\bclaude[-\s]+sonnet[-\s]+4[-.]?(?:6|5)?\b/, price: { inputPerMillion: 3, cachedInputPerMillion: 0.3, outputPerMillion: 15 } },
  { match: /\bclaude[-\s]+haiku[-\s]+4[-.]?5\b/, price: { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 5 } },
  { match: /\bdeepseek-v4-pro\b/, price: { inputPerMillion: 0.435, cachedInputPerMillion: 0.003625, outputPerMillion: 0.87 } },
  { match: /\bdeepseek-v4-flash\b|\bdeepseek-chat\b|\bdeepseek-reasoner\b/, price: { inputPerMillion: 0.14, cachedInputPerMillion: 0.0028, outputPerMillion: 0.28 } },
  { match: /\bqwen3(?:[.-]\d+)?-max\b/, price: { inputPerMillion: 1.2, outputPerMillion: 6 } },
  { match: /\bqwen-max\b/, price: { inputPerMillion: 1.6, outputPerMillion: 6.4 } },
  { match: /\bqwen3\.6-plus\b/, price: { inputPerMillion: 0.5, outputPerMillion: 3 } },
  { match: /\bqwen3\.5-plus\b/, price: { inputPerMillion: 0.4, outputPerMillion: 2.4 } },
  { match: /\bqwen-plus\b/, price: { inputPerMillion: 0.4, outputPerMillion: 1.2 } },
  { match: /\bqwen3(?:[.-]\d+)?-flash\b|\bqwen-flash\b/, price: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { match: /\bglm-5\.1\b/, price: { inputPerMillion: 1.4, cachedInputPerMillion: 0.26, outputPerMillion: 4.4 } },
  { match: /\bglm-5(?:-turbo)?\b/, price: { inputPerMillion: 1, cachedInputPerMillion: 0.2, outputPerMillion: 3.2 } },
  { match: /\bglm-4\.5-air\b/, price: { inputPerMillion: 0.2, cachedInputPerMillion: 0.03, outputPerMillion: 1.1 } },
  { match: /\bglm-4\.(?:7|6|5)\b/, price: { inputPerMillion: 0.6, cachedInputPerMillion: 0.11, outputPerMillion: 2.2 } },
  { match: /\bgemini-3\.5-flash\b/, price: { inputPerMillion: 1.5, cachedInputPerMillion: 0.15, outputPerMillion: 9 } },
  { match: /\bgemini-3\.1-pro-preview\b/, price: { inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 12 } },
  { match: /\bgemini-3(?:-flash-preview)?\b/, price: { inputPerMillion: 0.5, cachedInputPerMillion: 0.05, outputPerMillion: 3 } },
  { match: /\bgemini-2\.5-pro\b/, price: { inputPerMillion: 1.25, cachedInputPerMillion: 0.31, outputPerMillion: 10 } },
  { match: /\bgemini-2\.5-flash-lite\b/, price: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.4 } },
  { match: /\bgemini-2\.5-flash\b/, price: { inputPerMillion: 0.3, cachedInputPerMillion: 0.03, outputPerMillion: 2.5 } },
];

function usageSearchText(usage: ChatModelTokenUsage) {
  return [
    usage.providerId,
    usage.providerName,
    usage.modelId,
    usage.modelLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getTokenPrice(usage: ChatModelTokenUsage): TokenPrice | null {
  const searchText = usageSearchText(usage);
  if (/\bollama\b/.test(searchText)) {
    return { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 };
  }

  return PRICE_RULES.find((rule) => rule.match.test(searchText))?.price ?? null;
}

function roundCurrency(value: number) {
  return Number(value.toFixed(12));
}

function usdToCny(value: number) {
  return roundCurrency(value * USD_TO_CNY_RATE);
}

function estimateModelUsageCostCny(usage: ChatModelTokenUsage) {
  const price = getTokenPrice(usage);
  if (!price) {
    return null;
  }

  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const cachedInputRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  const costUsd =
    (uncachedInputTokens * price.inputPerMillion +
      cachedInputTokens * cachedInputRate +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000;

  return usdToCny(costUsd);
}

export function estimateChatTokenUsageCost(usage: ChatTokenUsageSummary | undefined): TokenCostEstimate | null {
  if (!usage || usage.totalTokens <= 0) {
    return null;
  }

  let costCny = 0;
  let knownInputTokens = 0;
  let knownOutputTokens = 0;
  let unknownTokens = 0;

  for (const modelUsage of usage.modelUsages) {
    const modelCost = estimateModelUsageCostCny(modelUsage);
    if (modelCost === null) {
      unknownTokens += modelUsage.totalTokens;
      continue;
    }

    costCny += modelCost;
    knownInputTokens += modelUsage.inputTokens;
    knownOutputTokens += modelUsage.outputTokens;
  }

  return {
    costCny: roundCurrency(costCny),
    knownInputTokens,
    knownOutputTokens,
    unknownTokens,
  };
}

function trimFixed(value: number, digits: number) {
  return Number(value.toFixed(digits)).toString();
}

export function formatCompactTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${trimFixed(value / 1_000_000, 1)}M`;
  }
  if (value >= 1_000) {
    return `${trimFixed(value / 1_000, 1)}K`;
  }
  return Math.max(0, Math.round(value)).toString();
}

function formatCnyAmount(value: number) {
  if (value === 0) {
    return "¥0";
  }
  if (value > 0 && value < 0.0001) {
    return "¥<0.0001";
  }
  if (value < 0.01) {
    return `¥${value.toFixed(4)}`;
  }
  if (value < 1) {
    return `¥${value.toFixed(3)}`;
  }
  return `¥${value.toFixed(2)}`;
}

function formatCnyUnitPrice(value: number) {
  if (value === 0) {
    return "¥0";
  }
  if (value > 0 && value < 0.0001) {
    return "¥<0.0001";
  }
  if (value < 0.01) {
    return `¥${value.toFixed(4)}`;
  }
  if (value < 0.1) {
    return `¥${value.toFixed(3)}`;
  }
  return `¥${value.toFixed(2)}`;
}

function formatModelUnitPrice(usage: ChatModelTokenUsage) {
  const price = getTokenPrice(usage);
  if (!price) {
    return "未知";
  }

  const cachedInputRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  return [
    `输入 ${formatCnyUnitPrice(usdToCny(price.inputPerMillion))}/M`,
    `缓存 ${formatCnyUnitPrice(usdToCny(cachedInputRate))}/M`,
    `输出 ${formatCnyUnitPrice(usdToCny(price.outputPerMillion))}/M`,
  ].join("、");
}

function formatModelUsageTitle(usage: ChatModelTokenUsage) {
  const modelName = usage.modelLabel || usage.modelId || usage.providerName || usage.providerId || "未知模型";
  const cost = estimateModelUsageCostCny(usage);
  const unitPrice = formatModelUnitPrice(usage);
  const suffix = cost === null ? "价格未知" : `估算：${formatCnyAmount(cost)}`;

  return [
    modelName,
    [
      `用量：输入 ${formatCompactTokenCount(usage.inputTokens)}`,
      `缓存 ${formatCompactTokenCount(usage.cachedInputTokens ?? 0)}`,
      `输出 ${formatCompactTokenCount(usage.outputTokens)}`,
      `推理 ${formatCompactTokenCount(usage.reasoningOutputTokens ?? 0)}`,
    ].join("，"),
    `单价：${unitPrice}`,
    suffix,
  ].join("\n");
}

export function formatChatTokenUsageBadge(usage: ChatTokenUsageSummary | undefined) {
  if (!usage || usage.totalTokens <= 0) {
    return null;
  }

  const estimate = estimateChatTokenUsageCost(usage);
  const costLabel = estimate && estimate.knownInputTokens + estimate.knownOutputTokens > 0
    ? ` · ${formatCnyAmount(estimate.costCny)}`
    : "";

  return {
    label: `${formatCompactTokenCount(usage.totalTokens)} tokens${costLabel}`,
    title: usage.modelUsages.map(formatModelUsageTitle).join("\n\n"),
  };
}
