import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  createRuntimeModelId,
  ensureActiveModelId,
  getActiveModelOption,
  isEmbeddingModel,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "./lib/model-config";
import type {
  AppConfig,
  AppSection,
  DesktopWindowState,
  EmergencyPlanInput,
  EmergencyPlanResult,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeBaseSummary,
  McpServerConfig,
  ModelProviderConfig,
  ProjectReportInput,
  ProjectReportResult,
  SkillConfig,
  WorkspaceTool,
} from "./types";
import { workspaceClient } from "./services/workspace-client";
import { ChatView } from "./features/chat/ChatView";
import { PreviewPane } from "./features/chat/PreviewPane";
import { PrimarySidebar } from "./features/navigation/PrimarySidebar";
import { SkillsView } from "./features/skills/SkillsView";
import { ToolsView } from "./features/tools/ToolsView";
import { KnowledgeView } from "./features/knowledge/KnowledgeView";
import { ReportsView } from "./features/reports/ReportsView";
import { EmergencyPlanView } from "./features/emergency/EmergencyPlanView";
import { AppTitleBar } from "./features/navigation/AppTitleBar";
import { AssistantSettings } from "./features/settings/AssistantSettings";
import { AppearanceSettings } from "./features/settings/AppearanceSettings";
import { SettingsSidebar } from "./features/settings/SettingsSidebar";
import type { SettingsSection } from "./features/settings/types";
import { useSessionController } from "./features/session/useSessionController";
import { cloneConfig, matchQuery } from "./features/session/utils";
import { fileKind, sanitizeMcpName } from "./features/shared/utils";

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function App() {
  const [view, setView] = useState<AppSection>("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("assistant");
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillsRefreshing, setSkillsRefreshing] = useState(false);
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [toolsRefreshing, setToolsRefreshing] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [knowledgeRefreshing, setKnowledgeRefreshing] = useState(false);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpAdvancedOpen, setMcpAdvancedOpen] = useState(false);
  const [providerRefreshingId, setProviderRefreshingId] = useState<string | null>(null);
  const [selectedModelProviderId, setSelectedModelProviderId] = useState("");
  const [windowState, setWindowState] = useState<DesktopWindowState | null>(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportResult, setReportResult] = useState<ProjectReportResult | null>(null);
  const [emergencyGenerating, setEmergencyGenerating] = useState(false);
  const [emergencyResult, setEmergencyResult] = useState<EmergencyPlanResult | null>(null);
  const [reportForm, setReportForm] = useState<ProjectReportInput>({
    knowledgeBaseId: "",
    projectName: "",
    projectType: "",
    projectLocation: "",
    longitude: "",
    latitude: "",
    projectOverview: "",
    policyFocus: "",
    outputDirectory: "",
    outputFileName: "",
    workspaceRoot: "",
  });
  const [emergencyForm, setEmergencyForm] = useState<EmergencyPlanInput>({
    projectName: "",
    companyName: "",
    projectType: "",
    industryCategory: "",
    projectLocation: "",
    projectOverview: "",
    riskSources: "",
    emergencyResources: "",
    specialRequirements: "",
    templateFiles: [],
    outputDirectory: "",
    outputFileName: "",
    workspaceRoot: "",
  });
  const {
    activeModel,
    activeSummary,
    activeThread,
    activeThreadId,
    activeThreads,
    applySuggestion,
    appendAttachments,
    archiveThread,
    archivedThreads,
    attachments,
    availableSkills,
    pendingQuestions,
    replyQuestion,
    rejectQuestion,
    abortThread,
    chooseThreadWorkspace,
    clearSelectedComposerSkill,
    commitConfig,
    composer,
    composerComposing,
    composerModelId,
    config,
    createThread,
    currentWorkspaceLabel,
    currentWorkspacePath,
    deleteThread: deleteThreadImmediately,
    drafting,
    dragActive,
    mcpStatuses,
    mcpStatusMap,
    messageListRef,
    openThread,
    openWorkspaceFolder,
    pickFiles,
    prepareSkillDraft,
    refreshThreadList,
    refreshWorkspaceSnapshot,
    removeAttachment,
    runSkill,
    scheduleConfigPersist,
    selectableModels,
    selectedComposerSkill,
    selectComposerSkill,
    sendMessageWithSkills,
    sending,
    setComposer,
    setComposerComposing,
    setDragActive,
    slashSkillSuggestions,
    status: sessionStatus,
    title,
    uninstallSkill,
    updateConfigField,
    useReferenceSkill,
    workspaceIssue,
  } = useSessionController({
    onOpenChat: () => setView("chat"),
    onToast: (message) => setToast(message),
  });
  const toolsLoadedRef = useRef(false);
  const knowledgeLoadedRef = useRef(false);

  const configuredSkills = useMemo(
    () =>
      config.skills.map((skill) => ({
        ...skill,
        location:
          skill.kind === "codex"
            ? skill.system
              ? "Codex system skill"
              : skill.sourcePath || "Codex local skill"
            : "Workspace builtin skill",
      })),
    [config.skills],
  );
  const filteredInstalledSkills = useMemo(
    () =>
      configuredSkills.filter((skill) =>
        matchQuery(skillQuery, [skill.name, skill.description, skill.location]),
      ),
    [configuredSkills, skillQuery],
  );
  const filteredReferenceSkills = useMemo(
    () =>
      availableSkills.filter((skill) =>
        matchQuery(skillQuery, [skill.name, skill.description, skill.location]),
      ),
    [availableSkills, skillQuery],
  );
  const reportMapTools = useMemo(
    () =>
      tools.filter((tool) =>
        /(map|geo|geocode|coordinate|location|amap|gaode|baidu|tencent|place|poi|reverse)/i.test(
          [tool.name, tool.title, tool.description, tool.origin].filter(Boolean).join(" "),
        ),
      ),
    [tools],
  );
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = workspaceClient.onWindowStateChanged((payload) => {
      if (mounted) {
        setWindowState(payload);
      }
    });

    void workspaceClient
      .getWindowState()
      .then((payload) => {
        if (mounted) {
          setWindowState(payload);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = config.appearance.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [config.appearance.theme]);

  useEffect(() => {
    if ((view !== "tools" && view !== "reports") || toolsRefreshing || toolsLoadedRef.current) {
      return;
    }

    void refreshToolsView({ silent: true });
  }, [toolsRefreshing, view]);

  useEffect(() => {
    if ((view !== "knowledge" && view !== "reports") || knowledgeRefreshing || knowledgeLoadedRef.current) {
      return;
    }

    void refreshKnowledgeView({ silent: true });
  }, [knowledgeRefreshing, view]);

  useEffect(() => {
    if (reportForm.workspaceRoot) return;
    setReportForm((current) => ({ ...current, workspaceRoot: config.opencodeRoot || "" }));
  }, [config.opencodeRoot, reportForm.workspaceRoot]);

  useEffect(() => {
    if (emergencyForm.workspaceRoot) return;
    setEmergencyForm((current) => ({ ...current, workspaceRoot: config.opencodeRoot || "" }));
  }, [config.opencodeRoot, emergencyForm.workspaceRoot]);

  useEffect(() => {
    if (reportForm.knowledgeBaseId) return;
    const fallbackId = config.knowledgeBase.selectedBaseIds[0] || knowledgeBases[0]?.id || "";
    if (!fallbackId) return;
    setReportForm((current) => ({ ...current, knowledgeBaseId: fallbackId }));
  }, [config.knowledgeBase.selectedBaseIds, knowledgeBases, reportForm.knowledgeBaseId]);

  useEffect(() => {
    if (config.modelProviders.length === 0) {
      if (selectedModelProviderId) {
        setSelectedModelProviderId("");
      }
      return;
    }

    if (config.modelProviders.some((provider) => provider.id === selectedModelProviderId)) {
      return;
    }

    const preferredProviderId =
      activeModel?.providerId &&
      config.modelProviders.some((provider) => provider.id === activeModel.providerId)
        ? activeModel.providerId
        : config.modelProviders[0]?.id ?? "";

    if (preferredProviderId && preferredProviderId !== selectedModelProviderId) {
      setSelectedModelProviderId(preferredProviderId);
    }
  }, [activeModel?.providerId, config.modelProviders, selectedModelProviderId]);

  useEffect(() => {
    if (config.modelProviders.length === 0) {
      return;
    }

    const currentProviderId = config.knowledgeBase.embeddingProviderId;
    if (currentProviderId && config.modelProviders.some((item) => item.id === currentProviderId)) {
      return;
    }

    const fallbackProviderId = activeModel?.providerId || config.modelProviders[0]?.id || "";
    if (!fallbackProviderId) return;

    updateKnowledgeBaseConfig({ embeddingProviderId: fallbackProviderId });
  }, [activeModel?.providerId, config.knowledgeBase.embeddingProviderId, config.modelProviders]);

  useEffect(() => {
    const provider = config.modelProviders.find((item) => item.id === config.knowledgeBase.embeddingProviderId);
    if (!provider) return;

    const embeddingModels = provider.models.filter(isEmbeddingModel);
    if (embeddingModels.length === 0) return;

    if (embeddingModels.some((model) => model.id === config.knowledgeBase.embeddingModel)) {
      return;
    }

    updateKnowledgeBaseConfig({ embeddingModel: embeddingModels[0].id });
  }, [config.knowledgeBase.embeddingModel, config.knowledgeBase.embeddingProviderId, config.modelProviders]);

  function updateInstalledSkill(skillId: string, patch: Partial<SkillConfig>) {
    const skills = config.skills.map((item) => (item.id === skillId ? { ...item, ...patch } : item));
    void commitConfig({ ...cloneConfig(config), skills });
  }

  async function openPreview(file: FileDropEntry) {
    setPreviewOpen(true);
    setPreview({
      title: file.name,
      path: file.path,
      kind: fileKind(file),
      mimeType: file.mimeType,
      content: file.content ?? file.dataUrl ?? "",
    });

    if (!file.content && !file.dataUrl) {
      try {
        const payload = await workspaceClient.readPreview({
          path: file.path,
          url: file.url,
          title: file.name,
          kind: fileKind(file),
        });
        setPreview(payload);
      } catch {
        setToast("Open preview failed");
      }
    }
  }

  async function openPreviewLink(url: string) {
    setPreviewOpen(true);
    setPreview({
      title: url,
      path: url,
      kind: "web",
      mimeType: "text/html",
      content: "",
      url,
    });

    try {
      const payload = await workspaceClient.readPreview({
        url,
        title: url,
        kind: "web",
      });
      setPreview(payload);
    } catch {
      setToast("Open page preview failed");
    }
  }

  function buildConfigWithModelProviders(
    modelProviders: ModelProviderConfig[],
    preferredActiveModelId = config.activeModelId,
  ) {
    const nextConfig = cloneConfig(config);
    const nextActiveModelId = ensureActiveModelId(modelProviders, preferredActiveModelId);
    const nextActiveModel = getActiveModelOption(modelProviders, nextActiveModelId);
    const nextEmbeddingProviderId =
      nextConfig.knowledgeBase.embeddingProviderId &&
      modelProviders.some((provider) => provider.id === nextConfig.knowledgeBase.embeddingProviderId)
        ? nextConfig.knowledgeBase.embeddingProviderId
        : nextActiveModel?.providerId || modelProviders[0]?.id || "";

    return {
      ...nextConfig,
      modelProviders,
      activeModelId: nextActiveModelId,
      knowledgeBase: {
        ...nextConfig.knowledgeBase,
        embeddingProviderId: nextEmbeddingProviderId,
      },
    } satisfies AppConfig;
  }

  function commitModelProviders(modelProviders: ModelProviderConfig[], message = "Settings saved") {
    void commitConfig(buildConfigWithModelProviders(modelProviders), message);
  }

  function scheduleModelProvidersPersist(modelProviders: ModelProviderConfig[]) {
    scheduleConfigPersist(buildConfigWithModelProviders(modelProviders));
  }

  function updateModelProvider(providerId: string, patch: Partial<ModelProviderConfig>) {
    const modelProviders = config.modelProviders.map((item) => (item.id === providerId ? { ...item, ...patch } : item));
    scheduleModelProvidersPersist(modelProviders);
  }

  function toggleProviderModel(providerId: string, modelId: string) {
    const modelProviders = config.modelProviders.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: provider.models.map((model) =>
              model.id === modelId ? { ...model, enabled: model.enabled === false } : model,
            ),
          }
        : provider,
    );
    scheduleModelProvidersPersist(modelProviders);
  }

  function setProviderModelsEnabled(providerId: string, modelIds: string[], enabled: boolean) {
    if (modelIds.length === 0) return;
    const targetIds = new Set(modelIds);
    const modelProviders = config.modelProviders.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: provider.models.map((model) =>
              targetIds.has(model.id) ? { ...model, enabled } : model,
            ),
          }
        : provider,
    );
    scheduleModelProvidersPersist(modelProviders);
  }

  function addModelProvider() {
    const providerId = sanitizeModelProviderId(`provider-${uid()}`);
    const modelProviders = [
      ...config.modelProviders,
      {
        id: providerId,
        name: "New Provider",
        kind: "openai-compatible" as const,
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
        temperature: 0.2,
        maxTokens: 4096,
        enabled: true,
        models: [],
      },
    ];
    setSelectedModelProviderId(providerId);
    commitModelProviders(modelProviders, "Added provider");
  }

  function removeModelProvider(providerId: string) {
    const target = config.modelProviders.find((item) => item.id === providerId);
    const modelProviders = config.modelProviders.filter((item) => item.id !== providerId);
    commitModelProviders(
      modelProviders,
      target ? `Removed ${target.name || "provider"} configuration` : "Removed provider configuration",
    );
  }

  function setDefaultProviderModel(providerId: string, modelId: string) {
    const modelProviders = config.modelProviders.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            enabled: true,
            models: provider.models.map((model) =>
              model.id === modelId ? { ...model, enabled: true } : model,
            ),
          }
        : provider,
    );

    void commitConfig(
      buildConfigWithModelProviders(modelProviders, createRuntimeModelId(providerId, modelId)),
      "Default model updated",
    );
  }

  async function refreshProviderModels(providerId: string) {
    const provider = config.modelProviders.find((item) => item.id === providerId);
    if (!provider) return;

    setProviderRefreshingId(providerId);
    try {
      const payload = await workspaceClient.fetchProviderModels({
        providerId: provider.id,
        name: provider.name,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
      });
      const previousEnabled = new Map(provider.models.map((item) => [item.id, item.enabled !== false]));
      const nextModels = normalizeProviderModels(
        payload.models.map((item) => ({
          ...item,
          enabled: previousEnabled.has(item.id) ? previousEnabled.get(item.id) : item.enabled !== false,
        })),
      );
      const modelProviders = config.modelProviders.map((item) =>
        item.id === providerId
          ? {
              ...item,
              models: nextModels,
            }
          : item,
      );
      commitModelProviders(modelProviders, `${provider.name} models discovered`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Fetch models failed");
    } finally {
      setProviderRefreshingId(null);
    }
  }

  function updateMcp(serverId: string, patch: Partial<McpServerConfig>) {
    const mcpServers = config.mcpServers.map((item) => (item.id === serverId ? { ...item, ...patch } : item));
    scheduleConfigPersist({ ...cloneConfig(config), mcpServers });
  }

  function removeMcpServer(serverId: string) {
    const target = config.mcpServers.find((item) => item.id === serverId);
    const mcpServers = config.mcpServers.filter((item) => item.id !== serverId);
    void commitConfig(
      { ...cloneConfig(config), mcpServers },
      target ? `Removed ${target.name || "MCP"} configuration` : "Removed MCP configuration",
    );
  }

  function addMcpServer() {
    const mcpServers = [
      ...config.mcpServers,
      {
        id: `mcp-${uid()}`,
        name: "New MCP",
        transport: "local" as const,
        command: "node",
        args: [],
        url: "",
        headersJson: "{}",
        envJson: "{}",
        enabled: false,
        timeoutMs: 30000,
      },
    ];
    void commitConfig({ ...cloneConfig(config), mcpServers }, "Added MCP server");
  }

  function addRecommendedMcpServer(server: {
    id: string;
    name: string;
    transport: "local" | "remote";
    command?: string;
    args?: string[];
    url?: string;
    headersJson?: string;
    envJson?: string;
    enabled?: boolean;
  }) {
    const normalized = sanitizeMcpName(server.name);
    if (config.mcpServers.some((item) => sanitizeMcpName(item.name) === normalized)) {
      setToast("This server draft already exists");
      setView("tools");
      return;
    }

    const mcpServers = [
      ...config.mcpServers,
      {
        id: `mcp-${uid()}`,
        name: server.name,
        transport: server.transport,
        command: server.command ?? (server.transport === "local" ? "node" : ""),
        args: server.args ?? [],
        url: server.url ?? "",
        headersJson: server.headersJson ?? "{}",
        envJson: server.envJson ?? "{}",
        enabled: server.enabled ?? false,
        timeoutMs: 30000,
      },
    ];

    void commitConfig({ ...cloneConfig(config), mcpServers }, "Added recommended MCP server");
    setView("tools");
  }

  async function addRecommendedMapMcpServer() {
    addRecommendedMcpServer({
      id: "amap-maps",
      name: "AMap Maps",
      transport: "local",
      command: "npx",
      args: ["-y", "@amap/amap-maps-mcp-server"],
      envJson: JSON.stringify(
        {
          AMAP_MAPS_API_KEY: "",
        },
        null,
        2,
      ),
      enabled: true,
    });
    setToast("已添加高德地图 MCP，请在工具页填写 AMAP_MAPS_API_KEY");
    await refreshToolsView({ silent: true });
  }

  async function refreshSkillsView() {
    setSkillsRefreshing(true);
    await refreshWorkspaceSnapshot("Skills refreshed");
    setSkillsRefreshing(false);
  }

  async function refreshMcpView() {
    setMcpRefreshing(true);
    await refreshWorkspaceSnapshot("MCP refreshed");
    setMcpRefreshing(false);
  }

  async function refreshToolsView(options?: { silent?: boolean }) {
    toolsLoadedRef.current = true;
    setToolsRefreshing(true);
    try {
      const payload = await workspaceClient.listTools();
      setTools(payload.tools);
    } catch {
      setToast("Refresh tools failed");
    } finally {
      setToolsRefreshing(false);
    }
  }

  function updateKnowledgeBaseConfig(patch: Partial<AppConfig["knowledgeBase"]>) {
    void commitConfig({
      ...cloneConfig(config),
      knowledgeBase: {
        ...cloneConfig(config).knowledgeBase,
        ...patch,
      },
    });
  }

  function toggleKnowledgeBaseSelection(baseId: string) {
    const selected = new Set(config.knowledgeBase.selectedBaseIds);
    if (selected.has(baseId)) {
      selected.delete(baseId);
    } else {
      selected.add(baseId);
    }

    updateKnowledgeBaseConfig({
      enabled: selected.size > 0,
      selectedBaseIds: Array.from(selected),
    });
  }

  async function refreshKnowledgeView(options?: { silent?: boolean }) {
    knowledgeLoadedRef.current = true;
    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.listKnowledgeBases();
      setKnowledgeBases(payload.knowledgeBases);

      const validIds = new Set(payload.knowledgeBases.map((item) => item.id));
      const selectedBaseIds = config.knowledgeBase.selectedBaseIds.filter((item) => validIds.has(item));
      if (selectedBaseIds.length !== config.knowledgeBase.selectedBaseIds.length) {
        void commitConfig({
          ...cloneConfig(config),
          knowledgeBase: {
            ...cloneConfig(config).knowledgeBase,
            enabled: selectedBaseIds.length > 0,
            selectedBaseIds,
          },
        });
      }

      if (!options?.silent) {
        setToast("知识库已刷新");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "刷新知识库失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  function updateReportForm(patch: Partial<ProjectReportInput>) {
    setReportForm((current) => ({ ...current, ...patch }));
  }

  async function chooseReportOutputDirectory() {
    try {
      const directory = await workspaceClient.selectWorkspaceFolder();
      if (!directory) return;
      updateReportForm({ outputDirectory: directory });
    } catch {
      setToast("选择输出目录失败");
    }
  }

  function updateEmergencyForm(patch: Partial<EmergencyPlanInput>) {
    setEmergencyForm((current) => ({ ...current, ...patch }));
  }

  async function pickEmergencyTemplates() {
    try {
      const files = await workspaceClient.selectFiles();
      const nextFiles = files.filter((file) => /\.(pdf|doc|docx)$/i.test(file.name));
      if (nextFiles.length === 0) {
        setToast("请选择 PDF、DOC 或 DOCX 模板文件");
        return;
      }
      setEmergencyForm((current) => {
        const existing = new Map(current.templateFiles.map((file) => [file.path, file]));
        for (const file of nextFiles) {
          existing.set(file.path, file);
        }
        return { ...current, templateFiles: Array.from(existing.values()) };
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "选择模板文件失败");
    }
  }

  function removeEmergencyTemplate(fileId: string) {
    setEmergencyForm((current) => ({
      ...current,
      templateFiles: current.templateFiles.filter((file) => file.id !== fileId),
    }));
  }

  async function chooseEmergencyOutputDirectory() {
    try {
      const directory = await workspaceClient.selectWorkspaceFolder();
      if (!directory) return;
      setEmergencyForm((current) => ({ ...current, outputDirectory: directory }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "选择输出目录失败");
    }
  }

  async function generateProjectReport() {
    if (!reportForm.knowledgeBaseId) {
      setToast("请先选择知识库");
      return;
    }
    if (!reportForm.projectName?.trim()) {
      setToast("请先输入项目名称");
      return;
    }

    setReportGenerating(true);
    try {
      const payload = await workspaceClient.generateProjectReport({
        ...reportForm,
        workspaceRoot: reportForm.workspaceRoot || config.opencodeRoot,
      });
      setReportResult(payload);
      setToast(`报告已生成：${payload.fileName}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "生成报告失败");
    } finally {
      setReportGenerating(false);
    }
  }

  async function generateEmergencyPlan() {
    if (!emergencyForm.projectName.trim()) {
      setToast("请先填写项目名称");
      return;
    }
    if (emergencyForm.templateFiles.length === 0) {
      setToast("请先选择应急预案模板");
      return;
    }

    setEmergencyGenerating(true);
    try {
      const result = await workspaceClient.generateEmergencyPlan(emergencyForm);
      setEmergencyResult(result);
      setToast(`应急预案已生成：${result.fileName}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "生成应急预案失败");
    } finally {
      setEmergencyGenerating(false);
    }
  }

  async function createKnowledgeBase(name: string, description: string) {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setToast("请先输入知识库名称");
      return null;
    }

    knowledgeLoadedRef.current = true;
    setKnowledgeRefreshing(true);
    try {
      const previousBaseIds = new Set(knowledgeBases.map((item) => item.id));
      const payload = await workspaceClient.createKnowledgeBase({
        name: trimmedName,
        description: trimmedDescription,
      });
      setKnowledgeBases(payload.knowledgeBases);
      setToast(`已创建知识库「${trimmedName}」`);
      const createdBase =
        payload.knowledgeBases.find((item) => !previousBaseIds.has(item.id)) ??
        payload.knowledgeBases.find(
          (item) =>
            item.name === trimmedName && (item.description ?? "").trim() === trimmedDescription,
        ) ??
        payload.knowledgeBases[0] ??
        null;
      return createdBase?.id ?? null;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "创建知识库失败");
      return null;
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function deleteKnowledgeBase(baseId: string) {
    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.deleteKnowledgeBase(baseId);
      setKnowledgeBases(payload.knowledgeBases);
      updateKnowledgeBaseConfig({
        enabled: config.knowledgeBase.selectedBaseIds.some((item) => item !== baseId),
        selectedBaseIds: config.knowledgeBase.selectedBaseIds.filter((item) => item !== baseId),
      });
      setToast("知识库已删除");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除知识库失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeFiles(baseId: string) {
    try {
      const files = await workspaceClient.selectFiles();
      if (files.length === 0) return;
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeFiles({ baseId, files });
      setKnowledgeBases(payload.knowledgeBases);
      setToast(`已导入 ${files.length} 个文件`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "导入文件失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeNote(baseId: string, title: string, content: string) {
    if (!title.trim() || !content.trim()) {
      setToast("请填写笔记标题和内容");
      return;
    }

    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.addKnowledgeNote({
        baseId,
        title: title.trim(),
        content: content.trim(),
      });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("笔记已添加");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "添加笔记失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeDirectory(baseId: string) {
    try {
      const directoryPath = await workspaceClient.selectWorkspaceFolder();
      if (!directoryPath) return;
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeDirectory({ baseId, directoryPath });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("目录资料已添加");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "添加目录失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeUrl(baseId: string, url: string) {
    try {
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeUrl({ baseId, url });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("网址资料已添加");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "添加网址失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeWebsite(baseId: string, url: string) {
    try {
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeWebsite({ baseId, url });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("网站资料已添加");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "添加网站失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function deleteKnowledgeItem(baseId: string, itemId: string) {
    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.deleteKnowledgeItem({ baseId, itemId });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("资料已删除");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除资料失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  function updateAppearanceTheme(theme: AppConfig["appearance"]["theme"]) {
    if (config.appearance.theme === theme) {
      return;
    }

    void commitConfig(
      {
        ...cloneConfig(config),
        appearance: {
          ...cloneConfig(config).appearance,
          theme,
        },
      },
      "外观主题已更新",
    );
  }

  async function minimizeWindow() {
    try {
      const payload = await workspaceClient.minimizeWindow();
      setWindowState(payload);
    } catch {
      setToast("Minimize window failed");
    }
  }

  async function toggleMaximizeWindow() {
    try {
      const payload = await workspaceClient.toggleMaximizeWindow();
      setWindowState(payload);
    } catch {
      setToast("Resize window failed");
    }
  }

  async function closeWindow() {
    try {
      await workspaceClient.closeWindow();
    } catch {
      setToast("Close window failed");
    }
  }

  const showPreviewPane = view === "chat" && preview && previewOpen;
  const threadBusy = !drafting && (activeThread?.messages.some((message) => message.status === "loading") ?? false);
  const settingsStats = {
    threadCount: activeThreads.length + archivedThreads.length,
    providerCount: config.modelProviders.length,
    mcpCount: config.mcpServers.length,
  };
  const hasSkillResults =
    filteredInstalledSkills.length > 0 || filteredReferenceSkills.length > 0;

  function renderSettingsView() {
    if (settingsSection === "appearance") {
      return (
        <AppearanceSettings
          appearance={config.appearance}
          onThemeChange={updateAppearanceTheme}
        />
      );
    }

    if (settingsSection === "assistant") {
      return (
        <AssistantSettings
          activeModel={activeModel}
          composerModelId={composerModelId}
          modelProviders={config.modelProviders}
          providerRefreshingId={providerRefreshingId}
          selectedModelProviderId={selectedModelProviderId}
          selectableModels={selectableModels}
          onAddModelProvider={addModelProvider}
          onModelChange={(value) => updateConfigField("activeModelId", value)}
          onRefreshProviderModels={refreshProviderModels}
          onRemoveModelProvider={removeModelProvider}
          onSelectProvider={setSelectedModelProviderId}
          onSetProviderModelsEnabled={setProviderModelsEnabled}
          onSetDefaultProviderModel={setDefaultProviderModel}
          onToggleProviderModel={toggleProviderModel}
          onUpdateModelProvider={updateModelProvider}
        />
      );
    }
  }

  function renderMainView() {
    if (view === "skills") {
      return (
        <SkillsView
          filteredInstalledSkills={filteredInstalledSkills}
          filteredReferenceSkills={filteredReferenceSkills}
          hasResults={hasSkillResults}
          skillQuery={skillQuery}
          skillsRefreshing={skillsRefreshing}
          onPrepareSkillDraft={prepareSkillDraft}
          onRefresh={refreshSkillsView}
          onSkillQueryChange={setSkillQuery}
          onUninstallSkill={uninstallSkill}
          onUpdateInstalledSkill={updateInstalledSkill}
          onUseReferenceSkill={useReferenceSkill}
        />
      );
    }

    if (view === "tools") {
      return (
        <ToolsView
          mcpAdvancedOpen={mcpAdvancedOpen}
          mcpRefreshing={mcpRefreshing}
          mcpServers={config.mcpServers}
          mcpStatusMap={mcpStatusMap}
          tools={tools}
          toolsRefreshing={toolsRefreshing}
          onAddMcpServer={addMcpServer}
          onDebugTool={(server, toolName, argumentsJson) =>
            workspaceClient.debugMcpTool({
              server,
              workspaceRoot: config.opencodeRoot,
              toolName,
              argumentsJson,
            })
          }
          onInspectServer={(server) =>
            workspaceClient.inspectMcpServer({
              server,
              workspaceRoot: config.opencodeRoot,
            })
          }
          onRefresh={refreshToolsView}
          onRefreshMcp={refreshMcpView}
          onRemoveMcpServer={removeMcpServer}
          onToggleAdvanced={() => setMcpAdvancedOpen((value) => !value)}
          onUpdateMcp={updateMcp}
        />
      );
    }

    if (view === "knowledge") {
      return (
        <KnowledgeView
          config={config.knowledgeBase}
          modelProviders={config.modelProviders}
          knowledgeBases={knowledgeBases}
          knowledgeRefreshing={knowledgeRefreshing}
          onRefresh={refreshKnowledgeView}
          onChangeEmbeddingProvider={(embeddingProviderId) => updateKnowledgeBaseConfig({ embeddingProviderId })}
          onChangeEmbeddingModel={(embeddingModel) => updateKnowledgeBaseConfig({ embeddingModel })}
          onToast={(message) => setToast(message)}
          onCreateKnowledgeBase={createKnowledgeBase}
          onDeleteKnowledgeBase={deleteKnowledgeBase}
          onAddKnowledgeFiles={addKnowledgeFiles}
          onAddKnowledgeDirectory={addKnowledgeDirectory}
          onAddKnowledgeNote={addKnowledgeNote}
          onAddKnowledgeUrl={addKnowledgeUrl}
          onAddKnowledgeWebsite={addKnowledgeWebsite}
          onDeleteKnowledgeItem={deleteKnowledgeItem}
        />
      );
    }

    if (view === "reports") {
      return (
        <ReportsView
          form={reportForm}
          generating={reportGenerating}
          knowledgeBases={knowledgeBases}
          mapTools={reportMapTools}
          result={reportResult}
          onAddMapTool={addRecommendedMapMcpServer}
          onChange={updateReportForm}
          onChooseOutputDirectory={chooseReportOutputDirectory}
          onGenerate={generateProjectReport}
        />
      );
    }

    if (view === "emergency") {
      return (
        <EmergencyPlanView
          form={emergencyForm}
          generating={emergencyGenerating}
          result={emergencyResult}
          onChange={updateEmergencyForm}
          onPickTemplates={pickEmergencyTemplates}
          onRemoveTemplate={removeEmergencyTemplate}
          onChooseOutputDirectory={chooseEmergencyOutputDirectory}
          onGenerate={generateEmergencyPlan}
        />
      );
    }

    if (view === "settings") {
      return renderSettingsView();
    }

    return (
        <ChatView
          activeThread={activeThread}
          attachments={attachments}
          composer={composer}
          composerModelId={composerModelId}
          composing={composerComposing}
          currentWorkspaceLabel={currentWorkspaceLabel}
          currentWorkspacePath={currentWorkspacePath}
          dragActive={dragActive}
          knowledgeBases={knowledgeBases}
          knowledgeConfig={config.knowledgeBase}
          messageListRef={messageListRef}
          previewAvailable={Boolean(preview)}
          previewOpen={previewOpen}
          selectedSkillName={selectedComposerSkill?.name ?? null}
          selectableModels={selectableModels}
          pendingQuestions={pendingQuestions}
          sending={sending}
          threadBusy={threadBusy}
          slashSkillSuggestions={slashSkillSuggestions.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            source: skill.source,
          }))}
          title={title}
          workspaceIssue={workspaceIssue}
          onApplySuggestion={applySuggestion}
          onComposerChange={setComposer}
          onChooseWorkspace={chooseThreadWorkspace}
          onDragActiveChange={setDragActive}
          onFilesDropped={appendAttachments}
          onCompositionChange={setComposerComposing}
          onOpenFile={openPreview}
          onOpenKnowledge={() => setView("knowledge")}
          onOpenLink={openPreviewLink}
          onPickFiles={pickFiles}
          onModelChange={(value) => updateConfigField("activeModelId", value)}
          onReplyQuestion={replyQuestion}
          onRejectQuestion={rejectQuestion}
          onRemoveAttachment={removeAttachment}
          onRemoveSelectedSkill={clearSelectedComposerSkill}
          onSelectSlashSkill={selectComposerSkill}
          onSend={sendMessageWithSkills}
          onStop={() => abortThread()}
          onToggleKnowledgeBase={toggleKnowledgeBaseSelection}
          onTogglePreviewPane={() => setPreviewOpen((value) => !value)}
        />
    );
  }

  return (
    <div className={clsx("window-frame", windowState?.maximized && "maximized")}>
      <AppTitleBar
        view={view}
        windowState={windowState}
        onClose={closeWindow}
        onMinimize={minimizeWindow}
        onToggleMaximize={toggleMaximizeWindow}
      />

      <div className={clsx("app-shell", showPreviewPane && "with-preview", view === "settings" && "settings-mode")}>
        {view === "settings" ? (
          <SettingsSidebar
            settingsSection={settingsSection}
            onBack={() => setView("chat")}
            onSelect={setSettingsSection}
          />
        ) : (
          <PrimarySidebar
            activeThreadId={activeThreadId}
            activeThreads={activeThreads}
            archivedThreads={archivedThreads}
            busyThreadId={sessionStatus.openingThreadId ?? sessionStatus.mutatingThreadId}
            creatingThread={sessionStatus.creatingThread}
            view={view}
            workspaceIssue={workspaceIssue}
            onArchiveThread={archiveThread}
            onCreateThread={createThread}
            onDeleteThread={deleteThreadImmediately}
            onOpenThread={openThread}
            onSetView={setView}
          />
        )}

        <main className="workspace">
          {renderMainView()}
        </main>

        {showPreviewPane && preview ? (
          <PreviewPane
            preview={preview}
            onClearPreview={() => setPreview(null)}
            onClosePane={() => setPreviewOpen(false)}
            onOpenLink={openPreviewLink}
          />
        ) : null}
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
