import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mammoth from "mammoth";
import mime from "mime-types";

import {
  createRuntimeModelId,
  ensureActiveModelId,
  getActiveModelOption,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "../src/lib/model-config";
import { inferProviderModelCapabilities, inferProviderModelGroup, inferProviderModelVendor } from "../src/lib/model-metadata";
import {
  DEFAULT_ACTIVE_MODEL_ID,
  DEFAULT_ACTIVE_PROVIDER_ID,
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_EMBEDDING_PROVIDER_ID,
  getDefaultModelProviders,
  isSystemModelProviderId,
  mergeWithDefaultModelProviders,
} from "../src/lib/provider-presets";
import { DEFAULT_REMOTE_CONTROL_CONFIG, normalizeRemoteControlConfig } from "../src/lib/remote-control-config";
import { sanitizeMcpName } from "../src/features/shared/utils";
import type {
  AppConfig,
  AudioTranscriptionInput,
  AudioTranscriptionResult,
  BootstrapPayload,
  EmergencyPlanInput,
  EmergencyPlanResult,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeCatalogPayload,
  KnowledgeDeleteItemInput,
  KnowledgeSearchPayload,
  McpServerConfig,
  McpServerStatus,
  ModelProviderConfig,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  PreviewKind,
  ProjectReportInput,
  ProjectReportResult,
  ProxyConfig,
  RuntimeSkill,
  SkillConfig,
  SkillImportResult,
  WorkspaceToolCatalog,
} from "../src/types";
import {
  buildEmergencyPlanPrompt,
  createDefaultEmergencyPlanFileName,
  createEmergencyPlanDocBuffer,
  recognizeEmergencyTemplate,
  sanitizeEmergencyPlanFileName,
} from "./emergency-plan";
import { KnowledgeService } from "./knowledge-service";
import {
  buildProjectReportPrompt,
  createDefaultReportFileName,
  createProjectReportDocBuffer,
  mergeKnowledgeResults,
  resolveReportOutputPath,
  sanitizeReportFileName,
} from "./project-report";
import { readJsonFile, writeJsonFile } from "./store";

interface PersistedWorkspaceState {
  config: AppConfig;
}

const LEGACY_DEFAULT_PROVIDER_BASE_URL = "https://oneapi.iflyrpa.com/v1";
const LEGACY_DEFAULT_PROVIDER_MODEL_IDS = [
  "azure/gpt-5",
  "azure/gpt-5-mini",
  "azure/gpt-5-nano",
  "claude-4.5-sonnet",
  "gemini-2.5-pro",
].sort();

const DEFAULT_MODEL_PROVIDERS: ModelProviderConfig[] = getDefaultModelProviders();

const DEFAULT_SKILLS: SkillConfig[] = [
  {
    id: "meeting-minutes",
    name: "meeting-minutes",
    description: "Turn meeting notes into minutes and action items",
    kind: "command",
    command:
      "Please turn the following input into concise Chinese meeting minutes. Include topic, key decisions, action items, owners, and due dates.\n\nInput:\n$ARGUMENTS",
    enabled: true,
  },
  {
    id: "email-draft",
    name: "email-draft",
    description: "Draft a professional Chinese work email from requirements",
    kind: "command",
    command:
      "Draft a professional and concise Chinese work email from the following requirements. Output the subject line and the body.\n\nRequirements:\n$ARGUMENTS",
    enabled: true,
  },
  {
    id: "schedule-summary",
    name: "schedule-summary",
    description: "Summarize schedules and flag conflicts or risks",
    kind: "command",
    command:
      "Summarize the following schedule in clear Chinese. Point out time conflicts, risks, and recommended adjustments.\n\nSchedule:\n$ARGUMENTS",
    enabled: true,
  },
];

const DEFAULT_CONFIG: AppConfig = {
  workspaceRoot: "",
  bridgeUrl: "",
  environment: "local",
  defaultAgentMode: "general",
  activeModelId: createRuntimeModelId(DEFAULT_ACTIVE_PROVIDER_ID, DEFAULT_ACTIVE_MODEL_ID),
  contextTier: "high",
  appearance: { theme: "linen" },
  proxy: { http: "", https: "", bypass: "localhost,127.0.0.1" },
  modelProviders: DEFAULT_MODEL_PROVIDERS,
  mcpServers: [],
  skills: DEFAULT_SKILLS,
  hiddenCodexSkillIds: [],
  knowledgeBase: {
    enabled: false,
    embeddingProviderId: DEFAULT_EMBEDDING_PROVIDER_ID,
    embeddingModel: DEFAULT_EMBEDDING_MODEL_ID,
    selectedBaseIds: [],
    documentCount: 5,
    chunkSize: 1200,
    chunkOverlap: 160,
  },
  remoteControl: DEFAULT_REMOTE_CONTROL_CONFIG,
};

const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const INLINE_TEXT_KINDS = new Set<PreviewKind>(["text", "code", "markdown", "html"]);

function cloneDefaultConfig(): AppConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
}

function createEmptyState(): PersistedWorkspaceState {
  return { config: cloneDefaultConfig() };
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function isLegacyDefaultProviderList(modelProviders: ModelProviderConfig[]) {
  if (modelProviders.length !== 1) {
    return false;
  }

  const [provider] = modelProviders;
  if (!provider || provider.id !== "iflyrpa") {
    return false;
  }

  if (normalizeBaseUrl(provider.baseUrl) !== LEGACY_DEFAULT_PROVIDER_BASE_URL) {
    return false;
  }

  const modelIds = provider.models.map((model) => model.id).sort();
  return (
    modelIds.length === LEGACY_DEFAULT_PROVIDER_MODEL_IDS.length &&
    modelIds.every((modelId, index) => modelId === LEGACY_DEFAULT_PROVIDER_MODEL_IDS[index])
  );
}

function migrateLegacyModels(legacyModels: any[], legacyActiveModelId?: string) {
  const groups = new Map<string, { provider: ModelProviderConfig }>();
  let nextActiveModelId = "";

  for (const item of legacyModels) {
    const baseUrl = normalizeBaseUrl(String(item?.baseUrl ?? ""));
    const apiKey = String(item?.apiKey ?? "");
    const providerName = String(item?.provider ?? "").trim() || "OpenAI Compatible";
    const modelId = String(item?.model ?? "").trim();
    if (!modelId) continue;

    const groupKey = `${providerName}::${baseUrl}::${apiKey}`;
    const providerId = sanitizeModelProviderId(String(item?.id ?? "") || `${providerName}-${baseUrl}`);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        provider: {
          id: providerId,
          name: providerName,
          kind: "openai-compatible",
          baseUrl,
          apiKey,
          temperature: typeof item?.temperature === "number" ? item.temperature : 0.2,
          maxTokens: typeof item?.maxTokens === "number" ? item.maxTokens : 4096,
          enabled: item?.enabled !== false,
          models: [],
        },
      });
    }

    const target = groups.get(groupKey)!;
    target.provider.models.push({
      id: modelId,
      label: String(item?.label ?? "").trim() || modelId,
      enabled: item?.enabled !== false,
    });

    if (String(item?.id ?? "") === legacyActiveModelId) {
      nextActiveModelId = createRuntimeModelId(target.provider.id, modelId);
    }
  }

  return {
    providers: Array.from(groups.values()).map(({ provider }) => ({
      ...provider,
      models: normalizeProviderModels(provider.models, provider.id),
    })),
    activeModelId: nextActiveModelId,
  };
}

function normalizeState(state: Partial<PersistedWorkspaceState> | null | undefined): PersistedWorkspaceState {
  const rawConfig = (state?.config ?? {}) as Partial<AppConfig> & {
    customModels?: any[];
  } & Record<string, unknown>;
  const { customModels, workspaceRoot, ...restConfigWithLegacy } = rawConfig;
  const legacyWorkspaceRootKey = ["open", "codeRoot"].join("");
  const { [legacyWorkspaceRootKey]: _legacyWorkspaceRoot, ...restConfig } = restConfigWithLegacy;
  const legacyModels = Array.isArray(customModels) ? customModels.filter(Boolean) : [];
  const migratedLegacy = migrateLegacyModels(legacyModels, rawConfig.activeModelId);
  const cleanedConfig = restConfig as Partial<AppConfig>;
  const configuredProviders =
    Array.isArray(cleanedConfig.modelProviders) && cleanedConfig.modelProviders.length > 0
      ? cleanedConfig.modelProviders.map((item) => ({
          ...item,
          kind: item.kind ?? "openai-compatible",
          enabled: item.enabled !== false,
          system: item.system === true || isSystemModelProviderId(item.id),
          temperature: typeof item.temperature === "number" ? item.temperature : 0.2,
          maxTokens: typeof item.maxTokens === "number" ? item.maxTokens : 4096,
          models: normalizeProviderModels(Array.isArray(item.models) ? item.models : [], item.id),
        }))
      : null;
  const migratedFromLegacyDefaults = Boolean(configuredProviders && isLegacyDefaultProviderList(configuredProviders));
  const baseModelProviders =
    configuredProviders && configuredProviders.length > 0
      ? migratedFromLegacyDefaults
        ? cloneDefaultConfig().modelProviders
        : configuredProviders
      : migratedLegacy.providers.length > 0
        ? migratedLegacy.providers
        : cloneDefaultConfig().modelProviders;
  const modelProviders = mergeWithDefaultModelProviders(baseModelProviders);
  const preferredActiveModelId =
    migratedFromLegacyDefaults
      ? DEFAULT_CONFIG.activeModelId
      : modelProviders.some((provider) =>
            provider.models.some((model) => createRuntimeModelId(provider.id, model.id) === rawConfig.activeModelId),
          )
      ? String(rawConfig.activeModelId ?? "")
      : String(migratedLegacy.activeModelId || rawConfig.activeModelId || DEFAULT_CONFIG.activeModelId);

  return {
    config: {
      ...DEFAULT_CONFIG,
      ...cleanedConfig,
      workspaceRoot:
        typeof workspaceRoot === "string" && workspaceRoot.trim() ? workspaceRoot.trim() : DEFAULT_CONFIG.workspaceRoot,
      activeModelId: ensureActiveModelId(modelProviders, preferredActiveModelId),
      appearance: {
        ...DEFAULT_CONFIG.appearance,
        ...(rawConfig.appearance ?? {}),
      },
      proxy: {
        ...DEFAULT_CONFIG.proxy,
        ...(rawConfig.proxy ?? {}),
      },
      modelProviders,
      hiddenCodexSkillIds: Array.isArray(rawConfig.hiddenCodexSkillIds)
        ? rawConfig.hiddenCodexSkillIds.map((item) => String(item))
        : [],
      knowledgeBase: {
        ...DEFAULT_CONFIG.knowledgeBase,
        ...(rawConfig.knowledgeBase ?? {}),
        embeddingProviderId:
          typeof rawConfig.knowledgeBase?.embeddingProviderId === "string" &&
          modelProviders.some((provider) => provider.id === rawConfig.knowledgeBase?.embeddingProviderId)
            ? rawConfig.knowledgeBase.embeddingProviderId
            : DEFAULT_CONFIG.knowledgeBase.embeddingProviderId,
        embeddingModel:
          typeof rawConfig.knowledgeBase?.embeddingModel === "string" && rawConfig.knowledgeBase.embeddingModel.trim()
            ? rawConfig.knowledgeBase.embeddingModel.trim()
            : DEFAULT_CONFIG.knowledgeBase.embeddingModel,
        selectedBaseIds: Array.isArray(rawConfig.knowledgeBase?.selectedBaseIds)
          ? rawConfig.knowledgeBase.selectedBaseIds.map((item) => String(item)).filter(Boolean)
          : [],
      },
      remoteControl: normalizeRemoteControlConfig(rawConfig.remoteControl),
      mcpServers: Array.isArray(rawConfig.mcpServers) ? rawConfig.mcpServers : DEFAULT_CONFIG.mcpServers,
      skills: Array.isArray(rawConfig.skills) && rawConfig.skills.length > 0 ? rawConfig.skills : DEFAULT_CONFIG.skills,
    },
  };
}

function createModelListUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("请先填写提供商接口地址");
  }
  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
}

const DEFAULT_TRANSCRIPTION_MODEL_IDS = [
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "whisper-1",
] as const;

const TRANSCRIPTION_MODEL_REGEX =
  /\b(?:whisper(?:-[\w.]+)?|transcribe(?:-[\w.]+)?|transcription|speech[-_ ]?to[-_ ]?text|stt)\b/i;

function createOpenAiCompatibleHeaders(apiKey: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
    headers["api-key"] = apiKey.trim();
    headers["x-api-key"] = apiKey.trim();
  }
  return headers;
}

function createAudioTranscriptionUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("请先填写提供商接口地址");
  }

  return normalized.endsWith("/audio/transcriptions")
    ? normalized
    : `${normalized}/audio/transcriptions`;
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractResponseErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const directMessage =
    typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : typeof (record.error as { message?: unknown } | undefined)?.message === "string"
          ? String((record.error as { message?: unknown }).message)
          : "";

  return directMessage.trim() || fallback;
}

export function getAudioTranscriptionModelCandidates(provider: ModelProviderConfig) {
  const configured = provider.models
    .filter((model) =>
      TRANSCRIPTION_MODEL_REGEX.test(
        `${model.id} ${model.label} ${model.description ?? ""}`,
      ),
    )
    .map((model) => model.id.trim())
    .filter(Boolean);

  return Array.from(new Set([...configured, ...DEFAULT_TRANSCRIPTION_MODEL_IDS]));
}

function shouldRetryWithAnotherTranscriptionModel(status: number, message: string) {
  if (!(status === 400 || status === 404)) {
    return false;
  }

  return /(model|engine).*(not found|does not exist|unsupported|invalid)|unknown model|unsupported model/i.test(
    message,
  );
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function createChatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("请先填写提供商接口地址");
  }

  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function extractTextFromCompletionPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice =
    choices.length > 0 && choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : null;
  const message =
    firstChoice?.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : null;

  if (typeof message?.content === "string") {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        const value = part as Record<string, unknown>;
        if (typeof value.text === "string") {
          return value.text;
        }
        const nestedText =
          value.text && typeof value.text === "object" ? (value.text as Record<string, unknown>).value : undefined;
        return typeof nestedText === "string" ? nestedText : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  return "";
}

async function generateTextWithActiveModel(config: AppConfig, prompt: string): Promise<string> {
  const activeModel = getActiveModelOption(config.modelProviders, config.activeModelId);
  if (!activeModel) {
    throw new Error("请先配置可用的默认模型");
  }

  const provider = config.modelProviders.find((item) => item.id === activeModel.providerId) ?? null;
  if (!provider || provider.enabled === false) {
    throw new Error("当前默认模型所属提供商不可用");
  }
  if (provider.kind !== "openai-compatible") {
    throw new Error("当前仅支持 OpenAI 兼容模型生成报告");
  }

  const response = await fetch(createChatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createOpenAiCompatibleHeaders(provider.apiKey),
    },
    body: JSON.stringify({
      model: activeModel.modelId,
      temperature: provider.temperature,
      max_tokens: provider.maxTokens,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const rawText = await response.text();
  const parsed = safeParseJson(rawText);

  if (!response.ok) {
    throw new Error(extractResponseErrorMessage(parsed ?? rawText, "模型生成失败"));
  }

  const content = extractTextFromCompletionPayload(parsed);
  if (!content.trim()) {
    throw new Error("模型未返回有效文本内容");
  }

  return content.trim();
}

function inferVendorName(record: Record<string, unknown>, id: string, label: string, description: string, group?: string) {
  const candidates = [
    record.vendor,
    record.provider,
    record.owned_by,
    record.family,
    (record.top_provider as { name?: unknown } | undefined)?.name,
  ];
  return inferProviderModelVendor({
    id,
    label,
    description,
    group,
    vendor: candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0),
  });
}

function inferCapabilities(
  record: Record<string, unknown>,
  id: string,
  label: string,
  description: string,
  vendor?: string,
  group?: string,
) {
  const architecture =
    record.architecture && typeof record.architecture === "object"
      ? (record.architecture as Record<string, unknown>)
      : {};
  const pricing =
    record.pricing && typeof record.pricing === "object"
      ? (record.pricing as Record<string, unknown>)
      : {};

  return inferProviderModelCapabilities({
    id,
    label,
    description,
    vendor,
    group,
    modalities: [
      ...extractStringList(record.input_modalities),
      ...extractStringList(record.output_modalities),
      ...extractStringList(architecture.input_modalities),
      ...extractStringList(architecture.output_modalities),
      ...extractStringList(record.modalities),
      ...extractStringList(record.supported_modalities),
      ...extractStringList(record.supported_endpoint_types),
    ],
    supportedParameters: extractStringList(record.supported_parameters),
    endpointTypes: extractStringList(record.supported_endpoint_types),
    capabilities: record.reasoning === true ? { reasoning: true } : undefined,
    promptPrice: Number(pricing.prompt ?? pricing.input ?? Number.NaN),
    completionPrice: Number(pricing.completion ?? pricing.output ?? Number.NaN),
  });
}

function extractModelList(payload: unknown, providerId?: string) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown[] })?.models)
        ? (payload as { models: unknown[] }).models
        : [];

  return normalizeProviderModels(
    source
      .map((item) => {
        if (typeof item === "string") {
          const vendor = inferProviderModelVendor({ id: item });
          return {
            id: item,
            label: item,
            enabled: true,
            vendor: vendor || undefined,
            group: inferProviderModelGroup({ id: item, providerId }),
          };
        }
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const id = String(record.id ?? record.name ?? "").trim();
        if (!id) return null;
        const label = String(record.name ?? record.display_name ?? record.displayName ?? record.label ?? id).trim() || id;
        const description = String(record.description ?? record.summary ?? "").trim();
        const vendor = inferVendorName(record, id, label, description, String(record.group ?? "").trim());
        const group = inferProviderModelGroup({
          id,
          providerId,
          label,
          description,
          vendor,
        });
        return {
          id,
          label,
          enabled: true,
          vendor: vendor || undefined,
          group,
          description: description || undefined,
          capabilities: inferCapabilities(record, id, label, description, vendor, group),
        };
      })
      .filter(Boolean) as ModelProviderConfig["models"],
    providerId,
  );
}

async function fetchOpenAiCompatibleModelsEnhanced(input: ModelProviderFetchInput) {
  const headers = createOpenAiCompatibleHeaders(input.apiKey);

  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  const urls = [createModelListUrl(input.baseUrl)];
  if (/openrouter\.ai/i.test(normalizedBaseUrl)) {
    urls.push("https://openrouter.ai/api/v1/embeddings/models");
  }
  if (/ppio/i.test(normalizedBaseUrl)) {
    urls.push(`${normalizedBaseUrl}/models?model_type=embedding`);
    urls.push(`${normalizedBaseUrl}/models?model_type=reranker`);
  }

  const responses = await Promise.all(
    urls.map(async (url, index) => {
      const response = await fetch(url, { method: "GET", headers });
      const text = await response.text();
      if (!response.ok) {
        if (index > 0) return [];
        throw new Error(text || `Fetch models failed: ${response.status}`);
      }
      return extractModelList(text ? JSON.parse(text) : {}, input.providerId);
    }),
  );

  const models = normalizeProviderModels(responses.flat(), input.providerId);
  if (models.length === 0) {
    throw new Error("Provider responded, but no usable models were returned.");
  }
  return models;
}

function getExternalCodexSkillsRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills");
}

function getLegacyManagedCodexSkillsRoot(statePath: string) {
  return path.join(path.dirname(statePath), "skills", "codex");
}

function getProjectCodexSkillsRoot(workspaceRoot: string) {
  return path.join(workspaceRoot, ".codex", "skills");
}

function getManagedCodexSkillsRoots(statePath: string, workspaceRoot?: string) {
  const roots = [getLegacyManagedCodexSkillsRoot(statePath)];
  const normalizedWorkspaceRoot = workspaceRoot?.trim();
  if (normalizedWorkspaceRoot) {
    roots.unshift(getProjectCodexSkillsRoot(normalizedWorkspaceRoot));
  }
  return Array.from(new Set(roots));
}

function getPreferredManagedCodexSkillsRoot(statePath: string, workspaceRoot?: string) {
  return getManagedCodexSkillsRoots(statePath, workspaceRoot)[0];
}

function parseSkillFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = match?.[1] ?? "";
  const clean = (value: string) => value.trim().replace(/^['"]|['"]$/g, "");
  return {
    name: frontmatter.match(/^name:\s*(.+)$/m)?.[1] ? clean(frontmatter.match(/^name:\s*(.+)$/m)![1]) : "",
    description: frontmatter.match(/^description:\s*(.+)$/m)?.[1]
      ? clean(frontmatter.match(/^description:\s*(.+)$/m)![1])
      : "",
  };
}

function stripSkillFrontmatter(content: string, skillName?: string) {
  let next = content.replace(/\r\n/g, "\n").trim();
  if (!next) {
    return "";
  }

  if (next.startsWith("---\n")) {
    const frontmatterEnd = next.indexOf("\n---\n", 4);
    if (frontmatterEnd >= 0) {
      next = next.slice(frontmatterEnd + 5).trimStart();
    }
  }

  if (skillName) {
    const escapedName = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`^#\\s+${escapedName}\\s*\\n+`, "i"), "");
  }

  return next.trim();
}

async function readLocalCodexSkill(skillRoot: string, system: boolean): Promise<SkillConfig | null> {
  try {
    const content = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const parsed = parseSkillFrontmatter(content);
    const name = parsed.name || path.basename(skillRoot);
    return {
      id: sanitizeModelProviderId(name),
      name,
      description: parsed.description || "Codex local skill",
      kind: "codex",
      command: "",
      enabled: true,
      sourcePath: skillRoot,
      system,
    };
  } catch {
    return null;
  }
}

async function readRuntimeSkill(skillRoot: string, location: string): Promise<RuntimeSkill | null> {
  try {
    const content = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const parsed = parseSkillFrontmatter(content);
    const name = parsed.name || path.basename(skillRoot);
    return {
      id: sanitizeModelProviderId(name),
      name,
      description: parsed.description || "Codex local skill",
      location,
      content,
    };
  } catch {
    return null;
  }
}

async function listCodexSkillsFromRoot(skillsRoot: string) {
  const result: SkillConfig[] = [];
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".system") {
      const systemEntries = await readdir(path.join(skillsRoot, entry.name), { withFileTypes: true }).catch(() => []);
      for (const systemEntry of systemEntries) {
        if (!systemEntry.isDirectory()) continue;
        const skill = await readLocalCodexSkill(path.join(skillsRoot, entry.name, systemEntry.name), true);
        if (skill) result.push(skill);
      }
      continue;
    }
    const skill = await readLocalCodexSkill(path.join(skillsRoot, entry.name), false);
    if (skill) result.push(skill);
  }
  return result;
}

async function listRuntimeSkillsFromRoot(skillsRoot: string, locationLabel: string) {
  const result: RuntimeSkill[] = [];
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".system") {
      const systemEntries = await readdir(path.join(skillsRoot, entry.name), { withFileTypes: true }).catch(() => []);
      for (const systemEntry of systemEntries) {
        if (!systemEntry.isDirectory()) continue;
        const skill = await readRuntimeSkill(
          path.join(skillsRoot, entry.name, systemEntry.name),
          `${locationLabel}/.system/${systemEntry.name}`,
        );
        if (skill) result.push(skill);
      }
      continue;
    }

    const skill = await readRuntimeSkill(path.join(skillsRoot, entry.name), `${locationLabel}/${entry.name}`);
    if (skill) result.push(skill);
  }
  return result;
}

async function collectRuntimeSkills(statePath: string, workspaceRoot?: string) {
  const managedRoots = getManagedCodexSkillsRoots(statePath, workspaceRoot);
  const discovered = [
    ...(await listRuntimeSkillsFromRoot(getExternalCodexSkillsRoot(), "$CODEX_HOME/skills").catch(() => [])),
    ...(
      await Promise.all(
        managedRoots.map((root) =>
          listRuntimeSkillsFromRoot(root, path.relative(path.dirname(statePath), root) || root).catch(() => []),
        ),
      )
    ).flat(),
  ];

  return Array.from(new Map(discovered.map((skill) => [skill.id, skill] as const)).values()).sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
}

async function loadCodexSkillPrompt(skill: SkillConfig) {
  if (!skill.sourcePath?.trim()) {
    return "";
  }

  try {
    const content = await readFile(path.join(skill.sourcePath, "SKILL.md"), "utf8");
    return stripSkillFrontmatter(content, skill.name);
  } catch {
    return "";
  }
}

async function buildEnabledSkillPromptContext(config: AppConfig) {
  const enabledSkills = config.skills.filter((skill) => skill.enabled);
  if (enabledSkills.length === 0) {
    return "";
  }

  const sections = await Promise.all(
    enabledSkills.map(async (skill) => {
      if (skill.kind === "codex") {
        const body = await loadCodexSkillPrompt(skill);
        if (!body) {
          return "";
        }

        return [
          `## ${skill.name}`,
          `Type: codex`,
          skill.description ? `Description: ${skill.description}` : "",
          "Use this skill only when it is relevant to the user's request.",
          "",
          body,
        ]
          .filter(Boolean)
          .join("\n");
      }

      const command = skill.command.replace(/\$ARGUMENTS/g, "<user request>");
      return [
        `## ${skill.name}`,
        `Type: command`,
        skill.description ? `Description: ${skill.description}` : "",
        "Use this skill only when it is relevant to the user's request.",
        "Template:",
        command,
      ]
        .filter(Boolean)
        .join("\n");
    }),
  );

  const nonEmptySections = sections.filter(Boolean);
  if (nonEmptySections.length === 0) {
    return "";
  }

  return [
    "Enabled workspace skills for this turn:",
    "Apply these skills only when they clearly match the user's intent. Do not force them into unrelated requests.",
    "",
    nonEmptySections.join("\n\n"),
  ].join("\n");
}

async function assertDirectoryExists(targetPath: string) {
  const stats = await stat(targetPath).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error("请选择有效的技能目录");
  }
}

async function assertSkillDirectory(sourcePath: string) {
  await assertDirectoryExists(sourcePath);
  try {
    await access(path.join(sourcePath, "SKILL.md"));
  } catch {
    throw new Error("所选目录缺少 SKILL.md，无法作为技能导入");
  }
}

function isPathInside(parentPath: string, childPath: string) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveImportDestination(rootPath: string, preferredName: string) {
  const normalized = preferredName.trim() || "skill";
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const destination = path.join(rootPath, `${normalized}${suffix}`);
    const existing = await stat(destination).catch(() => null);
    if (!existing) {
      return destination;
    }
    attempt += 1;
  }
}

async function syncManagedCodexSkills(statePath: string, state: PersistedWorkspaceState) {
  const hidden = new Set(state.config.hiddenCodexSkillIds);
  const managedRoots = getManagedCodexSkillsRoots(statePath, state.config.workspaceRoot);
  await Promise.all(managedRoots.map((root) => mkdir(root, { recursive: true }).catch(() => undefined)));
  const discovered = [
    ...(await listCodexSkillsFromRoot(getExternalCodexSkillsRoot()).catch(() => [])),
    ...(
      await Promise.all(managedRoots.map((root) => listCodexSkillsFromRoot(root).catch(() => [])))
    ).flat(),
  ];
  const codexSkills = new Map(
    discovered.filter((skill) => !hidden.has(skill.id)).map((skill) => [skill.id, skill] as const),
  );
  const commandSkills = state.config.skills.filter((skill) => skill.kind !== "codex");
  return {
    ...state,
    config: {
      ...state.config,
      skills: [...commandSkills, ...Array.from(codexSkills.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))],
    },
  };
}

function detectKind(filePath: string, mimeType?: string): PreviewKind {
  const extension = path.extname(filePath).toLowerCase();
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || extension === ".pdf") return "pdf";
  if (mimeType?.includes("text/html")) return "html";
  if ([".md", ".mdx"].includes(extension)) return "markdown";
  if ([".html", ".htm"].includes(extension)) return "html";
  if ([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".yml", ".yaml", ".py", ".go", ".rs", ".java", ".sh", ".ps1"].includes(extension)) {
    return "code";
  }
  if ([".txt", ".log", ".out", ".err"].includes(extension)) return "text";
  if (mimeType?.startsWith("text/")) return "text";
  return "binary";
}

function isDocxDocument(filePath: string, mimeType?: string) {
  return path.extname(filePath).toLowerCase() === ".docx" || DOCX_MIME_TYPES.has(mimeType ?? "");
}

async function readAttachmentInlineContent(filePath: string, mimeType: string, kind: PreviewKind) {
  if (INLINE_TEXT_KINDS.has(kind)) {
    return { content: await readFile(filePath, "utf8"), kind, mimeType: "text/plain" };
  }
  if (isDocxDocument(filePath, mimeType)) {
    const result = await mammoth.extractRawText({ path: filePath });
    return { content: result.value.replace(/\r\n/g, "\n"), kind: "text" as const, mimeType: "text/plain" };
  }
  return null;
}

function filePathFromUrl(url: string) {
  if (!url.startsWith("file:")) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
  } catch {
    return null;
  }
}

function isInterpreterLikeCommand(command: string) {
  return [
    "",
    "node",
    "node.exe",
    "npx",
    "npx.cmd",
    "npm",
    "npm.cmd",
    "pnpm",
    "pnpm.cmd",
    "yarn",
    "yarn.cmd",
    "python",
    "python.exe",
    "py",
    "py.exe",
    "bun",
    "bun.exe",
  ].includes(path.basename(command.trim()).toLowerCase());
}

function hasUsableRemoteUrl(server: McpServerConfig) {
  const rawUrl = server.url.trim();
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasUsableLocalCommand(server: McpServerConfig) {
  const command = server.command.trim();
  if (!command) return false;
  if (server.args.filter(Boolean).length > 0) return true;
  return !isInterpreterLikeCommand(command);
}

function getMcpStatuses(config: AppConfig): McpServerStatus[] {
  return config.mcpServers.map((server) => {
    const name = sanitizeMcpName(server.name || server.id);
    if (!server.enabled) {
      return { name, status: "disabled" };
    }
    const valid = server.transport === "remote" ? hasUsableRemoteUrl(server) : hasUsableLocalCommand(server);
    return {
      name,
      status: valid ? "connected" : "failed",
      error: valid ? undefined : "MCP server configuration is incomplete.",
    };
  });
}

export class WorkspaceService {
  private readonly knowledge: KnowledgeService;

  constructor(private readonly statePath: string) {
    this.knowledge = new KnowledgeService(path.join(path.dirname(statePath), "knowledge"));
  }

  async bootstrap(): Promise<BootstrapPayload> {
    const state = await this.loadState();
    return {
      snapshotAt: Date.now(),
      config: state.config,
      availableSkills: await collectRuntimeSkills(this.statePath, state.config.workspaceRoot),
      mcpStatuses: getMcpStatuses(state.config),
    };
  }

  async getConfigSnapshot(): Promise<AppConfig> {
    return (await this.loadState()).config;
  }

  async getEnabledSkillPromptContext(config?: AppConfig) {
    return await buildEnabledSkillPromptContext(config ?? (await this.getConfigSnapshot()));
  }

  async shutdown() {
    return;
  }

  async updateConfig(patch: Partial<AppConfig>) {
    const state = await this.loadState();
    state.config = {
      ...state.config,
      ...patch,
      appearance: {
        ...state.config.appearance,
        ...(patch.appearance ?? {}),
      },
      proxy: {
        ...state.config.proxy,
        ...(patch.proxy ?? {}),
      } satisfies ProxyConfig,
      modelProviders: patch.modelProviders ?? state.config.modelProviders,
      mcpServers: patch.mcpServers ?? state.config.mcpServers,
      skills: patch.skills ?? state.config.skills,
      hiddenCodexSkillIds: patch.hiddenCodexSkillIds ?? state.config.hiddenCodexSkillIds,
      knowledgeBase: patch.knowledgeBase ?? state.config.knowledgeBase,
      remoteControl: patch.remoteControl ?? state.config.remoteControl,
    };
    await this.saveState(state);
    return await this.bootstrap();
  }

  async importLocalSkill(sourcePath: string): Promise<SkillImportResult> {
    const state = await this.loadState();
    const normalizedSourcePath = path.resolve(String(sourcePath || "").trim());
    if (!normalizedSourcePath) {
      throw new Error("缺少技能目录");
    }

    await assertSkillDirectory(normalizedSourcePath);

    const targetRoot = getPreferredManagedCodexSkillsRoot(this.statePath, state.config.workspaceRoot);
    await mkdir(targetRoot, { recursive: true });

    let importedTo = normalizedSourcePath;
    if (!isPathInside(targetRoot, normalizedSourcePath)) {
      const preferredFolderName = path.basename(normalizedSourcePath);
      importedTo = await resolveImportDestination(targetRoot, preferredFolderName);
      await cp(normalizedSourcePath, importedTo, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }

    const importedSkill = await readLocalCodexSkill(importedTo, false);
    if (!importedSkill) {
      throw new Error("技能导入失败，无法解析 SKILL.md");
    }

    state.config.hiddenCodexSkillIds = state.config.hiddenCodexSkillIds.filter((id) => id !== importedSkill.id);
    await this.saveState(state);

    return {
      bootstrap: await this.bootstrap(),
      importedSkillName: importedSkill.name,
      importedTo,
    };
  }

  async uninstallSkill(skillId: string) {
    const state = await this.loadState();
    const target = state.config.skills.find((skill) => skill.id === skillId);
    if (!target) {
      return await this.bootstrap();
    }

    if (target.kind === "codex") {
      if (target.system !== true && target.sourcePath) {
        await rm(target.sourcePath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (target.system === true) {
        state.config.hiddenCodexSkillIds = Array.from(new Set([...state.config.hiddenCodexSkillIds, target.id]));
      }
    }

    state.config.skills = state.config.skills.filter((skill) => skill.id !== skillId);
    await this.saveState(state);
    return await this.bootstrap();
  }

  async fetchProviderModels(input: ModelProviderFetchInput): Promise<ModelProviderFetchResult> {
    if (input.kind !== "openai-compatible") {
      throw new Error("当前仅支持 OpenAI 兼容提供商自动拉取模型列表");
    }
    return {
      providerId: input.providerId,
      models: await fetchOpenAiCompatibleModelsEnhanced(input),
    };
  }

  async transcribeAudio(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
    const config = (await this.loadState()).config;
    const requestedProviderId = input.providerId?.trim() || "";
    const provider =
      (requestedProviderId
        ? config.modelProviders.find((item) => item.id === requestedProviderId)
        : null) ??
      (() => {
        const activeModel = getActiveModelOption(config.modelProviders, config.activeModelId);
        return activeModel
          ? config.modelProviders.find((item) => item.id === activeModel.providerId)
          : null;
      })() ??
      config.modelProviders.find((item) => item.enabled !== false) ??
      null;

    if (!provider || provider.enabled === false) {
      throw new Error("请先配置可用的模型提供商，再使用语音输入");
    }

    if (provider.kind !== "openai-compatible") {
      throw new Error("当前仅支持 OpenAI 兼容提供商的语音转写");
    }

    if (!provider.baseUrl.trim()) {
      throw new Error("当前提供商缺少接口地址，无法进行语音转写");
    }

    const audioBase64 = input.audioBase64.trim();
    if (!audioBase64) {
      throw new Error("缺少语音数据，无法开始转写");
    }

    const audioBuffer = Buffer.from(audioBase64, "base64");
    if (audioBuffer.byteLength === 0) {
      throw new Error("语音数据为空，请重新录制");
    }

    const mimeType = input.mimeType.trim() || "audio/webm";
    const fileName = input.fileName.trim() || "voice-input.webm";
    const url = createAudioTranscriptionUrl(provider.baseUrl);
    const headers = createOpenAiCompatibleHeaders(provider.apiKey);
    const modelCandidates = getAudioTranscriptionModelCandidates(provider);
    let retryableErrorMessage = "";

    for (const modelId of modelCandidates) {
      const formData = new FormData();
      formData.set(
        "file",
        new File([audioBuffer], fileName, {
          type: mimeType,
        }),
      );
      formData.set("model", modelId);
      formData.set("language", input.language?.trim() || "zh");

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
      });
      const rawText = await response.text();
      const parsed = rawText ? safeParseJson(rawText) : null;
      const fallbackMessage = rawText.trim() || `语音转写失败 (${response.status})`;

      if (!response.ok) {
        const message = extractResponseErrorMessage(parsed, fallbackMessage);
        if (shouldRetryWithAnotherTranscriptionModel(response.status, message)) {
          retryableErrorMessage = message;
          continue;
        }

        throw new Error(message);
      }

      const text =
        typeof (parsed as { text?: unknown } | null)?.text === "string"
          ? String((parsed as { text: string }).text).trim()
          : rawText.trim();

      if (!text) {
        throw new Error("语音转写完成，但没有返回可用文本");
      }

      return {
        text,
        providerId: provider.id,
        modelId,
      };
    }

    throw new Error(
      retryableErrorMessage ||
        "当前提供商暂不支持语音转写，请在模型设置里补充 whisper-1 或 gpt-4o-mini-transcribe",
    );
  }

  async listKnowledgeBases(): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.listBases();
  }

  async createKnowledgeBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.createBase(input);
  }

  async deleteKnowledgeBase(baseId: string): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.deleteBase(baseId);
  }

  async addKnowledgeFiles(input: KnowledgeAddFilesInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.addFiles((await this.loadState()).config, input);
  }

  async addKnowledgeDirectory(input: KnowledgeAddDirectoryInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.addDirectory((await this.loadState()).config, input);
  }

  async addKnowledgeNote(input: KnowledgeAddNoteInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.addNote((await this.loadState()).config, input);
  }

  async addKnowledgeUrl(input: KnowledgeAddUrlInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.addUrl((await this.loadState()).config, input);
  }

  async addKnowledgeWebsite(input: KnowledgeAddUrlInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.addWebsite((await this.loadState()).config, input);
  }

  async deleteKnowledgeItem(input: KnowledgeDeleteItemInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.deleteItem(input);
  }

  async generateProjectReport(
    input: ProjectReportInput & { mapSummary?: string; mapToolUsed?: string },
  ): Promise<ProjectReportResult> {
    const state = await this.loadState();
    const knowledgeBaseId = input.knowledgeBaseId.trim();
    if (!knowledgeBaseId) {
      throw new Error("请先选择知识库");
    }
    if (!input.projectName.trim()) {
      throw new Error("请先输入项目名称");
    }

    const workspaceRoot = input.workspaceRoot?.trim() || state.config.workspaceRoot || process.cwd();
    const outputDirectory = input.outputDirectory?.trim() || path.join(workspaceRoot, "reports");
    const outputFileName = (() => {
      const raw = input.outputFileName?.trim();
      if (!raw) return createDefaultReportFileName(input);
      return `${sanitizeReportFileName(raw.replace(/\.docx?$/i, ""))}.docx`;
    })();

    await mkdir(outputDirectory, { recursive: true });

    const knowledgeQueries = [
      input.projectName.trim(),
      `${input.projectName.trim()} 环评 编制依据`,
      `${input.projectName.trim()} 评价等级`,
      `${input.projectName.trim()} 选址符合性`,
      `${input.projectName.trim()} 政策符合性`,
      input.projectLocation?.trim() ? `${input.projectLocation.trim()} ${input.projectName.trim()}` : "",
    ].filter(Boolean);

    const searchResults = await Promise.all(
      knowledgeQueries.map((query) =>
        this.searchKnowledgeBases({
          query,
          knowledgeBaseIds: [knowledgeBaseId],
          documentCount: 6,
        }).catch(() => ({
          query,
          total: 0,
          results: [],
          searchedBases: [],
          warnings: [],
        })),
      ),
    );

    const references = mergeKnowledgeResults(searchResults.map((item) => item.results));
    const draft = await generateTextWithActiveModel(
      state.config,
      buildProjectReportPrompt(input, references, input.mapSummary),
    );
    const filePath = resolveReportOutputPath(outputDirectory, outputFileName);
    const buffer = await createProjectReportDocBuffer({
      title: `${input.projectName.trim()} 环评分析报告`,
      content: draft,
      meta: [
        `项目名称：${input.projectName.trim()}`,
        input.projectLocation?.trim() ? `项目位置：${input.projectLocation.trim()}` : "",
        input.mapToolUsed ? `地图工具：${input.mapToolUsed}` : "",
        input.mapSummary ? `定位摘要：${input.mapSummary.slice(0, 140)}` : "",
      ],
    });

    await writeFile(filePath, buffer);

    return {
      outputPath: filePath,
      fileName: outputFileName,
      generatedAt: Date.now(),
      locationSummary: input.mapSummary,
      mapToolUsed: input.mapToolUsed,
      references,
      content: draft,
    };
  }

  async generateEmergencyPlan(input: EmergencyPlanInput): Promise<EmergencyPlanResult> {
    const state = await this.loadState();
    const projectName = input.projectName.trim();
    if (!projectName) {
      throw new Error("请先填写项目名称");
    }
    if (!Array.isArray(input.templateFiles) || input.templateFiles.length === 0) {
      throw new Error("请至少选择一个 PDF 或 Word 模板文件");
    }

    const workspaceRoot = input.workspaceRoot?.trim() || state.config.workspaceRoot || process.cwd();
    const outputDirectory = input.outputDirectory?.trim() || path.join(workspaceRoot, "emergency-plans");
    await mkdir(outputDirectory, { recursive: true });

    const recognizedTemplates = await Promise.all(input.templateFiles.map((file) => recognizeEmergencyTemplate(file)));
    const fileName = sanitizeEmergencyPlanFileName(
      input.outputFileName?.trim() || createDefaultEmergencyPlanFileName(input),
    ).replace(/(?:\.docx)?$/i, ".docx");
    const outputPath = path.join(outputDirectory, fileName);
    const draft = await generateTextWithActiveModel(
      state.config,
      buildEmergencyPlanPrompt(input, recognizedTemplates),
    );
    const buffer = await createEmergencyPlanDocBuffer({
      title: `${projectName} 突发环境事件应急预案`,
      content: draft,
      meta: [
        input.companyName ? `企业名称：${input.companyName}` : "",
        input.projectLocation ? `项目位置：${input.projectLocation}` : "",
        `模板数量：${recognizedTemplates.length}`,
        `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      ],
    });

    await writeFile(outputPath, buffer);

    return {
      outputPath,
      fileName,
      generatedAt: Date.now(),
      templateCount: recognizedTemplates.length,
      recognizedTemplates: recognizedTemplates.map((template) => ({
        name: template.name,
        path: template.path,
        kind: template.kind,
        excerpt: template.excerpt,
      })),
      content: draft,
    };
  }

  async searchKnowledgeBases(input: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }): Promise<KnowledgeSearchPayload> {
    return await this.knowledge.search((await this.loadState()).config, input);
  }

  async selectFiles(filePaths: string[]) {
    return await this.prepareAttachments(filePaths);
  }

  async prepareAttachments(filePaths: string[]) {
    return await Promise.all(filePaths.map((filePath) => this.readSelectedFile(filePath)));
  }

  async readPreview(payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }): Promise<FilePreviewPayload> {
    if (payload.content) {
      return {
        title: payload.title ?? "Preview",
        path: payload.path ?? null,
        kind: (payload.kind as FilePreviewPayload["kind"]) ?? "text",
        mimeType: "text/plain",
        content: payload.content,
      };
    }

    if (payload.url?.startsWith("http://") || payload.url?.startsWith("https://")) {
      const response = await fetch(payload.url);
      const contentType = response.headers.get("content-type") || "text/html";
      const mimeTypeValue = contentType.split(";")[0]?.trim() || "text/html";
      const kind =
        mimeTypeValue === "application/pdf"
          ? "pdf"
          : mimeTypeValue.startsWith("text/html")
            ? "web"
            : mimeTypeValue.startsWith("text/markdown")
              ? "markdown"
              : mimeTypeValue.startsWith("text/")
                ? "text"
                : "binary";

      if (kind === "pdf") {
        return {
          title: payload.title ?? payload.url,
          path: payload.url,
          kind,
          mimeType: mimeTypeValue,
          content: "",
          url: payload.url,
        };
      }

      return {
        title: payload.title ?? payload.url,
        path: payload.url,
        kind,
        mimeType: mimeTypeValue,
        content: await response.text(),
        url: payload.url,
      };
    }

    if (payload.url?.startsWith("data:")) {
      const [header, content] = payload.url.split(",", 2);
      const mimeTypeValue = header.match(/^data:(.+?);base64$/)?.[1] ?? "text/plain";
      const kind =
        (payload.kind as FilePreviewPayload["kind"]) ??
        (mimeTypeValue.startsWith("image/") ? "image" : mimeTypeValue === "application/pdf" ? "pdf" : "text");
      return {
        title: payload.title ?? "Preview",
        path: payload.path ?? null,
        kind,
        mimeType: mimeTypeValue,
        content: kind === "image" || kind === "pdf" ? payload.url : Buffer.from(content ?? "", "base64").toString("utf8"),
        url: kind === "html" ? payload.url : undefined,
      };
    }

    const directPath =
      payload.path &&
      !payload.path.startsWith("file:") &&
      !payload.path.startsWith("data:") &&
      !payload.path.startsWith("http://") &&
      !payload.path.startsWith("https://")
        ? payload.path
        : null;
    const resolvedPath = directPath ?? (payload.url ? filePathFromUrl(payload.url) : null);
    if (!resolvedPath) {
      throw new Error("Missing preview path");
    }

    const fileName = path.basename(resolvedPath);
    const mimeTypeValue = String(mime.lookup(resolvedPath) || "application/octet-stream");
    const kind = detectKind(resolvedPath, mimeTypeValue);

    if (kind === "image" || kind === "pdf") {
      const buffer = await readFile(resolvedPath);
      return {
        title: payload.title ?? fileName,
        path: resolvedPath,
        kind,
        mimeType: mimeTypeValue,
        content: `data:${mimeTypeValue};base64,${buffer.toString("base64")}`,
        url: kind === "pdf" ? pathToFileURL(resolvedPath).href : undefined,
      };
    }

    const inline = await readAttachmentInlineContent(resolvedPath, mimeTypeValue, kind).catch(() => null);
    if (inline) {
      return {
        title: payload.title ?? fileName,
        path: resolvedPath,
        kind: inline.kind,
        mimeType: inline.mimeType,
        content: inline.content,
      };
    }

    if (kind === "binary") {
      return {
        title: payload.title ?? fileName,
        path: resolvedPath,
        kind,
        mimeType: mimeTypeValue,
        content: "",
      };
    }

    return {
      title: payload.title ?? fileName,
      path: resolvedPath,
      kind,
      mimeType: mimeTypeValue,
      content: await readFile(resolvedPath, "utf8"),
      url: kind === "html" ? pathToFileURL(resolvedPath).href : undefined,
    };
  }

  async listObservedTools(): Promise<WorkspaceToolCatalog> {
    return { fetchedAt: Date.now(), tools: [] };
  }

  private async readSelectedFile(filePath: string): Promise<FileDropEntry> {
    const mimeTypeValue = String(mime.lookup(filePath) || "application/octet-stream");
    const kind = detectKind(filePath, mimeTypeValue);
    const size = await stat(filePath).then((entry) => entry.size).catch(() => 0);

    if (kind === "image") {
      const buffer = await readFile(filePath);
      return {
        id: randomUUID(),
        name: path.basename(filePath),
        path: filePath,
        size,
        mimeType: mimeTypeValue,
        kind,
        dataUrl: `data:${mimeTypeValue};base64,${buffer.toString("base64")}`,
      };
    }

    const inline = await readAttachmentInlineContent(filePath, mimeTypeValue, kind).catch(() => null);
    if (inline) {
      return {
        id: randomUUID(),
        name: path.basename(filePath),
        path: filePath,
        size,
        mimeType: inline.mimeType,
        kind: inline.kind,
        content: inline.content,
      };
    }

    return {
      id: randomUUID(),
      name: path.basename(filePath),
      path: filePath,
      size,
      mimeType: mimeTypeValue,
      kind,
    };
  }

  private async loadState(): Promise<PersistedWorkspaceState> {
    const rawState = await readJsonFile<any>(this.statePath, createEmptyState());
    const normalized = await syncManagedCodexSkills(this.statePath, normalizeState(rawState));
    if (JSON.stringify(rawState?.config ?? null) !== JSON.stringify(normalized.config)) {
      await this.saveState(normalized);
    }
    return normalized;
  }

  private async saveState(state: PersistedWorkspaceState) {
    await writeJsonFile(this.statePath, state);
  }
}
