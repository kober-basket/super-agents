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
import { getNextModelProvider } from "./lib/provider-presets";
import type {
  AppConfig,
  AppSection,
  ChatConversation,
  ChatMessage,
  ChatConversationRuntimeState,
  ChatConversationSummary,
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
import {
  arrayBufferToBase64,
  buildVoiceRecordingFileName,
  getPreferredAudioRecordingMimeType,
  mergeTranscriptIntoDraft,
  type VoiceInputState,
} from "./lib/voice-input";

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
const ReportsView = lazy(async () => {
  const module = await import("./features/reports/ReportsView");
  return { default: module.ReportsView };
});
const EmergencyPlanView = lazy(async () => {
  const module = await import("./features/emergency/EmergencyPlanView");
  return { default: module.EmergencyPlanView };
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

function normalizeKnowledgeBaseSelection(value: string[] | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function filterKnowledgeBaseSelection(value: string[] | undefined, knowledgeBases: KnowledgeBaseSummary[]) {
  const validIds = new Set(knowledgeBases.map((base) => base.id));
  return normalizeKnowledgeBaseSelection(value).filter((item) => validIds.has(item));
}

function resolveConversationKnowledgeBaseSelection(
  conversationId: string | null,
  conversation: ChatConversation | null,
  draftKnowledgeBaseIds: string[],
  conversationKnowledgeBaseIds: Record<string, string[]>,
) {
  if (!conversationId) {
    return draftKnowledgeBaseIds;
  }

  return conversationKnowledgeBaseIds[conversationId] ?? conversation?.selectedKnowledgeBaseIds ?? [];
}

function formatConversationPreview(value: string | undefined) {
  const base = (value ?? "").replace(/\s+/g, " ").trim();
  return base.length > 120 ? `${base.slice(0, 120)}...` : base;
}

function describeMessagePreview(message: Pick<ChatMessage, "content" | "visuals"> | null | undefined) {
  const contentPreview = formatConversationPreview(message?.content);
  if (contentPreview) {
    return contentPreview;
  }

  const firstVisual = message?.visuals?.[0];
  if (!firstVisual) {
    return "";
  }

  return formatConversationPreview(
    firstVisual.title?.trim() ||
      firstVisual.description?.trim() ||
      (firstVisual.type === "chart" ? "Data chart" : "Diagram"),
  );
}

const SIDEBAR_WIDTH_STORAGE_KEY = "super-agents:sidebar-width";
const SETTINGS_SIDEBAR_WIDTH_STORAGE_KEY = "super-agents:settings-sidebar-width";
const PREVIEW_PANE_WIDTH_STORAGE_KEY = "super-agents:preview-pane-width";
const SIDEBAR_DEFAULT_WIDTH = 208;
const SETTINGS_SIDEBAR_DEFAULT_WIDTH = 344;
const PREVIEW_PANE_DEFAULT_WIDTH = 380;
const SIDEBAR_MIN_WIDTH = 172;
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

function readStoredWidth(key: string, fallback: number, legacyValues: number[] = []) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(key);
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return legacyValues.includes(parsedValue) ? fallback : parsedValue;
}

function LazyViewFallback() {
  return (
    <div className="empty-panel">
      <strong>正在加载...</strong>
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
    thoughtText: "",
  };
}

function isConversationTurnActive(status?: ChatConversationRuntimeState["status"]) {
  return status === "running" || status === "cancelling";
}

function preserveActiveTurnStatus(status?: ChatConversationRuntimeState["status"]) {
  return status === "cancelling" ? "cancelling" : "running";
}

function looksLikeTurnCancellation(value?: string) {
  return Boolean(value && /(cancel|abort|interrupt|stop(ped)?)/i.test(value));
}

function normalizeTurnStopReason(
  stopReason: string | undefined,
  status?: ChatConversationRuntimeState["status"],
) {
  if (status === "cancelling" || looksLikeTurnCancellation(stopReason)) {
    return "cancelled";
  }

  return stopReason;
}

function formatVoiceInputError(error: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "麦克风权限未开启，请允许访问后重试";
  }

  if (error === "audio-capture") {
    return "没有检测到可用的麦克风";
  }

  if (error === "network") {
    return "语音识别服务暂时不可用，请稍后再试";
  }

  if (error === "no-speech") {
    return "没有听到语音，再试一次吧";
  }

  if (error === "language-not-supported") {
    return "当前语言暂不支持语音识别";
  }

  if (error === "aborted") {
    return "";
  }

  return "语音输入失败，请重试";
}

function formatVoiceRecordingError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "麦克风权限未开启，请允许访问后重试";
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "没有检测到可用的麦克风";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "麦克风当前不可用，请检查是否被其他应用占用";
    }
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : "语音输入失败，请重试";
}

function formatProviderModelsRefreshError(provider: Pick<ModelProviderConfig, "name" | "apiKey" | "baseUrl">, error: unknown) {
  const fallback = "拉取模型列表失败，请稍后重试";
  const rawMessage = error instanceof Error ? error.message.trim() : "";
  const normalizedMessage = rawMessage.toLowerCase();
  const providerName = provider.name.trim() || "当前提供商";

  if (!provider.apiKey.trim()) {
    return `请先填写 ${providerName} 的 API Key，再拉取模型列表。`;
  }

  if (!provider.baseUrl.trim()) {
    return `请先填写 ${providerName} 的 Base URL，再拉取模型列表。`;
  }

  if (
    normalizedMessage.includes("you didn't provide an api key") ||
    normalizedMessage.includes("authorization header") ||
    normalizedMessage.includes("invalid api key") ||
    normalizedMessage.includes("incorrect api key")
  ) {
    return `${providerName} 的 API Key 不可用，请检查后再重试。`;
  }

  if (normalizedMessage.includes("fetch failed") || normalizedMessage.includes("network")) {
    return `无法连接到 ${providerName}，请检查 Base URL、网络或代理设置。`;
  }

  return rawMessage || fallback;
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
  const [draftKnowledgeBaseIds, setDraftKnowledgeBaseIds] = useState<string[]>([]);
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
  const [conversationKnowledgeBaseIds, setConversationKnowledgeBaseIds] = useState<
    Record<string, string[]>
  >({});
  const [knowledgeRefreshing, setKnowledgeRefreshing] = useState(false);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpAdvancedOpen, setMcpAdvancedOpen] = useState(false);
  const [providerRefreshingId, setProviderRefreshingId] = useState<string | null>(null);
  const [providerRefreshErrors, setProviderRefreshErrors] = useState<Record<string, string>>({});
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
  const [remoteStatus, setRemoteStatus] = useState<RemoteControlStatus | null>(null);
  const [remoteStatusRefreshing, setRemoteStatusRefreshing] = useState(false);
  const [wechatConnecting, setWechatConnecting] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredWidth(SIDEBAR_WIDTH_STORAGE_KEY, SIDEBAR_DEFAULT_WIDTH, [236]),
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
  const [voiceInputState, setVoiceInputState] = useState<VoiceInputState>("idle");
  const resizeStateRef = useRef<{ startX: number; startWidth: number; target: ResizeTarget } | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceRecorderStreamRef = useRef<MediaStream | null>(null);
  const voiceRecorderMimeTypeRef = useRef("audio/webm");
  const voiceRecorderChunksRef = useRef<Blob[]>([]);
  const voiceShouldCommitRef = useRef(false);
  const voiceRequestTokenRef = useRef(0);
  const {
    activeModel,
    appendAttachments,
    attachments,
    commitConfig,
    composerModelId,
    config,
    currentWorkspaceLabel,
    currentWorkspacePath,
    dragActive,
    importLocalSkill,
    mcpStatusMap,
    pickFiles,
    prepareSkillDraft,
    refreshWorkspaceSnapshot,
    removeAttachment,
    scheduleConfigPersist,
    selectableModels,
    setAttachments,
    setDragActive,
    skillImporting,
    uninstallSkill,
    updateConfigField,
  } = useWorkspaceController({
    onToast: (message) => setToast(message),
  });
  const toolsLoadedRef = useRef(false);
  const knowledgeLoadedRef = useRef(false);
  const wechatLoginCancelledRef = useRef(false);
  const voiceInputSupported =
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

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
    return () => {
      voiceRequestTokenRef.current += 1;
      voiceShouldCommitRef.current = false;
      if (voiceRecorderRef.current && voiceRecorderRef.current.state !== "inactive") {
        voiceRecorderRef.current.stop();
      }
      voiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceRecorderRef.current = null;
      voiceRecorderStreamRef.current = null;
      voiceRecorderChunksRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (view === "chat") {
      return;
    }

    voiceRequestTokenRef.current += 1;
    voiceShouldCommitRef.current = false;
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== "inactive") {
      voiceRecorderRef.current.stop();
    }
    voiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceRecorderRef.current = null;
    voiceRecorderStreamRef.current = null;
    voiceRecorderChunksRef.current = [];
    setVoiceInputState("idle");
  }, [view]);

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
    if ((view !== "tools" && view !== "reports") || toolsRefreshing || toolsLoadedRef.current) {
      return;
    }

    void refreshToolsView({ silent: true });
  }, [toolsRefreshing, view]);

  useEffect(() => {
    if ((view !== "knowledge" && view !== "chat" && view !== "reports") || knowledgeRefreshing || knowledgeLoadedRef.current) {
      return;
    }

    void refreshKnowledgeView({ silent: true });
  }, [knowledgeRefreshing, view]);

  useEffect(() => {
    if (reportForm.workspaceRoot) {
      return;
    }
    setReportForm((current) => ({ ...current, workspaceRoot: config.workspaceRoot || "" }));
  }, [config.workspaceRoot, reportForm.workspaceRoot]);

  useEffect(() => {
    if (emergencyForm.workspaceRoot) {
      return;
    }
    setEmergencyForm((current) => ({ ...current, workspaceRoot: config.workspaceRoot || "" }));
  }, [config.workspaceRoot, emergencyForm.workspaceRoot]);

  useEffect(() => {
    if (reportForm.knowledgeBaseId) {
      return;
    }
    const fallbackId = config.knowledgeBase.selectedBaseIds[0] || knowledgeBases[0]?.id || "";
    if (!fallbackId) {
      return;
    }
    setReportForm((current) => ({ ...current, knowledgeBaseId: fallbackId }));
  }, [config.knowledgeBase.selectedBaseIds, knowledgeBases, reportForm.knowledgeBaseId]);

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
    if (embeddingModels.length === 0) {
      if (config.knowledgeBase.embeddingModel) {
        updateKnowledgeBaseConfig({ embeddingModel: "" });
      }
      return;
    }

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
      preview: lastMessage?.role === "assistant" ? describeMessagePreview(lastMessage) : conversation.preview,
      messageCount: conversation.messageCount,
      selectedKnowledgeBaseIds: conversation.selectedKnowledgeBaseIds,
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
    let mounted = true;
    const unsubscribe = workspaceClient.onWorkspaceChanged(() => {
      void (async () => {
        try {
          const [listPayload, conversation] = await Promise.all([
            workspaceClient.listConversations(),
            activeConversationId
              ? workspaceClient.getConversation(activeConversationId).catch(() => null)
              : Promise.resolve(null),
          ]);

          if (!mounted) {
            return;
          }

          setConversations(listPayload.conversations);

          if (conversation) {
            setActiveConversation((current) =>
              !current || current.id === conversation.id ? conversation : current,
            );
          }
        } catch {
          return;
        }
      })();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [activeConversationId]);

  useEffect(() => {
    return workspaceClient.onChatEvent((event) => {
      if (event.type === "message_updated") {
        const now = Date.now();
        const preview = describeMessagePreview({
          content: event.content,
          visuals: event.visuals,
        });

        setActiveConversation((current) => {
          if (!current || current.id !== event.conversationId) {
            return current;
          }

          const nextMessages = current.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  content: event.content,
                  visuals: event.visuals.length > 0 ? event.visuals : undefined,
                  updatedAt: now,
                }
              : message,
          );

          return {
            ...current,
            messages: nextMessages,
            updatedAt: now,
            lastMessageAt: now,
            preview: preview || current.preview,
          };
        });

        setConversations((current) =>
          current
            .map((conversation) =>
              conversation.id === event.conversationId
                ? {
                    ...conversation,
                    preview: preview || conversation.preview,
                    updatedAt: now,
                    lastMessageAt: now,
                  }
                : conversation,
            )
            .sort((left, right) => right.lastMessageAt - left.lastMessageAt || right.createdAt - left.createdAt),
        );

        return;
      }

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

      if (event.type === "message_runtime_trace_updated") {
        const now = Date.now();

        setActiveConversation((current) => {
          if (!current || current.id !== event.conversationId) {
            return current;
          }

          return {
            ...current,
            messages: current.messages.map((message) =>
              message.id === event.messageId
                ? {
                    ...message,
                    runtimeTrace: event.runtimeTrace,
                    updatedAt: now,
                  }
                : message,
            ),
            updatedAt: now,
          };
        });

        return;
      }

      if (event.type === "plan_updated") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: preserveActiveTurnStatus(previous.status),
              error: undefined,
              stopReason: undefined,
              planEntries: event.entries,
            },
          };
        });
        return;
      }

      if (event.type === "thought_delta") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: preserveActiveTurnStatus(previous.status),
              error: undefined,
              stopReason: undefined,
              thoughtText: `${previous.thoughtText}${event.textDelta}`,
            },
          };
        });
        return;
      }

      if (event.type === "tool_call_started") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: preserveActiveTurnStatus(previous.status),
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
              status: preserveActiveTurnStatus(previous.status),
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
              status: preserveActiveTurnStatus(previous.status),
              error: undefined,
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
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState();
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: "idle",
              stopReason: normalizeTurnStopReason(event.stopReason, previous.status),
              error: undefined,
            },
          };
        });
        return;
      }

      let shouldToast = true;
      setConversationRuntimeStates((current) => {
        const previous = current[event.conversationId] ?? createConversationRuntimeState();
        if (previous.status === "cancelling" && looksLikeTurnCancellation(event.error)) {
          shouldToast = false;
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: "idle",
              stopReason: "cancelled",
              error: undefined,
            },
          };
        }

        return {
          ...current,
          [event.conversationId]: {
            ...previous,
            status: "failed",
            stopReason: undefined,
            error: event.error,
          },
        };
      });
      if (shouldToast) {
        setToast(event.error);
      }
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

  function addPresetModelProvider() {
    const providerId = sanitizeModelProviderId(`provider-${uid()}`);
    const nextProvider = getNextModelProvider(config.modelProviders, providerId);
    const modelProviders = [...config.modelProviders, nextProvider];
    setSelectedModelProviderId(nextProvider.id);
    commitModelProviders(modelProviders, "宸叉坊鍔犳彁渚涙柟");
  }

  function addModelProvider() {
    const providerId = sanitizeModelProviderId(`provider-${uid()}`);
    const modelProviders = [
      {
        id: providerId,
        name: "新模型提供方",
        kind: "openai-compatible" as const,
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
        temperature: 0.2,
        maxTokens: 4096,
        enabled: true,
        system: false,
        models: [],
      },
      ...config.modelProviders,
    ];
    setSelectedModelProviderId(providerId);
    commitModelProviders(modelProviders, "已添加提供方");
  }

  function reorderModelProviders(providerId: string, targetProviderId: string) {
    const index = config.modelProviders.findIndex((item) => item.id === providerId);
    const targetIndex = config.modelProviders.findIndex((item) => item.id === targetProviderId);
    if (index < 0 || targetIndex < 0 || index === targetIndex) {
      return;
    }

    const modelProviders = [...config.modelProviders];
    const [target] = modelProviders.splice(index, 1);
    modelProviders.splice(targetIndex, 0, target);
    commitModelProviders(modelProviders);
  }

  function removeModelProvider(providerId: string) {
    const target = config.modelProviders.find((item) => item.id === providerId);
    if (target?.system) {
      setToast("内置提供商不可删除");
      return;
    }
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
    setProviderRefreshErrors((current) => {
      if (!current[providerId]) {
        return current;
      }

      const next = { ...current };
      delete next[providerId];
      return next;
    });
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
      setProviderRefreshErrors((current) => {
        if (!current[providerId]) {
          return current;
        }

        const next = { ...current };
        delete next[providerId];
        return next;
      });
      commitModelProviders(modelProviders, `${provider.name} 模型已同步`);
    } catch (error) {
      setProviderRefreshErrors((current) => ({
        ...current,
        [providerId]: formatProviderModelsRefreshError(provider, error),
      }));
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
    command?: string;
    args?: string[];
    url?: string;
    headersJson?: string;
    envJson?: string;
    enabled?: boolean;
  }) {
    const normalized = sanitizeMcpName(server.name);
    if (config.mcpServers.some((item) => sanitizeMcpName(item.name) === normalized)) {
      setToast("这个服务草稿已经存在");
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

    void commitConfig({ ...cloneConfig(config), mcpServers }, "已添加推荐的 MCP 服务");
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
    const selected = new Set(activeKnowledgeBaseIds);
    if (selected.has(baseId)) {
      selected.delete(baseId);
    } else {
      selected.add(baseId);
    }

    const nextSelectedBaseIds = filterKnowledgeBaseSelection(Array.from(selected), knowledgeBases);
    if (activeConversationId) {
      setConversationKnowledgeBaseIds((current) => ({
        ...current,
        [activeConversationId]: nextSelectedBaseIds,
      }));
      return;
    }

    setDraftKnowledgeBaseIds(nextSelectedBaseIds);
  }

  function clearKnowledgeBaseSelection() {
    if (activeConversationId) {
      setConversationKnowledgeBaseIds((current) => ({
        ...current,
        [activeConversationId]: [],
      }));
      return;
    }

    setDraftKnowledgeBaseIds([]);
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
    if (!reportForm.projectName.trim()) {
      setToast("请先输入项目名称");
      return;
    }

    setReportGenerating(true);
    try {
      const payload = await workspaceClient.generateProjectReport({
        ...reportForm,
        workspaceRoot: reportForm.workspaceRoot || config.workspaceRoot,
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
      const result = await workspaceClient.generateEmergencyPlan({
        ...emergencyForm,
        workspaceRoot: emergencyForm.workspaceRoot || config.workspaceRoot,
      });
      setEmergencyResult(result);
      setToast(`应急预案已生成：${result.fileName}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "生成应急预案失败");
    } finally {
      setEmergencyGenerating(false);
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
    setDraftKnowledgeBaseIds([]);
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
      setConversationKnowledgeBaseIds((current) => {
        if (!(conversationId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setConversationRuntimeStates((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });

      if (activeConversationId === conversationId) {
        setActiveConversation(null);
        setActiveConversationId(null);
        setDraftMessage("");
        setDraftKnowledgeBaseIds([]);
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

  function buildOptimisticConversationPreview(content: string, pendingAttachments: FileDropEntry[]) {
    const trimmed = content.trim();
    if (trimmed) {
      return trimmed;
    }

    const attachmentNames = pendingAttachments
      .map((attachment) => attachment.name.trim())
      .filter(Boolean);
    return attachmentNames.join("、");
  }

  async function sendChatMessage() {
    const content = draftMessage.trim();
    const pendingAttachments = attachments.map((attachment) => ({ ...attachment }));
    const selectedKnowledgeBaseIds = activeKnowledgeBaseIds;
    if (!content && pendingAttachments.length === 0) return;

    voiceRequestTokenRef.current += 1;
    voiceShouldCommitRef.current = false;
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== "inactive") {
      voiceRecorderRef.current.stop();
    }
    voiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceRecorderRef.current = null;
    voiceRecorderStreamRef.current = null;
    voiceRecorderChunksRef.current = [];
    setVoiceInputState("idle");

    setMessageScrollRequest((current) => current + 1);

    const now = Date.now();
    const previousConversation = activeConversation;
    const previousConversationId = activeConversationId;
    const previousConversations = conversations;
    const nextConversationId = activeConversationId ?? `temp-${uid()}`;
    const optimisticUserMessage: ChatMessage = {
      id: `temp-user-${uid()}`,
      role: "user",
      content,
      attachments: pendingAttachments,
      createdAt: now,
      updatedAt: now,
    };
    const optimisticAssistantMessage: ChatMessage = {
      id: `temp-assistant-${uid()}`,
      role: "assistant",
      content: "",
      createdAt: now + 1,
      updatedAt: now + 1,
    };
    const optimisticPreview = buildOptimisticConversationPreview(content, pendingAttachments);
    const optimisticConversation: ChatConversation = activeConversation
      ? {
          ...activeConversation,
          messages: [...activeConversation.messages, optimisticUserMessage, optimisticAssistantMessage],
          updatedAt: now + 1,
          lastMessageAt: now + 1,
          messageCount: activeConversation.messageCount + 2,
          preview: optimisticPreview || activeConversation.preview,
          selectedKnowledgeBaseIds,
        }
      : {
          id: nextConversationId,
          title: content || pendingAttachments[0]?.name || "新对话",
          createdAt: now,
          updatedAt: now + 1,
          lastMessageAt: now + 1,
          preview: optimisticPreview,
          messageCount: 2,
          selectedKnowledgeBaseIds,
          messages: [optimisticUserMessage, optimisticAssistantMessage],
        };

    syncConversationState(optimisticConversation);
    setView("chat");
    setDraftMessage("");
    setAttachments([]);
    setStartingChatTurn(true);

    try {
      const result = await workspaceClient.startChatTurn({
        conversationId: activeConversationId,
        content,
        attachments: pendingAttachments,
        selectedKnowledgeBaseIds,
      });

      syncConversationState(result.conversation);
      setConversationRuntimeStates((current) => ({
        ...current,
        [result.conversation.id]: createConversationRuntimeState("running"),
      }));
    } catch (error) {
      if (previousConversation) {
        setActiveConversation(previousConversation);
        setActiveConversationId(previousConversationId);
        upsertConversationSummary(toConversationSummary(previousConversation));
      } else {
        setActiveConversation(null);
        setActiveConversationId(null);
        setConversations(previousConversations);
      }
      setView("chat");
      setDraftMessage(content);
      setAttachments(pendingAttachments);
      /*
      setToast(error instanceof Error ? error.message : "发送消息失败");
      legacy fallback
      setToast(error instanceof Error ? error.message : "发送消息失败");
      fallback continued
      setToast(error instanceof Error ? error.message : "发送消息失败");
      */
      setToast(error instanceof Error ? error.message : "发送消息失败");
    } finally {
      setStartingChatTurn(false);
    }
  }

  function stopVoiceInput() {
    if (voiceInputState === "transcribing") {
      return;
    }

    if (!voiceRecorderRef.current) {
      setVoiceInputState("idle");
      return;
    }

    voiceShouldCommitRef.current = true;
    setVoiceInputState("transcribing");
    voiceRecorderRef.current.stop();
  }

  function releaseVoiceRecorder() {
    voiceRecorderRef.current = null;
    voiceRecorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceRecorderStreamRef.current = null;
    voiceRecorderChunksRef.current = [];
  }

  function cancelVoiceInput() {
    voiceRequestTokenRef.current += 1;
    voiceShouldCommitRef.current = false;
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== "inactive") {
      voiceRecorderRef.current.stop();
    } else {
      releaseVoiceRecorder();
    }
    setVoiceInputState("idle");
  }

  async function startVoiceInput() {
    if (!voiceInputSupported) {
      setToast("当前环境暂不支持语音输入");
      return;
    }

    const requestToken = ++voiceRequestTokenRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredMimeType = getPreferredAudioRecordingMimeType();
    const recorder = preferredMimeType
      ? new MediaRecorder(stream, { mimeType: preferredMimeType })
      : new MediaRecorder(stream);

    voiceRecorderRef.current = recorder;
    voiceRecorderStreamRef.current = stream;
    voiceRecorderMimeTypeRef.current = recorder.mimeType || preferredMimeType || "audio/webm";
    voiceRecorderChunksRef.current = [];
    voiceShouldCommitRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        voiceRecorderChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      if (requestToken !== voiceRequestTokenRef.current) {
        return;
      }

      releaseVoiceRecorder();
      setVoiceInputState("idle");
      setToast("录音失败，请重试");
    };

    recorder.onstop = () => {
      const shouldCommit = voiceShouldCommitRef.current;
      const activeToken = requestToken;
      const chunks = [...voiceRecorderChunksRef.current];
      const mimeType = voiceRecorderMimeTypeRef.current;
      voiceShouldCommitRef.current = false;
      releaseVoiceRecorder();

      if (!shouldCommit) {
        if (activeToken === voiceRequestTokenRef.current) {
          setVoiceInputState("idle");
        }
        return;
      }

      if (chunks.length === 0) {
        if (activeToken === voiceRequestTokenRef.current) {
          setVoiceInputState("idle");
          setToast("没有录到声音，再试一次吧");
        }
        return;
      }

      void (async () => {
        try {
          const blob = new Blob(chunks, { type: mimeType });
          const result = await workspaceClient.transcribeAudio({
            providerId: activeModel?.providerId,
            fileName: buildVoiceRecordingFileName(mimeType),
            mimeType,
            audioBase64: arrayBufferToBase64(await blob.arrayBuffer()),
            language: "zh",
          });

          if (activeToken !== voiceRequestTokenRef.current) {
            return;
          }

          setDraftMessage((current) => mergeTranscriptIntoDraft(current, result.text));
          setToast("语音已转成文字");
        } catch (error) {
          if (activeToken !== voiceRequestTokenRef.current) {
            return;
          }

          setToast(error instanceof Error ? error.message : "语音转写失败，请重试");
        } finally {
          if (activeToken === voiceRequestTokenRef.current) {
            setVoiceInputState("idle");
          }
        }
      })();
    };

    recorder.start();
    setVoiceInputState("recording");
    setToast("正在录音，点击麦克风结束");
  }

  async function toggleVoiceInput() {
    if (!voiceInputSupported) {
      setToast("当前环境暂不支持语音输入");
      return;
    }

    if (voiceInputState === "transcribing") {
      return;
    }

    if (voiceInputState === "recording") {
      stopVoiceInput();
      return;
    }

    try {
      await startVoiceInput();
    } catch (error) {
      cancelVoiceInput();
      setToast(formatVoiceRecordingError(error));
    }
  }

  async function cancelActiveChatTurn() {
    const conversationId = activeConversationId;
    if (!conversationId) {
      return;
    }

    const runtimeState = conversationRuntimeStates[conversationId];
    if (!runtimeState || !isConversationTurnActive(runtimeState.status)) {
      return;
    }

    if (runtimeState.status === "cancelling") {
      return;
    }

    setConversationRuntimeStates((current) => {
      const previous = current[conversationId];
      if (!previous || !isConversationTurnActive(previous.status)) {
        return current;
      }

      return {
        ...current,
        [conversationId]: {
          ...previous,
          status: "cancelling",
          error: undefined,
          stopReason: undefined,
        },
      };
    });

    try {
      await workspaceClient.cancelChatTurn(conversationId);
    } catch (error) {
      setConversationRuntimeStates((current) => {
        const previous = current[conversationId];
        if (!previous || previous.status !== "cancelling") {
          return current;
        }

        return {
          ...current,
          [conversationId]: {
            ...previous,
            status: "running",
          },
        };
      });
      setToast(error instanceof Error ? error.message : "停止生成失败");
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
  const hasSkillResults = filteredInstalledSkills.length > 0;
  const activeConversationRuntimeState =
    (activeConversationId ? conversationRuntimeStates[activeConversationId] : null) ?? null;
  const activeKnowledgeBaseIds = useMemo(
    () =>
      filterKnowledgeBaseSelection(
        resolveConversationKnowledgeBaseSelection(
          activeConversationId,
          activeConversation,
          draftKnowledgeBaseIds,
          conversationKnowledgeBaseIds,
        ),
        knowledgeBases,
      ),
    [
      activeConversation,
      activeConversationId,
      conversationKnowledgeBaseIds,
      draftKnowledgeBaseIds,
      knowledgeBases,
    ],
  );
  const activeConversationCancelling =
    activeConversationRuntimeState?.status === "cancelling";
  const activeConversationCanCancel =
    Boolean(
      activeConversationId &&
        activeConversationRuntimeState &&
        isConversationTurnActive(activeConversationRuntimeState.status),
    );
  const activeConversationBusy =
    startingChatTurn || isConversationTurnActive(activeConversationRuntimeState?.status);

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
            providerRefreshError={providerRefreshErrors[selectedModelProviderId] ?? null}
            providerRefreshingId={providerRefreshingId}
            selectedModelProviderId={selectedModelProviderId}
            selectableModels={selectableModels}
            onAddModelProvider={addModelProvider}
            onModelChange={(value) => updateConfigField("activeModelId", value)}
            onReorderModelProviders={reorderModelProviders}
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
          canCancel={activeConversationCanCancel}
          cancelInFlight={activeConversationCancelling}
          composerModelId={composerModelId}
          draftMessage={draftMessage}
          knowledgeBases={knowledgeBases}
          knowledgeEnabled={activeKnowledgeBaseIds.length > 0}
          knowledgeRefreshing={knowledgeRefreshing}
          onDraftMessageChange={setDraftMessage}
          onClearKnowledgeBases={clearKnowledgeBaseSelection}
          onManageKnowledgeBases={() => setView("knowledge")}
          onModelChange={(value) => updateConfigField("activeModelId", value)}
          onOpenAttachment={openPreview}
          onOpenPreviewLink={openPreviewLink}
          onPickFiles={() => void pickFiles()}
          onRemoveAttachment={removeAttachment}
          onCancelMessage={() => void cancelActiveChatTurn()}
          onSendMessage={sendChatMessage}
          onToggleKnowledgeBase={toggleKnowledgeBaseSelection}
          runtimeState={activeConversationRuntimeState}
          onVoiceInput={toggleVoiceInput}
          voiceInputState={voiceInputState}
          voiceInputSupported={voiceInputSupported}
          selectableModels={selectableModels}
          selectedKnowledgeBaseIds={activeKnowledgeBaseIds}
          scrollToBottomRequest={messageScrollRequest}
        />
      );
    }

    if (view === "skills") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
          <SkillsView
            filteredInstalledSkills={filteredInstalledSkills}
            hasResults={hasSkillResults}
            skillQuery={skillQuery}
            skillsImporting={skillImporting}
            skillsRefreshing={skillsRefreshing}
            onImportLocalSkill={importLocalSkill}
            onPrepareSkillDraft={prepareSkillDraft}
            onRefresh={refreshSkillsView}
            onSkillQueryChange={setSkillQuery}
            onUninstallSkill={uninstallSkill}
            onUpdateInstalledSkill={updateInstalledSkill}
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

    if (view === "reports") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
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
        </Suspense>
      );
    }

    if (view === "emergency") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
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
              isGenerating: isConversationTurnActive(conversationRuntimeStates[conversation.id]?.status),
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

