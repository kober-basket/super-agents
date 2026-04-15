import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mammoth from "mammoth";
import mime from "mime-types";

import {
  createRuntimeModelId,
  ensureActiveModelId,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "../src/lib/model-config";
import { inferProviderModelCapabilities, inferProviderModelGroup, inferProviderModelVendor } from "../src/lib/model-metadata";
import { DEFAULT_REMOTE_CONTROL_CONFIG, normalizeRemoteControlConfig } from "../src/lib/remote-control-config";
import { sanitizeMcpName } from "../src/features/shared/utils";
import type {
  AppConfig,
  BootstrapPayload,
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
  ProxyConfig,
  SkillConfig,
  WorkspaceToolCatalog,
} from "../src/types";
import { KnowledgeService } from "./knowledge-service";
import { readJsonFile, writeJsonFile } from "./store";

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
  activeModelId: createRuntimeModelId("iflyrpa", "azure/gpt-5-mini"),
  contextTier: "high",
  appearance: { theme: "linen" },
  proxy: { http: "", https: "", bypass: "localhost,127.0.0.1" },
  modelProviders: DEFAULT_MODEL_PROVIDERS,
  mcpServers: [],
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
      models: normalizeProviderModels(provider.models),
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
  const modelProviders =
    Array.isArray(cleanedConfig.modelProviders) && cleanedConfig.modelProviders.length > 0
      ? cleanedConfig.modelProviders.map((item) => ({
          ...item,
          kind: item.kind ?? "openai-compatible",
          enabled: item.enabled !== false,
          temperature: typeof item.temperature === "number" ? item.temperature : 0.2,
          maxTokens: typeof item.maxTokens === "number" ? item.maxTokens : 4096,
          models: normalizeProviderModels(Array.isArray(item.models) ? item.models : []),
        }))
      : migratedLegacy.providers.length > 0
        ? migratedLegacy.providers
        : cloneDefaultConfig().modelProviders;
  const preferredActiveModelId =
    modelProviders.some((provider) =>
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

function extractModelList(payload: unknown) {
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
            group: inferProviderModelGroup({ id: item, vendor }),
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
      .filter(Boolean) as ModelProviderConfig["models"],
  );
}

async function fetchOpenAiCompatibleModelsEnhanced(input: ModelProviderFetchInput) {
  const headers: Record<string, string> = { Accept: "application/json" };
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
      const response = await fetch(url, { method: "GET", headers });
      const text = await response.text();
      if (!response.ok) {
        if (index > 0) return [];
        throw new Error(text || `Fetch models failed: ${response.status}`);
      }
      return extractModelList(text ? JSON.parse(text) : {});
    }),
  );

  const models = normalizeProviderModels(responses.flat());
  if (models.length === 0) {
    throw new Error("Provider responded, but no usable models were returned.");
  }
  return models;
}

function getExternalCodexSkillsRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills");
}

function getManagedCodexSkillsRoot(statePath: string) {
  return path.join(path.dirname(statePath), "skills", "codex");
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

async function syncManagedCodexSkills(statePath: string, state: PersistedWorkspaceState) {
  const hidden = new Set(state.config.hiddenCodexSkillIds);
  const managedRoot = getManagedCodexSkillsRoot(statePath);
  await mkdir(managedRoot, { recursive: true }).catch(() => undefined);
  const discovered = [
    ...(await listCodexSkillsFromRoot(getExternalCodexSkillsRoot()).catch(() => [])),
    ...(await listCodexSkillsFromRoot(managedRoot).catch(() => [])),
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
      availableSkills: [],
      mcpStatuses: getMcpStatuses(state.config),
    };
  }

  async getConfigSnapshot(): Promise<AppConfig> {
    return (await this.loadState()).config;
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
