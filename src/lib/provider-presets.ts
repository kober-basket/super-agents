import type { ModelProviderConfig } from "../types";
import { sanitizeModelProviderId } from "./model-config";

const DEFAULT_PROVIDER_TEMPERATURE = 0.2;
const DEFAULT_PROVIDER_MAX_TOKENS = 8192;
const DEFAULT_CUSTOM_PROVIDER_BASE_URL = "https://api.example.com/v1";

interface ProviderPresetInput {
  id: string;
  name: string;
  baseUrl: string;
  models?: ModelProviderConfig["models"];
}

export const DEFAULT_ACTIVE_PROVIDER_ID = "openai";
export const DEFAULT_ACTIVE_MODEL_ID = "gpt-5-mini";
export const DEFAULT_EMBEDDING_PROVIDER_ID = "openai";
export const DEFAULT_EMBEDDING_MODEL_ID = "text-embedding-3-small";

const PROVIDER_PRESET_INPUTS: ProviderPresetInput[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5", label: "GPT-5", enabled: true },
      { id: "gpt-5-mini", label: "GPT-5 Mini", enabled: true },
      { id: "text-embedding-3-small", label: "Text Embedding 3 Small", enabled: true },
      { id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", enabled: true },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", enabled: true }],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [{ id: "openai/gpt-5.2", label: "GPT-5.2", enabled: true }],
  },
  {
    id: "qwen",
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", label: "Qwen Plus", enabled: true },
      { id: "qwen-max", label: "Qwen Max", enabled: true },
    ],
  },
  {
    id: "z-ai",
    name: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    models: [{ id: "glm-5.1", label: "GLM 5.1", enabled: true }],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", enabled: true },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", enabled: true },
    ],
  },
  {
    id: "volcengine",
    name: "Volcengine Ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: [],
  },
];

function cloneModels(models: ModelProviderConfig["models"]) {
  return models.map((model) => ({
    ...model,
    capabilities: model.capabilities ? { ...model.capabilities } : undefined,
  }));
}

function createProviderFromPreset(input: ProviderPresetInput): ModelProviderConfig {
  return {
    id: sanitizeModelProviderId(input.id),
    name: input.name,
    kind: "openai-compatible",
    baseUrl: input.baseUrl,
    apiKey: "",
    temperature: DEFAULT_PROVIDER_TEMPERATURE,
    maxTokens: DEFAULT_PROVIDER_MAX_TOKENS,
    enabled: true,
    system: true,
    models: cloneModels(input.models ?? []),
  };
}

export function getDefaultModelProviders() {
  return PROVIDER_PRESET_INPUTS.map(createProviderFromPreset);
}

export function mergeWithDefaultModelProviders(existingProviders: ModelProviderConfig[]) {
  const existingIds = new Set(existingProviders.map((provider) => sanitizeModelProviderId(provider.id)));
  const missingProviders = PROVIDER_PRESET_INPUTS
    .filter((provider) => !existingIds.has(sanitizeModelProviderId(provider.id)))
    .map(createProviderFromPreset);

  return [...existingProviders, ...missingProviders];
}

export function isSystemModelProviderId(providerId: string) {
  const normalizedId = sanitizeModelProviderId(providerId);
  return PROVIDER_PRESET_INPUTS.some((provider) => sanitizeModelProviderId(provider.id) === normalizedId);
}

export function createCustomModelProvider(providerId: string): ModelProviderConfig {
  return {
    id: sanitizeModelProviderId(providerId),
    name: "Custom Provider",
    kind: "openai-compatible",
    baseUrl: DEFAULT_CUSTOM_PROVIDER_BASE_URL,
    apiKey: "",
    temperature: DEFAULT_PROVIDER_TEMPERATURE,
    maxTokens: DEFAULT_PROVIDER_MAX_TOKENS,
    enabled: true,
    models: [],
  };
}

export function getNextModelProvider(existingProviders: ModelProviderConfig[], fallbackProviderId: string) {
  const existingIds = new Set(existingProviders.map((provider) => sanitizeModelProviderId(provider.id)));
  const preset = PROVIDER_PRESET_INPUTS.find((provider) => !existingIds.has(sanitizeModelProviderId(provider.id)));
  return preset ? createProviderFromPreset(preset) : createCustomModelProvider(fallbackProviderId);
}
