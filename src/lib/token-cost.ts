import type { ChatModelTokenUsage, ChatTokenUsageSummary } from "../types";

interface TokenPrice {
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  outputPerMillion: number;
  currency?: "USD" | "CNY";
  sourceLabel?: string;
}

interface TokenPriceTier extends TokenPrice {
  minInputTokensExclusive?: number;
  minInputTokensInclusive?: number;
  maxInputTokensInclusive?: number;
  maxInputTokensExclusive?: number;
}

interface TokenCostEstimate {
  costCny: number;
  knownInputTokens: number;
  knownOutputTokens: number;
  unknownTokens: number;
}

const USD_TO_CNY_RATE = 6.8;

type TokenPriceResolver = TokenPrice | ((usage: ChatModelTokenUsage, searchText: string) => TokenPrice | null);

function selectInputTokenTier(usage: ChatModelTokenUsage, tiers: TokenPriceTier[]) {
  return tiers.find((tier) => {
    if (tier.minInputTokensExclusive !== undefined && usage.inputTokens <= tier.minInputTokensExclusive) {
      return false;
    }
    if (tier.minInputTokensInclusive !== undefined && usage.inputTokens < tier.minInputTokensInclusive) {
      return false;
    }
    if (tier.maxInputTokensInclusive !== undefined && usage.inputTokens > tier.maxInputTokensInclusive) {
      return false;
    }
    if (tier.maxInputTokensExclusive !== undefined && usage.inputTokens >= tier.maxInputTokensExclusive) {
      return false;
    }
    return true;
  }) ?? null;
}

function isQwenCloud(searchText: string) {
  return /\bqianwen\b|\bqwen cloud\b|千问云/.test(searchText);
}

function getAlibabaQwenRegion(searchText: string): "international" | "mainland" | null {
  if (isQwenCloud(searchText)) {
    return null;
  }
  if (/\binternational\b|\bsingapore\b|\bhong kong\b|\beu\b|\bunited states\b|\bus\b/.test(searchText)) {
    return "international";
  }
  if (/\balibaba cloud model studio\b|\bmodel studio\b|\balibabacloud\b|\bdashscope\b|\baliyuncs\b|\baliyun\b|\bqwen\b/.test(searchText)) {
    return "mainland";
  }
  return null;
}

const PRICE_RULES: Array<{ match: RegExp; price: TokenPriceResolver }> = [
  { match: /\bgpt-5\.5\b/, price: { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 } },
  { match: /\bgpt-5\.4-mini\b/, price: { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 } },
  { match: /\bgpt-5\.4-nano\b/, price: { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 } },
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
  {
    match: /\bqwen3(?:[.-]\d+)?-max\b/,
    price: (usage, searchText) => {
      const region = getAlibabaQwenRegion(searchText);
      if (!region) {
        return null;
      }
      const tiers = region === "international" ? [
        {
          maxInputTokensInclusive: 32_000,
          inputPerMillion: 1.2,
          cachedInputPerMillion: 0.24,
          outputPerMillion: 6,
          sourceLabel: "Alibaba Cloud Model Studio International 0<Token≤32K；隐式缓存按 20% 估算",
        },
        {
          minInputTokensExclusive: 32_000,
          maxInputTokensInclusive: 128_000,
          inputPerMillion: 2.4,
          cachedInputPerMillion: 0.48,
          outputPerMillion: 12,
          sourceLabel: "Alibaba Cloud Model Studio International 32K<Token≤128K；隐式缓存按 20% 估算",
        },
        {
          minInputTokensExclusive: 128_000,
          maxInputTokensInclusive: 252_000,
          inputPerMillion: 3,
          cachedInputPerMillion: 0.6,
          outputPerMillion: 15,
          sourceLabel: "Alibaba Cloud Model Studio International 128K<Token≤252K；隐式缓存按 20% 估算",
        },
      ] : [
        {
          maxInputTokensInclusive: 32_000,
          inputPerMillion: 0.359,
          cachedInputPerMillion: 0.0718,
          outputPerMillion: 1.434,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 0<Token≤32K；隐式缓存按 20% 估算",
        },
        {
          minInputTokensExclusive: 32_000,
          maxInputTokensInclusive: 128_000,
          inputPerMillion: 0.574,
          cachedInputPerMillion: 0.1148,
          outputPerMillion: 2.294,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 32K<Token≤128K；隐式缓存按 20% 估算",
        },
        {
          minInputTokensExclusive: 128_000,
          maxInputTokensInclusive: 252_000,
          inputPerMillion: 1.004,
          cachedInputPerMillion: 0.2008,
          outputPerMillion: 4.014,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 128K<Token≤252K；隐式缓存按 20% 估算",
        },
      ];
      return selectInputTokenTier(usage, tiers);
    },
  },
  {
    match: /\bqwen-max\b/,
    price: (_usage, searchText) => {
      const region = getAlibabaQwenRegion(searchText);
      if (region === "international") {
        return {
          inputPerMillion: 1.6,
          outputPerMillion: 6.4,
          sourceLabel: "Alibaba Cloud Model Studio International",
        };
      }
      if (region === "mainland") {
        return {
          inputPerMillion: 0.345,
          outputPerMillion: 1.377,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland",
        };
      }
      return null;
    },
  },
  {
    match: /\bqwen3\.6-plus\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensInclusive: 256_000,
        inputPerMillion: 2,
        outputPerMillion: 12,
        currency: "CNY",
        sourceLabel: "Qwen Cloud qwen3.6-plus ≤256K",
      },
    ]),
  },
  {
    match: /\bqwen3\.5-plus\b/,
    price: (usage, searchText) => {
      const alibabaRegion = getAlibabaQwenRegion(searchText);
      if (alibabaRegion === "international") {
        return selectInputTokenTier(usage, [
          {
            maxInputTokensInclusive: 256_000,
            inputPerMillion: 0.4,
            outputPerMillion: 2.4,
            sourceLabel: "Alibaba Cloud Model Studio International 0<Token≤256K",
          },
          {
            minInputTokensExclusive: 256_000,
            maxInputTokensInclusive: 1_000_000,
            inputPerMillion: 0.5,
            outputPerMillion: 3,
            sourceLabel: "Alibaba Cloud Model Studio International 256K<Token≤1M",
          },
        ]);
      }
      if (alibabaRegion === "mainland") {
        return selectInputTokenTier(usage, [
          {
            maxInputTokensInclusive: 128_000,
            inputPerMillion: 0.115,
            outputPerMillion: 0.688,
            sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 0<Token≤128K",
          },
          {
            minInputTokensExclusive: 128_000,
            maxInputTokensInclusive: 256_000,
            inputPerMillion: 0.287,
            outputPerMillion: 1.72,
            sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 128K<Token≤256K",
          },
          {
            minInputTokensExclusive: 256_000,
            maxInputTokensInclusive: 1_000_000,
            inputPerMillion: 0.573,
            outputPerMillion: 3.44,
            sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 256K<Token≤1M",
          },
        ]);
      }
      return selectInputTokenTier(usage, [
        {
          maxInputTokensInclusive: 128_000,
          inputPerMillion: 0.8,
          outputPerMillion: 4.8,
          currency: "CNY",
          sourceLabel: "Qwen Cloud qwen3.5-plus ≤128K",
        },
      ]);
    },
  },
  {
    match: /\bqwen-plus\b/,
    price: (usage, searchText) => {
      const region = getAlibabaQwenRegion(searchText);
      if (!region) {
        return null;
      }
      const tiers = region === "international" ? [
        {
          maxInputTokensInclusive: 256_000,
          inputPerMillion: 0.4,
          outputPerMillion: 1.2,
          sourceLabel: "Alibaba Cloud Model Studio International 0<Token≤256K non-thinking",
        },
        {
          minInputTokensExclusive: 256_000,
          maxInputTokensInclusive: 1_000_000,
          inputPerMillion: 1.2,
          outputPerMillion: 3.6,
          sourceLabel: "Alibaba Cloud Model Studio International 256K<Token≤1M non-thinking",
        },
      ] : [
        {
          maxInputTokensInclusive: 128_000,
          inputPerMillion: 0.115,
          outputPerMillion: 0.287,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 0<Token≤128K non-thinking；thinking 输出价更高",
        },
        {
          minInputTokensExclusive: 128_000,
          maxInputTokensInclusive: 256_000,
          inputPerMillion: 0.345,
          outputPerMillion: 2.868,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 128K<Token≤256K non-thinking；thinking 输出价更高",
        },
        {
          minInputTokensExclusive: 256_000,
          maxInputTokensInclusive: 1_000_000,
          inputPerMillion: 0.689,
          outputPerMillion: 6.881,
          sourceLabel: "Alibaba Cloud Model Studio Chinese Mainland 256K<Token≤1M non-thinking；thinking 输出价更高",
        },
      ];
      return selectInputTokenTier(usage, tiers);
    },
  },
  { match: /\bqwen3\.5-flash\b/, price: { inputPerMillion: 0.2, outputPerMillion: 2, currency: "CNY", sourceLabel: "Qwen Cloud qwen3.5-flash ≤128K" } },
  { match: /\bqwen3(?:[.-]\d+)?-flash\b|\bqwen-flash\b/, price: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  {
    match: /\bglm-5\.1\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensExclusive: 32_000,
        inputPerMillion: 6,
        cachedInputPerMillion: 1.3,
        outputPerMillion: 24,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-5.1 输入长度 <32K；缓存存储限时免费",
      },
      {
        minInputTokensInclusive: 32_000,
        inputPerMillion: 8,
        cachedInputPerMillion: 2,
        outputPerMillion: 28,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-5.1 输入长度 ≥32K；缓存存储限时免费",
      },
    ]),
  },
  {
    match: /\bglm-5-turbo\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensExclusive: 32_000,
        inputPerMillion: 5,
        cachedInputPerMillion: 1.2,
        outputPerMillion: 22,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-5-Turbo 输入长度 <32K；缓存存储限时免费",
      },
      {
        minInputTokensInclusive: 32_000,
        inputPerMillion: 7,
        cachedInputPerMillion: 1.8,
        outputPerMillion: 26,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-5-Turbo 输入长度 ≥32K；缓存存储限时免费",
      },
    ]),
  },
  {
    match: /\bglm-5\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensExclusive: 32_000,
        inputPerMillion: 4,
        cachedInputPerMillion: 1,
        outputPerMillion: 18,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-5 输入长度 <32K；缓存存储限时免费",
      },
      {
        minInputTokensInclusive: 32_000,
        inputPerMillion: 6,
        cachedInputPerMillion: 1.5,
        outputPerMillion: 22,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-5 输入长度 ≥32K；缓存存储限时免费",
      },
    ]),
  },
  {
    match: /\bglm-4\.5-air\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensExclusive: 32_000,
        inputPerMillion: 0.8,
        cachedInputPerMillion: 0.16,
        outputPerMillion: 2,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-4.5-Air 输入长度 <32K、输出长度 <0.2K；缓存存储限时免费",
      },
      {
        minInputTokensInclusive: 32_000,
        maxInputTokensExclusive: 128_000,
        inputPerMillion: 1.2,
        cachedInputPerMillion: 0.24,
        outputPerMillion: 8,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-4.5-Air 输入长度 32K-128K；缓存存储限时免费",
      },
    ]),
  },
  {
    match: /\bglm-4\.7\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensExclusive: 32_000,
        inputPerMillion: 2,
        cachedInputPerMillion: 0.4,
        outputPerMillion: 8,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-4.7 输入长度 <32K、输出长度 <0.2K；缓存存储限时免费",
      },
      {
        minInputTokensInclusive: 32_000,
        maxInputTokensExclusive: 200_000,
        inputPerMillion: 4,
        cachedInputPerMillion: 0.8,
        outputPerMillion: 16,
        currency: "CNY",
        sourceLabel: "Zhipu BigModel GLM-4.7 输入长度 32K-200K；缓存存储限时免费",
      },
    ]),
  },
  { match: /\bglm-4\.(?:6|5)\b/, price: { inputPerMillion: 0.6, cachedInputPerMillion: 0.11, outputPerMillion: 2.2 } },
  { match: /\bgemini-3\.5-flash\b/, price: { inputPerMillion: 1.5, cachedInputPerMillion: 0.15, outputPerMillion: 9 } },
  {
    match: /\bgemini-3\.1-pro-preview\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensInclusive: 200_000,
        inputPerMillion: 2,
        cachedInputPerMillion: 0.2,
        outputPerMillion: 12,
        sourceLabel: "Gemini API Standard prompts ≤200K",
      },
      {
        minInputTokensExclusive: 200_000,
        inputPerMillion: 4,
        cachedInputPerMillion: 0.4,
        outputPerMillion: 18,
        sourceLabel: "Gemini API Standard prompts >200K",
      },
    ]),
  },
  { match: /\bgemini-3(?:-flash-preview)?\b/, price: { inputPerMillion: 0.5, cachedInputPerMillion: 0.05, outputPerMillion: 3 } },
  {
    match: /\bgemini-2\.5-pro\b/,
    price: (usage) => selectInputTokenTier(usage, [
      {
        maxInputTokensInclusive: 200_000,
        inputPerMillion: 1.25,
        cachedInputPerMillion: 0.125,
        outputPerMillion: 10,
        sourceLabel: "Gemini API Standard prompts ≤200K",
      },
      {
        minInputTokensExclusive: 200_000,
        inputPerMillion: 2.5,
        cachedInputPerMillion: 0.25,
        outputPerMillion: 15,
        sourceLabel: "Gemini API Standard prompts >200K",
      },
    ]),
  },
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
    return { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0, currency: "CNY" };
  }

  for (const rule of PRICE_RULES) {
    if (!rule.match.test(searchText)) {
      continue;
    }
    return typeof rule.price === "function" ? rule.price(usage, searchText) : rule.price;
  }

  return null;
}

function roundCurrency(value: number) {
  return Number(value.toFixed(12));
}

function ratePerMillionToCny(price: TokenPrice, value: number) {
  return price.currency === "CNY" ? value : value * USD_TO_CNY_RATE;
}

function estimateModelUsageCostCny(usage: ChatModelTokenUsage) {
  const price = getTokenPrice(usage);
  if (!price) {
    return null;
  }

  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const cachedInputRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  const costCny =
    (uncachedInputTokens * ratePerMillionToCny(price, price.inputPerMillion) +
      cachedInputTokens * ratePerMillionToCny(price, cachedInputRate) +
      usage.outputTokens * ratePerMillionToCny(price, price.outputPerMillion)) /
    1_000_000;

  return roundCurrency(costCny);
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

function formatModelUnitPriceLine(usage: ChatModelTokenUsage) {
  const price = getTokenPrice(usage);
  if (!price) {
    return "单价：未知";
  }

  const cachedInputRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  const parts = [
    `输入 ${formatCnyUnitPrice(ratePerMillionToCny(price, price.inputPerMillion))}`,
    price.cachedInputPerMillion === undefined
      ? null
      : `缓存 ${formatCnyUnitPrice(ratePerMillionToCny(price, cachedInputRate))}`,
    `输出 ${formatCnyUnitPrice(ratePerMillionToCny(price, price.outputPerMillion))}`,
  ].filter((part): part is string => Boolean(part));

  return `单价/百万：${parts.join(" · ")}`;
}

function formatModelPriceSourceLine(usage: ChatModelTokenUsage) {
  const price = getTokenPrice(usage);
  return price?.sourceLabel ? `价格依据：${price.sourceLabel}` : null;
}

function formatModelUsageLine(usage: ChatModelTokenUsage) {
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const reasoningOutputTokens = usage.reasoningOutputTokens ?? 0;
  const parts = [
    `输入 ${formatCompactTokenCount(usage.inputTokens)}`,
    cachedInputTokens > 0 ? `缓存 ${formatCompactTokenCount(cachedInputTokens)}` : null,
    `输出 ${formatCompactTokenCount(usage.outputTokens)}`,
    reasoningOutputTokens > 0 ? `推理 ${formatCompactTokenCount(reasoningOutputTokens)}` : null,
  ].filter((part): part is string => Boolean(part));

  return `用量：${parts.join(" · ")}`;
}

function formatModelUsageTitle(usage: ChatModelTokenUsage) {
  const modelName = usage.modelLabel || usage.modelId || usage.providerName || usage.providerId || "未知模型";
  const cost = estimateModelUsageCostCny(usage);
  const suffix = cost === null ? "价格未知" : `估算：${formatCnyAmount(cost)}`;

  return [
    modelName,
    formatModelUsageLine(usage),
    formatModelUnitPriceLine(usage),
    formatModelPriceSourceLine(usage),
    suffix,
  ].filter((line): line is string => Boolean(line)).join("\n");
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
