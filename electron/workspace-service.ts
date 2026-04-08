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
  type OpencodeFilePart,
  type OpencodePart,
  type OpencodeSessionInfo,
  type OpencodeSessionMessage,
  type OpencodeToolPart,
} from "./opencode-runtime";
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
  threadMeta: Record<string, PersistedThreadMeta>;
}

interface PersistedThreadMeta {
  title?: string;
  archived?: boolean;
  workspaceRoot?: string;
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
    activeThreadId: "",
    threadMeta: {},
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
    activeThreadId: typeof state?.activeThreadId === "string" ? state.activeThreadId : "",
    threadMeta:
      state?.threadMeta && typeof state.threadMeta === "object"
        ? Object.fromEntries(
            Object.entries(state.threadMeta)
              .map(([threadId, value]) => {
                const meta = value as PersistedThreadMeta | null | undefined;
                const title = typeof meta?.title === "string" ? meta.title.trim() : "";
                const workspaceRoot = typeof meta?.workspaceRoot === "string" ? meta.workspaceRoot.trim() : "";
                return [
                  threadId,
                  {
                    ...(title ? { title } : {}),
                    ...(workspaceRoot ? { workspaceRoot } : {}),
                    ...(meta?.archived !== undefined ? { archived: meta.archived === true } : {}),
                  } satisfies PersistedThreadMeta,
                ] as const;
              })
              .filter(([, value]) => Object.keys(value).length > 0),
          )
        : {},
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
          { recursive: true, force: false, errorOnExist: false },
        ).catch(() => undefined);
      }
      continue;
    }

    await cp(
      path.join(externalRoot, entry.name),
      path.join(managedRoot, entry.name),
      { recursive: true, force: false, errorOnExist: false },
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

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSessionTitle(title?: string | null) {
  if (!title || title === "New Thread") return "新会话";
  return title;
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

function isUntitledSessionTitle(title?: string | null) {
  return normalizeSessionTitle(title) === "新会话";
}

function stripMarkdownDecoration(text: string) {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleCandidate(text: string) {
  let candidate = stripMarkdownDecoration(text)
    .replace(/^(请帮我|请帮忙|请你|请先|请|帮我|帮忙|麻烦你|麻烦|可以帮我|可以|能否|能不能|我想请你|我想|想请你)\s*/u, "")
    .replace(/^(整理|总结|汇总|生成|草拟|撰写|写一封|写封|拟一封|安排|规划|输出|制作|优化|润色|分析|提炼|列出|改写|翻译|做个|做一份)\s*/u, "")
    .replace(/^(一下|一下子|一下吧|一个|一份|一封|一版|一套|一篇|今天的|今天|这份|这个|关于)\s*/u, "")
    .replace(/^(以下是|下面是|这是|已为你整理|为你整理|根据你的要求|按照你的要求|好的[,，]?|当然[,，]?|可以[,，]?)/u, "")
    .trim();

  candidate = candidate
    .split(/[\r\n。！？!?；;：:]/, 1)[0]
    ?.replace(/^[\d\s.、-]+/, "")
    .trim() ?? "";

  if (!candidate) return "";

  const containsCjk = /[\u3400-\u9fff]/u.test(candidate);
  const compacted = containsCjk ? candidate.replace(/\s+/g, "") : candidate.replace(/\s+/g, " ");
  const maxLength = containsCjk ? 18 : 32;
  return compacted.slice(0, maxLength).trim();
}

function isMissingResourceError(error: unknown) {
  return error instanceof Error && error.message.includes("Resource not found:");
}

function keywordThreadTitle(text: string) {
  const source = compact(text).toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/会议|纪要|meeting|minutes/, "会议纪要"],
    [/邮件|email|mail/, "邮件草稿"],
    [/周报|日报|月报|汇报|report/, "工作汇报"],
    [/日程|行程|排期|schedule|calendar/, "日程整理"],
    [/表格|excel|sheet|数据整理/, "表格整理"],
    [/ppt|演示|提纲|slide/, "PPT 提纲"],
    [/报销|费用|发票/, "报销整理"],
    [/合同|制度|方案|文档|doc/, "文档整理"],
  ];

  for (const [pattern, title] of rules) {
    if (pattern.test(source)) {
      return title;
    }
  }

  return "";
}

function summarizeThreadTitle(messages: ChatMessage[]) {
  const firstUser = messages.find((message) => message.role === "user" && compact(message.text));
  const firstAssistant = messages.find((message) => message.role === "assistant" && compact(message.text));
  const firstTool = messages.find((message) => message.role === "tool" && compact(message.text));
  const combined = [firstUser?.text, firstAssistant?.text, firstTool?.text].filter(Boolean).join("\n");
  const keyword = keywordThreadTitle(combined);

  if (keyword) {
    return keyword;
  }

  const candidates = [firstUser?.text, firstAssistant?.text, firstTool?.text]
    .filter((item): item is string => Boolean(item))
    .map((item) => normalizeTitleCandidate(item))
    .filter((item) => item.length >= 2);

  return candidates[0] ?? "";
}

function getThreadMeta(state: PersistedWorkspaceState, threadId: string): PersistedThreadMeta {
  return state.threadMeta[threadId] ?? {};
}

function updateThreadMeta(
  state: PersistedWorkspaceState,
  threadId: string,
  updater: (previous: PersistedThreadMeta) => PersistedThreadMeta,
) {
  const next = updater(getThreadMeta(state, threadId));
  if (Object.keys(next).length === 0) {
    delete state.threadMeta[threadId];
    return;
  }
  state.threadMeta[threadId] = next;
}

function isThreadArchived(state: PersistedWorkspaceState, threadId: string, session?: OpencodeSessionInfo) {
  const meta = getThreadMeta(state, threadId);
  if (typeof meta.archived === "boolean") {
    return meta.archived;
  }
  return Boolean(session?.time.archived);
}

function filePathFromUrl(url: string) {
  if (!url.startsWith("file:")) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
  } catch {
    return null;
  }
}

function attachmentFromFilePart(part: OpencodeFilePart): FileDropEntry {
  const localPath = part.source?.type === "file" ? part.source.path ?? filePathFromUrl(part.url) : filePathFromUrl(part.url);
  const displayPath = localPath ?? part.filename ?? part.url;
  return {
    id: part.id,
    name: part.filename ?? path.basename(displayPath) ?? "attachment",
    path: displayPath,
    size: 0,
    mimeType: part.mime,
    kind: detectKind(displayPath, part.mime),
    url: part.url,
  };
}

function formatToolInput(input: Record<string, unknown>) {
  if (!input || Object.keys(input).length === 0) return "";
  return JSON.stringify(input, null, 2);
}

function toolMessageFromPart(part: OpencodeToolPart): ChatMessage {
  const input = formatToolInput(part.state.input);
  const lines: string[] = [];
  const attachments =
    part.state.status === "completed" ? (part.state.attachments ?? []).map(attachmentFromFilePart) : [];

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
          : "loading",
    attachments,
  };
}

function baseMessageText(parts: OpencodePart[]) {
  const textParts = parts.filter((part): part is Extract<OpencodePart, { type: "text" }> => part.type === "text" && !part.synthetic);
  const agentParts = parts.filter((part): part is Extract<OpencodePart, { type: "agent" }> => part.type === "agent");
  const subtaskParts = parts.filter((part): part is Extract<OpencodePart, { type: "subtask" }> => part.type === "subtask");
  const blocks: string[] = [];

  if (textParts.length > 0) {
    blocks.push(textParts.map((part) => part.text).join("\n\n").trim());
  }

  if (agentParts.length > 0) {
    blocks.push(agentParts.map((part) => `@${part.name}`).join("\n"));
  }

  if (subtaskParts.length > 0) {
    blocks.push(
      subtaskParts
        .map((part) => compact(`${part.description}\n${part.prompt}`))
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return blocks.filter(Boolean).join("\n\n").trim();
}

function messageTimestamp(message: OpencodeSessionMessage) {
  if (message.info.role === "assistant") {
    return message.info.time.completed ?? message.info.time.created;
  }
  return message.info.time.created;
}

function convertMessages(messages: OpencodeSessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const message of messages) {
    const isPendingAssistant =
      message.info.role === "assistant" &&
      !message.info.error &&
      message.info.time.completed === undefined;
    const fileAttachments = message.parts
      .filter((part): part is OpencodeFilePart => part.type === "file")
      .map(attachmentFromFilePart);

    for (const part of message.parts) {
      if (part.type === "tool") {
        result.push(toolMessageFromPart(part));
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
      status: message.info.error ? "error" : isPendingAssistant ? "loading" : "done",
    });
  }

  return result.sort((left, right) => left.createdAt - right.createdAt);
}

function createThreadSummary(
  session: OpencodeSessionInfo,
  messages: ChatMessage[],
  meta?: PersistedThreadMeta,
): ThreadSummary {
  const lastMessage =
    [...messages]
      .reverse()
      .map((item) => compact(item.text))
      .find(Boolean) ?? "";

  return {
    id: session.id,
    title: meta?.title?.trim() || normalizeSessionTitle(session.title),
    updatedAt: session.time.updated,
    lastMessage: lastMessage.slice(0, 120),
    messageCount: messages.length,
    archived: meta?.archived ?? Boolean(session.time.archived),
    workspaceRoot: meta?.workspaceRoot?.trim() || session.directory,
  };
}

function createThreadRecord(
  session: OpencodeSessionInfo,
  sourceMessages: OpencodeSessionMessage[],
  meta?: PersistedThreadMeta,
): ThreadRecord {
  const messages = convertMessages(sourceMessages);
  return {
    ...createThreadSummary(session, messages, meta),
    messages,
  };
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

function buildKnowledgePrompt(message: string, searchPayload: KnowledgeSearchPayload) {
  const trimmedMessage = message.trim();
  const searchedBaseIds = Array.from(new Set(searchPayload.searchedBases.map((item) => item.id).filter(Boolean)));

  if (searchPayload.results.length === 0) {
    return {
      prompt: trimmedMessage,
      meta: {
        injected: false,
        query: searchPayload.query,
        resultCount: 0,
        searchedBaseIds,
        warnings: searchPayload.warnings,
      },
    };
  }

  const context = searchPayload.results
    .map((item, index) =>
      [
        `[知识片段 ${index + 1}]`,
        `知识库: ${item.knowledgeBaseName}`,
        `相关度: ${item.score.toFixed(3)}`,
        typeof item.metadata.source === "string" ? `来源: ${item.metadata.source}` : "",
        item.pageContent.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return {
    prompt: [
      "请优先依据下面的知识库检索结果回答当前问题。",
      "如果知识库内容不足，再结合通用能力补充，但要优先以知识库为准。",
      "",
      "知识库检索结果:",
      context,
      "",
      "用户问题:",
      trimmedMessage,
    ].join("\n"),
    meta: {
      injected: true,
      query: searchPayload.query,
      resultCount: searchPayload.results.length,
      searchedBaseIds,
      warnings: searchPayload.warnings,
    },
  };
}

export class WorkspaceService {
  private readonly runtime = new OpencodeRuntime();
  private readonly knowledge: KnowledgeService;

  constructor(private readonly statePath: string) {
    this.knowledge = new KnowledgeService(path.join(path.dirname(statePath), "knowledge"));
  }

  async bootstrap(): Promise<BootstrapPayload> {
    const state = await this.loadState();
    const sessions = await this.runtime.listSessions(state.config);
    let changed = this.pruneThreadMeta(state, sessions);
    let current = sessions.find((item) => item.id === state.activeThreadId) ?? sessions[0];

    if (!current) {
      current = await this.runtime.createSession(state.config, "新会话");
      sessions.push(current);
      state.activeThreadId = current.id;
      changed = true;
    }

    if (changed) {
      await this.saveState(state);
    }

    const [threads, currentMessages, availableSkills, availableAgents, mcpStatuses] = await Promise.all([
      this.listThreadSummaries(state, sessions.length > 0 ? sessions : [current]),
      this.runtime.listMessages(state.config, current.id),
      this.runtime.listSkills(state.config).catch(() => []),
      this.runtime.listAgents(state.config).catch(() => []),
      this.runtime.listMcpStatuses(state.config).catch(() => []),
    ]);

    return {
      config: state.config,
      threads,
      activeThreadId: current.id,
      currentThread: createThreadRecord(current, currentMessages, getThreadMeta(state, current.id)),
      availableSkills,
      availableAgents,
      mcpStatuses,
    };
  }

  async shutdown() {
    await this.runtime.dispose();
  }

  async getCurrentThread(threadId: string) {
    const state = await this.loadState();
    try {
      return await this.readThreadRecord(state, threadId);
    } catch (error) {
      if (isMissingResourceError(error)) {
        const payload = await this.bootstrap();
        return payload.currentThread;
      }
      throw error;
    }
  }

  async listThreads() {
    const state = await this.loadState();
    const sessions = await this.runtime.listSessions(state.config);
    return await this.listThreadSummaries(state, sessions);
  }

  async createThread(title?: string) {
    const state = await this.loadState();
    const session = await this.runtime.createSession(state.config, title?.trim() || "新会话");
    state.activeThreadId = session.id;
    await this.saveState(state);
    return await this.bootstrap();
  }

  async setActiveThread(threadId: string) {
    const state = await this.loadState();
    state.activeThreadId = threadId;
    await this.saveState(state);
    try {
      return await this.getCurrentThread(threadId);
    } catch (error) {
      if (isMissingResourceError(error)) {
        const payload = await this.bootstrap();
        return payload.currentThread;
      }
      throw error;
    }
  }

  async resetThread(threadId: string) {
    const state = await this.loadState();
    const existing = await this.runtime.getSession(state.config, threadId);
    const nextTitle = getThreadMeta(state, threadId).title?.trim() || normalizeSessionTitle(existing.title);
    await this.runtime.deleteSession(state.config, threadId);
    delete state.threadMeta[threadId];
    const session = await this.runtime.createSession(state.config, nextTitle);
    state.activeThreadId = session.id;
    await this.saveState(state);
    return await this.readThreadRecord(state, session.id);
  }

  async archiveThread(threadId: string, archived: boolean) {
    const state = await this.loadState();
    updateThreadMeta(state, threadId, (previous) => {
      const next: PersistedThreadMeta = {};
      if (previous.title?.trim()) {
        next.title = previous.title.trim();
      }
      if (archived) {
        next.archived = true;
      }
      return next;
    });

    if (archived && state.activeThreadId === threadId) {
      const sessions = await this.runtime.listSessions(state.config);
      const nextActiveThreadId = this.pickUnarchivedThreadId(state, sessions, threadId);

      if (nextActiveThreadId) {
        state.activeThreadId = nextActiveThreadId;
      } else {
        const session = await this.runtime.createSession(state.config, "新会话");
        state.activeThreadId = session.id;
      }
    }

    await this.saveState(state);
    return await this.bootstrap();
  }

  async deleteThread(threadId: string) {
    const state = await this.loadState();
    await this.runtime.deleteSession(state.config, threadId);
    delete state.threadMeta[threadId];

    if (state.activeThreadId === threadId) {
      const sessions = await this.runtime.listSessions(state.config);
      const nextActiveThreadId = this.pickUnarchivedThreadId(state, sessions);

      if (nextActiveThreadId) {
        state.activeThreadId = nextActiveThreadId;
      } else {
        const session = await this.runtime.createSession(state.config, "新会话");
        state.activeThreadId = session.id;
      }
    }

    await this.saveState(state);
    return await this.bootstrap();
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const state = await this.loadState();
    let transportMessage = input.message;
    let knowledgeMeta: SendMessageResult["knowledge"] | undefined;

    if (state.config.knowledgeBase.enabled) {
      try {
        const searchPayload = await this.searchKnowledgeBases({
          query: input.message,
          knowledgeBaseIds: state.config.knowledgeBase.selectedBaseIds,
          documentCount: state.config.knowledgeBase.documentCount,
        });
        const injected = buildKnowledgePrompt(input.message, searchPayload);
        transportMessage = injected.prompt;
        knowledgeMeta = injected.meta;
      } catch (error) {
        knowledgeMeta = {
          injected: false,
          query: input.message.trim(),
          resultCount: 0,
          searchedBaseIds: state.config.knowledgeBase.selectedBaseIds,
          warnings: [error instanceof Error ? error.message : "知识库检索失败"],
        };
      }
    }

    await this.runtime.prompt(this.getThreadConfig(state, input.threadId), input.threadId, transportMessage, input.attachments);
    state.activeThreadId = input.threadId;
    updateThreadMeta(state, input.threadId, (previous) => ({
      ...(previous.title?.trim() ? { title: previous.title.trim() } : {}),
    }));
    let thread = await this.readThreadRecord(state, input.threadId);
    this.maybeAssignGeneratedThreadTitle(state, thread);
    thread = {
      ...thread,
      title: getThreadMeta(state, input.threadId).title?.trim() || thread.title,
      archived: isThreadArchived(state, input.threadId),
    };
    await this.saveState(state);
    return {
      thread,
      knowledge: knowledgeMeta,
    };
  }

  async runSkill(input: SkillRunInput): Promise<SkillRunResult> {
    const state = await this.loadState();
    await this.runtime.command(this.getThreadConfig(state, input.threadId), input.threadId, input.skillId, input.prompt || "", []);
    state.activeThreadId = input.threadId;
    updateThreadMeta(state, input.threadId, (previous) => ({
      ...(previous.title?.trim() ? { title: previous.title.trim() } : {}),
    }));
    let thread = await this.readThreadRecord(state, input.threadId);
    this.maybeAssignGeneratedThreadTitle(state, thread);
    thread = {
      ...thread,
      title: getThreadMeta(state, input.threadId).title?.trim() || thread.title,
      archived: isThreadArchived(state, input.threadId),
    };
    await this.saveState(state);
    return {
      thread,
    };
  }

  async updateConfig(patch: Partial<AppConfig>) {
    const state = await this.loadState();
    state.config = {
      ...state.config,
      ...patch,
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

  async setThreadWorkspace(threadId: string, workspaceRoot: string) {
    const state = await this.loadState();
    updateThreadMeta(state, threadId, (previous) => ({
      ...previous,
      workspaceRoot: workspaceRoot.trim(),
    }));
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
    const state = await this.loadState();
    const sessions = await this.runtime.listSessions(state.config);
    const toolMap = new Map<string, WorkspaceTool>();

    for (const session of sessions) {
      const messages = await this.runtime.listMessages(state.config, session.id).catch(() => []);
      for (const message of messages) {
        for (const part of message.parts) {
          if (part.type !== "tool") continue;
          if (!part.tool?.trim()) continue;

          const name = part.tool.trim();
          if (toolMap.has(name)) {
            continue;
          }

          toolMap.set(name, {
            id: `runtime:${name}`,
            name,
            description: BUILTIN_TOOL_DESCRIPTIONS[name] ?? "Tool observed in recent runtime activity.",
            source: "runtime",
            origin: "运行时工具",
            observed: true,
          });
        }
      }
    }

    for (const [name, description] of Object.entries(BUILTIN_TOOL_DESCRIPTIONS)) {
      if (toolMap.has(name)) continue;
      toolMap.set(name, {
        id: `runtime:${name}`,
        name,
        description,
        source: "runtime",
        origin: "运行时工具",
        observed: false,
      });
    }

    return {
      fetchedAt: Date.now(),
      tools: Array.from(toolMap.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    };
  }

  private async readThreadRecord(state: PersistedWorkspaceState, threadId: string) {
    const session = await this.runtime.getSession(state.config, threadId);
    const messages = await this.runtime.listMessages(state.config, threadId);
    return createThreadRecord(session, messages, getThreadMeta(state, threadId));
  }

  private getThreadConfig(state: PersistedWorkspaceState, threadId: string) {
    const workspaceRoot = getThreadMeta(state, threadId).workspaceRoot?.trim();
    return {
      ...state.config,
      opencodeRoot: workspaceRoot || state.config.opencodeRoot,
    };
  }

  private maybeAssignGeneratedThreadTitle(state: PersistedWorkspaceState, thread: ThreadRecord) {
    const existing = getThreadMeta(state, thread.id).title?.trim();
    if (existing || !isUntitledSessionTitle(thread.title)) {
      return false;
    }

    const title = summarizeThreadTitle(thread.messages);
    if (!title) {
      return false;
    }

    updateThreadMeta(state, thread.id, (previous) => ({
      ...previous,
      title,
    }));
    return true;
  }

  private pickUnarchivedThreadId(
    state: PersistedWorkspaceState,
    sessions: OpencodeSessionInfo[],
    excludeThreadId?: string,
  ) {
    const visible = sessions.filter((session) => session.id !== excludeThreadId && !isThreadArchived(state, session.id, session));
    return visible[0]?.id ?? "";
  }

  private pruneThreadMeta(state: PersistedWorkspaceState, sessions: OpencodeSessionInfo[]) {
    const sessionIds = new Set(sessions.map((session) => session.id));
    let changed = false;

    for (const threadId of Object.keys(state.threadMeta)) {
      if (!sessionIds.has(threadId)) {
        delete state.threadMeta[threadId];
        changed = true;
      }
    }

    return changed;
  }

  private async listThreadSummaries(state: PersistedWorkspaceState, sessions: OpencodeSessionInfo[]) {
    const summaries = await Promise.all(
      sessions.map(async (session) => {
        const messages = await this.runtime.listMessages(state.config, session.id).catch(() => []);
        return createThreadSummary(session, convertMessages(messages), getThreadMeta(state, session.id));
      }),
    );

    return summaries.sort((left, right) => {
      if (left.archived !== right.archived) {
        return Number(left.archived) - Number(right.archived);
      }
      return right.updatedAt - left.updatedAt;
    });
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
