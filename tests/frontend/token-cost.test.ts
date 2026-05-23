import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateChatTokenUsageCost,
  formatChatTokenUsageBadge,
} from "../../src/lib/token-cost";
import type { ChatTokenUsageSummary } from "../../src/types";

test("token cost estimation uses model-specific input, cached input, and output rates", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 300,
    totalTokens: 1500,
    modelUsages: [
      {
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5-mini",
        modelLabel: "GPT-5 Mini",
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 300,
        totalTokens: 1500,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.005814,
    knownInputTokens: 1200,
    knownOutputTokens: 300,
    unknownTokens: 0,
  });
});

test("token usage badge formats compact totals and RMB cost with model unit prices", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 300,
    totalTokens: 1500,
    modelUsages: [
      {
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5-mini",
        modelLabel: "GPT-5 Mini",
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 300,
        totalTokens: 1500,
      },
    ],
  };

  assert.deepEqual(formatChatTokenUsageBadge(usage), {
    label: "1.5K tokens · ¥0.0058",
    title: [
      "GPT-5 Mini",
      "用量：输入 1.2K · 缓存 200 · 输出 300",
      "单价/百万：输入 ¥1.70 · 缓存 ¥0.17 · 输出 ¥13.60",
      "估算：¥0.0058",
    ].join("\n"),
  });
});

test("token usage badge keeps token counts when model price is unknown", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    modelUsages: [
      {
        providerId: "custom",
        providerName: "Custom",
        modelId: "private-model",
        modelLabel: "Private Model",
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    ],
  };

  assert.deepEqual(formatChatTokenUsageBadge(usage), {
    label: "120 tokens",
    title: [
      "Private Model",
      "用量：输入 100 · 输出 20",
      "单价：未知",
      "价格未知",
    ].join("\n"),
  });
});

test("token cost estimation uses current DeepSeek v4 flash alias pricing", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1000,
    cachedInputTokens: 200,
    outputTokens: 300,
    totalTokens: 1300,
    modelUsages: [
      {
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-chat",
        modelLabel: "DeepSeek Chat",
        inputTokens: 1000,
        cachedInputTokens: 200,
        outputTokens: 300,
        totalTokens: 1300,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.001336608,
    knownInputTokens: 1000,
    knownOutputTokens: 300,
    unknownTokens: 0,
  });
});

test("token cost estimation uses current Gemini 2.5 Flash standard pricing", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1000,
    cachedInputTokens: 100,
    outputTokens: 200,
    totalTokens: 1200,
    modelUsages: [
      {
        providerId: "google",
        providerName: "Google Gemini",
        modelId: "gemini-2.5-flash",
        modelLabel: "Gemini 2.5 Flash",
        inputTokens: 1000,
        cachedInputTokens: 100,
        outputTokens: 200,
        totalTokens: 1200,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.0052564,
    knownInputTokens: 1000,
    knownOutputTokens: 200,
    unknownTokens: 0,
  });
});

test("token cost estimation uses current OpenAI GPT-5.4 nano output pricing", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1000,
    outputTokens: 1000,
    totalTokens: 2000,
    modelUsages: [
      {
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5.4-nano",
        modelLabel: "GPT-5.4 Nano",
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.00986,
    knownInputTokens: 1000,
    knownOutputTokens: 1000,
    unknownTokens: 0,
  });
});

test("token cost estimation uses current Gemini 2.5 Pro cache pricing", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1000,
    cachedInputTokens: 100,
    outputTokens: 200,
    totalTokens: 1200,
    modelUsages: [
      {
        providerId: "google",
        providerName: "Google Gemini",
        modelId: "gemini-2.5-pro",
        modelLabel: "Gemini 2.5 Pro",
        inputTokens: 1000,
        cachedInputTokens: 100,
        outputTokens: 200,
        totalTokens: 1200,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.021335,
    knownInputTokens: 1000,
    knownOutputTokens: 200,
    unknownTokens: 0,
  });
});

test("token cost estimation uses long-context tier pricing when the provider publishes tiers", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 210000,
    cachedInputTokens: 10000,
    outputTokens: 1000,
    totalTokens: 211000,
    modelUsages: [
      {
        providerId: "google",
        providerName: "Google Gemini",
        modelId: "gemini-3.1-pro-preview",
        modelLabel: "Gemini 3.1 Pro Preview",
        inputTokens: 210000,
        cachedInputTokens: 10000,
        outputTokens: 1000,
        totalTokens: 211000,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 5.5896,
    knownInputTokens: 210000,
    knownOutputTokens: 1000,
    unknownTokens: 0,
  });
});

test("token usage badge shows tier details for Alibaba Qwen international pricing", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 40000,
    outputTokens: 10000,
    totalTokens: 50000,
    modelUsages: [
      {
        providerId: "alibaba-model-studio-international",
        providerName: "Alibaba Cloud Model Studio International",
        modelId: "qwen3-max",
        modelLabel: "Qwen3 Max",
        inputTokens: 40000,
        outputTokens: 10000,
        totalTokens: 50000,
      },
    ],
  };

  assert.deepEqual(formatChatTokenUsageBadge(usage), {
    label: "50K tokens · ¥1.47",
    title: [
      "Qwen3 Max",
      "用量：输入 40K · 输出 10K",
      "单价/百万：输入 ¥16.32 · 缓存 ¥3.26 · 输出 ¥81.60",
      "价格依据：Alibaba Cloud Model Studio International 32K<Token≤128K；隐式缓存按 20% 估算",
      "估算：¥1.47",
    ].join("\n"),
  });
});

test("token cost estimation uses DashScope mainland pricing for the default Qwen provider", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1000,
    outputTokens: 1000,
    totalTokens: 2000,
    modelUsages: [
      {
        providerId: "qwen",
        providerName: "Qwen",
        modelId: "qwen-plus",
        modelLabel: "Qwen Plus",
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.0027336,
    knownInputTokens: 1000,
    knownOutputTokens: 1000,
    unknownTokens: 0,
  });
});

test("token cost estimation uses Qwen Cloud RMB pricing for qwen3.6 plus", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 1000,
    outputTokens: 1000,
    totalTokens: 2000,
    modelUsages: [
      {
        providerId: "qianwen",
        providerName: "Qwen Cloud",
        modelId: "qwen3.6-plus",
        modelLabel: "Qwen3.6 Plus",
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
      },
    ],
  };

  assert.deepEqual(estimateChatTokenUsageCost(usage), {
    costCny: 0.014,
    knownInputTokens: 1000,
    knownOutputTokens: 1000,
    unknownTokens: 0,
  });
});

test("token usage badge uses current BigModel GLM-5.1 tiered RMB pricing", () => {
  const usage: ChatTokenUsageSummary = {
    inputTokens: 33000,
    cachedInputTokens: 1000,
    outputTokens: 1000,
    totalTokens: 34000,
    modelUsages: [
      {
        providerId: "zhipu",
        providerName: "Zhipu AI",
        modelId: "glm-5.1",
        modelLabel: "GLM-5.1",
        inputTokens: 33000,
        cachedInputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 34000,
      },
    ],
  };

  assert.deepEqual(formatChatTokenUsageBadge(usage), {
    label: "34K tokens · ¥0.286",
    title: [
      "GLM-5.1",
      "用量：输入 33K · 缓存 1K · 输出 1K",
      "单价/百万：输入 ¥8.00 · 缓存 ¥2.00 · 输出 ¥28.00",
      "价格依据：Zhipu BigModel GLM-5.1 输入长度 ≥32K；缓存存储限时免费",
      "估算：¥0.286",
    ].join("\n"),
  });
});
