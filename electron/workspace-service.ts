import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mime from "mime-types";

import {
  createRuntimeModelId,
  ensureActiveModelId,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "../src/lib/model-config";
import {
  inferProviderModelCapabilities,
  inferProviderModelGroup,
  inferProviderModelVendor,
} from "../src/lib/model-metadata";
import { KnowledgeService } from "./knowledge-service";
import { readJsonFile, writeJsonFile } from "./store";
import {
  OpencodeRuntime,
} from "./opencode-runtime";
import type { OpencodeTextPart } from "./opencode-runtime";
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
};

const BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  question: "Ask the user for confirmation or missing input before continuing.",
  webfetch: "Fetch a web page and extract the parts needed for the current task.",
};

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
    },
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
  if (mimeType?.includes("text/html")) return "html";
  if ([".md", ".mdx"].includes(extension)) return "markdown";
  if ([".html", ".htm"].includes(extension)) return "html";
  if ([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".yml", ".yaml", ".py", ".go", ".rs", ".java", ".sh", ".ps1"].includes(extension)) {
    return "code";
  }
  if ([".txt", ".log", ".out", ".err"].includes(extension)) return "text";
  return "binary";
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

export class WorkspaceService {
  private readonly runtime = new OpencodeRuntime();
  private readonly knowledge: KnowledgeService;
  private activeThreadId: string = "";
  private threadSessionMap = new Map<string, string>();

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

  async shutdown() {
    await this.runtime.dispose();
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
      const body = await response.text();
      const kind =
        mimeType.startsWith("text/html")
          ? "web"
          : mimeType.startsWith("text/markdown")
            ? "markdown"
            : mimeType.startsWith("text/")
              ? "text"
              : "binary";

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
      const kind = (payload.kind as FilePreviewPayload["kind"]) ?? (mimeType.startsWith("image/") ? "image" : "text");
      return {
        title: payload.title ?? "Preview",
        path: payload.path ?? null,
        kind,
        mimeType,
        content: kind === "image" ? payload.url : Buffer.from(content ?? "", "base64").toString("utf8"),
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

    if (kind === "image") {
      const buffer = await readFile(resolvedPath);
      return {
        title: payload.title ?? fileName,
        path: resolvedPath,
        kind,
        mimeType,
        content: `data:${mimeType};base64,${buffer.toString("base64")}`,
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
    const sessions = await this.runtime.listSessions(state.config).catch(() => []);

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

    const [session, messages] = await Promise.all([
      this.runtime.getSession(state.config, sessionId),
      this.runtime.listMessages(state.config, sessionId),
    ]);

    const chatMessages: ChatMessage[] = messages.map((msg) => {
      const textParts = msg.parts.filter((p) => p.type === "text") as OpencodeTextPart[];
      const text = textParts.map((p) => p.text).join("\n");

      return {
        id: msg.info.id,
        role: msg.info.role === "user" ? "user" : "assistant",
        text,
        createdAt: msg.info.time.created,
        status: msg.info.time.completed ? "done" : msg.info.error ? "error" : "loading",
      };
    });

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
    const session = await this.runtime.createSession(state.config, title);

    this.threadSessionMap.set(session.id, session.id);
    this.activeThreadId = session.id;

    const threads = await this.listThreads();
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

    return {
      config: state.config,
      threads,
      activeThreadId: session.id,
      currentThread,
      availableSkills: [],
      availableAgents: [],
      mcpStatuses: [],
      pendingQuestions: [],
    };
  }

  async setActiveThread(threadId: string): Promise<ThreadRecord> {
    this.activeThreadId = threadId;
    return await this.getThread(threadId);
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

    if (this.activeThreadId === threadId) {
      this.activeThreadId = "";
    }

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

    // Fire async prompt, then poll until the assistant reply appears
    await this.runtime.promptAsync(state.config, sessionId, payload.message, attachments);

    // Poll for completion (assistant message with completed status)
    const maxWait = 120_000;
    const interval = 1_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const statuses = await this.runtime.listSessionStatuses(state.config).catch(() => ({}));
      const sessionStatus = statuses[sessionId];
      if (!sessionStatus || sessionStatus.type === "idle") {
        break;
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    const thread = await this.getThread(threadId);
    return { thread };
  }

  async abortThread(threadId?: string): Promise<BootstrapPayload> {
    const state = await this.loadState();
    const targetThreadId = threadId || this.activeThreadId;

    if (targetThreadId) {
      const sessionId = this.threadSessionMap.get(targetThreadId) || targetThreadId;
      await this.runtime.abortSession(state.config, sessionId);
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

    if (kind === "image") {
      const buffer = await readFile(filePath);
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      return makeFileAttachment(filePath, buffer.toString("base64"), mimeType, dataUrl);
    }

    try {
      const content = await readFile(filePath, "utf8");
      return {
        id: randomUUID(),
        name: path.basename(filePath),
        path: filePath,
        size: Buffer.byteLength(content),
        mimeType,
      };
    } catch {
      const buffer = await readFile(filePath);
      return {
        id: randomUUID(),
        name: path.basename(filePath),
        path: filePath,
        size: buffer.length,
        mimeType,
      };
    }
  }

  private async loadState(): Promise<PersistedWorkspaceState> {
    const fallback = createEmptyState();
    const state = await readJsonFile<Partial<PersistedWorkspaceState>>(this.statePath, fallback);
    const normalized = normalizeState(state);
    const synced = await syncManagedCodexSkills(this.statePath, normalized);
    if (JSON.stringify(state) !== JSON.stringify(synced)) {
      await this.saveState(synced);
    }
    return synced;
  }

  private async saveState(state: PersistedWorkspaceState) {
    await writeJsonFile(this.statePath, state);
  }
}
