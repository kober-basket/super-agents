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
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeBaseSummary,
  McpServerConfig,
  ModelProviderConfig,
  SkillConfig,
  WorkspaceTool,
} from "./types";
import { workspaceClient } from "./services/workspace-client";
import { ChatView } from "./features/chat/ChatView";
import { PreviewPane } from "./features/chat/PreviewPane";
import { PrimarySidebar } from "./features/navigation/PrimarySidebar";
import { SkillsView } from "./features/skills/SkillsView";
import { RECOMMENDED_SKILLS } from "./features/skills/constants";
import { ToolsView } from "./features/tools/ToolsView";
import { KnowledgeView } from "./features/knowledge/KnowledgeView";
import { AssistantSettings } from "./features/settings/AssistantSettings";
import { GeneralSettings } from "./features/settings/GeneralSettings";
import { McpSettings } from "./features/settings/McpSettings";
import { SettingsSidebar } from "./features/settings/SettingsSidebar";
import type { SettingsSection } from "./features/settings/types";
import { WorkspaceSettings } from "./features/settings/WorkspaceSettings";
import { useSessionController } from "./features/session/useSessionController";
import { cloneConfig, matchQuery } from "./features/session/utils";
import { fileKind, sanitizeMcpName } from "./features/shared/utils";

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function App() {
  const [view, setView] = useState<AppSection>("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
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
  const filteredRecommendedSkills = useMemo(
    () =>
      RECOMMENDED_SKILLS.filter((skill) =>
        matchQuery(skillQuery, [skill.name, skill.description, skill.badge]),
      ),
    [skillQuery],
  );
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (view !== "tools" || toolsRefreshing || toolsLoadedRef.current) {
      return;
    }

    void refreshToolsView({ silent: true });
  }, [toolsRefreshing, view]);

  useEffect(() => {
    if (view !== "knowledge" || knowledgeRefreshing || knowledgeLoadedRef.current) {
      return;
    }

    void refreshKnowledgeView({ silent: true });
  }, [knowledgeRefreshing, view]);

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
          enabled: previousEnabled.get(item.id) ?? false,
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
  }) {
    const normalized = sanitizeMcpName(server.name);
    if (config.mcpServers.some((item) => sanitizeMcpName(item.name) === normalized)) {
      setToast("This server draft already exists");
      setSettingsSection("mcp");
      return;
    }

    const mcpServers = [
      ...config.mcpServers,
      {
        id: `mcp-${uid()}`,
        name: server.name,
        transport: server.transport,
        command: server.transport === "local" ? "node" : "",
        args: [],
        url: "",
        headersJson: "{}",
        envJson: "{}",
        enabled: false,
        timeoutMs: 30000,
      },
    ];

    void commitConfig({ ...cloneConfig(config), mcpServers }, "Added recommended MCP server");
    setSettingsSection("mcp");
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
        setToast("Knowledge bases refreshed");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Refresh knowledge bases failed");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function createKnowledgeBase(name: string, description: string) {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setToast("Enter a knowledge base name first");
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
      setToast(`Created knowledge base ${trimmedName}`);
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
      setToast(error instanceof Error ? error.message : "Create knowledge base failed");
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
      setToast("Knowledge base deleted");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Delete knowledge base failed");
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
      setToast(`Imported ${files.length} file(s)`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "鐎电厧鍙嗛惌銉ㄧ槕閺傚洣娆㈡径杈Е");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeNote(baseId: string, title: string, content: string) {
    if (!title.trim() || !content.trim()) {
      setToast("Enter both a note title and content");
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
      setToast("Knowledge note added");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "濞ｈ濮為惌銉ㄧ槕缁楁棁顔囨径杈Е");
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
      setToast("Knowledge directory added");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Add knowledge directory failed");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeUrl(baseId: string, url: string) {
    try {
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeUrl({ baseId, url });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("Knowledge URL added");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Add knowledge URL failed");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeWebsite(baseId: string, url: string) {
    try {
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeWebsite({ baseId, url });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("Knowledge website added");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Add knowledge website failed");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  const showPreviewPane = view === "chat" && preview && previewOpen;
  const threadBusy = activeThread?.messages.some((message) => message.status === "loading") ?? false;
  const settingsStats = {
    threadCount: activeThreads.length + archivedThreads.length,
    providerCount: config.modelProviders.length,
    mcpCount: config.mcpServers.length,
  };
  const hasSkillResults =
    filteredInstalledSkills.length > 0 ||
    filteredReferenceSkills.length > 0 ||
    filteredRecommendedSkills.length > 0;

  function renderSettingsView() {
    if (settingsSection === "general") {
      return (
        <GeneralSettings
          activeModelLabel={activeModel?.label ?? null}
          mcpCount={settingsStats.mcpCount}
          providerCount={settingsStats.providerCount}
          threadCount={settingsStats.threadCount}
          onOpenWorkspaceFolder={openWorkspaceFolder}
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

    if (settingsSection === "mcp") {
      return (
        <McpSettings
          mcpAdvancedOpen={mcpAdvancedOpen}
          mcpRefreshing={mcpRefreshing}
          mcpServers={config.mcpServers}
          mcpStatusMap={mcpStatusMap}
          onAddMcpServer={addMcpServer}
          onAddRecommendedMcpServer={addRecommendedMcpServer}
          onRefresh={refreshMcpView}
          onRemoveMcpServer={removeMcpServer}
          onToggleAdvanced={() => setMcpAdvancedOpen((value) => !value)}
          onUpdateMcp={updateMcp}
          onInspectServer={(server) =>
            workspaceClient.inspectMcpServer({
              server,
              workspaceRoot: config.opencodeRoot,
            })
          }
          onDebugTool={(server, toolName, argumentsJson) =>
            workspaceClient.debugMcpTool({
              server,
              workspaceRoot: config.opencodeRoot,
              toolName,
              argumentsJson,
            })
          }
        />
      );
    }

    return (
      <WorkspaceSettings
        bridgeUrl={config.bridgeUrl}
        mcpCount={settingsStats.mcpCount}
        opencodeRoot={config.opencodeRoot}
        providerCount={settingsStats.providerCount}
        threadCount={settingsStats.threadCount}
        onOpenWorkspaceFolder={openWorkspaceFolder}
      />
    );
  }

  function renderMainView() {
    if (view === "skills") {
      return (
        <SkillsView
          filteredInstalledSkills={filteredInstalledSkills}
          filteredRecommendedSkills={filteredRecommendedSkills}
          filteredReferenceSkills={filteredReferenceSkills}
          hasResults={hasSkillResults}
          skillQuery={skillQuery}
          skillsRefreshing={skillsRefreshing}
          onPrepareSkillDraft={prepareSkillDraft}
          onRefresh={refreshSkillsView}
          onRunSkill={runSkill}
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
          tools={tools}
          toolsRefreshing={toolsRefreshing}
          onRefresh={refreshToolsView}
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

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

