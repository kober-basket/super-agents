import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
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
import { sortWorkspaceDirectoryEntries } from "../src/lib/workspace-directory";
import { sanitizeMcpName } from "../src/features/shared/utils";
import { buildSkillIndexPrompt } from "./chat/skill-invocation";
import type {
  AppConfig,
  AudioTranscriptionInput,
  AudioTranscriptionResult,
  BootstrapPayload,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeCatalogPayload,
  KnowledgeDeleteItemInput,
  KnowledgeSearchPayload,
  MemoryCatalogPayload,
  MemoryCreateInput,
  MemorySearchInput,
  MemorySearchPayload,
  MemoryUpdateInput,
  McpServerConfig,
  McpServerStatus,
  ModelProviderConfig,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  PreviewKind,
  ProxyConfig,
  RuntimeSkill,
  SkillConfig,
  SkillImportResult,
  TerminalCommandResult,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceToolCatalog,
} from "../src/types";
import { KnowledgeService } from "./knowledge-service";
import { MailService } from "./mail/mail-service";
import type {
  MailAccountCreateInput,
  MailAccountSummary,
  MailDraft,
  MailDraftCreateInput,
  MailMessage,
  MailMessageSummary,
  MailOAuthAuthorization,
  MailOAuthAuthorizationInput,
  MailOAuthCodeExchangeInput,
  MailOAuthCredentialsInput,
  MailPasswordCredentialsInput,
  MailProviderSetup,
  MailReadInput,
  MailSearchInput,
  MailSendDraftInput,
  MailSendResult,
} from "./mail/types";
import { MemoryService } from "./memory-service";
import { createRuntimeProcessEnv } from "./runtime-support";
import { readJsonFile, writeJsonFile } from "./store";
import { buildWorkspaceToolCatalog } from "./tool-catalog";

interface PersistedWorkspaceState {
  config: AppConfig;
}

interface SkillOpenAiMetadata {
  displayName?: string;
  shortDescription?: string;
  brandColor?: string;
  defaultPrompt?: string;
  allowImplicitInvocation?: boolean;
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

const LEGACY_DEFAULT_SKILL_IDS = new Set(["meeting-minutes", "email-draft", "schedule-summary"]);
// Keep the imagegen names as legacy fallbacks for skills copied before icon.* became the canonical asset name.
const SKILL_ICON_ASSET_CANDIDATES = [
  "assets/icon.svg",
  "assets/imagegen-small.svg",
  "assets/icon.png",
  "assets/imagegen.png",
  "assets/logo.svg",
  "assets/logo.png",
] as const;
const DEFAULT_SKILLS: SkillConfig[] = readBuiltinSkillConfigs();
const activeBuiltinSkillSyncs = new Map<string, Promise<SkillConfig[]>>();

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
  security: {
    fullFileSystemAccess: true,
  },
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
  const legacyHiddenSkillKey = ["hidden", "Code", "x", "SkillIds"].join("");
  const { customModels, workspaceRoot, [legacyHiddenSkillKey]: _legacyHiddenSkillIds, ...restConfigWithLegacy } = rawConfig;
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
      skills: normalizeSkillList(rawConfig.skills),
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
      security: {
        ...DEFAULT_CONFIG.security,
        ...(rawConfig.security ?? {}),
        fullFileSystemAccess: rawConfig.security?.fullFileSystemAccess === false
          ? false
          : DEFAULT_CONFIG.security.fullFileSystemAccess,
      },
      mcpServers: Array.isArray(rawConfig.mcpServers) ? rawConfig.mcpServers : DEFAULT_CONFIG.mcpServers,
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

function hasConfiguredAudioTranscriptionModel(provider: ModelProviderConfig) {
  return provider.models.some((model) =>
    TRANSCRIPTION_MODEL_REGEX.test(`${model.id} ${model.label} ${model.description ?? ""}`),
  );
}

function getAudioTranscriptionProviderCandidates(config: AppConfig, requestedProviderId: string) {
  const activeModel = getActiveModelOption(config.modelProviders, config.activeModelId);
  const speechProviderIds = config.modelProviders
    .filter((provider) => hasConfiguredAudioTranscriptionModel(provider))
    .map((provider) => provider.id);
  const requestedProvider = requestedProviderId
    ? config.modelProviders.find((provider) => provider.id === requestedProviderId)
    : null;
  const activeProvider = activeModel
    ? config.modelProviders.find((provider) => provider.id === activeModel.providerId)
    : null;
  const candidateIds = [
    requestedProvider && hasConfiguredAudioTranscriptionModel(requestedProvider)
      ? requestedProvider.id
      : "",
    activeProvider && hasConfiguredAudioTranscriptionModel(activeProvider) ? activeProvider.id : "",
    ...speechProviderIds,
    requestedProvider?.id ?? "",
    activeProvider?.id ?? "",
    ...config.modelProviders.map((provider) => provider.id),
  ]
    .map((providerId) => providerId.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const candidates: ModelProviderConfig[] = [];

  for (const providerId of candidateIds) {
    if (seen.has(providerId)) {
      continue;
    }
    seen.add(providerId);

    const provider = config.modelProviders.find((item) => item.id === providerId);
    if (provider && provider.enabled !== false) {
      candidates.push(provider);
    }
  }

  return candidates;
}

function shouldRetryWithAnotherTranscriptionModel(status: number, message: string) {
  if (
    /(no available channel|channel.*not available|no route|no provider|distributor)/i.test(
      message,
    )
  ) {
    return true;
  }

  if (!(status === 400 || status === 404)) {
    return false;
  }

  return /(model|engine).*(not found|does not exist|unsupported|invalid)|unknown model|unsupported model/i.test(
    message,
  );
}

function shouldRetryWithAnotherTranscriptionProvider(status: number, message: string) {
  if (shouldRetryWithAnotherTranscriptionModel(status, message)) {
    return true;
  }

  if (status !== 400 && status !== 404) {
    return false;
  }

  return /audio\/transcriptions|transcription|endpoint|route|not found|cannot\s+(post|get)/i.test(
    message,
  );
}

function formatAudioTranscriptionFetchError(provider: ModelProviderConfig, modelId: string, error: unknown) {
  const rawMessage =
    error instanceof Error && error.message.trim() ? error.message.trim() : "fetch failed";
  return `${provider.name} (${provider.baseUrl}) 的语音转写接口连接失败：${rawMessage}；模型：${modelId}`;
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
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

function getManagedLocalSkillsRoot(statePath: string) {
  return path.join(path.dirname(statePath), "skills", "local");
}

function getManagedBuiltinSkillsRoot(statePath: string) {
  return path.join(path.dirname(statePath), "skills", "builtin");
}

function getProjectLocalSkillsRoot(workspaceRoot: string) {
  return path.join(workspaceRoot, ".super-agents", "skills");
}

function getManagedLocalSkillsRoots(statePath: string, workspaceRoot?: string) {
  const roots = [getManagedLocalSkillsRoot(statePath)];
  const normalizedWorkspaceRoot = workspaceRoot?.trim();
  if (normalizedWorkspaceRoot) {
    roots.unshift(getProjectLocalSkillsRoot(normalizedWorkspaceRoot));
  }
  return Array.from(new Set(roots));
}

function getPreferredManagedLocalSkillsRoot(statePath: string, workspaceRoot?: string) {
  return getManagedLocalSkillsRoots(statePath, workspaceRoot)[0];
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

function parseOpenAiYamlScalar(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    return quote === '"'
      ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : inner.replace(/''/g, "'");
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}

function parseSkillOpenAiMetadata(content: string): SkillOpenAiMetadata {
  const metadata: SkillOpenAiMetadata = {};
  let section = "";

  for (const rawLine of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const topLevelMatch = rawLine.match(/^([A-Za-z_][\w-]*):\s*$/);
    if (topLevelMatch?.[1]) {
      section = topLevelMatch[1];
      continue;
    }

    const fieldMatch = rawLine.match(/^\s+([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (!fieldMatch?.[1] || !section) continue;

    const key = fieldMatch[1];
    const value = parseOpenAiYamlScalar(fieldMatch[2] ?? "");
    if (section === "interface" && typeof value === "string" && value.trim()) {
      if (key === "display_name") metadata.displayName = value.trim();
      if (key === "short_description") metadata.shortDescription = value.trim();
      if (key === "brand_color") metadata.brandColor = value.trim();
      if (key === "default_prompt") metadata.defaultPrompt = value.trim();
    }
    if (section === "policy" && key === "allow_implicit_invocation" && typeof value === "boolean") {
      metadata.allowImplicitInvocation = value;
    }
  }

  return metadata;
}

function readSkillOpenAiMetadataSync(skillRoot: string): SkillOpenAiMetadata {
  try {
    return parseSkillOpenAiMetadata(readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8"));
  } catch {
    return {};
  }
}

function readSkillIconDataUrlSync(skillRoot: string) {
  for (const relativePath of SKILL_ICON_ASSET_CANDIDATES) {
    const assetPath = path.join(skillRoot, relativePath);
    if (!existsSync(assetPath)) continue;

    try {
      const mimeType = mime.lookup(assetPath) || "application/octet-stream";
      return `data:${mimeType};base64,${readFileSync(assetPath).toString("base64")}`;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function readSkillOpenAiMetadata(skillRoot: string): Promise<SkillOpenAiMetadata> {
  try {
    return parseSkillOpenAiMetadata(await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8"));
  } catch {
    return {};
  }
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

function resolveBuiltinSkillsRoot() {
  const candidates = [
    path.resolve(process.cwd(), "electron", "builtin-skills"),
    path.resolve(process.cwd(), "..", "electron", "builtin-skills"),
    path.resolve(__dirname, "builtin-skills"),
    path.resolve(__dirname, "..", "electron", "builtin-skills"),
    path.resolve(__dirname, "..", "..", "electron", "builtin-skills"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function readBuiltinSkillConfigs(): SkillConfig[] {
  const root = resolveBuiltinSkillsRoot();

  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillRoot = path.join(root, entry.name);
        const content = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
        const parsed = parseSkillFrontmatter(content);
        const name = parsed.name || entry.name;
        return {
          id: sanitizeModelProviderId(name),
          name,
          description: parsed.description || "Built-in skill",
          ...readSkillOpenAiMetadataSync(skillRoot),
          iconDataUrl: readSkillIconDataUrlSync(skillRoot),
          kind: "command" as const,
          command: stripSkillFrontmatter(content, name),
          enabled: true,
          sourcePath: skillRoot,
          system: true,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  } catch {
    return [];
  }
}

function normalizeSkillList(rawSkills: unknown, builtinSkills: SkillConfig[] = DEFAULT_SKILLS): SkillConfig[] {
  const source = Array.isArray(rawSkills) ? rawSkills : [];
  const previousById = new Map<string, any>();
  for (const item of source) {
    const id = String(item?.id ?? "").trim();
    if (id) previousById.set(id, item);
  }

  const builtinIds = new Set(builtinSkills.map((skill) => skill.id));
  const normalizedBuiltinSkills = builtinSkills.map((skill) => {
    const previous = previousById.get(skill.id);
    return {
      ...skill,
      enabled: previous?.enabled === false ? false : skill.enabled,
    };
  });

  const customSkills = source.flatMap((item): SkillConfig[] => {
    const id = String(item?.id ?? "").trim();
    const name = String(item?.name ?? id).trim();
    const kind = item?.kind;
    if (!id || !name || kind !== "command") return [];
    if (builtinIds.has(id)) return [];
    if (!item?.sourcePath && (LEGACY_DEFAULT_SKILL_IDS.has(id) || LEGACY_DEFAULT_SKILL_IDS.has(name))) return [];
    const sourcePath = typeof item?.sourcePath === "string" ? item.sourcePath : undefined;
    const iconDataUrl =
      (sourcePath ? readSkillIconDataUrlSync(sourcePath) : undefined) ||
      (typeof item?.iconDataUrl === "string" ? item.iconDataUrl : undefined);

    return [
      {
        id,
        name,
        description: String(item?.description ?? ""),
        displayName: typeof item?.displayName === "string" ? item.displayName : undefined,
        shortDescription: typeof item?.shortDescription === "string" ? item.shortDescription : undefined,
        brandColor: typeof item?.brandColor === "string" ? item.brandColor : undefined,
        iconDataUrl,
        defaultPrompt: typeof item?.defaultPrompt === "string" ? item.defaultPrompt : undefined,
        allowImplicitInvocation: typeof item?.allowImplicitInvocation === "boolean" ? item.allowImplicitInvocation : undefined,
        kind: "command",
        command: String(item?.command ?? ""),
        enabled: item?.enabled !== false,
        sourcePath,
        system: item?.system === true,
      },
    ];
  });

  return [...normalizedBuiltinSkills, ...customSkills];
}

async function readLocalSkill(skillRoot: string): Promise<SkillConfig | null> {
  try {
    const content = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const parsed = parseSkillFrontmatter(content);
    const name = parsed.name || path.basename(skillRoot);
    const body = stripSkillFrontmatter(content, name);
    const metadata = await readSkillOpenAiMetadata(skillRoot);
    return {
      id: sanitizeModelProviderId(name),
      name,
      description: parsed.description || "Local skill",
      ...metadata,
      iconDataUrl: readSkillIconDataUrlSync(skillRoot),
      kind: "command",
      command: body,
      enabled: true,
      sourcePath: skillRoot,
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
    const metadata = await readSkillOpenAiMetadata(skillRoot);
    return {
      id: sanitizeModelProviderId(name),
      name,
      description: parsed.description || "Local skill",
      ...metadata,
      iconDataUrl: readSkillIconDataUrlSync(skillRoot),
      location,
      content,
    };
  } catch {
    return null;
  }
}

async function listLocalSkillsFromRoot(skillsRoot: string) {
  const result: SkillConfig[] = [];
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = await readLocalSkill(path.join(skillsRoot, entry.name));
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
  const managedRoots = getManagedLocalSkillsRoots(statePath, workspaceRoot);
  const discovered = [
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

async function buildEnabledSkillPromptContext(config: AppConfig) {
  return buildSkillIndexPrompt(config);
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

async function syncManagedBuiltinSkills(statePath: string) {
  const builtinRoot = getManagedBuiltinSkillsRoot(statePath);
  const activeSync = activeBuiltinSkillSyncs.get(builtinRoot);
  if (activeSync) {
    return await activeSync;
  }

  const sync = syncManagedBuiltinSkillsForRoot(builtinRoot);
  activeBuiltinSkillSyncs.set(builtinRoot, sync);
  try {
    return await sync;
  } finally {
    if (activeBuiltinSkillSyncs.get(builtinRoot) === sync) {
      activeBuiltinSkillSyncs.delete(builtinRoot);
    }
  }
}

async function syncManagedBuiltinSkillsForRoot(builtinRoot: string) {
  await mkdir(builtinRoot, { recursive: true });

  await Promise.all(
    DEFAULT_SKILLS.map(async (skill) => {
      const sourcePath = skill.sourcePath?.trim();
      if (!sourcePath) return;

      const folderName = path.basename(sourcePath) || skill.id;
      const targetPath = path.join(builtinRoot, folderName);
      const existingSkillFile = await stat(path.join(targetPath, "SKILL.md")).catch(() => null);
      if (!existingSkillFile?.isFile()) {
        await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
      }
      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
      });
    }),
  );

  return DEFAULT_SKILLS.map((skill) => {
    const folderName = path.basename(skill.sourcePath?.trim() || "") || skill.id;
    return {
      ...skill,
      sourcePath: path.join(builtinRoot, folderName),
    };
  });
}

async function syncManagedLocalSkills(statePath: string, state: PersistedWorkspaceState) {
  const builtinSkills = await syncManagedBuiltinSkills(statePath);
  const managedRoots = getManagedLocalSkillsRoots(statePath, state.config.workspaceRoot);
  await Promise.all(managedRoots.map((root) => mkdir(root, { recursive: true }).catch(() => undefined)));
  const discovered = [
    ...(await Promise.all(managedRoots.map((root) => listLocalSkillsFromRoot(root).catch(() => [])))).flat(),
  ];
  const localSkills = new Map(discovered.map((skill) => [skill.id, skill] as const));
  const configuredSkills = normalizeSkillList(
    state.config.skills.filter((skill) => !skill.sourcePath || skill.system),
    builtinSkills,
  );
  const configuredIds = new Set(configuredSkills.map((skill) => skill.id));
  return {
    ...state,
    config: {
      ...state.config,
      skills: [
        ...configuredSkills,
        ...Array.from(localSkills.values())
          .filter((skill) => !configuredIds.has(skill.id))
          .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      ],
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

function normalizeWorkspaceRoot(config: AppConfig, workspaceRoot?: string) {
  return path.resolve(workspaceRoot?.trim() || config.workspaceRoot.trim() || process.cwd());
}

function isInsideDirectory(candidatePath: string, directoryPath: string) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRelativePath(rootPath: string, targetPath: string) {
  return path.relative(rootPath, targetPath).replace(/\\/g, "/");
}

async function runShellCommand(command: string, cwd: string): Promise<Omit<TerminalCommandResult, "command" | "cwd" | "durationMs">> {
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command];
  const env = await createRuntimeProcessEnv();

  return new Promise((resolve) => {
    execFile(shell, args, { cwd, env, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode =
        typeof (error as NodeJS.ErrnoException | null)?.errno === "number"
          ? 1
          : typeof (error as { code?: unknown } | null)?.code === "number"
            ? Number((error as { code: number }).code)
            : error
              ? 1
              : 0;

      resolve({
        exitCode,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
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
  private readonly memory: MemoryService;
  private readonly mail: MailService;

  constructor(private readonly statePath: string) {
    const dataRoot = path.dirname(statePath);
    this.knowledge = new KnowledgeService(path.join(dataRoot, "knowledge"));
    this.memory = new MemoryService(path.join(dataRoot, "memory"));
    this.mail = new MailService(path.join(dataRoot, "mail"));
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
      knowledgeBase: patch.knowledgeBase ?? state.config.knowledgeBase,
      remoteControl: patch.remoteControl ?? state.config.remoteControl,
      security: {
        ...state.config.security,
        ...(patch.security ?? {}),
      },
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

    const targetRoot = getPreferredManagedLocalSkillsRoot(this.statePath, state.config.workspaceRoot);
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

    const importedSkill = await readLocalSkill(importedTo);
    if (!importedSkill) {
      throw new Error("技能导入失败，无法解析 SKILL.md");
    }

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

    if (target.system) {
      throw new Error("内置技能不可卸载");
    }

    if (target.sourcePath) {
      await rm(target.sourcePath, { recursive: true, force: true }).catch(() => undefined);
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
    const providers = getAudioTranscriptionProviderCandidates(config, requestedProviderId);

    if (providers.length === 0) {
      throw new Error("请先配置可用的模型提供商，再使用语音输入");
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
    let retryableErrorMessage = "";

    for (const provider of providers) {
      if (provider.kind !== "openai-compatible") {
        retryableErrorMessage = "当前仅支持 OpenAI 兼容提供商的语音转写";
        continue;
      }

      if (!provider.baseUrl.trim()) {
        retryableErrorMessage = "当前提供商缺少接口地址，无法进行语音转写";
        continue;
      }

      const url = createAudioTranscriptionUrl(provider.baseUrl);
      const headers = createOpenAiCompatibleHeaders(provider.apiKey);
      const modelCandidates = getAudioTranscriptionModelCandidates(provider);

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

        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: formData,
          });
        } catch (error) {
          retryableErrorMessage = formatAudioTranscriptionFetchError(provider, modelId, error);
          break;
        }
        const rawText = await response.text();
        const parsed = rawText ? safeParseJson(rawText) : null;
        const fallbackMessage = rawText.trim() || `语音转写失败 (${response.status})`;

        if (!response.ok) {
          const message = extractResponseErrorMessage(parsed, fallbackMessage);
          if (shouldRetryWithAnotherTranscriptionProvider(response.status, message)) {
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

  async updateKnowledgeBase(input: KnowledgeBaseUpdateInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.updateBase(input);
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

  async searchKnowledgeBases(input: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }): Promise<KnowledgeSearchPayload> {
    return await this.knowledge.search((await this.loadState()).config, input);
  }

  async listMemories(): Promise<MemoryCatalogPayload> {
    return await this.memory.listMemories();
  }

  async createMemory(input: MemoryCreateInput): Promise<MemoryCatalogPayload> {
    return await this.memory.createMemory(input);
  }

  async updateMemory(input: MemoryUpdateInput): Promise<MemoryCatalogPayload> {
    return await this.memory.updateMemory(input);
  }

  async deleteMemory(id: string): Promise<MemoryCatalogPayload> {
    return await this.memory.deleteMemory(id);
  }

  async searchMemories(input: MemorySearchInput): Promise<MemorySearchPayload> {
    return await this.memory.searchMemories(input);
  }

  async buildMemoryPromptContext(input: MemorySearchInput): Promise<string> {
    return await this.memory.buildPromptContext(input);
  }

  inferSetup(email: string): MailProviderSetup {
    return this.mail.inferSetup(email);
  }

  async listAccounts(): Promise<MailAccountSummary[]> {
    return await this.mail.listAccounts();
  }

  async createMailAccount(input: MailAccountCreateInput): Promise<MailAccountSummary> {
    return await this.mail.createAccount(input);
  }

  async saveMailPasswordCredentials(input: MailPasswordCredentialsInput): Promise<MailAccountSummary> {
    return await this.mail.savePasswordCredentials(input);
  }

  async saveMailOAuthCredentials(input: MailOAuthCredentialsInput): Promise<MailAccountSummary> {
    return await this.mail.saveOAuthCredentials(input);
  }

  async createMailOAuthAuthorization(input: MailOAuthAuthorizationInput): Promise<MailOAuthAuthorization> {
    return await this.mail.createOAuthAuthorization(input);
  }

  async exchangeMailOAuthCode(input: MailOAuthCodeExchangeInput): Promise<MailAccountSummary> {
    return await this.mail.exchangeOAuthCode(input);
  }

  async disconnectMailAccount(accountId: string): Promise<MailAccountSummary[]> {
    return await this.mail.disconnectAccount(accountId);
  }

  async removeMailAccount(accountId: string): Promise<MailAccountSummary[]> {
    return await this.mail.removeAccount(accountId);
  }

  async searchMessages(input: MailSearchInput): Promise<MailMessageSummary[]> {
    return await this.mail.searchMessages(input);
  }

  async readMessage(input: MailReadInput): Promise<MailMessage> {
    return await this.mail.readMessage(input);
  }

  async createDraft(input: MailDraftCreateInput): Promise<MailDraft> {
    return await this.mail.createDraft(input);
  }

  async sendDraft(input: MailSendDraftInput): Promise<MailSendResult> {
    return await this.mail.sendDraft(input);
  }

  async selectFiles(filePaths: string[]) {
    return await this.prepareAttachments(filePaths);
  }

  async prepareAttachments(filePaths: string[]) {
    return await Promise.all(filePaths.map((filePath) => this.readSelectedFile(filePath)));
  }

  async listWorkspaceDirectory(payload: { path?: string; workspaceRoot?: string } = {}): Promise<WorkspaceDirectoryListing> {
    const config = (await this.loadState()).config;
    const rootPath = normalizeWorkspaceRoot(config, payload.workspaceRoot);
    const targetPath = path.resolve(payload.path?.trim() || rootPath);

    if (!isInsideDirectory(targetPath, rootPath)) {
      throw new Error("Directory is outside the current workspace.");
    }

    const targetStats = await stat(targetPath);
    if (!targetStats.isDirectory()) {
      throw new Error("Target path is not a directory.");
    }

    const entries = await Promise.all(
      (await readdir(targetPath, { withFileTypes: true })).map(async (entry): Promise<WorkspaceDirectoryEntry | null> => {
        const fullPath = path.join(targetPath, entry.name);
        const entryStats = await stat(fullPath).catch(() => null);
        if (!entryStats) {
          return null;
        }

        const kind = entry.isDirectory() ? "directory" : "file";
        return {
          name: entry.name,
          path: fullPath,
          relativePath: normalizeRelativePath(rootPath, fullPath),
          kind,
          size: kind === "file" ? entryStats.size : undefined,
          mimeType: kind === "file" ? String(mime.lookup(fullPath) || "application/octet-stream") : undefined,
          modifiedAt: entryStats.mtimeMs,
        };
      }),
    );

    return {
      rootPath,
      path: targetPath,
      relativePath: normalizeRelativePath(rootPath, targetPath),
      entries: sortWorkspaceDirectoryEntries(entries.filter((entry): entry is WorkspaceDirectoryEntry => Boolean(entry))),
    };
  }

  async runTerminalCommand(payload: { command: string; cwd?: string; workspaceRoot?: string }): Promise<TerminalCommandResult> {
    const command = payload.command.trim();
    if (!command) {
      throw new Error("Command is required.");
    }

    const config = (await this.loadState()).config;
    const rootPath = normalizeWorkspaceRoot(config, payload.workspaceRoot);
    const cwd = path.resolve(payload.cwd?.trim() || rootPath);
    if (!isInsideDirectory(cwd, rootPath)) {
      throw new Error("Terminal cwd is outside the current workspace.");
    }

    const startedAt = Date.now();
    const result = await runShellCommand(command, cwd);
    return {
      command,
      cwd,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
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
        url: inline.kind === "html" ? pathToFileURL(resolvedPath).href : undefined,
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

  async listBuiltinTools(): Promise<WorkspaceToolCatalog> {
    return buildWorkspaceToolCatalog([]);
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
    const normalized = await syncManagedLocalSkills(this.statePath, normalizeState(rawState));
    if (JSON.stringify(rawState?.config ?? null) !== JSON.stringify(normalized.config)) {
      await this.saveState(normalized);
    }
    return normalized;
  }

  private async saveState(state: PersistedWorkspaceState) {
    await writeJsonFile(this.statePath, state);
  }
}
