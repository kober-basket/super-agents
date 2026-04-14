import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mime from "mime-types";
import mammoth from "mammoth";

import {
  createRuntimeModelId,
  ensureActiveModelId,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "../src/lib/model-config";
import { DEFAULT_REMOTE_CONTROL_CONFIG, normalizeRemoteControlConfig } from "../src/lib/remote-control-config";
import {
  inferProviderModelCapabilities,
  inferProviderModelGroup,
  inferProviderModelVendor,
} from "../src/lib/model-metadata";
import {
  DEFAULT_THREAD_TITLE as FALLBACK_THREAD_TITLE,
  deriveThreadTitleFromMessages,
  formatThreadTitle,
} from "../src/lib/thread-title";
import { KnowledgeService } from "./knowledge-service";
import { readJsonFile, writeJsonFile } from "./store";
import {
  OpencodeRuntime,
  type OpencodeFilePart,
  type OpencodePart,
  type OpencodeSessionMessage,
  type OpencodeToolPart,
} from "./opencode-runtime-acp";
import type {
  AppConfig,
  BootstrapPayload,
  ChatMessage,
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
  ModelProviderConfig,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  PreviewKind,
  ProxyConfig,
  SendMessageInput,
  SendMessageResult,
  SkillConfig,
  SkillRunInput,
  SkillRunResult,
  ThreadRecord,
  ThreadSummary,
  WorkspaceTool,
  WorkspaceToolCatalog,
} from "../src/types";

interface PersistedWorkspaceState {
  config: AppConfig;
  activeThreadId: string;
  threads: ThreadSummary[];
}

const IFLY_RPA_BASE_URL = "https://oneapi.iflyrpa.com/v1";
const IFLY_RPA_API_KEY =
  process.env.SUPER_AGENTS_IFLYRPA_API_KEY ??
  process.env.KOBER_IFLYRPA_API_KEY ??
  process.env.IFLYRPA_API_KEY ??
  "sk-9Uoh18eJkEL8PEFPB735D104Bd534cA69e95F971A4Ba4e6d";

const DEFAULT_MODEL_PROVIDERS: ModelProviderConfig[] = [
  {
    id: "iflyrpa",
    name: "iFlyRpa",
    kind: "openai-compatible",
    baseUrl: IFLY_RPA_BASE_URL,
    apiKey: IFLY_RPA_API_KEY,
    temperature: 0.2,
    maxTokens: 8192,
    enabled: true,
    models: [
      { id: "azure/gpt-5", label: "GPT-5", enabled: true },
      { id: "azure/gpt-5-mini", label: "GPT-5 Mini", enabled: true },
      { id: "azure/gpt-5-nano", label: "GPT-5 Nano", enabled: true },
      { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", enabled: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", enabled: true },
    ],
  },
];

const DEFAULT_MCP: McpServerConfig[] = [];
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const INLINE_TEXT_KINDS = new Set<PreviewKind>(["text", "code", "markdown", "html"]);

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
  opencodeRoot: path.resolve(process.cwd(), "..", "opencode"),
  bridgeUrl: "",
  environment: "local",
  defaultAgentMode: "general",
  activeModelId: createRuntimeModelId("iflyrpa", "azure/gpt-5-mini"),
  contextTier: "high",
  appearance: {
    theme: "linen",
  },
  proxy: {
    http: "",
    https: "",
    bypass: "localhost,127.0.0.1",
  },
  modelProviders: DEFAULT_MODEL_PROVIDERS,
  mcpServers: DEFAULT_MCP,
  skills: DEFAULT_SKILLS,
  hiddenCodexSkillIds: [],
  knowledgeBase: {
    enabled: false,
    embeddingProviderId: "iflyrpa",
    embeddingModel: "text-embedding-3-small",
    selectedBaseIds: [],
    documentCount: 5,
    chunkSize: 1200,
    chunkOverlap: 160,
  },
  remoteControl: DEFAULT_REMOTE_CONTROL_CONFIG,
};

const BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  question: "Ask the user for confirmation or missing input before continuing.",
  webfetch: "Fetch a web page and extract the parts needed for the current task.",
};

const DEFAULT_THREAD_TITLE = "新会话";

function sortPersistedThreads(threads: ThreadSummary[]) {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

function normalizePersistedThreads(value: unknown): ThreadSummary[] {
  if (!Array.isArray(value)) return [];

  const byId = new Map<string, ThreadSummary>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<ThreadSummary>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) continue;

    byId.set(id, {
      id,
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : DEFAULT_THREAD_TITLE,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
      lastMessage: typeof record.lastMessage === "string" ? record.lastMessage : "",
      messageCount: typeof record.messageCount === "number" ? record.messageCount : 0,
      archived: record.archived === true,
      workspaceRoot:
        typeof record.workspaceRoot === "string" && record.workspaceRoot.trim()
          ? record.workspaceRoot.trim()
          : undefined,
    });
  }

  return sortPersistedThreads(Array.from(byId.values()));
}

function createEmptyState(): PersistedWorkspaceState {
  return {
    config: {
      ...DEFAULT_CONFIG,
      modelProviders: DEFAULT_MODEL_PROVIDERS.map((provider) => ({
        ...provider,
        models: provider.models.map((model) => ({ ...model })),
      })),
      mcpServers: DEFAULT_MCP.map((server) => ({ ...server })),
      skills: DEFAULT_SKILLS.map((skill) => ({ ...skill })),
      hiddenCodexSkillIds: [],
      remoteControl: normalizeRemoteControlConfig(undefined),
    },
    activeThreadId: "",
    threads: [],
  };
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function migrateLegacyModels(legacyModels: any[], legacyActiveModelId?: string) {
  const groups = new Map<
    string,
    {
      provider: ModelProviderConfig;
      legacyIds: string[];
    }
  >();
  let nextActiveModelId = "";

  for (const item of legacyModels) {
    const baseUrl = normalizeBaseUrl(String(item?.baseUrl ?? ""));
    const apiKey = String(item?.apiKey ?? "");
    const providerName = String(item?.provider ?? "").trim() || "OpenAI Compatible";
    const modelId = String(item?.model ?? "").trim();
    if (!modelId) continue;

    const groupKey = `${providerName}::${baseUrl}::${apiKey}`;
    const providerId = sanitizeModelProviderId(String(item?.id ?? "") || `${providerName}-${baseUrl}`);
    const existing = groups.get(groupKey);
    if (!existing) {
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
        legacyIds: [],
      });
    }

    const target = groups.get(groupKey)!;
    target.provider.models.push({
      id: modelId,
      label: String(item?.label ?? "").trim() || modelId,
      enabled: item?.enabled !== false,
    });
    target.legacyIds.push(String(item?.id ?? ""));

    if (String(item?.id ?? "") === legacyActiveModelId) {
      nextActiveModelId = createRuntimeModelId(target.provider.id, modelId);
    }
  }

  const providers = Array.from(groups.values()).map(({ provider }) => ({
    ...provider,
    models: normalizeProviderModels(provider.models),
  }));

  return {
    providers,
    activeModelId: nextActiveModelId,
  };
}

function normalizeState(state: Partial<PersistedWorkspaceState> | null | undefined): PersistedWorkspaceState {
  const rawConfig = (state?.config ?? {}) as AppConfig & { customModels?: any[] };
  const legacyModels = Array.isArray(rawConfig.customModels) ? rawConfig.customModels.filter(Boolean) : [];
  const migratedLegacy = migrateLegacyModels(legacyModels, rawConfig.activeModelId);
  const hasStoredProviders = Array.isArray(rawConfig.modelProviders);
  const modelProviders =
    hasStoredProviders
      ? rawConfig.modelProviders.map((item) => ({
          ...item,
          kind: item.kind ?? "openai-compatible",
          enabled: item.enabled !== false,
          temperature: typeof item.temperature === "number" ? item.temperature : 0.2,
          maxTokens: typeof item.maxTokens === "number" ? item.maxTokens : 4096,
          models: normalizeProviderModels(Array.isArray(item.models) ? item.models : []),
        }))
      : migratedLegacy.providers.length > 0
        ? migratedLegacy.providers
        : DEFAULT_MODEL_PROVIDERS.map((item) => ({
            ...item,
            models: item.models.map((model) => ({ ...model })),
          }));
  const preferredActiveModelId =
    modelProviders.some((provider) => provider.models.some((model) => createRuntimeModelId(provider.id, model.id) === rawConfig.activeModelId))
      ? rawConfig.activeModelId
      : migratedLegacy.activeModelId || rawConfig.activeModelId || DEFAULT_CONFIG.activeModelId;
  const activeModelId = ensureActiveModelId(modelProviders, preferredActiveModelId);
  const proxy = {
    ...DEFAULT_CONFIG.proxy,
    ...(rawConfig.proxy ?? {}),
  };

  return {
    config: {
      ...DEFAULT_CONFIG,
      ...rawConfig,
      defaultAgentMode: rawConfig.defaultAgentMode === "build" ? "build" : "general",
      activeModelId,
      appearance: {
        ...DEFAULT_CONFIG.appearance,
        ...(rawConfig.appearance ?? {}),
      },
      proxy,
      modelProviders,
      hiddenCodexSkillIds: Array.isArray(rawConfig.hiddenCodexSkillIds)
        ? rawConfig.hiddenCodexSkillIds.map((item) => String(item))
        : [],
      knowledgeBase: {
        enabled: rawConfig.knowledgeBase?.enabled === true,
        embeddingProviderId:
          typeof rawConfig.knowledgeBase?.embeddingProviderId === "string" && rawConfig.knowledgeBase.embeddingProviderId.trim()
            ? rawConfig.knowledgeBase.embeddingProviderId.trim()
            : DEFAULT_CONFIG.knowledgeBase.embeddingProviderId,
        embeddingModel:
          typeof rawConfig.knowledgeBase?.embeddingModel === "string" && rawConfig.knowledgeBase.embeddingModel.trim()
            ? rawConfig.knowledgeBase.embeddingModel.trim()
            : DEFAULT_CONFIG.knowledgeBase.embeddingModel,
        selectedBaseIds: Array.isArray(rawConfig.knowledgeBase?.selectedBaseIds)
          ? rawConfig.knowledgeBase.selectedBaseIds.map((item) => String(item)).filter(Boolean)
          : [],
        documentCount:
          typeof rawConfig.knowledgeBase?.documentCount === "number" &&
          rawConfig.knowledgeBase.documentCount > 0
            ? Math.min(Math.max(Math.round(rawConfig.knowledgeBase.documentCount), 1), 10)
            : DEFAULT_CONFIG.knowledgeBase.documentCount,
        chunkSize:
          typeof rawConfig.knowledgeBase?.chunkSize === "number" && rawConfig.knowledgeBase.chunkSize > 0
            ? Math.min(Math.max(Math.round(rawConfig.knowledgeBase.chunkSize), 200), 4000)
            : DEFAULT_CONFIG.knowledgeBase.chunkSize,
        chunkOverlap:
          typeof rawConfig.knowledgeBase?.chunkOverlap === "number" && rawConfig.knowledgeBase.chunkOverlap >= 0
            ? Math.min(Math.max(Math.round(rawConfig.knowledgeBase.chunkOverlap), 0), 800)
            : DEFAULT_CONFIG.knowledgeBase.chunkOverlap,
      },
      remoteControl: normalizeRemoteControlConfig(rawConfig.remoteControl),
      mcpServers:
        Array.isArray(rawConfig.mcpServers) && rawConfig.mcpServers.length > 0
          ? rawConfig.mcpServers.map((item) => ({
              transport: "local",
              url: "",
              headersJson: "{}",
              timeoutMs: 30000,
              ...item,
            }))
          : DEFAULT_CONFIG.mcpServers,
      skills:
        Array.isArray(rawConfig.skills) && rawConfig.skills.length > 0
          ? rawConfig.skills.map((item) => ({
              kind: item.kind === "codex" ? "codex" : "command",
              sourcePath: item.sourcePath,
              system: item.system === true,
              ...item,
              command: item.command ?? "",
              enabled: item.enabled !== false,
            }))
          : DEFAULT_CONFIG.skills,
    },
    activeThreadId: typeof state?.activeThreadId === "string" ? state.activeThreadId.trim() : "",
    threads: normalizePersistedThreads(state?.threads),
  };
}

function createModelListUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("请先填写供应商接口地址");
  }
  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
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

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function inferCapabilities(record: Record<string, unknown>, id: string, label: string, description: string, vendor?: string, group?: string) {
  const architecture =
    record.architecture && typeof record.architecture === "object"
      ? (record.architecture as Record<string, unknown>)
      : {};
  const modalities = [
    ...extractStringList(record.input_modalities),
    ...extractStringList(record.output_modalities),
    ...extractStringList(architecture.input_modalities),
    ...extractStringList(architecture.output_modalities),
    ...extractStringList(record.modalities),
    ...extractStringList(record.supported_modalities),
    ...extractStringList(record.supported_endpoint_types),
  ];
  const supportedParameters = extractStringList(record.supported_parameters);
  const pricing =
    record.pricing && typeof record.pricing === "object"
      ? (record.pricing as Record<string, unknown>)
      : {};
  const promptPrice = Number(pricing.prompt ?? pricing.input ?? NaN);
  const completionPrice = Number(pricing.completion ?? pricing.output ?? NaN);

  return inferProviderModelCapabilities({
    id,
    label,
    description,
    vendor,
    group,
    modalities,
    supportedParameters,
    endpointTypes: extractStringList(record.supported_endpoint_types),
    capabilities:
      record.reasoning === true
        ? {
            reasoning: true,
          }
        : undefined,
    promptPrice,
    completionPrice,
  });
}

function extractModelList(payload: unknown) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown[] })?.models)
        ? (payload as { models: unknown[] }).models
        : [];

  const models = source
    .map((item) => {
      if (typeof item === "string") {
        const vendor = inferProviderModelVendor({ id: item });
        const group = inferProviderModelGroup({ id: item, vendor });
        return {
          id: item,
          label: item,
          enabled: true,
          vendor: vendor || undefined,
          group,
        };
      }
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? record.name ?? "").trim();
      if (!id) return null;
      const label = String(record.name ?? record.display_name ?? record.displayName ?? record.label ?? id).trim() || id;
      const description = String(record.description ?? record.summary ?? "").trim();
      const vendor = inferVendorName(record, id, label, description, String(record.group ?? "").trim());
      const group = inferProviderModelGroup({
        id,
        label,
        description,
        vendor,
        group: String(record.group ?? "").trim() || undefined,
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
    .filter(Boolean);

  return normalizeProviderModels(models as ModelProviderConfig["models"]);
}

async function fetchOpenAiCompatibleModels(input: ModelProviderFetchInput) {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (input.apiKey.trim()) {
    headers.Authorization = `Bearer ${input.apiKey.trim()}`;
    headers["api-key"] = input.apiKey.trim();
    headers["x-api-key"] = input.apiKey.trim();
  }

  const response = await fetch(createModelListUrl(input.baseUrl), {
    method: "GET",
    headers,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `模型列表拉取失败（${response.status}）`);
  }

  const payload = text ? JSON.parse(text) : {};
  const models = extractModelList(payload);
  if (models.length === 0) {
    throw new Error("供应商已响应，但没有返回可用模型列表");
  }

  return models;
}

async function fetchOpenAiCompatibleModelsEnhanced(input: ModelProviderFetchInput) {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (input.apiKey.trim()) {
    headers.Authorization = `Bearer ${input.apiKey.trim()}`;
    headers["api-key"] = input.apiKey.trim();
    headers["x-api-key"] = input.apiKey.trim();
  }

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
      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      const text = await response.text();
      if (!response.ok) {
        if (index > 0) {
          return [];
        }
        throw new Error(text || `Fetch models failed: ${response.status}`);
      }

      const payload = text ? JSON.parse(text) : {};
      return extractModelList(payload);
    }),
  );

  const models = normalizeProviderModels(responses.flat());
  if (models.length === 0) {
    throw new Error("Provider responded, but no usable models were returned.");
  }

  return models;
}

function getExternalCodexSkillsRoot() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "skills");
}

function getManagedSkillsRoot(statePath: string) {
  return path.join(path.dirname(statePath), "skills");
}

function getManagedCodexSkillsRoot(statePath: string) {
  return path.join(getManagedSkillsRoot(statePath), "codex");
}

function getManagedCodexSystemSkillsRoot(statePath: string) {
  return path.join(getManagedCodexSkillsRoot(statePath), ".system");
}

function parseSkillFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = match?.[1] ?? "";
  const clean = (value: string) => value.trim().replace(/^['"]|['"]$/g, "");
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1] ? clean(frontmatter.match(/^name:\s*(.+)$/m)![1]) : "";
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]
    ? clean(frontmatter.match(/^description:\s*(.+)$/m)![1])
    : "";
  return { name, description };
}

async function readLocalCodexSkill(skillRoot: string, system: boolean): Promise<SkillConfig | null> {
  const skillFile = path.join(skillRoot, "SKILL.md");

  try {
    const content = await readFile(skillFile, "utf8");
    const parsed = parseSkillFrontmatter(content);
    const name = parsed.name || path.basename(skillRoot);
    return {
      id: sanitizeModelProviderId(name),
      name,
      description: parsed.description || "Codex 本地技能",
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

  return result.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

async function importExternalCodexSkills(statePath: string) {
  const externalRoot = getExternalCodexSkillsRoot();
  const managedRoot = getManagedCodexSkillsRoot(statePath);
  const managedSystemRoot = getManagedCodexSystemSkillsRoot(statePath);
  const entries = await readdir(externalRoot, { withFileTypes: true }).catch(() => []);

  await rm(managedRoot, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(managedRoot, { recursive: true }).catch(() => undefined);
  await mkdir(managedSystemRoot, { recursive: true }).catch(() => undefined);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (entry.name === ".system") {
      const systemEntries = await readdir(path.join(externalRoot, entry.name), { withFileTypes: true }).catch(() => []);
      for (const systemEntry of systemEntries) {
        if (!systemEntry.isDirectory()) continue;
        await cp(
          path.join(externalRoot, entry.name, systemEntry.name),
          path.join(managedSystemRoot, systemEntry.name),
          { recursive: true, force: true, errorOnExist: false },
        ).catch(() => undefined);
      }
      continue;
    }

    await cp(
      path.join(externalRoot, entry.name),
      path.join(managedRoot, entry.name),
      { recursive: true, force: true, errorOnExist: false },
    ).catch(() => undefined);
  }
}

async function listManagedCodexSkills(statePath: string) {
  return await listCodexSkillsFromRoot(getManagedCodexSkillsRoot(statePath));
}

async function syncManagedCodexSkills(statePath: string, state: PersistedWorkspaceState) {
  await importExternalCodexSkills(statePath);
  const discovered = await listManagedCodexSkills(statePath);
  const hidden = new Set(state.config.hiddenCodexSkillIds);
  const existingCodex = new Map(
    state.config.skills
      .filter((skill) => skill.kind === "codex")
      .map((skill) => [skill.id, skill] as const),
  );
  const commandSkills = state.config.skills.filter((skill) => skill.kind !== "codex");

  const codexSkills = discovered
    .filter((skill) => !hidden.has(skill.id))
    .map((skill) => {
      const existing = existingCodex.get(skill.id);
      return {
        ...skill,
        enabled: existing?.enabled !== false,
      };
    });

  return {
    ...state,
    config: {
      ...state.config,
      skills: [...commandSkills, ...codexSkills],
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

async function extractDocxText(filePath: string) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.replace(/\r\n/g, "\n");
}

async function readAttachmentInlineContent(filePath: string, mimeType: string, kind: PreviewKind) {
  if (INLINE_TEXT_KINDS.has(kind)) {
    return {
      content: await readFile(filePath, "utf8"),
      kind,
      mimeType: "text/plain",
    };
  }

  if (isDocxDocument(filePath, mimeType)) {
    return {
      content: await extractDocxText(filePath),
      kind: "text" as const,
      mimeType: "text/plain",
    };
  }

  return null;
}

function normalizeName(value: string) {
  const trimmed = value.trim();
  return trimmed || "untitled";
}

function filePathFromUrl(url: string) {
  if (!url.startsWith("file:")) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
  } catch {
    return null;
  }
}

function makeFileAttachment(filePath: string, content: string, mimeType: string, dataUrl?: string): FileDropEntry {
  return {
    id: randomUUID(),
    name: path.basename(filePath),
    path: filePath,
    size: Buffer.byteLength(content),
    mimeType,
    dataUrl,
  };
}

function byteLengthFromDataUrl(url: string) {
  const [, payload = ""] = url.split(",", 2);
  const normalized = payload.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attachmentFromFilePart(part: OpencodeFilePart): Promise<FileDropEntry> {
  const localPath =
    part.source?.type === "file" ? part.source.path ?? filePathFromUrl(part.url) : filePathFromUrl(part.url);
  const displayPath = localPath ?? part.filename ?? part.url;
  let size = 0;

  if (localPath) {
    size = await stat(localPath).then((entry) => entry.size).catch(() => 0);
  } else if (part.url.startsWith("data:")) {
    size = byteLengthFromDataUrl(part.url);
  }

  return {
    id: part.id,
    name: part.filename ?? path.basename(displayPath) ?? "attachment",
    path: displayPath,
    size,
    mimeType: part.mime,
    kind: detectKind(displayPath, part.mime),
    url: part.url,
  };
}

function formatToolInput(input: Record<string, unknown>) {
  if (!input || Object.keys(input).length === 0) return "";
  return JSON.stringify(input, null, 2);
}

type SessionExecutionState = {
  busy: boolean;
  blockedOnQuestion: boolean;
};

function isSessionActivelyRunning(state: SessionExecutionState) {
  return state.busy || state.blockedOnQuestion;
}

async function toolMessageFromPart(
  part: OpencodeToolPart,
  executionState: SessionExecutionState,
): Promise<ChatMessage> {
  const input = formatToolInput(part.state.input);
  const lines: string[] = [];
  const attachments =
    part.state.status === "completed" ? await Promise.all((part.state.attachments ?? []).map(attachmentFromFilePart)) : [];

  if (input) {
    lines.push("Input:");
    lines.push(input);
  }

  if (part.state.status === "completed") {
    if (part.state.output?.trim()) {
      if (lines.length > 0) lines.push("");
      lines.push(part.state.output.trim());
    }
  } else if (part.state.status === "error") {
    if (lines.length > 0) lines.push("");
    lines.push(part.state.error.trim());
  } else if (part.state.status === "running") {
    if (part.state.title?.trim()) {
      if (lines.length > 0) lines.push("");
      lines.push(part.state.title.trim());
    } else if (lines.length === 0) {
      lines.push("Tool is running...");
    }
  } else if (lines.length === 0) {
    lines.push("Tool call queued.");
  }

  const createdAt =
    part.state.status === "pending"
      ? Date.now()
      : part.state.status === "running"
        ? part.state.time.start
        : part.state.time.start;

  return {
    id: part.callID,
    role: "tool",
    toolName: part.tool,
    text: lines.join("\n"),
    createdAt,
    status:
      part.state.status === "completed"
        ? "done"
        : part.state.status === "error"
          ? "error"
          : isSessionActivelyRunning(executionState)
            ? "loading"
            : "paused",
    attachments,
  };
}

function baseMessageText(parts: OpencodePart[]) {
  const sanitizeMessageText = (value: string) =>
    value
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
      .replace(/<\/?system-reminder>/gi, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const textParts = parts.filter(
    (part): part is Extract<OpencodePart, { type: "text" }> => part.type === "text" && !part.synthetic,
  );
  const agentParts = parts.filter(
    (part): part is Extract<OpencodePart, { type: "agent" }> => part.type === "agent",
  );
  const subtaskParts = parts.filter(
    (part): part is Extract<OpencodePart, { type: "subtask" }> => part.type === "subtask",
  );
  const blocks: string[] = [];

  if (textParts.length > 0) {
    blocks.push(
      textParts
        .map((part) => sanitizeMessageText(part.text))
        .filter(Boolean)
        .join("\n\n")
        .trim(),
    );
  }

  if (agentParts.length > 0) {
    blocks.push(agentParts.map((part) => `@${part.name}`).join("\n"));
  }

  if (subtaskParts.length > 0) {
    blocks.push(
      subtaskParts
        .map((part) => `${part.description}\n${part.prompt}`.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return sanitizeMessageText(blocks.filter(Boolean).join("\n\n").trim());
}

function messageTimestamp(message: OpencodeSessionMessage) {
  if (message.info.role === "assistant") {
    return message.info.time.completed ?? message.info.time.created;
  }
  return message.info.time.created;
}

async function convertMessages(
  messages: OpencodeSessionMessage[],
  executionState: SessionExecutionState,
): Promise<ChatMessage[]> {
  const result: ChatMessage[] = [];

  for (const message of messages) {
    const isPendingAssistant =
      message.info.role === "assistant" &&
      !message.info.error &&
      message.info.time.completed === undefined;
    const fileAttachments = await Promise.all(
      message.parts
        .filter((part): part is OpencodeFilePart => part.type === "file")
        .map(attachmentFromFilePart),
    );

    for (const part of message.parts) {
      if (part.type === "tool") {
        result.push(await toolMessageFromPart(part, executionState));
      }
    }

    const text = baseMessageText(message.parts) || message.info.error?.data?.message || "";
    if (!text && fileAttachments.length === 0 && message.info.role === "assistant" && !isPendingAssistant) {
      continue;
    }

    result.push({
      id: message.info.id,
      role: message.info.role,
      text,
      createdAt: messageTimestamp(message),
      attachments: fileAttachments,
      status:
        message.info.error
          ? "error"
          : isPendingAssistant
            ? isSessionActivelyRunning(executionState)
              ? "loading"
              : "paused"
            : "done",
    });
  }

  if (executionState.busy && !result.some((message) => message.status === "loading")) {
    const anchorMessage = [...messages].reverse().find((message) => message.info.role === "user") ?? messages.at(-1);
    result.push({
      id: `pending:${anchorMessage?.info.id ?? "assistant"}`,
      role: "assistant",
      text: "",
      createdAt: anchorMessage ? messageTimestamp(anchorMessage) + 1 : Date.now(),
      status: "loading",
    });
  }

  return result.sort((left, right) => left.createdAt - right.createdAt);
}

export class WorkspaceService {
  private readonly runtime = new OpencodeRuntime();
  private readonly knowledge: KnowledgeService;
  private activeThreadId: string = "";
  private threadSessionMap = new Map<string, string>();
  private threadSummaryCache = new Map<string, ThreadSummary>();

  constructor(private readonly statePath: string) {
    this.knowledge = new KnowledgeService(path.join(path.dirname(statePath), "knowledge"));
  }

  async bootstrap(): Promise<BootstrapPayload> {
    const state = await this.loadState();
    const [availableSkills, availableAgents, mcpStatuses] = await Promise.all([
      this.runtime.listSkills(state.config).catch(() => []),
      this.runtime.listAgents(state.config).catch(() => []),
      this.runtime.listMcpStatuses(state.config).catch(() => []),
    ]);

    const threads = await this.listThreads();
    const currentThread = this.activeThreadId ? await this.getThread(this.activeThreadId).catch(() => null) : null;
    const pendingQuestions = await this.runtime.listQuestions(state.config).catch(() => []);

    return {
      snapshotAt: Date.now(),
      config: state.config,
      threads,
      activeThreadId: this.activeThreadId,
      currentThread,
      availableSkills,
      availableAgents,
      mcpStatuses,
      pendingQuestions: pendingQuestions.map((q) => ({
        id: q.id,
        sessionID: q.sessionID,
        questions: q.questions.map((item) => ({
          header: item.header,
          question: item.question,
          options: item.options,
          multiple: item.multiple,
          custom: item.custom,
        })),
        tool: q.tool,
      })),
    };
  }

  async getConfigSnapshot(): Promise<AppConfig> {
    const state = await this.loadState();
    return state.config;
  }

  async shutdown() {
    await this.runtime.dispose();
  }

  private rememberThreadSummary(summary: ThreadSummary) {
    const previous = this.threadSummaryCache.get(summary.id);
    const normalized = {
      ...summary,
      title: formatThreadTitle(summary.title, previous?.title || summary.lastMessage || FALLBACK_THREAD_TITLE),
    };
    this.threadSummaryCache.set(summary.id, normalized);
    return normalized;
  }

  private syncPersistedThread(state: PersistedWorkspaceState, summary: ThreadSummary | ThreadRecord) {
    const normalized = this.rememberThreadSummary({
      id: summary.id,
      title: summary.title || DEFAULT_THREAD_TITLE,
      updatedAt: summary.updatedAt,
      lastMessage: summary.lastMessage || "",
      messageCount: summary.messageCount,
      archived: summary.archived,
      workspaceRoot: summary.workspaceRoot,
    });
    const nextThreads = state.threads.filter((thread) => thread.id !== normalized.id);
    nextThreads.push(normalized);
    state.threads = sortPersistedThreads(nextThreads);
    return normalized;
  }

  private removePersistedThread(state: PersistedWorkspaceState, threadId: string) {
    state.threads = state.threads.filter((thread) => thread.id !== threadId);
    if (state.activeThreadId === threadId) {
      state.activeThreadId = "";
    }
  }

  async getThreadProgress(threadId: string) {
    const state = await this.loadState();
    const sessionId = this.threadSessionMap.get(threadId) || threadId;
    const [statuses, questions] = await Promise.all([
      this.runtime.listSessionStatuses(state.config).catch(() => ({})),
      this.runtime.listQuestions(state.config).catch(() => []),
    ]);
    const sessionStatus = statuses[sessionId];
    return {
      busy: sessionStatus?.type === "busy" || sessionStatus?.type === "retry",
      blockedOnQuestion: questions.some((question) => question.sessionID === sessionId),
    };
  }

  async runSkill(input: SkillRunInput): Promise<SkillRunResult> {
    const state = await this.loadState();

    // Use active thread or create a new one
    let threadId = input.threadId || this.activeThreadId;
    if (!threadId) {
      const payload = await this.createThread("新会话");
      threadId = payload.activeThreadId;
    }

    const sessionId = this.threadSessionMap.get(threadId) || threadId;
    await this.runtime.commandAsync(state.config, sessionId, input.skillId, input.prompt || "", []);

    const thread = await this.getThread(threadId);
    return { thread };
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
        state.config.hiddenCodexSkillIds = Array.from(
          new Set([...state.config.hiddenCodexSkillIds, target.id]),
        );
      }
    }

    state.config.skills = state.config.skills.filter((skill) => skill.id !== skillId);
    await this.saveState(state);
    return await this.bootstrap();
  }

  async fetchProviderModels(input: ModelProviderFetchInput): Promise<ModelProviderFetchResult> {
    if (input.kind !== "openai-compatible") {
      throw new Error("当前仅支持 OpenAI 兼容供应商自动拉取模型列表");
    }

    return {
      providerId: input.providerId,
      models: await fetchOpenAiCompatibleModelsEnhanced(input),
    };
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
    const state = await this.loadState();
    return await this.knowledge.addFiles(state.config, input);
  }

  async addKnowledgeDirectory(input: KnowledgeAddDirectoryInput): Promise<KnowledgeCatalogPayload> {
    const state = await this.loadState();
    return await this.knowledge.addDirectory(state.config, input);
  }

  async addKnowledgeNote(input: KnowledgeAddNoteInput): Promise<KnowledgeCatalogPayload> {
    const state = await this.loadState();
    return await this.knowledge.addNote(state.config, input);
  }

  async addKnowledgeUrl(input: KnowledgeAddUrlInput): Promise<KnowledgeCatalogPayload> {
    const state = await this.loadState();
    return await this.knowledge.addUrl(state.config, input);
  }

  async addKnowledgeWebsite(input: KnowledgeAddUrlInput): Promise<KnowledgeCatalogPayload> {
    const state = await this.loadState();
    return await this.knowledge.addWebsite(state.config, input);
  }

  async deleteKnowledgeItem(input: KnowledgeDeleteItemInput): Promise<KnowledgeCatalogPayload> {
    return await this.knowledge.deleteItem(input);
  }

  async searchKnowledgeBases(input: {
    query: string;
    knowledgeBaseIds?: string[];
    documentCount?: number;
  }): Promise<KnowledgeSearchPayload> {
    const state = await this.loadState();
    return await this.knowledge.search(state.config, input);
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
      const mimeType = contentType.split(";")[0]?.trim() || "text/html";
      const kind =
        mimeType === "application/pdf"
          ? "pdf"
          : mimeType.startsWith("text/html")
          ? "web"
          : mimeType.startsWith("text/markdown")
            ? "markdown"
            : mimeType.startsWith("text/")
              ? "text"
              : "binary";

      if (kind === "pdf") {
        return {
          title: payload.title ?? payload.url,
          path: payload.url,
          kind,
          mimeType,
          content: "",
          url: payload.url,
        };
      }

      const body = await response.text();

      return {
        title: payload.title ?? payload.url,
        path: payload.url,
        kind,
        mimeType,
        content: body,
        url: payload.url,
      };
    }

    if (payload.url?.startsWith("data:")) {
      const [header, content] = payload.url.split(",", 2);
      const mimeType = header.match(/^data:(.+?);base64$/)?.[1] ?? "text/plain";
      const kind =
        (payload.kind as FilePreviewPayload["kind"]) ??
        (mimeType.startsWith("image/") ? "image" : mimeType === "application/pdf" ? "pdf" : "text");
      return {
        title: payload.title ?? "Preview",
        path: payload.path ?? null,
        kind,
        mimeType,
        content:
          kind === "image" || kind === "pdf"
            ? payload.url
            : Buffer.from(content ?? "", "base64").toString("utf8"),
        url: kind === "html" ? payload.url : undefined,
      };
    }

    const directPath =
      payload.path && !payload.path.startsWith("file:") && !payload.path.startsWith("data:") && !payload.path.startsWith("http://") && !payload.path.startsWith("https://")
        ? payload.path
        : null;
    const resolvedPath = directPath ?? (payload.url ? filePathFromUrl(payload.url) : null);
    if (!resolvedPath) {
      throw new Error("Missing preview path");
    }

    const fileName = path.basename(resolvedPath);
    const mimeType = String(mime.lookup(resolvedPath) || "application/octet-stream");
    const kind = detectKind(resolvedPath, mimeType);

    if (kind === "image" || kind === "pdf") {
      const buffer = await readFile(resolvedPath);
      return {
        title: payload.title ?? fileName,
        path: resolvedPath,
        kind,
        mimeType,
        content: `data:${mimeType};base64,${buffer.toString("base64")}`,
        url: kind === "pdf" ? pathToFileURL(resolvedPath).href : undefined,
      };
    }

    try {
      const inline = await readAttachmentInlineContent(resolvedPath, mimeType, kind);
      if (inline) {
        return {
          title: payload.title ?? fileName,
          path: resolvedPath,
          kind: inline.kind,
          mimeType: inline.mimeType,
          content: inline.content,
        };
      }
    } catch {
      // Fall back to the original file preview below if inline extraction fails.
    }

    if (kind === "binary") {
      return {
        title: payload.title ?? fileName,
        path: resolvedPath,
        kind,
        mimeType,
        content: "",
      };
    }

    const content = await readFile(resolvedPath, "utf8");
    return {
      title: payload.title ?? fileName,
      path: resolvedPath,
      kind,
      mimeType,
      content,
      url: kind === "html" ? pathToFileURL(resolvedPath).href : undefined,
    };
  }

  async listObservedTools(): Promise<WorkspaceToolCatalog> {
    return {
      fetchedAt: Date.now(),
      tools: Object.entries(BUILTIN_TOOL_DESCRIPTIONS).map(([name, description]) => ({
        id: `runtime:${name}`,
        name,
        description,
        source: "runtime" as const,
        origin: "运行时工具",
        observed: false,
      })),
    };
  }

  async listThreads(): Promise<ThreadSummary[]> {
    const state = await this.loadState();
    const previousSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    const managedSessions = await this.runtime.listSessions(state.config).catch(() => null);

    if (!managedSessions) {
      return sortPersistedThreads(state.threads);
    }

    if (state.threads.length === 0 && managedSessions.length > 0) {
      const latestSession = [...managedSessions].sort((left, right) => right.time.updated - left.time.updated)[0];
      if (latestSession) {
        this.syncPersistedThread(state, {
          id: latestSession.id,
          title: formatThreadTitle(latestSession.title, ""),
          updatedAt: latestSession.time.updated,
          lastMessage: "",
          messageCount: 0,
          archived: !!latestSession.time.archived,
          workspaceRoot: latestSession.directory || undefined,
        });
        if (!state.activeThreadId) {
          state.activeThreadId = latestSession.id;
        }
      }
    }

    const managedSessionsById = new Map(managedSessions.map((session) => [session.id, session] as const));
    const managedSummaries = sortPersistedThreads(
      state.threads
        .map((storedThread) => {
          const session = managedSessionsById.get(storedThread.id);
          if (!session) {
            return null;
          }
          this.threadSessionMap.set(session.id, session.id);
          const cached = this.threadSummaryCache.get(session.id);
          return this.rememberThreadSummary({
            id: session.id,
            title: formatThreadTitle(
              session.title,
              cached?.title || storedThread.title || storedThread.lastMessage || cached?.lastMessage || "",
            ),
            updatedAt: Math.max(session.time.updated, cached?.updatedAt ?? 0, storedThread.updatedAt),
            lastMessage: cached?.lastMessage || storedThread.lastMessage || "",
            messageCount: Math.max(cached?.messageCount ?? 0, storedThread.messageCount),
            archived: !!session.time.archived,
            workspaceRoot: session.directory || cached?.workspaceRoot || storedThread.workspaceRoot,
          });
        })
        .filter((thread): thread is ThreadSummary => Boolean(thread)),
    );

    state.threads = managedSummaries;
    if (state.activeThreadId && !managedSummaries.some((thread) => thread.id === state.activeThreadId)) {
      state.activeThreadId = "";
    }
    if (!this.activeThreadId && state.activeThreadId) {
      this.activeThreadId = state.activeThreadId;
    }

    const nextSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    if (previousSnapshot !== nextSnapshot) {
      await this.saveState(state);
    }

    return managedSummaries;
    const sessions = await this.runtime.listSessions(state.config).catch(() => []);

    const summaries = sessions.map((session) => {
      this.threadSessionMap.set(session.id, session.id);
      const cached = this.threadSummaryCache.get(session.id);
      return this.rememberThreadSummary({
        id: session.id,
        title: session.title || cached?.title || DEFAULT_THREAD_TITLE,
        updatedAt: Math.max(session.time.updated, cached?.updatedAt ?? 0),
        lastMessage: cached?.lastMessage || "",
        messageCount: cached?.messageCount ?? 0,
        archived: !!session.time.archived,
        workspaceRoot: session.directory || cached?.workspaceRoot,
      });
    });

    return summaries.sort((left, right) => right.updatedAt - left.updatedAt);

    return sessions.map((session) => {
      this.threadSessionMap.set(session.id, session.id);
      return {
        id: session.id,
        title: session.title || "新会话",
        updatedAt: session.time.updated,
        lastMessage: "",
        messageCount: 0,
        archived: !!session.time.archived,
        workspaceRoot: session.directory || undefined,
      };
    });
  }

  async getThread(threadId: string): Promise<ThreadRecord> {
    const state = await this.loadState();
    const sessionId = this.threadSessionMap.get(threadId) || threadId;

    const [session, messages, statuses, questions] = await Promise.all([
      this.runtime.getSession(state.config, sessionId),
      this.runtime.listMessages(state.config, sessionId),
      this.runtime.listSessionStatuses(state.config).catch(() => ({})),
      this.runtime.listQuestions(state.config).catch(() => []),
    ]);

    const sessionStatus = statuses[sessionId];
    const executionState: SessionExecutionState = {
      busy: sessionStatus?.type === "busy" || sessionStatus?.type === "retry",
      blockedOnQuestion: questions.some((question) => question.sessionID === sessionId),
    };

    const chatMessages = await convertMessages(messages, executionState);
    const derivedTitle = deriveThreadTitleFromMessages(chatMessages);
    const lastMessage =
      [...chatMessages]
        .reverse()
        .find((message) => message.text.trim())?.text || "";
    const thread: ThreadRecord = {
      id: session.id,
      title: formatThreadTitle(session.title, derivedTitle || lastMessage),
      updatedAt: session.time.updated,
      lastMessage,
      messageCount: chatMessages.length,
      archived: !!session.time.archived,
      workspaceRoot: session.directory || undefined,
      messages: chatMessages,
    };
    const previousSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    this.threadSessionMap.set(thread.id, session.id);
    this.syncPersistedThread(state, thread);
    if (state.activeThreadId === threadId) {
      state.activeThreadId = thread.id;
    }
    const nextSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    if (previousSnapshot !== nextSnapshot) {
      await this.saveState(state);
    }
    return thread;

    return {
      id: session.id,
      title: session.title || "新会话",
      updatedAt: session.time.updated,
      lastMessage: chatMessages.length > 0 ? chatMessages[chatMessages.length - 1]?.text || "" : "",
      messageCount: chatMessages.length,
      archived: !!session.time.archived,
      workspaceRoot: session.directory || undefined,
      messages: chatMessages,
    };
  }

  async createThread(title?: string): Promise<BootstrapPayload> {
    const state = await this.loadState();
    const previousSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    const session = await this.runtime.createSession(state.config, title?.trim() || DEFAULT_THREAD_TITLE);

    this.threadSessionMap.set(session.id, session.id);
    this.activeThreadId = session.id;

    const currentThread: ThreadRecord = {
      id: session.id,
      title: session.title || "新会话",
      updatedAt: session.time.updated,
      lastMessage: "",
      messageCount: 0,
      archived: false,
      workspaceRoot: session.directory || undefined,
      messages: [],
    };
    this.rememberThreadSummary({
      id: currentThread.id,
      title: currentThread.title,
      updatedAt: currentThread.updatedAt,
      lastMessage: currentThread.lastMessage,
      messageCount: currentThread.messageCount,
      archived: currentThread.archived,
      workspaceRoot: currentThread.workspaceRoot,
    });
    state.activeThreadId = currentThread.id;
    this.syncPersistedThread(state, currentThread);
    const nextSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    if (previousSnapshot !== nextSnapshot) {
      await this.saveState(state);
    }

    return await this.bootstrap();
  }

  async createBackgroundThread(title?: string): Promise<ThreadRecord> {
    const state = await this.loadState();
    const previousSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    const session = await this.runtime.createSession(state.config, title?.trim() || DEFAULT_THREAD_TITLE);

    this.threadSessionMap.set(session.id, session.id);

    const thread: ThreadRecord = {
      id: session.id,
      title: session.title || DEFAULT_THREAD_TITLE,
      updatedAt: session.time.updated,
      lastMessage: "",
      messageCount: 0,
      archived: false,
      workspaceRoot: session.directory || undefined,
      messages: [],
    };
    this.rememberThreadSummary({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      lastMessage: thread.lastMessage,
      messageCount: thread.messageCount,
      archived: thread.archived,
      workspaceRoot: thread.workspaceRoot,
    });
    this.syncPersistedThread(state, thread);
    const nextSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    if (previousSnapshot !== nextSnapshot) {
      await this.saveState(state);
    }
    return thread;
  }

  async setActiveThread(threadId: string): Promise<ThreadRecord> {
    const thread = await this.getThread(threadId);
    const state = await this.loadState();
    const previousSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    this.activeThreadId = thread.id;
    state.activeThreadId = thread.id;
    this.syncPersistedThread(state, thread);
    const nextSnapshot = JSON.stringify({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    });
    if (previousSnapshot !== nextSnapshot) {
      await this.saveState(state);
    }
    return thread;
  }

  async resetThread(threadId: string): Promise<ThreadRecord> {
    const state = await this.loadState();
    const sessionId = this.threadSessionMap.get(threadId) || threadId;

    await this.runtime.deleteSession(state.config, sessionId);
    const newSession = await this.runtime.createSession(state.config, "新会话");

    this.threadSessionMap.set(threadId, newSession.id);
    return await this.getThread(threadId);
  }

  async archiveThread(threadId: string, archived: boolean): Promise<BootstrapPayload> {
    // OpenCode runtime doesn't have a direct archive API
    // We'll need to track this in our own state or skip for now
    // For now, this is a no-op
    return await this.bootstrap();
  }

  async deleteThread(threadId: string): Promise<BootstrapPayload> {
    const state = await this.loadState();
    const sessionId = this.threadSessionMap.get(threadId) || threadId;

    await this.runtime.deleteSession(state.config, sessionId);
    this.threadSessionMap.delete(threadId);
    this.threadSummaryCache.delete(threadId);
    this.removePersistedThread(state, threadId);

    if (this.activeThreadId === threadId) {
      this.activeThreadId = "";
    }
    if (state.activeThreadId === threadId) {
      state.activeThreadId = "";
    }
    await this.saveState(state);

    return await this.bootstrap();
  }

  async sendMessage(payload: SendMessageInput): Promise<SendMessageResult> {
    const state = await this.loadState();
    const threadId = payload.threadId || this.activeThreadId;

    if (!threadId) {
      throw new Error("No active thread");
    }

    const sessionId = this.threadSessionMap.get(threadId) || threadId;
    const attachments = payload.attachments || [];

    await this.runtime.promptAsync(state.config, sessionId, payload.message, attachments);
    const thread = await this.getThread(threadId);
    return { thread };
  }

  async abortThread(threadId?: string): Promise<BootstrapPayload> {
    const state = await this.loadState();
    const targetThreadId = threadId || this.activeThreadId;

    if (targetThreadId) {
      const sessionId = this.threadSessionMap.get(targetThreadId) || targetThreadId;
      let forceRestart = false;

      try {
        await this.runtime.abortSession(state.config, sessionId);
      } catch {
        forceRestart = true;
      }

      if (!forceRestart) {
        const deadline = Date.now() + 600;
        while (Date.now() < deadline) {
          const statuses = await this.runtime.listSessionStatuses(state.config).catch(() => ({}));
          const sessionStatus = statuses[sessionId];
          const busy = sessionStatus?.type === "busy" || sessionStatus?.type === "retry";
          if (!busy) {
            break;
          }
          await delay(50);
        }

        const statuses = await this.runtime.listSessionStatuses(state.config).catch(() => ({}));
        const sessionStatus = statuses[sessionId];
        forceRestart = sessionStatus?.type === "busy" || sessionStatus?.type === "retry";
      }

      if (forceRestart) {
        await this.runtime.dispose();
      }
    }

    return await this.bootstrap();
  }

  async replyQuestion(requestId: string, sessionId: string, answers: string[][]): Promise<BootstrapPayload> {
    const state = await this.loadState();
    await this.runtime.replyQuestion(state.config, requestId, answers);
    return await this.bootstrap();
  }

  async rejectQuestion(requestId: string, sessionId: string): Promise<BootstrapPayload> {
    const state = await this.loadState();
    await this.runtime.rejectQuestion(state.config, requestId);
    return await this.bootstrap();
  }

  async setThreadWorkspace(threadId: string, workspaceRoot: string): Promise<BootstrapPayload> {
    // OpenCode runtime doesn't have a direct API to change workspace after creation
    // This would need to be tracked in our own state or implemented in runtime
    // For now, this is a no-op
    return await this.bootstrap();
  }

  private async readSelectedFile(filePath: string): Promise<FileDropEntry> {
    const mimeType = String(mime.lookup(filePath) || "application/octet-stream");
    const kind = detectKind(filePath, mimeType);
    const size = await stat(filePath).then((entry) => entry.size).catch(() => 0);

    if (kind === "image") {
      const buffer = await readFile(filePath);
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      return {
        ...makeFileAttachment(filePath, buffer.toString("base64"), mimeType, dataUrl),
        kind,
        size,
      };
    }

    try {
      const inline = await readAttachmentInlineContent(filePath, mimeType, kind);
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
    } catch {
      // Fall through to the original file reference when inline extraction fails.
    }

    return {
      id: randomUUID(),
      name: path.basename(filePath),
      path: filePath,
      size,
      mimeType,
      kind,
    };
  }

  private async loadState(): Promise<PersistedWorkspaceState> {
    const fallback = createEmptyState();
    const state = await readJsonFile<Partial<PersistedWorkspaceState>>(this.statePath, fallback);
    const normalized = normalizeState(state);
    const synced = await syncManagedCodexSkills(this.statePath, normalized);
    if (JSON.stringify(state) !== JSON.stringify(synced)) {
      await this.saveState(synced);
    }
    if (!this.activeThreadId && synced.activeThreadId) {
      this.activeThreadId = synced.activeThreadId;
    }
    for (const thread of synced.threads) {
      this.threadSessionMap.set(thread.id, thread.id);
      this.threadSummaryCache.set(thread.id, thread);
    }
    return synced;
  }

  private async saveState(state: PersistedWorkspaceState) {
    await writeJsonFile(this.statePath, state);
  }
}
