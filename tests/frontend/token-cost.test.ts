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
      "用量：输入 1.2K，缓存 200，输出 300，推理 0",
      "单价：输入 ¥1.70/M、缓存 ¥0.17/M、输出 ¥13.60/M",
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
      "用量：输入 100，缓存 0，输出 20，推理 0",
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
