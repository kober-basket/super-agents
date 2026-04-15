import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Suspense, lazy } from "react";
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
  ChatConversation,
  ChatConversationRuntimeState,
  ChatConversationSummary,
  DesktopWindowState,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeBaseSummary,
  McpServerConfig,
  ModelProviderConfig,
  RemoteControlStatus,
  SkillConfig,
  WorkspaceTool,
} from "./types";
import { workspaceClient } from "./services/workspace-client";
import { PrimarySidebar } from "./features/navigation/PrimarySidebar";
import { AppTitleBar } from "./features/navigation/AppTitleBar";
import { SettingsSidebar } from "./features/settings/SettingsSidebar";
import type { SettingsSection } from "./features/settings/types";
import { useWorkspaceController } from "./features/workspace/useWorkspaceController";
import { fileKind, sanitizeMcpName } from "./features/shared/utils";
import { ChatWorkspace } from "./features/chat/ChatWorkspace";

const PreviewPane = lazy(async () => {
  const module = await import("./features/chat/PreviewPane");
  return { default: module.PreviewPane };
});
const SkillsView = lazy(async () => {
  const module = await import("./features/skills/SkillsView");
  return { default: module.SkillsView };
});
const ToolsView = lazy(async () => {
  const module = await import("./features/tools/ToolsView");
  return { default: module.ToolsView };
});
const KnowledgeView = lazy(async () => {
  const module = await import("./features/knowledge/KnowledgeView");
  return { default: module.KnowledgeView };
});
const AssistantSettings = lazy(async () => {
  const module = await import("./features/settings/AssistantSettings");
  return { default: module.AssistantSettings };
});
const AppearanceSettings = lazy(async () => {
  const module = await import("./features/settings/AppearanceSettings");
  return { default: module.AppearanceSettings };
});
const RemoteControlSettings = lazy(async () => {
  const module = await import("./features/settings/RemoteControlSettings");
  return { default: module.RemoteControlSettings };
});

function uid() {
  return Math.random().toString(36).slice(2);
}

function cloneConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function matchQuery(query: string, values: Array<string | undefined>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

const SIDEBAR_WIDTH_STORAGE_KEY = "super-agents:sidebar-width";
const SETTINGS_SIDEBAR_WIDTH_STORAGE_KEY = "super-agents:settings-sidebar-width";
const PREVIEW_PANE_WIDTH_STORAGE_KEY = "super-agents:preview-pane-width";
const SIDEBAR_DEFAULT_WIDTH = 236;
const SETTINGS_SIDEBAR_DEFAULT_WIDTH = 344;
const PREVIEW_PANE_DEFAULT_WIDTH = 380;
const SIDEBAR_MIN_WIDTH = 188;
const SIDEBAR_MAX_WIDTH = 360;
const SETTINGS_SIDEBAR_MIN_WIDTH = 260;
const SETTINGS_SIDEBAR_MAX_WIDTH = 460;
const PREVIEW_PANE_MIN_WIDTH = 300;
const PREVIEW_PANE_MAX_WIDTH = 640;

type ResizeTarget = "sidebar" | "settings-sidebar" | "preview";
type RemoteControlChannelKey = keyof AppConfig["remoteControl"];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredWidth(key: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(key);
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function LazyViewFallback() {
  return (
    <div className="empty-panel">
      <strong>Loading...</strong>
    </div>
  );
}

function createConversationRuntimeState(
  status: ChatConversationRuntimeState["status"] = "idle",
): ChatConversationRuntimeState {
  return {
    status,
    planEntries: [],
    toolCalls: [],
    terminalOutputs: {},
  };
}

export default function App() {
  const [view, setView] = useState<AppSection>("chat");
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [conversationRuntimeStates, setConversationRuntimeStates] = useState<
    Record<string, ChatConversationRuntimeState>
  >({});
  const [startingChatTurn, setStartingChatTurn] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [messageScrollRequest, setMessageScrollRequest] = useState(0);
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
  const [remoteStatus, setRemoteStatus] = useState<RemoteControlStatus | null>(null);
  const [remoteStatusRefreshing, setRemoteStatusRefreshing] = useState(false);
  const [wechatConnecting, setWechatConnecting] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredWidth(SIDEBAR_WIDTH_STORAGE_KEY, SIDEBAR_DEFAULT_WIDTH),
  );
  const [settingsSidebarWidth, setSettingsSidebarWidth] = useState(() =>
    readStoredWidth(SETTINGS_SIDEBAR_WIDTH_STORAGE_KEY, SETTINGS_SIDEBAR_DEFAULT_WIDTH),
  );
  const [previewPaneWidth, setPreviewPaneWidth] = useState(() =>
    readStoredWidth(PREVIEW_PANE_WIDTH_STORAGE_KEY, PREVIEW_PANE_DEFAULT_WIDTH),
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number; target: ResizeTarget } | null>(null);
  const {
    activeModel,
    appendAttachments,
    attachments,
    availableSkills,
    commitConfig,
    composerModelId,
    config,
    currentWorkspaceLabel,
    currentWorkspacePath,
    dragActive,
    mcpStatusMap,
    pickFiles,
    prepareSkillDraft,
    refreshWorkspaceSnapshot,
    removeAttachment,
    scheduleConfigPersist,
    selectableModels,
    setAttachments,
    setDragActive,
    uninstallSkill,
    updateConfigField,
    useReferenceSkill,
  } = useWorkspaceController({
    onToast: (message) => setToast(message),
  });
  const toolsLoadedRef = useRef(false);
  const knowledgeLoadedRef = useRef(false);
  const wechatLoginCancelledRef = useRef(false);

  const configuredSkills = useMemo(
    () =>
      config.skills.map((skill) => ({
        ...skill,
        location:
          skill.kind === "codex"
            ? skill.system
              ? "Codex 系统技能"
              : skill.sourcePath || "Codex 本地技能"
            : "内置技能",
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
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(clamp(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)),
    );
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      SETTINGS_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clamp(settingsSidebarWidth, SETTINGS_SIDEBAR_MIN_WIDTH, SETTINGS_SIDEBAR_MAX_WIDTH)),
    );
  }, [settingsSidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      PREVIEW_PANE_WIDTH_STORAGE_KEY,
      String(clamp(previewPaneWidth, PREVIEW_PANE_MIN_WIDTH, PREVIEW_PANE_MAX_WIDTH)),
    );
  }, [previewPaneWidth]);

  useEffect(() => {
    if (!resizeTarget) {
      document.body.classList.remove("pane-resizing");
      return undefined;
    }

    document.body.classList.add("pane-resizing");

    const handlePointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      const deltaX = event.clientX - state.startX;
      if (state.target === "sidebar") {
        setSidebarWidth(clamp(state.startWidth + deltaX, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
        return;
      }

      if (state.target === "settings-sidebar") {
        setSettingsSidebarWidth(
          clamp(state.startWidth + deltaX, SETTINGS_SIDEBAR_MIN_WIDTH, SETTINGS_SIDEBAR_MAX_WIDTH),
        );
        return;
      }

      setPreviewPaneWidth(clamp(state.startWidth - deltaX, PREVIEW_PANE_MIN_WIDTH, PREVIEW_PANE_MAX_WIDTH));
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      setResizeTarget(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.classList.remove("pane-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [resizeTarget]);

  useEffect(() => {
    document.documentElement.dataset.theme = config.appearance.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [config.appearance.theme]);

  useEffect(() => {
    if (view !== "tools" || toolsRefreshing || toolsLoadedRef.current) {
      return;
    }

    void refreshToolsView({ silent: true });
  }, [toolsRefreshing, view]);

  useEffect(() => {
    if ((view !== "knowledge" && view !== "chat") || knowledgeRefreshing || knowledgeLoadedRef.current) {
      return;
    }

    void refreshKnowledgeView({ silent: true });
  }, [knowledgeRefreshing, view]);

  useEffect(() => {
    if (view !== "settings" || settingsSection !== "remote-control") {
      return undefined;
    }

    void refreshRemoteControlStatus({ silent: true });
    const timer = window.setInterval(() => {
      void refreshRemoteControlStatus({ silent: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [settingsSection, view]);

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

  function toConversationSummary(conversation: ChatConversation): ChatConversationSummary {
    const lastMessage = conversation.messages[conversation.messages.length - 1];

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessageAt: conversation.lastMessageAt,
      preview: lastMessage?.role === "assistant" ? lastMessage.content : conversation.preview,
      messageCount: conversation.messageCount,
      agentCore: conversation.agentCore,
      agentSessionId: conversation.agentSessionId,
    };
  }

  function upsertConversationSummary(summary: ChatConversationSummary) {
    setConversations((current) =>
      [summary, ...current.filter((conversation) => conversation.id !== summary.id)].sort(
        (left, right) => right.lastMessageAt - left.lastMessageAt || right.createdAt - left.createdAt,
      ),
    );
  }

  function syncConversationState(conversation: ChatConversation) {
    setActiveConversation(conversation);
    setActiveConversationId(conversation.id);
    upsertConversationSummary(toConversationSummary(conversation));
  }

  useEffect(() => {
    let mounted = true;

    void workspaceClient
      .listConversations()
      .then((payload) => {
        if (!mounted) {
          return;
        }
        setConversations(payload.conversations);
      })
      .catch(() => {
        if (mounted) {
          setToast("加载会话列表失败");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return workspaceClient.onChatEvent((event) => {
      if (event.type === "message_delta") {
        const now = Date.now();

        setActiveConversation((current) => {
          if (!current || current.id !== event.conversationId) {
            return current;
          }

          const nextMessages = current.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  content: `${message.content}${event.textDelta}`,
                  updatedAt: now,
                }
              : message,
          );

          return {
            ...current,
            messages: nextMessages,
            updatedAt: now,
            lastMessageAt: now,
            preview: nextMessages[nextMessages.length - 1]?.content ?? current.preview,
          };
        });

        setConversations((current) =>
          current
            .map((conversation) =>
              conversation.id === event.conversationId
                ? {
                    ...conversation,
                    preview: `${conversation.preview}${event.textDelta}`,
                    updatedAt: now,
                    lastMessageAt: now,
                  }
                : conversation,
            )
            .sort((left, right) => right.lastMessageAt - left.lastMessageAt || right.createdAt - left.createdAt),
        );

        return;
      }

      if (event.type === "plan_updated") {
        setConversationRuntimeStates((current) => ({
          ...current,
          [event.conversationId]: {
            ...(current[event.conversationId] ?? createConversationRuntimeState("running")),
            status: "running",
            error: undefined,
            stopReason: undefined,
            planEntries: event.entries,
          },
        }));
        return;
      }

      if (event.type === "tool_call_started") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: "running",
              error: undefined,
              stopReason: undefined,
              toolCalls: [
                ...previous.toolCalls.filter((toolCall) => toolCall.toolCallId !== event.toolCall.toolCallId),
                event.toolCall,
              ],
            },
          };
        });
        return;
      }

      if (event.type === "tool_call_updated") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: "running",
              error: undefined,
              stopReason: undefined,
              toolCalls: previous.toolCalls.map((toolCall) =>
                toolCall.toolCallId === event.toolCallId
                  ? {
                      ...toolCall,
                      ...event.patch,
                      content: event.patch.content ?? toolCall.content,
                      locations: event.patch.locations ?? toolCall.locations,
                    }
                  : toolCall,
              ),
            },
          };
        });
        return;
      }

      if (event.type === "terminal_output") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: "running",
              terminalOutputs: {
                ...previous.terminalOutputs,
                [event.terminal.terminalId]: event.terminal,
              },
            },
          };
        });
        return;
      }

      if (event.type === "turn_finished") {
        setConversationRuntimeStates((current) => ({
          ...current,
          [event.conversationId]: {
            ...(current[event.conversationId] ?? createConversationRuntimeState()),
            status: "idle",
            stopReason: event.stopReason,
            error: undefined,
          },
        }));
        return;
      }

      setConversationRuntimeStates((current) => ({
        ...current,
        [event.conversationId]: {
          ...(current[event.conversationId] ?? createConversationRuntimeState()),
          status: "failed",
          error: event.error,
        },
      }));
      setToast(event.error);
    });
  }, []);

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
      loading: !file.content && !file.dataUrl,
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
      setToast("打开预览失败");
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
      loading: true,
    });

    try {
      const payload = await workspaceClient.readPreview({
        url,
        title: url,
        kind: "web",
      });
      setPreview(payload);
    } catch {
      setToast("打开页面预览失败");
    }
  }

  async function openPreviewExternally(payload: { path?: string; url?: string }) {
    try {
      await workspaceClient.openPreviewTarget(payload);
    } catch {
      setToast("在外部打开预览失败");
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

  function commitModelProviders(modelProviders: ModelProviderConfig[], message = "设置已保存") {
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
        name: "新模型提供方",
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
    commitModelProviders(modelProviders, "已添加提供方");
  }

  function removeModelProvider(providerId: string) {
    const target = config.modelProviders.find((item) => item.id === providerId);
    const modelProviders = config.modelProviders.filter((item) => item.id !== providerId);
    commitModelProviders(
      modelProviders,
      target ? `已移除 ${target.name || "提供方"} 配置` : "已移除提供方配置",
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
      "默认模型已更新",
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
        provider.id,
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
      setToast(error instanceof Error ? error.message : "拉取模型列表失败");
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
      target ? `已移除 ${target.name || "MCP"} 配置` : "已移除 MCP 配置",
    );
  }

  function addMcpServer() {
    const mcpServers = [
      ...config.mcpServers,
      {
        id: `mcp-${uid()}`,
        name: "新 MCP 服务",
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
    void commitConfig({ ...cloneConfig(config), mcpServers }, "已添加 MCP 服务");
  }

  function addRecommendedMcpServer(server: {
    id: string;
    name: string;
    transport: "local" | "remote";
  }) {
    const normalized = sanitizeMcpName(server.name);
    if (config.mcpServers.some((item) => sanitizeMcpName(item.name) === normalized)) {
      setToast("这个服务草稿已经存在");
      setView("tools");
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

    void commitConfig({ ...cloneConfig(config), mcpServers }, "已添加推荐的 MCP 服务");
    setView("tools");
  }

  async function refreshSkillsView() {
    setSkillsRefreshing(true);
    await refreshWorkspaceSnapshot("技能列表已刷新");
    setSkillsRefreshing(false);
  }

  async function refreshMcpView() {
    setMcpRefreshing(true);
    await refreshWorkspaceSnapshot("MCP 状态已刷新");
    setMcpRefreshing(false);
  }

  async function refreshToolsView(options?: { silent?: boolean }) {
    toolsLoadedRef.current = true;
    setToolsRefreshing(true);
    try {
      const payload = await workspaceClient.listTools();
      setTools(payload.tools);
    } catch {
      setToast("刷新工具列表失败");
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

  function clearKnowledgeBaseSelection() {
    updateKnowledgeBaseConfig({
      enabled: false,
      selectedBaseIds: [],
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

  async function refreshRemoteControlStatus(options?: { silent?: boolean }) {
    setRemoteStatusRefreshing(true);
    try {
      const payload = await workspaceClient.getRemoteControlStatus();
      setRemoteStatus(payload);
      if (!options?.silent) {
        setToast("远程控制状态已刷新");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "刷新远程控制状态失败");
    } finally {
      setRemoteStatusRefreshing(false);
    }
  }

  function buildRemoteControlConfig<K extends RemoteControlChannelKey>(
    channel: K,
    patch: Partial<AppConfig["remoteControl"][K]>,
  ) {
    const nextConfig = cloneConfig(config);
    nextConfig.remoteControl = {
      ...nextConfig.remoteControl,
      [channel]: {
        ...nextConfig.remoteControl[channel],
        ...patch,
      },
    };
    return nextConfig;
  }

  function updateRemoteControlChannel<K extends RemoteControlChannelKey>(
    channel: K,
    patch: Partial<AppConfig["remoteControl"][K]>,
    options?: {
      immediate?: boolean;
      toast?: string;
    },
  ) {
    const nextConfig = buildRemoteControlConfig(channel, patch);
    if (options?.immediate) {
      void commitConfig(nextConfig, options.toast || "远程控制配置已更新");
    } else {
      scheduleConfigPersist(nextConfig);
    }

    window.setTimeout(() => {
      void refreshRemoteControlStatus({ silent: true });
    }, 300);
  }

  function updateWechatRemoteControl(enabled: boolean) {
    updateRemoteControlChannel(
      "wechat",
      {
        enabled,
      },
      {
        immediate: true,
        toast: enabled ? "微信远程控制已启用" : "微信远程控制已停用",
      },
    );
  }

  function updateDingtalkRemoteControl(
    patch: Partial<AppConfig["remoteControl"]["dingtalk"]>,
    options?: { immediate?: boolean },
  ) {
    updateRemoteControlChannel("dingtalk", patch, {
      immediate: options?.immediate,
      toast:
        patch.enabled === true
          ? "钉钉远程控制已启用"
          : patch.enabled === false
            ? "钉钉远程控制已停用"
            : undefined,
    });
  }

  function updateFeishuRemoteControl(
    patch: Partial<AppConfig["remoteControl"]["feishu"]>,
    options?: { immediate?: boolean },
  ) {
    updateRemoteControlChannel("feishu", patch, {
      immediate: options?.immediate,
      toast:
        patch.enabled === true
          ? "飞书远程控制已启用"
          : patch.enabled === false
            ? "飞书远程控制已停用"
            : undefined,
    });
  }

  function updateWecomRemoteControl(
    patch: Partial<AppConfig["remoteControl"]["wecom"]>,
    options?: { immediate?: boolean },
  ) {
    updateRemoteControlChannel("wecom", patch, {
      immediate: options?.immediate,
      toast:
        patch.enabled === true
          ? "企微远程控制已启用"
          : patch.enabled === false
            ? "企微远程控制已停用"
            : undefined,
    });
  }

  async function connectWechatRemoteControl() {
    wechatLoginCancelledRef.current = false;
    setWechatConnecting(true);
    try {
      const start = await workspaceClient.startWechatLogin();
      setRemoteStatus((current) =>
        current
          ? {
              ...current,
              wechat: {
                ...current.wechat,
                pendingLogin: true,
                pendingLoginQrCodeUrl: start.qrCodeUrl,
              },
            }
          : current,
      );
      await refreshRemoteControlStatus({ silent: true });
      const result = await workspaceClient.waitWechatLogin({
        sessionKey: start.sessionKey,
        timeoutMs: 480000,
      });
      await refreshRemoteControlStatus({ silent: true });
      if (!wechatLoginCancelledRef.current) {
        setToast(result.connected ? "微信已连接" : result.message || "微信登录未完成");
      }
    } catch (error) {
      if (!wechatLoginCancelledRef.current) {
        setToast(error instanceof Error ? error.message : "微信连接失败");
      }
      await refreshRemoteControlStatus({ silent: true });
    } finally {
      setWechatConnecting(false);
    }
  }

  async function disconnectWechatRemoteControl() {
    wechatLoginCancelledRef.current = true;
    setWechatConnecting(false);
    try {
      await workspaceClient.disconnectWechat();
      await refreshRemoteControlStatus({ silent: true });
      setToast("微信已断开连接");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "断开微信连接失败");
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
      setToast("目录已添加");
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
      setToast("链接已添加");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "添加链接失败");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeWebsite(baseId: string, url: string) {
    try {
      setKnowledgeRefreshing(true);
      const payload = await workspaceClient.addKnowledgeWebsite({ baseId, url });
      setKnowledgeBases(payload.knowledgeBases);
      setToast("网站已添加");
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
      setToast("知识项已删除");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除知识项失败");
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
      "主题已更新",
    );
  }

  async function minimizeWindow() {
    try {
      const payload = await workspaceClient.minimizeWindow();
      setWindowState(payload);
    } catch {
      setToast("最小化窗口失败");
    }
  }

  async function toggleMaximizeWindow() {
    try {
      const payload = await workspaceClient.toggleMaximizeWindow();
      setWindowState(payload);
    } catch {
      setToast("切换窗口大小失败");
    }
  }

  async function closeWindow() {
    try {
      await workspaceClient.closeWindow();
    } catch {
      setToast("关闭窗口失败");
    }
  }

  function createDraftConversation() {
    setView("chat");
    setActiveConversation(null);
    setActiveConversationId(null);
    setDraftMessage("");
    setAttachments([]);
  }

  async function openConversation(conversationId: string) {
    setView("chat");
    setActiveConversationId(conversationId);
    setDraftMessage("");
    setAttachments([]);
    setActiveConversation(null);

    try {
      const conversation = await workspaceClient.getConversation(conversationId);
      syncConversationState(conversation);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加载会话失败");
      setToast(error instanceof Error ? error.message : "加载会话失败");
      setActiveConversationId(null);
    }
  }

  async function deleteConversation(conversationId: string) {
    try {
      const payload = await workspaceClient.deleteConversation(conversationId);
      setConversations(payload.conversations);
      setConversationRuntimeStates((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });

      if (activeConversationId === conversationId) {
        setActiveConversation(null);
        setActiveConversationId(null);
        setDraftMessage("");
        setAttachments([]);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除会话失败");
    }
  }

  function buildMockAssistantMessage(userContent: string) {
    return {
      id: uid(),
      role: "assistant",
      content: `好的，你发送的是：${userContent}`,
    };
  }

  function buildAssistantEchoMessage(userContent: string) {
    return {
      id: uid(),
      role: "assistant",
      content: `\u597d\u7684\uff0c\u4f60\u53d1\u9001\u7684\u662f\uff1a${userContent}`,
    };
  }

  async function sendChatMessage() {
    const content = draftMessage.trim();
    const pendingAttachments = attachments.map((attachment) => ({ ...attachment }));
    if (!content && pendingAttachments.length === 0) return;

    setMessageScrollRequest((current) => current + 1);

    setStartingChatTurn(true);

    try {
      const result = await workspaceClient.startChatTurn({
        conversationId: activeConversationId,
        content,
        attachments: pendingAttachments,
      });

      syncConversationState(result.conversation);
      setConversationRuntimeStates((current) => ({
        ...current,
        [result.conversation.id]: createConversationRuntimeState("running"),
      }));
      setView("chat");
      setDraftMessage("");
      setAttachments([]);
    } catch (error) {
      /*
      setToast(error instanceof Error ? error.message : "发送消息失败");
      legacy fallback
      setToast(error instanceof Error ? error.message : "发送消息失败");
      fallback continued
      setToast(error instanceof Error ? error.message : "发送消息失败");
      */
      setToast(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setStartingChatTurn(false);
    }
  }

  const showPreviewPane = preview && previewOpen;
  const canResizePanels = viewportWidth > 840;
  const showInlinePreviewPane = Boolean(showPreviewPane) && viewportWidth > 1400;
  const activeSidebarWidth = view === "settings" ? settingsSidebarWidth : sidebarWidth;
  const appShellStyle =
    canResizePanels
      ? {
          gridTemplateColumns: showInlinePreviewPane
            ? `${activeSidebarWidth}px minmax(0, 1fr) ${previewPaneWidth}px`
            : `${activeSidebarWidth}px minmax(0, 1fr)`,
        }
      : undefined;
  const hasSkillResults =
    filteredInstalledSkills.length > 0 || filteredReferenceSkills.length > 0;
  const activeConversationRuntimeState =
    (activeConversationId ? conversationRuntimeStates[activeConversationId] : null) ?? null;
  const activeConversationBusy =
    startingChatTurn || activeConversationRuntimeState?.status === "running";

  const beginResize =
    (target: ResizeTarget, width: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: width,
        target,
      };
      setResizeTarget(target);
    };

  const resetWidth = (target: ResizeTarget) => {
    if (target === "sidebar") {
      setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
      return;
    }

    if (target === "settings-sidebar") {
      setSettingsSidebarWidth(SETTINGS_SIDEBAR_DEFAULT_WIDTH);
      return;
    }

    setPreviewPaneWidth(PREVIEW_PANE_DEFAULT_WIDTH);
  };

  function renderSettingsView() {
    if (settingsSection === "appearance") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
          <AppearanceSettings
            appearance={config.appearance}
            onThemeChange={updateAppearanceTheme}
          />
        </Suspense>
      );
    }

    if (settingsSection === "assistant") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
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
        </Suspense>
      );
    }

    if (settingsSection === "remote-control") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
          <RemoteControlSettings
            remoteControl={config.remoteControl}
            remoteStatus={remoteStatus}
            refreshing={remoteStatusRefreshing}
            wechatConnecting={wechatConnecting}
            onRefresh={refreshRemoteControlStatus}
            onToggleWechatEnabled={updateWechatRemoteControl}
            onStartWechatLogin={connectWechatRemoteControl}
            onDisconnectWechat={disconnectWechatRemoteControl}
            onUpdateDingtalk={updateDingtalkRemoteControl}
            onUpdateFeishu={updateFeishuRemoteControl}
            onUpdateWecom={updateWecomRemoteControl}
          />
        </Suspense>
      );
    }
  }

  function renderMainView() {
    if (view === "chat") {
      return (
        <ChatWorkspace
          activeConversation={activeConversation}
          activeModel={activeModel}
          attachments={attachments}
          busy={activeConversationBusy}
          composerModelId={composerModelId}
          draftMessage={draftMessage}
          knowledgeBases={knowledgeBases}
          knowledgeEnabled={config.knowledgeBase.enabled}
          knowledgeRefreshing={knowledgeRefreshing}
          onDraftMessageChange={setDraftMessage}
          onClearKnowledgeBases={clearKnowledgeBaseSelection}
          onManageKnowledgeBases={() => setView("knowledge")}
          onModelChange={(value) => updateConfigField("activeModelId", value)}
          onOpenAttachment={openPreview}
          onOpenPreviewLink={openPreviewLink}
          onPickFiles={() => void pickFiles()}
          onRemoveAttachment={removeAttachment}
          onSendMessage={sendChatMessage}
          onToggleKnowledgeBase={toggleKnowledgeBaseSelection}
          runtimeState={activeConversationRuntimeState}
          onVoiceInput={() => setToast("语音输入即将支持")}
          selectableModels={selectableModels}
          selectedKnowledgeBaseIds={config.knowledgeBase.selectedBaseIds}
          scrollToBottomRequest={messageScrollRequest}
        />
      );
    }

    if (view === "skills") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
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
        </Suspense>
      );
    }

    if (view === "tools") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
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
                workspaceRoot: config.workspaceRoot,
                toolName,
                argumentsJson,
              })
            }
            onInspectServer={(server) =>
              workspaceClient.inspectMcpServer({
                server,
                workspaceRoot: config.workspaceRoot,
              })
            }
            onRefresh={refreshToolsView}
            onRefreshMcp={refreshMcpView}
            onRemoveMcpServer={removeMcpServer}
            onToggleAdvanced={() => setMcpAdvancedOpen((value) => !value)}
            onUpdateMcp={updateMcp}
          />
        </Suspense>
      );
    }

    if (view === "knowledge") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
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
        </Suspense>
      );
    }

    if (view === "settings") {
      return renderSettingsView();
    }

    return (
      <div className="empty-panel">
        <strong>选择一个功能开始使用</strong>
        <span>左侧提供技能、工具、知识库和设置入口。</span>
      </div>
    );
  }

  return (
    <div className={clsx("window-frame", windowState?.maximized && "maximized")}>
      <AppTitleBar
        sidebarWidth={activeSidebarWidth}
        view={view}
        windowState={windowState}
        onClose={closeWindow}
        onMinimize={minimizeWindow}
        onToggleMaximize={toggleMaximizeWindow}
      />

      <div
        className={clsx("app-shell", showPreviewPane && "with-preview", view === "settings" && "settings-mode")}
        style={appShellStyle}
      >
        {view === "settings" ? (
          <SettingsSidebar
            settingsSection={settingsSection}
            onBack={() => setView("skills")}
            onSelect={setSettingsSection}
          />
        ) : (
          <PrimarySidebar
            activeConversationId={activeConversationId}
            conversations={conversations.map((conversation) => ({
              ...conversation,
              isGenerating: conversationRuntimeStates[conversation.id]?.status === "running",
            }))}
            onCreateConversation={createDraftConversation}
            onDeleteConversation={(conversationId) => void deleteConversation(conversationId)}
            onOpenConversation={(conversationId) => void openConversation(conversationId)}
            onSetView={setView}
            view={view}
          />
        )}

        {canResizePanels ? (
          <button
            aria-label={view === "settings" ? "调整设置侧栏宽度" : "调整左侧栏宽度"}
            className={clsx(
              "pane-resizer",
              "pane-resizer-left",
              ((view === "settings" && resizeTarget === "settings-sidebar") ||
                (view !== "settings" && resizeTarget === "sidebar")) &&
                "active",
            )}
            onDoubleClick={() => resetWidth(view === "settings" ? "settings-sidebar" : "sidebar")}
            onPointerDown={beginResize(view === "settings" ? "settings-sidebar" : "sidebar", activeSidebarWidth)}
            style={{ left: `${activeSidebarWidth - 6}px` }}
            type="button"
          >
            <span className="pane-resizer-rail" />
          </button>
        ) : null}

        <main className="workspace">
          {renderMainView()}
        </main>

        {showInlinePreviewPane ? (
          <button
            aria-label="调整预览栏宽度"
            className={clsx("pane-resizer", "pane-resizer-right", resizeTarget === "preview" && "active")}
            onDoubleClick={() => resetWidth("preview")}
            onPointerDown={beginResize("preview", previewPaneWidth)}
            style={{ right: `${previewPaneWidth - 6}px` }}
            type="button"
          >
            <span className="pane-resizer-rail" />
          </button>
        ) : null}

        {showPreviewPane && preview ? (
          <Suspense fallback={<LazyViewFallback />}>
            <PreviewPane
              preview={preview}
              onClearPreview={() => setPreview(null)}
              onClosePane={() => setPreviewOpen(false)}
              onOpenLink={openPreviewLink}
              onOpenExternal={openPreviewExternally}
            />
          </Suspense>
        ) : null}
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

