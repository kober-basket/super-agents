import type { ProviderModelConfig } from "../types";

type ProviderModelCapabilities = NonNullable<ProviderModelConfig["capabilities"]>;

export interface ProviderModelMetadataHint {
  id: string;
  label?: string;
  description?: string;
  vendor?: string;
  group?: string;
  capabilities?: Partial<ProviderModelCapabilities>;
  modalities?: string[];
  supportedParameters?: string[];
  endpointTypes?: string[];
  promptPrice?: number;
  completionPrice?: number;
}

interface VendorRule {
  label: string;
  patterns: RegExp[];
}

const VENDOR_RULES: VendorRule[] = [
  {
    label: "OpenAI",
    patterns: [
      /\b(?:openai|gpt(?:-[\w.]+)?|chatgpt(?:-[\w.]+)?|o[134](?:-[\w.]+)?|gpt-oss(?:-[\w.]+)?|text-embedding(?:-[\w.]+)?|whisper(?:-[\w.]+)?|tts(?:-[\w.]+)?|dall-e(?:-[\w.]+)?|gpt-image(?:-[\w.]+)?)\b/i,
    ],
  },
  {
    label: "Anthropic",
    patterns: [/\b(?:anthropic|claude(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Google",
    patterns: [/\b(?:google|gemini(?:-[\w.]+)?|learnlm(?:-[\w.]+)?|imagen(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Qwen",
    patterns: [/\b(?:qwen(?:[\w.-]+)?|qwq(?:[\w.-]+)?|qvq(?:[\w.-]+)?)\b/i],
  },
  {
    label: "DeepSeek",
    patterns: [/\b(?:deepseek|deepseek(?:[\w.-]+)?)\b/i],
  },
  {
    label: "xAI",
    patterns: [/\b(?:xai|grok(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Mistral",
    patterns: [/\b(?:mistral|mistral(?:-[\w.]+)?|ministral(?:-[\w.]+)?|pixtral(?:-[\w.]+)?|codestral(?:-[\w.]+)?|magistral(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Zhipu",
    patterns: [/\b(?:zhipu|glm(?:-[\w.]+)?|cogview(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Moonshot",
    patterns: [/\b(?:moonshot|kimi(?:-[\w.]+)?|moonshot(?:-[\w.]+)?)\b/i],
  },
  {
    label: "ByteDance",
    patterns: [/\b(?:bytedance|doubao(?:-[\w.]+)?|seed(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Tencent",
    patterns: [/\b(?:tencent|hunyuan(?:-[\w.]+)?)\b/i],
  },
  {
    label: "MiniMax",
    patterns: [/\b(?:minimax|minimax(?:-[\w.]+)?|abab(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Meta",
    patterns: [/\b(?:meta|llama(?:-[\w.]+)?|meta-llama(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Cohere",
    patterns: [/\b(?:cohere|cohere(?:-[\w.]+)?|command(?:-[\w.]+)?|embed-english|embed-multilingual)\b/i],
  },
  {
    label: "Perplexity",
    patterns: [/\b(?:perplexity|sonar(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Jina",
    patterns: [/\b(?:jina|jina(?:-[\w.]+)?)\b/i],
  },
  {
    label: "BGE",
    patterns: [/\bbge(?:-[\w.]+)?\b/i],
  },
  {
    label: "Voyage",
    patterns: [/\b(?:voyage|voyage(?:-[\w.]+)?)\b/i],
  },
  {
    label: "Nomic",
    patterns: [/\b(?:nomic|nomic(?:-[\w.]+)?)\b/i],
  },
  {
    label: "StepFun",
    patterns: [/\b(?:stepfun|step-(?:1[ov]|2|3|r1)(?:-[\w.]+)?)\b/i],
  },
];

const GROUP_PRIORITY = new Map(VENDOR_RULES.map((rule, index) => [rule.label, index]));
const GROUP_FALLBACK_PRIORITY = 10_000;

const GENERIC_GROUP_NAMES = new Set([
  "",
  "all",
  "chat",
  "default",
  "general",
  "model",
  "models",
  "other",
  "provider",
  "text",
]);

const HOST_LIKE_GROUP_NAMES = new Set([
  "api",
  "azure",
  "bedrock",
  "dashscope",
  "github",
  "iflyrpa",
  "new api",
  "new-api",
  "newapi",
  "one api",
  "one-api",
  "oneapi",
  "openai-compatible",
  "openai compatible",
  "openrouter",
  "provider",
  "siliconflow",
  "vertex",
  "volcengine",
]);

const EMBEDDING_REGEX =
  /\b(?:embedding|embeddings|text-embedding(?:-[\w.]+)?|jina-embeddings?(?:-[\w.]+)?|voyage(?:-[\w.]+)?|nomic-embed(?:-[\w.]+)?|multilingual-e5|e5(?:-[\w.]+)?|m3e(?:-[\w.]+)?|gte(?:-[\w.]+)?|bce-embedding(?:-[\w.]+)?|all-minilm)\b/i;

const RERANK_REGEX =
  /\b(?:rerank|reranker|re-rank|bge-reranker(?:-[\w.]+)?|jina-reranker(?:-[\w.]+)?|mxbai-rerank(?:-[\w.]+)?|gte-rerank(?:-[\w.]+)?|bce-reranker(?:-[\w.]+)?)\b/i;

const VISION_REGEX =
  /\b(?:vision|multimodal|omni|llava|moondream|minicpm|internvl(?:[\w.-]+)?|pixtral(?:-[\w.]+)?|qvq(?:-[\w.]+)?|qwen(?:[\d.]+)?-vl(?:-[\w.]+)?|qwen-omni(?:-[\w.]+)?|qwen2\.5-omni(?:-[\w.]+)?|gemini(?:-[\d.]+)?-(?:flash|pro|flash-lite)(?:-(?:preview|latest))?(?:-[\w.]+)?|gemini-exp(?:-[\w.]+)?|claude-(?:3(?:-[\w.]+)?|haiku-4(?:-[\w.]+)?|sonnet-4(?:-[\w.]+)?|opus-4(?:-[\w.]+)?)|gpt-4o(?:-[\w.]+)?|chatgpt-4o(?:-[\w.]+)?|gpt-4\.1(?:-[\w.]+)?|gpt-5(?:-[\w.]+)?|o[134](?:-[\w.]+)?|grok-(?:vision|4)(?:-[\w.]+)?|glm-(?:4(?:\.\d+)?v|5v)(?:-[\w.]+)?|deepseek-vl(?:-[\w.]+)?|kimi-vl(?:-[\w.]+)?|kimi-k2\.5(?:-[\w.]+)?|doubao-(?:1[.-]5-thinking-vision-pro|seed-1[.-][68](?:-[\w.]+)?|seed-2[.-]0(?:-[\w.]+)?)|step-1[ov](?:-[\w.]+)?|llama-4(?:-[\w.]+)?|gemma-[34](?:-[\w.]+)?|mimo-v2-omni(?:-[\w.]+)?|image(?:-[\w.]+)?)\b/i;

const VISION_EXCLUSION_REGEX =
  /\b(?:o1-mini|o3-mini|o1-preview|gpt-4-32k|gpt-4-turbo-preview|gpt-4-\d{4}(?:-\d{2}-\d{2})?|gpt-4-\d+-preview)\b/i;

const TOOLS_REGEX =
  /\b(?:function(?:[_ -]?calling)?|tool(?:[_ -]?use|s)?|computer(?:[_ -]?use)?|gpt-4o(?:-[\w.]+)?|gpt-4\.1(?:-[\w.]+)?|gpt-4\.5(?:-[\w.]+)?|gpt-5(?:-[\w.]+)?|gpt-oss(?:-[\w.]+)?|o[134](?:-[\w.]+)?|claude(?:-[\w.]+)?|qwen(?!.*(?:embedding|rerank|image|mt))(?:[\w.-]+)?|gemini(?!.*(?:embedding|image|tts))(?:[\w.-]+)?|hunyuan(?:-[\w.]+)?|deepseek(?:-[\w.]+)?|glm-(?:4|5)(?:[\w.-]+)?|grok-(?:3|4)(?:-[\w.]+)?|learnlm(?:-[\w.]+)?|doubao(?:-[\w.]+)?|kimi-k2(?:\.[5-9])?(?:-[\w.]+)?|minimax-m2(?:\.[\w-]+)?|mimo-v2(?:-[\w.]+)?|llama-4(?:-[\w.]+)?)\b/i;

const REASONING_REGEX =
  /\b(?:reasoning|reasoner|thinking|deep[- ]research|qwq(?:-[\w.]+)?|qvq(?:-[\w.]+)?|o[134](?:-[\w.]+)?|gpt-5(?:-[\w.]+)?|gpt-oss(?:-[\w.]+)?|claude-(?:3[.-]7(?:-[\w.]+)?|haiku-4(?:-[\w.]+)?|sonnet-4(?:-[\w.]+)?|opus-4(?:-[\w.]+)?)|gemini-(?:2\.5|3(?:\.\d+)?)(?:-[\w.]+)?|qwen(?:3(?:\.[5-9])?-(?:max|plus|flash|turbo|\d)|3(?:[\w.-]*thinking)?|max|plus|flash|turbo)(?:-[\w.]+)?|deepseek-(?:r1|reasoner|chat|v3(?:\.\d+)?)(?:-[\w.]+)?|grok-(?:3-mini|4|4-fast)(?:-[\w.]+)?|glm-(?:zero|z1|4\.5|4\.6|4\.7|5)(?:-[\w.]+)?|hunyuan-t1(?:-[\w.]+)?|doubao-(?:1[.-]5-thinking(?:-vision-pro|-pro-m)?|seed-1[.-][68](?:-[\w.]+)?|seed-2[.-]0(?:-[\w.]+)?|seed-code(?:-[\w.]+)?)|mimo-v2(?:-[\w.]+)?|minimax-m[12](?:\.[\w-]+)?|magistral(?:-[\w.]+)?|step-(?:3|r1)(?:-[\w.]+)?|baichuan-m[23](?:-[\w.]+)?|kimi-k2(?:\.5|-thinking)?(?:-[\w.]+)?)\b/i;

const WEB_SEARCH_REGEX =
  /\b(?:web[_ -]?search|browser|internet|deep[- ]research|search-preview|search(?:-[\w.]+)?|sonar(?:-[\w.]+)?|perplexity|gpt-4o-search-preview|gpt-4o-mini-search-preview|gpt-4\.1(?:-[\w.]+)?|gpt-4o(?!-image)(?:-[\w.]+)?|gpt-5(?:-[\w.]+)?|o[34](?:-[\w.]+)?|claude-(?:3[.-](?:5|7)(?:-[\w.]+)?|haiku-4(?:-[\w.]+)?|sonnet-4(?:-[\w.]+)?|opus-4(?:-[\w.]+)?)|gemini-(?:2|3)(?:[\w.-]+)?|qwen-(?:turbo|max|plus|flash)(?:-[\w.]+)?|qwen3-max(?:-[\w.]+)?|hunyuan(?!-lite)(?:-[\w.]+)?|grok(?:-[\w.]+)?)\b/i;

const FREE_REGEX = /(^|[:/_\-\s])free($|[:/_\-\s])/i;
const IMAGE_MODALITY_REGEX = /\b(?:image|vision|multimodal|omni)\b/i;
const TOOL_PARAMETER_REGEX = /\b(?:tool|tools|function|computer[_ -]?use)\b/i;
const REASONING_PARAMETER_REGEX = /\b(?:reasoning|thinking|reasoner|reasoning_effort|max_thinking_tokens)\b/i;
const WEB_PARAMETER_REGEX = /\b(?:web[_ -]?search|browser|internet|grounding)\b/i;

function compactText(values: Array<string | undefined>) {
  return values
    .map((value) => value?.trim().toLowerCase() ?? "")
    .filter(Boolean)
    .join(" ");
}

function formatDisplayName(value: string) {
  return value
    .trim()
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ai") return "AI";
      if (lower === "gpt") return "GPT";
      if (lower === "glm") return "GLM";
      if (lower === "api") return "API";
      return part.slice(0, 1).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function firstModelSegment(id: string) {
  const segments = id
    .split(/[/:]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return "";
  }

  return segments[0];
}

function matchVendorRule(value?: string) {
  const text = value?.trim();
  if (!text) return "";

  const exact = VENDOR_RULES.find((rule) => rule.label.toLowerCase() === text.toLowerCase());
  if (exact) {
    return exact.label;
  }

  for (const rule of VENDOR_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return rule.label;
    }
  }

  return "";
}

function isLowSignalGroup(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return GENERIC_GROUP_NAMES.has(normalized) || HOST_LIKE_GROUP_NAMES.has(normalized);
}

export function inferProviderModelVendor(hint: ProviderModelMetadataHint) {
  const semanticCandidates = [
    hint.vendor,
    hint.label,
    hint.id,
    hint.description,
    hint.group,
  ];

  for (const candidate of semanticCandidates) {
    const matched = matchVendorRule(candidate);
    if (matched) {
      return matched;
    }
  }

  const fallbackCandidates = [hint.vendor, hint.group, firstModelSegment(hint.id)];
  for (const candidate of fallbackCandidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || isLowSignalGroup(trimmed)) {
      continue;
    }
    return formatDisplayName(trimmed);
  }

  return "";
}

export function inferProviderModelGroup(hint: ProviderModelMetadataHint) {
  const explicitGroup = hint.group?.trim();
  if (explicitGroup && !isLowSignalGroup(explicitGroup)) {
    return matchVendorRule(explicitGroup) || formatDisplayName(explicitGroup);
  }

  return inferProviderModelVendor(hint) || formatDisplayName(firstModelSegment(hint.id) || "Other");
}

export function inferProviderModelCapabilities(hint: ProviderModelMetadataHint) {
  const metadataText = compactText([
    ...(hint.modalities ?? []),
    ...(hint.supportedParameters ?? []),
    ...(hint.endpointTypes ?? []),
  ]);
  const searchText = compactText([
    hint.id,
    hint.label,
    hint.description,
    hint.vendor,
    hint.group,
    metadataText,
  ]);
  const explicit = hint.capabilities ?? {};

  const embedding = explicit.embedding === true || EMBEDDING_REGEX.test(searchText);
  const rerank = explicit.rerank === true || RERANK_REGEX.test(searchText);
  const retrievalOnly = embedding || rerank;

  const capabilities: ProviderModelCapabilities = {
    vision:
      explicit.vision === true ||
      (!retrievalOnly &&
        !VISION_EXCLUSION_REGEX.test(searchText) &&
        (VISION_REGEX.test(searchText) || IMAGE_MODALITY_REGEX.test(metadataText))),
    tools:
      explicit.tools === true ||
      (!retrievalOnly && (TOOLS_REGEX.test(searchText) || TOOL_PARAMETER_REGEX.test(metadataText))),
    reasoning:
      explicit.reasoning === true ||
      (!retrievalOnly && (REASONING_REGEX.test(searchText) || REASONING_PARAMETER_REGEX.test(metadataText))),
    webSearch:
      explicit.webSearch === true ||
      (!retrievalOnly && (WEB_SEARCH_REGEX.test(searchText) || WEB_PARAMETER_REGEX.test(metadataText))),
    embedding,
    rerank,
    free:
      explicit.free === true ||
      FREE_REGEX.test(searchText) ||
      (Number.isFinite(hint.promptPrice) &&
        Number.isFinite(hint.completionPrice) &&
        hint.promptPrice === 0 &&
        hint.completionPrice === 0),
  };

  return Object.values(capabilities).some(Boolean) ? capabilities : undefined;
}

export function enrichProviderModel(model: ProviderModelConfig) {
  const vendor = inferProviderModelVendor(model);
  const group = inferProviderModelGroup({ ...model, vendor: vendor || model.vendor });
  const capabilities = inferProviderModelCapabilities({
    ...model,
    vendor: vendor || model.vendor,
    group,
  });

  return {
    ...model,
    vendor: vendor || undefined,
    group,
    capabilities,
  };
}

export function compareModelGroupNames(left: string, right: string) {
  const normalizedLeft = matchVendorRule(left) || formatDisplayName(left);
  const normalizedRight = matchVendorRule(right) || formatDisplayName(right);
  const leftPriority = GROUP_PRIORITY.get(normalizedLeft) ?? GROUP_FALLBACK_PRIORITY;
  const rightPriority = GROUP_PRIORITY.get(normalizedRight) ?? GROUP_FALLBACK_PRIORITY;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return normalizedLeft.localeCompare(normalizedRight, "zh-CN", { sensitivity: "base" });
}
