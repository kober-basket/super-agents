import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Suspense, lazy } from "react";
import type { CSSProperties } from "react";
import clsx from "clsx";
import { FolderOpen, FolderPlus, PanelRightClose, PanelRightOpen } from "lucide-react";
import {
  createRuntimeModelId,
  ensureActiveModelId,
  getActiveModelOption,
  isEmbeddingModel,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "./lib/model-config";
import { getNextModelProvider, isSystemModelProviderId } from "./lib/provider-presets";
import type {
  AppConfig,
  AppSection,
  ChatConversation,
  ChatConversationExportFormat,
  ChatMessage,
  ChatConversationRuntimeState,
  ChatConversationSummary,
  DesktopApprovalRequest,
  DesktopApprovalResponse,
  DesktopWindowState,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeBaseSummary,
  MemoryCreateInput,
  MemoryEntry,
  MemoryUpdateInput,
  McpServerConfig,
  ModelProviderConfig,
  RemoteControlStatus,
  SkillConfig,
  WorkspaceTool,
} from "./types";
import { workspaceClient } from "./services/workspace-client";
import { PrimarySidebar } from "./features/navigation/PrimarySidebar";
import {
  isConversationTurnActive,
  resolveSidebarConversationRunStatus,
  shouldApplyStartedConversationAsActive,
} from "./features/navigation/conversation-status";
import { AppTitleBar } from "./features/navigation/AppTitleBar";
import { SettingsSidebar } from "./features/settings/SettingsSidebar";
import type { SettingsSection } from "./features/settings/types";
import { useWorkspaceController } from "./features/workspace/useWorkspaceController";
import { workspaceLabel } from "./features/workspace/labels";
import { fileKind } from "./features/shared/utils";
import { ChatWorkspace } from "./features/chat/ChatWorkspace";
import { BrowserWorkspacePane } from "./features/chat/BrowserWorkspacePane";
import { PreviewPane } from "./features/chat/PreviewPane";
import { TerminalPane } from "./features/chat/TerminalPane";
import { WorkspaceFileExplorer } from "./features/chat/WorkspaceFileExplorer";
import { HoverTooltipLayer } from "./features/shared/HoverTooltipLayer";
import {
  upsertConversationSummaryList,
  type UpsertConversationSummaryOptions,
} from "./features/chat/conversation-list";
import {
  arrayBufferToBase64,
  buildVoiceRecordingFileName,
  getPreferredAudioRecordingMimeType,
  mergeTranscriptIntoDraft,
  type VoiceInputState,
} from "./lib/voice-input";
import {
  appendTimelineTextItem,
  syncTimelineActivityItems,
  upsertTimelineToolItem,
} from "./lib/runtime-timeline";
import {
  createEmptyConversationRuntimeState,
  mergeStartedConversationRuntimeState,
  resetConversationRuntimeStateForTurn,
} from "./lib/chat-runtime-state";
import { stripComposerSkillMentions } from "./lib/composer-skills";
import { BROWSER_HOME_URL, buildBrowserPreview } from "./lib/browser-target";
import {
  BROWSER_WORKSPACE_STATE_STORAGE_KEY,
  parseBrowserWorkspaceTab,
  serializeBrowserWorkspaceTab,
} from "./lib/browser-workspace-state";
import {
  closeRightPaneTab,
  createBrowserRightPaneTab,
  createFileSystemRightPaneTab,
  createPreviewRightPaneTab,
  createTerminalRightPaneTab,
  hasBrowserRightPaneTab,
  replaceRightPaneTabByTarget,
  rightPaneTabTargetKey,
  RIGHT_BROWSER_TAB_ID,
  RIGHT_FILES_TAB_ID,
  upsertRightPaneTab,
  type RightPaneTab,
} from "./lib/right-pane-tabs";
import { resolveRightPanePresentation } from "./lib/workspace-layout";
import { resolveToastFeedback } from "./lib/toast-feedback";

const loadRightWorkspacePane = async () => {
  const module = await import("./features/chat/RightWorkspacePane");
  return { default: module.RightWorkspacePane };
};
const loadSkillsView = async () => {
  const module = await import("./features/skills/SkillsView");
  return { default: module.SkillsView };
};
const loadToolsView = async () => {
  const module = await import("./features/tools/ToolsView");
  return { default: module.ToolsView };
};
const loadMemoryView = async () => {
  const module = await import("./features/memory/MemoryView");
  return { default: module.MemoryView };
};
const loadKnowledgeView = async () => {
  const module = await import("./features/knowledge/KnowledgeView");
  return { default: module.KnowledgeView };
};
const loadAssistantSettings = async () => {
  const module = await import("./features/settings/AssistantSettings");
  return { default: module.AssistantSettings };
};
const loadAppearanceSettings = async () => {
  const module = await import("./features/settings/AppearanceSettings");
  return { default: module.AppearanceSettings };
};
const loadRemoteControlSettings = async () => {
  const module = await import("./features/settings/RemoteControlSettings");
  return { default: module.RemoteControlSettings };
};
const loadMailSettings = async () => {
  const module = await import("./features/settings/MailSettings");
  return { default: module.MailSettings };
};

const RightWorkspacePane = lazy(loadRightWorkspacePane);
const SkillsView = lazy(loadSkillsView);
const ToolsView = lazy(loadToolsView);
const MemoryView = lazy(loadMemoryView);
const KnowledgeView = lazy(loadKnowledgeView);
const AssistantSettings = lazy(loadAssistantSettings);
const AppearanceSettings = lazy(loadAppearanceSettings);
const RemoteControlSettings = lazy(loadRemoteControlSettings);
const MailSettings = lazy(loadMailSettings);

function preloadLazyViews() {
  void loadRightWorkspacePane();
  void loadSkillsView();
  void loadToolsView();
  void loadMemoryView();
  void loadKnowledgeView();
  void loadAssistantSettings();
  void loadAppearanceSettings();
  void loadRemoteControlSettings();
  void loadMailSettings();
}

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

function isConversationNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("Conversation not found");
}

function isConversationAlreadyRunningError(error: unknown) {
  return error instanceof Error && /conversation is already running/i.test(error.message);
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
const PREVIEW_PANE_DEFAULT_WIDTH = 760;
const RIGHT_PANE_TRANSITION_MS = 500;
const SIDEBAR_MIN_WIDTH = 172;
const SIDEBAR_MAX_WIDTH = 360;
const SETTINGS_SIDEBAR_MIN_WIDTH = 260;
const SETTINGS_SIDEBAR_MAX_WIDTH = 460;
const PREVIEW_PANE_MIN_WIDTH = 420;
const PREVIEW_PANE_MAX_WIDTH = 980;

type ResizeTarget = "sidebar" | "settings-sidebar" | "preview";
type RemoteControlChannelKey = keyof AppConfig["remoteControl"];
type AppShellStyle = CSSProperties & {
  "--right-pane-inline-width"?: string;
};
type IdleCallbackWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredWidth(key: string, fallback: number, legacyValues: number[] = [], legacyTolerance = 0) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(key);
  const parsedValue = rawValue ? Number.parseFloat(rawValue) : Number.NaN;
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  const isLegacyValue = legacyValues.some((legacyValue) =>
    Math.abs(parsedValue - legacyValue) <= legacyTolerance,
  );

  return isLegacyValue ? fallback : parsedValue;
}

function readStoredBrowserWorkspaceTab() {
  if (typeof window === "undefined") {
    return null;
  }

  return parseBrowserWorkspaceTab(window.localStorage.getItem(BROWSER_WORKSPACE_STATE_STORAGE_KEY));
}

function writeStoredBrowserWorkspaceTab(tab: Extract<RightPaneTab, { kind: "browser" }>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(BROWSER_WORKSPACE_STATE_STORAGE_KEY, serializeBrowserWorkspaceTab(tab));
  } catch {
    // Browser state is a convenience cache; losing it should not block the chat workspace.
  }
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
  return createEmptyConversationRuntimeState(status);
}

function preserveActiveTurnStatus(status?: ChatConversationRuntimeState["status"]) {
  return status === "cancelling" ? "cancelling" : "running";
}

function createRuntimeTimelineId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const activeConversationIdRef = useRef<string | null>(null);
  const streamingPreviewByMessageRef = useRef<Record<string, string>>({});
  const [startingChatTurn, setStartingChatTurn] = useState(false);
  const chatTurnStartInFlightRef = useRef(false);
  const [exportingConversationFormat, setExportingConversationFormat] =
    useState<ChatConversationExportFormat | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftKnowledgeBaseIds, setDraftKnowledgeBaseIds] = useState<string[]>([]);
  const [draftConversationWorkspaceRoot, setDraftConversationWorkspaceRoot] = useState("");
  const [messageScrollRequest, setMessageScrollRequest] = useState(0);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("assistant");
  const [rightTabs, setRightTabs] = useState<RightPaneTab[]>(() => [createFileSystemRightPaneTab()]);
  const [rightPaneOpen, setRightPaneOpen] = useState(false);
  const [rightPaneMounted, setRightPaneMounted] = useState(false);
  const [activeRightTabId, setActiveRightTabId] = useState<string | null>(RIGHT_FILES_TAB_ID);
  const [toast, setToast] = useState<string | null>(null);
  const [approvalRequests, setApprovalRequests] = useState<DesktopApprovalRequest[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillsRefreshing, setSkillsRefreshing] = useState(false);
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [toolsRefreshing, setToolsRefreshing] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryRefreshing, setMemoryRefreshing] = useState(false);
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
    readStoredWidth(PREVIEW_PANE_WIDTH_STORAGE_KEY, PREVIEW_PANE_DEFAULT_WIDTH, [380, 640], 8),
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
  const memoryLoadedRef = useRef(false);
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
        location: skill.sourcePath || "内置技能",
      })),
    [config.skills],
  );
  const filteredInstalledSkills = useMemo(
    () =>
      configuredSkills.filter((skill) =>
        matchQuery(skillQuery, [
          skill.name,
          skill.description,
          skill.displayName,
          skill.shortDescription,
          skill.suiteName,
          skill.suiteDisplayName,
          skill.suiteDescription,
          ...(skill.suiteItems ?? []).flatMap((item) => [
            item.name,
            item.displayName,
            item.description,
            item.shortDescription,
            item.typeLabel,
          ]),
          skill.location,
        ]),
      ),
    [configuredSkills, skillQuery],
  );
  const toastFeedback = useMemo(() => resolveToastFeedback(toast), [toast]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const idleWindow = window as IdleCallbackWindow;
    if (idleWindow.requestIdleCallback) {
      const idleHandle = idleWindow.requestIdleCallback(preloadLazyViews, { timeout: 1600 });
      return () => idleWindow.cancelIdleCallback?.(idleHandle);
    }

    const timer = window.setTimeout(preloadLazyViews, 360);
    return () => window.clearTimeout(timer);
  }, []);

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
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    const browserTab = rightTabs.find(
      (tab): tab is Extract<RightPaneTab, { kind: "browser" }> => tab.kind === "browser",
    );
    if (browserTab) {
      writeStoredBrowserWorkspaceTab(browserTab);
    }
  }, [rightTabs]);

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
    if (view !== "memory" || memoryRefreshing || memoryLoadedRef.current) {
      return;
    }

    void refreshMemoryView({ silent: true });
  }, [memoryRefreshing, view]);

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
    const currentProvider = config.modelProviders.find((item) => item.id === currentProviderId);
    if (currentProvider?.models.some((model) => model.enabled !== false && isEmbeddingModel(model))) {
      return;
    }

    const activeEmbeddingProvider =
      activeModel?.providerId && config.modelProviders.find((item) => item.id === activeModel.providerId);
    const fallbackProviderId =
      activeEmbeddingProvider?.models.some((model) => model.enabled !== false && isEmbeddingModel(model))
        ? activeEmbeddingProvider.id
        : config.modelProviders.find((item) =>
            item.models.some((model) => model.enabled !== false && isEmbeddingModel(model)),
          )?.id || "";
    if (!fallbackProviderId) return;

    updateKnowledgeBaseConfig({ embeddingProviderId: fallbackProviderId });
  }, [activeModel?.providerId, config.knowledgeBase.embeddingProviderId, config.modelProviders]);

  useEffect(() => {
    const provider = config.modelProviders.find((item) => item.id === config.knowledgeBase.embeddingProviderId);
    if (!provider) return;

    const embeddingModels = provider.models.filter((model) => model.enabled !== false && isEmbeddingModel(model));
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
      workspaceRoot: conversation.workspaceRoot,
      selectedKnowledgeBaseIds: conversation.selectedKnowledgeBaseIds,
      agentCore: conversation.agentCore,
      agentSessionId: conversation.agentSessionId,
      completedTurnId: conversation.completedTurnId,
    };
  }

  function upsertConversationSummary(
    summary: ChatConversationSummary,
    options?: UpsertConversationSummaryOptions,
  ) {
    setConversations((current) =>
      upsertConversationSummaryList(current, summary, options),
    );
  }

  function syncConversationState(
    conversation: ChatConversation,
    options?: UpsertConversationSummaryOptions,
  ) {
    activeConversationIdRef.current = conversation.id;
    setActiveConversation(conversation);
    setActiveConversationId(conversation.id);
    upsertConversationSummary(toConversationSummary(conversation), options);
  }

  function clearConversationCompletion(conversationId: string) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, completedTurnId: undefined }
          : conversation,
      ),
    );
    setActiveConversation((current) =>
      current?.id === conversationId
        ? { ...current, completedTurnId: undefined }
        : current,
    );
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
      if (event.type === "conversation_updated") {
        setActiveConversation((current) =>
          current?.id === event.conversation.id ? event.conversation : current,
        );
        upsertConversationSummary(toConversationSummary(event.conversation));
        return;
      }

      if (event.type === "message_updated") {
        const now = Date.now();
        delete streamingPreviewByMessageRef.current[`${event.conversationId}:${event.messageId}`];
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
                  }
                : conversation,
            ),
        );

        return;
      }

      if (event.type === "message_delta") {
        const now = Date.now();
        const previewKey = `${event.conversationId}:${event.messageId}`;
        const streamingPreview = `${streamingPreviewByMessageRef.current[previewKey] ?? ""}${event.textDelta}`;
        streamingPreviewByMessageRef.current[previewKey] = streamingPreview;

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
            preview: nextMessages[nextMessages.length - 1]?.content ?? current.preview,
          };
        });

        setConversations((current) =>
          current
            .map((conversation) =>
              conversation.id === event.conversationId
                ? {
                    ...conversation,
                    preview: streamingPreview,
                    updatedAt: now,
                  }
                : conversation,
            ),
        );

        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: preserveActiveTurnStatus(previous.status),
              error: undefined,
              stopReason: undefined,
              events: [
                ...previous.events,
                {
                  id: createRuntimeTimelineId("message"),
                  timestamp: now,
                  type: "message_delta",
                  text: event.textDelta,
                },
              ],
            },
          };
        });

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
              timelineItems: appendTimelineTextItem(
                previous.timelineItems,
                "thought",
                event.textDelta,
                createRuntimeTimelineId("thought"),
              ),
            },
          };
        });
        return;
      }

      if (event.type === "status_delta") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: preserveActiveTurnStatus(previous.status),
              error: undefined,
              stopReason: undefined,
              timelineItems: appendTimelineTextItem(
                previous.timelineItems,
                "status",
                event.textDelta,
                createRuntimeTimelineId("status"),
              ),
            },
          };
        });
        return;
      }

      if (event.type === "activity_summary") {
        setConversationRuntimeStates((current) => {
          const previous = current[event.conversationId] ?? createConversationRuntimeState("running");
          return {
            ...current,
            [event.conversationId]: {
              ...previous,
              status: preserveActiveTurnStatus(previous.status),
              error: undefined,
              stopReason: undefined,
              activityItems: event.items,
              timelineItems: syncTimelineActivityItems(
                previous.timelineItems,
                event.items,
                (activity) => createRuntimeTimelineId(`activity-${activity.id}`),
              ),
            },
          };
        });
        return;
      }

      if (event.type === "tool_call_started") {
        const now = Date.now();
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
              events: [
                ...previous.events.filter(
                  (entry) =>
                    entry.type !== "tool_call_started" ||
                    entry.toolCallId !== event.toolCall.toolCallId,
                ),
                {
                  id: createRuntimeTimelineId(`tool-${event.toolCall.toolCallId}`),
                  timestamp: now,
                  type: "tool_call_started",
                  toolCallId: event.toolCall.toolCallId,
                  toolName: event.toolCall.title,
                },
              ],
              timelineItems: upsertTimelineToolItem(
                previous.timelineItems,
                event.toolCall.toolCallId,
                createRuntimeTimelineId(`tool-${event.toolCall.toolCallId}`),
              ),
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
        const normalizedStopReason = normalizeTurnStopReason(
          event.stopReason,
          conversationRuntimeStates[event.conversationId]?.status,
        );
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
        if (normalizedStopReason !== "cancelled") {
          if (activeConversationIdRef.current === event.conversationId) {
            clearConversationCompletion(event.conversationId);
            void workspaceClient
              .markConversationViewed(event.conversationId)
              .catch(() => undefined);
            return;
          }

          const completedConversation = event.conversation;
          if (completedConversation) {
            upsertConversationSummary(toConversationSummary(completedConversation));
            setActiveConversation((current) =>
              current?.id === completedConversation.id ? completedConversation : current,
            );
          } else {
            setConversations((current) =>
              current.map((conversation) =>
                conversation.id === event.conversationId
                  ? { ...conversation, completedTurnId: event.turnId }
                  : conversation,
              ),
            );
            void workspaceClient
              .getConversation(event.conversationId)
              .then((conversation) => {
                upsertConversationSummary(toConversationSummary(conversation));
                setActiveConversation((current) =>
                  current?.id === conversation.id ? conversation : current,
                );
              })
              .catch(() => undefined);
          }
        }
        return;
      }

      setConversationRuntimeStates((current) => {
        const previous = current[event.conversationId] ?? createConversationRuntimeState();
        if (previous.status === "cancelling" && looksLikeTurnCancellation(event.error)) {
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
    });
  }, []);

  useEffect(() => {
    return workspaceClient.onApprovalRequest((request) => {
      setApprovalRequests((current) => [
        ...current.filter((item) => item.approvalId !== request.approvalId),
        request,
      ]);
      if (request.kind === "mail_auth" || request.kind === "question") {
        setView("chat");
      }
    });
  }, []);

  async function resolveApproval(response: DesktopApprovalResponse) {
    setApprovalRequests((current) => current.filter((item) => item.approvalId !== response.approvalId));
    try {
      const accepted = await workspaceClient.respondToApproval(response);
      if (!accepted) {
        setToast("授权请求已过期");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "提交授权结果失败");
    }
  }

  function updateInstalledSkill(skillId: string, patch: Partial<SkillConfig>) {
    const skills = config.skills.map((item) =>
      item.id === skillId || item.suiteId === skillId ? { ...item, ...patch } : item,
    );
    void commitConfig({ ...cloneConfig(config), skills });
  }

  function openRightTab(previewPayload: FilePreviewPayload, options: { forceNew?: boolean; id?: string } = {}) {
    const nextTab: RightPaneTab = createPreviewRightPaneTab(options.id ?? `right-tab-${uid()}`, previewPayload);

    setRightPaneOpen(true);
    setRightTabs((currentTabs) => {
      if (options.forceNew) {
        setActiveRightTabId(nextTab.id);
        return [...currentTabs, nextTab];
      }

      const result = upsertRightPaneTab(currentTabs, nextTab);
      setActiveRightTabId(result.activeTabId);
      return result.tabs;
    });
  }

  function updateRightTabByTarget(targetKey: string | null, previewPayload: FilePreviewPayload) {
    setRightTabs((currentTabs) => replaceRightPaneTabByTarget(currentTabs, targetKey, previewPayload));
  }

  function closeRightTab(tabId: string) {
    setRightTabs((currentTabs) => {
      const result = closeRightPaneTab(currentTabs, activeRightTabId, tabId);
      setActiveRightTabId(result.activeTabId);
      return result.tabs;
    });
  }

  function createBrowserPage(target = BROWSER_HOME_URL) {
    return {
      id: `browser-page-${uid()}`,
      preview: buildBrowserPreview(target, target === BROWSER_HOME_URL ? "新标签页" : target),
    };
  }

  function createBrowserRightTabFromStoredState(target = BROWSER_HOME_URL) {
    const restoredTab = readStoredBrowserWorkspaceTab();
    if (!restoredTab) {
      return createBrowserRightPaneTab(RIGHT_BROWSER_TAB_ID, target);
    }

    if (target === BROWSER_HOME_URL) {
      return restoredTab;
    }

    const nextPage = createBrowserPage(target);
    return {
      ...restoredTab,
      browserTabs: [...restoredTab.browserTabs, nextPage],
      activeBrowserTabId: nextPage.id,
    };
  }

  function openBrowserTab(target = BROWSER_HOME_URL) {
    setRightPaneOpen(true);
    setRightTabs((currentTabs) => {
      const browserTab = currentTabs.find((tab) => tab.kind === "browser");
      if (!browserTab) {
        const nextTab = createBrowserRightTabFromStoredState(target);
        setActiveRightTabId(nextTab.id);
        return [...currentTabs, nextTab];
      }

      const nextPage = createBrowserPage(target);
      setActiveRightTabId(browserTab.id);
      return currentTabs.map((tab) =>
        tab.id === browserTab.id && tab.kind === "browser"
          ? {
              ...tab,
              browserTabs: target === BROWSER_HOME_URL ? tab.browserTabs : [...tab.browserTabs, nextPage],
              activeBrowserTabId: target === BROWSER_HOME_URL ? tab.activeBrowserTabId : nextPage.id,
            }
          : tab,
      );
    });
  }

  function createBrowserTab() {
    openBrowserTab();
  }

  function createTerminalTab() {
    const nextTab = createTerminalRightPaneTab(`right-terminal-${uid()}`);
    setRightPaneOpen(true);
    setActiveRightTabId(nextTab.id);
    setRightTabs((currentTabs) => [...currentTabs, nextTab]);
  }

  function updateBrowserTabState(
    tabId: string,
    browserTabs: Extract<RightPaneTab, { kind: "browser" }>["browserTabs"],
    activeBrowserTabId: string,
  ) {
    setRightTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId && tab.kind === "browser"
          ? { ...tab, browserTabs, activeBrowserTabId }
          : tab,
      ),
    );
  }

  async function openPreview(file: FileDropEntry) {
    const loadingPreview: FilePreviewPayload = {
      title: file.name,
      path: file.path,
      kind: fileKind(file),
      mimeType: file.mimeType,
      content: file.content ?? file.dataUrl ?? "",
      loading: !file.content && !file.dataUrl,
    };
    const targetKey = rightPaneTabTargetKey(loadingPreview);
    openRightTab(loadingPreview);

    if (!file.content && !file.dataUrl) {
      try {
        const payload = await workspaceClient.readPreview({
          path: file.path,
          url: file.url,
          title: file.name,
          kind: fileKind(file),
        });
        updateRightTabByTarget(targetKey, payload);
      } catch {
        setToast("打开预览失败");
      }
    }
  }

  async function openPreviewLink(url: string) {
    openBrowserTab(url);
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

  function commitModelProviders(modelProviders: ModelProviderConfig[], message?: string) {
    void commitConfig(buildConfigWithModelProviders(modelProviders), message);
  }

  function scheduleModelProvidersPersist(modelProviders: ModelProviderConfig[]) {
    scheduleConfigPersist(buildConfigWithModelProviders(modelProviders));
  }

  function updateModelProvider(providerId: string, patch: Partial<ModelProviderConfig>) {
    const modelProviders = config.modelProviders.map((item) => {
      if (item.id !== providerId) {
        return item;
      }

      if ((item.system || isSystemModelProviderId(item.id)) && "name" in patch) {
        const { name: _ignoredName, ...safePatch } = patch;
        setToast("内置提供商不可更名");
        return { ...item, ...safePatch };
      }

      return { ...item, ...patch };
    });
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
    commitModelProviders(modelProviders);
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
    commitModelProviders(modelProviders);
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
    commitModelProviders(modelProviders);
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
      commitModelProviders(modelProviders);
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
    const mcpServers = config.mcpServers.filter((item) => item.id !== serverId);
    void commitConfig({ ...cloneConfig(config), mcpServers });
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
    void commitConfig({ ...cloneConfig(config), mcpServers });
  }

  async function refreshSkillsView() {
    setSkillsRefreshing(true);
    await refreshWorkspaceSnapshot(undefined, { silent: true });
    setSkillsRefreshing(false);
  }

  async function refreshMcpView() {
    setMcpRefreshing(true);
    await refreshWorkspaceSnapshot(undefined, { silent: true });
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

  async function refreshMemoryView(options?: { silent?: boolean }) {
    memoryLoadedRef.current = true;
    setMemoryRefreshing(true);
    try {
      const payload = await workspaceClient.listMemories();
      setMemoryEntries(payload.entries);
    } catch (error) {
      if (!options?.silent) {
        setToast(error instanceof Error ? error.message : "刷新记忆失败");
      }
    } finally {
      setMemoryRefreshing(false);
    }
  }

  async function createMemory(input: MemoryCreateInput) {
    memoryLoadedRef.current = true;
    setMemoryRefreshing(true);
    try {
      const payload = await workspaceClient.createMemory(input);
      setMemoryEntries(payload.entries);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "创建记忆失败");
    } finally {
      setMemoryRefreshing(false);
    }
  }

  async function updateMemory(input: MemoryUpdateInput) {
    memoryLoadedRef.current = true;
    setMemoryRefreshing(true);
    try {
      const payload = await workspaceClient.updateMemory(input);
      setMemoryEntries(payload.entries);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "更新记忆失败");
    } finally {
      setMemoryRefreshing(false);
    }
  }

  async function deleteMemory(memoryId: string) {
    memoryLoadedRef.current = true;
    setMemoryRefreshing(true);
    try {
      const payload = await workspaceClient.deleteMemory(memoryId);
      setMemoryEntries(payload.entries);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除记忆失败");
    } finally {
      setMemoryRefreshing(false);
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

  async function updateKnowledgeBase(baseId: string, name: string, description: string) {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setToast("请先输入知识库名称");
      return false;
    }

    knowledgeLoadedRef.current = true;
    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.updateKnowledgeBase({
        id: baseId,
        name: trimmedName,
        description: trimmedDescription,
      });
      setKnowledgeBases(payload.knowledgeBases);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "编辑知识库失败");
      return false;
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
    activeConversationIdRef.current = null;
    setActiveConversation(null);
    setActiveConversationId(null);
    setDraftMessage("");
    setDraftKnowledgeBaseIds([]);
    setDraftConversationWorkspaceRoot("");
    setAttachments([]);
  }

  async function openConversation(conversationId: string) {
    setView("chat");
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
    setDraftMessage("");
    setDraftConversationWorkspaceRoot("");
    setAttachments([]);
    setActiveConversation(null);

    try {
      const conversation = await workspaceClient.markConversationViewed(conversationId);
      syncConversationState(conversation);
    } catch (error) {
      if (isConversationNotFoundError(error)) {
        setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
        try {
          const payload = await workspaceClient.listConversations();
          setConversations(payload.conversations);
        } catch {
          // Keep the local stale-item removal if refreshing the list also fails.
        }
        setToast("会话已不存在，已刷新列表");
      } else {
        setToast(error instanceof Error ? error.message : "加载会话失败");
      }
      activeConversationIdRef.current = null;
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
        activeConversationIdRef.current = null;
        setActiveConversation(null);
        setActiveConversationId(null);
        setDraftMessage("");
        setDraftKnowledgeBaseIds([]);
        setDraftConversationWorkspaceRoot("");
        setAttachments([]);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除会话失败");
    }
  }

  async function exportActiveConversation(format: ChatConversationExportFormat) {
    if (!activeConversationId) {
      setToast("请先打开一个会话");
      return;
    }

    setExportingConversationFormat(format);
    try {
      const result = await workspaceClient.exportConversation({
        conversationId: activeConversationId,
        format,
      });
      setToast(`已导出：${result.fileName}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "导出会话失败");
    } finally {
      setExportingConversationFormat(null);
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
    if (chatTurnStartInFlightRef.current || activeConversationBusy) {
      return;
    }
    chatTurnStartInFlightRef.current = true;

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
    const previousRuntimeState = conversationRuntimeStates[nextConversationId];
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
    const optimisticPreview = buildOptimisticConversationPreview(
      stripComposerSkillMentions(content),
      pendingAttachments,
    );
    const optimisticConversation: ChatConversation = activeConversation
      ? {
          ...activeConversation,
          messages: [...activeConversation.messages, optimisticUserMessage, optimisticAssistantMessage],
          updatedAt: now + 1,
          lastMessageAt: now,
          messageCount: activeConversation.messageCount + 2,
          preview: optimisticPreview || activeConversation.preview,
          selectedKnowledgeBaseIds,
        }
      : {
          id: nextConversationId,
          title: optimisticPreview || pendingAttachments[0]?.name || "新对话",
          createdAt: now,
          updatedAt: now + 1,
          lastMessageAt: now,
          preview: optimisticPreview,
          messageCount: 2,
          workspaceRoot: draftConversationWorkspaceRoot || config.workspaceRoot,
          selectedKnowledgeBaseIds,
          messages: [optimisticUserMessage, optimisticAssistantMessage],
        };

    syncConversationState(optimisticConversation);
    setConversationRuntimeStates((current) =>
      resetConversationRuntimeStateForTurn(current, nextConversationId),
    );
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
        workspaceRoot: activeConversationId ? undefined : draftConversationWorkspaceRoot.trim() || undefined,
      });

      const replaceConversationId = nextConversationId.startsWith("temp-") ? nextConversationId : null;
      if (shouldApplyStartedConversationAsActive(activeConversationIdRef.current, nextConversationId)) {
        syncConversationState(result.conversation, { replaceConversationId });
      } else {
        upsertConversationSummary(toConversationSummary(result.conversation), { replaceConversationId });
      }
      setDraftConversationWorkspaceRoot("");
      setConversationRuntimeStates((current) =>
        mergeStartedConversationRuntimeState(current, {
          conversationId: result.conversation.id,
          replaceConversationId,
        }),
      );
    } catch (error) {
      const alreadyRunning = isConversationAlreadyRunningError(error);
      if (previousConversation) {
        activeConversationIdRef.current = previousConversationId;
        setActiveConversation(previousConversation);
        setActiveConversationId(previousConversationId);
        upsertConversationSummary(toConversationSummary(previousConversation));
      } else {
        activeConversationIdRef.current = null;
        setActiveConversation(null);
        setActiveConversationId(null);
        setConversations(previousConversations);
      }
      setView("chat");
      setDraftMessage(content);
      setAttachments(pendingAttachments);
      if (alreadyRunning && previousConversationId) {
        setConversationRuntimeStates((current) => ({
          ...current,
          [previousConversationId]: {
            ...(current[previousConversationId] ?? createConversationRuntimeState()),
            status: "running",
            error: undefined,
            stopReason: undefined,
          },
        }));
      } else {
        setConversationRuntimeStates((current) => {
          const next = { ...current };
          if (previousRuntimeState) {
            next[nextConversationId] = previousRuntimeState;
          } else {
            delete next[nextConversationId];
          }
          return next;
        });
      }
      /*
      setToast(error instanceof Error ? error.message : "发送消息失败");
      legacy fallback
      setToast(error instanceof Error ? error.message : "发送消息失败");
      fallback continued
      setToast(error instanceof Error ? error.message : "发送消息失败");
      */
      setToast(
        alreadyRunning
          ? "当前对话仍在生成，请等待或停止后再发送"
          : error instanceof Error
            ? error.message
            : "发送消息失败",
      );
    } finally {
      chatTurnStartInFlightRef.current = false;
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

  const rightPanePresentation = resolveRightPanePresentation({
    view,
    rightPaneOpen,
    viewportWidth,
  });
  const showRightPane = rightPanePresentation !== "hidden";
  const canResizePanels = viewportWidth > 840;
  const showInlineRightPane = rightPanePresentation === "inline";
  const showOverlayRightPane = rightPanePresentation === "overlay";
  const shouldRenderRightPaneContent = showRightPane || rightPaneMounted;
  const activeSidebarWidth = view === "settings" ? settingsSidebarWidth : sidebarWidth;
  const workspaceTransitionKey = view === "settings" ? `settings:${settingsSection}` : view;
  const appShellStyle: AppShellStyle | undefined =
    canResizePanels
      ? {
          ...(view === "chat" ? { "--right-pane-inline-width": `${previewPaneWidth}px` } : {}),
          gridTemplateColumns:
            view === "chat"
              ? `${activeSidebarWidth}px minmax(0, 1fr) ${showInlineRightPane ? "var(--right-pane-inline-width)" : "0px"}`
              : `${activeSidebarWidth}px minmax(0, 1fr)`,
        }
      : undefined;
  const canCreateBrowserTab = !hasBrowserRightPaneTab(rightTabs);

  useEffect(() => {
    if (showRightPane) {
      setRightPaneMounted(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setRightPaneMounted(false);
    }, RIGHT_PANE_TRANSITION_MS);

    return () => window.clearTimeout(timer);
  }, [showRightPane]);

  function renderRightPaneToggleButton(extraClassName?: string) {
    return (
      <button
        aria-label={showRightPane ? "收起右侧栏" : "展开右侧栏"}
        className={clsx("right-pane-toggle", extraClassName, showRightPane && "is-open")}
        onClick={() => setRightPaneOpen((open) => !open)}
        type="button"
      >
        {showRightPane ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
      </button>
    );
  }
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

  function resolveActiveConversationWorkspaceRoot() {
    return activeConversation?.workspaceRoot || draftConversationWorkspaceRoot || config.workspaceRoot;
  }

  const activeConversationWorkspaceRoot = resolveActiveConversationWorkspaceRoot();

  async function openActiveWorkspaceFolder() {
    if (!activeConversationWorkspaceRoot.trim()) {
      setToast("当前对话没有工作目录");
      return;
    }

    try {
      await workspaceClient.openFolder(activeConversationWorkspaceRoot);
    } catch {
      setToast("打开当前工作目录失败");
    }
  }

  async function selectConversationWorkspaceFolder() {
    try {
      const directoryPath = await workspaceClient.selectWorkspaceFolder();
      if (!directoryPath) {
        return;
      }

      if (!activeConversationId) {
        setDraftConversationWorkspaceRoot(directoryPath);
        setToast(`新对话工作区已设置为 ${workspaceLabel(directoryPath)}`);
        return;
      }

      const conversation = await workspaceClient.updateConversationWorkspaceRoot({
        conversationId: activeConversationId,
        workspaceRoot: directoryPath,
      });
      syncConversationState(conversation);
      setToast(`会话工作区已切换为 ${workspaceLabel(directoryPath)}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "设置会话工作区失败");
    }
  }

  function renderWorkspaceFolderButton() {
    const workspaceRoot = resolveActiveConversationWorkspaceRoot();
    const workspaceName = workspaceLabel(workspaceRoot);

    return (
      <div className="conversation-workspace-control" title={workspaceRoot || "未选择工作区"}>
        <button
          aria-label="设置当前会话工作区"
          className="right-pane-toggle workspace-folder-button"
          onClick={() => void selectConversationWorkspaceFolder()}
          title="设置当前会话工作区"
          type="button"
        >
          <FolderPlus size={17} />
        </button>
        <span className="conversation-workspace-label">{workspaceName}</span>
        <button
          aria-label="打开当前工作目录"
          className="right-pane-toggle workspace-folder-button"
          disabled={!workspaceRoot.trim()}
          onClick={() => void openActiveWorkspaceFolder()}
          title="打开当前工作目录"
          type="button"
        >
          <FolderOpen size={17} />
        </button>
      </div>
    );
  }

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
            fallbackModelId={config.imageRecognition.fallbackModelId}
            modelProviders={config.modelProviders}
            providerRefreshError={providerRefreshErrors[selectedModelProviderId] ?? null}
            providerRefreshingId={providerRefreshingId}
            selectedModelProviderId={selectedModelProviderId}
            selectableModels={selectableModels}
            onAddModelProvider={addModelProvider}
            onFallbackModelChange={(value) =>
              updateConfigField("imageRecognition", {
                ...config.imageRecognition,
                fallbackModelId: value,
              })
            }
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

    if (settingsSection === "mail") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
          <MailSettings />
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
          permissionMode={config.security.permissionMode}
          onDraftMessageChange={setDraftMessage}
          onClearKnowledgeBases={clearKnowledgeBaseSelection}
          onManageKnowledgeBases={() => setView("knowledge")}
          onAddAttachments={(files) => void appendAttachments(files)}
          onModelChange={(value) => updateConfigField("activeModelId", value)}
          onPermissionModeChange={(value) =>
            updateConfigField("security", {
              ...config.security,
              permissionMode: value,
              fullFileSystemAccess: value === "full-access",
            })
          }
          onOpenAttachment={openPreview}
          onOpenPreviewLink={openPreviewLink}
          onPickFiles={() => void pickFiles()}
          onRemoveAttachment={removeAttachment}
          onCancelMessage={() => void cancelActiveChatTurn()}
          onSendMessage={sendChatMessage}
          onToggleKnowledgeBase={toggleKnowledgeBaseSelection}
          runtimeState={activeConversationRuntimeState}
          workspaceFolderControl={renderWorkspaceFolderButton()}
          onVoiceInput={toggleVoiceInput}
          voiceInputState={voiceInputState}
          voiceInputSupported={voiceInputSupported}
          selectableModels={selectableModels}
          selectedKnowledgeBaseIds={activeKnowledgeBaseIds}
          skills={config.skills}
          scrollToBottomRequest={messageScrollRequest}
          approvalRequests={approvalRequests}
          onResolveApproval={resolveApproval}
          onToast={(message) => setToast(message)}
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
            onRefreshMcp={refreshMcpView}
            onRemoveMcpServer={removeMcpServer}
            onToggleAdvanced={() => setMcpAdvancedOpen((value) => !value)}
            onUpdateMcp={updateMcp}
          />
        </Suspense>
      );
    }

    if (view === "memory") {
      return (
        <Suspense fallback={<LazyViewFallback />}>
          <MemoryView
            entries={memoryEntries}
            refreshing={memoryRefreshing}
            workspaceRoot={config.workspaceRoot}
            onCreateMemory={createMemory}
            onDeleteMemory={deleteMemory}
            onRefresh={refreshMemoryView}
            onToast={(message) => setToast(message)}
            onUpdateMemory={updateMemory}
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
            onChangeEmbeddingSelection={(embeddingProviderId, embeddingModel) =>
              updateKnowledgeBaseConfig({ embeddingProviderId, embeddingModel })
            }
            onToast={(message) => setToast(message)}
            onCreateKnowledgeBase={createKnowledgeBase}
            onUpdateKnowledgeBase={updateKnowledgeBase}
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
        className={clsx(
          "app-shell",
          showRightPane && "with-preview",
          showOverlayRightPane && "right-pane-overlay",
          view === "settings" && "settings-mode",
        )}
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
            conversations={conversations.map((conversation) => {
              const runtimeState = conversationRuntimeStates[conversation.id];
              const hasPendingApproval = Boolean(
                conversation.agentSessionId &&
                  approvalRequests.some((request) => request.sessionId === conversation.agentSessionId),
              );
              const hasCompletion = conversation.id !== activeConversationId && Boolean(conversation.completedTurnId);

              return {
                ...conversation,
                runStatus: resolveSidebarConversationRunStatus(
                  runtimeState,
                  hasPendingApproval,
                  hasCompletion,
                ),
              };
            })}
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
          <div className="workspace-view-transition" key={workspaceTransitionKey}>
            {renderMainView()}
          </div>
        </main>

        {showInlineRightPane ? (
          <button
            aria-label="调整右侧栏宽度"
            className={clsx("pane-resizer", "pane-resizer-right", resizeTarget === "preview" && "active")}
            onDoubleClick={() => resetWidth("preview")}
            onPointerDown={beginResize("preview", previewPaneWidth)}
            style={{ right: `${previewPaneWidth - 6}px` }}
            type="button"
          >
            <span className="pane-resizer-rail" />
          </button>
        ) : null}

        {showOverlayRightPane ? (
          <button
            aria-label="关闭右侧栏"
            className="right-pane-backdrop"
            onClick={() => setRightPaneOpen(false)}
            type="button"
          />
        ) : null}

        {view === "chat" ? (
          <div
            aria-hidden={!showRightPane}
            className={clsx(
              "right-workspace-slot",
              showRightPane && "is-open",
              showOverlayRightPane && "is-overlay",
            )}
          >
            {shouldRenderRightPaneContent ? (
              <Suspense fallback={<LazyViewFallback />}>
                <RightWorkspacePane
                  activeTabId={activeRightTabId}
                  canCreateBrowserTab={canCreateBrowserTab}
                  tabs={rightTabs}
                  onCloseTab={closeRightTab}
                  onCreateBrowserTab={createBrowserTab}
                  onCreateTerminalTab={createTerminalTab}
                  onSelectTab={setActiveRightTabId}
                  renderTabContent={(tab) => {
                    if (tab.kind === "files") {
                      return (
                        <WorkspaceFileExplorer
                          workspaceRoot={activeConversationWorkspaceRoot}
                          onListDirectory={workspaceClient.listWorkspaceDirectory}
                          onReadPreview={workspaceClient.readPreview}
                          onOpenExternal={openPreviewExternally}
                          onOpenLink={openPreviewLink}
                        />
                      );
                    }

                    if (tab.kind === "browser") {
                      return (
                        <BrowserWorkspacePane
                          activePageId={tab.activeBrowserTabId}
                          initialPages={tab.browserTabs}
                          onClosePane={() => setRightPaneOpen(false)}
                          onOpenExternal={openPreviewExternally}
                          onPagesChange={(pages, activePageId) => updateBrowserTabState(tab.id, pages, activePageId)}
                          onBrowserPageActive={workspaceClient.markBrowserPageActive}
                          onBrowserWindowOpen={workspaceClient.onBrowserWindowOpen}
                        />
                      );
                    }

                    if (tab.kind === "terminal") {
                      return (
                        <TerminalPane
                          cwd={activeConversationWorkspaceRoot}
                          onClearSession={workspaceClient.clearTerminalSession}
                          onCopyText={workspaceClient.writeClipboardText}
                          onCreateSession={workspaceClient.createTerminalSession}
                          onReleaseSession={workspaceClient.releaseTerminalSession}
                          onResizeSession={workspaceClient.resizeTerminalSession}
                          onRestartSession={workspaceClient.restartTerminalSession}
                          onStopSession={workspaceClient.stopTerminalSession}
                          onTerminalEvent={workspaceClient.onTerminalEvent}
                          onWriteInput={workspaceClient.writeTerminalInput}
                        />
                      );
                    }

                    return (
                      <PreviewPane
                        embedded
                        preview={tab.preview}
                        onClearPreview={() => closeRightTab(tab.id)}
                        onClosePane={() => setRightPaneOpen(false)}
                        onOpenExternal={openPreviewExternally}
                        onOpenLink={openPreviewLink}
                        onBrowserPageActive={workspaceClient.markBrowserPageActive}
                        onBrowserWindowOpen={workspaceClient.onBrowserWindowOpen}
                      />
                    );
                  }}
                />
              </Suspense>
            ) : null}
          </div>
        ) : null}

        {view === "chat" ? (
          <div className="chat-fixed-right-pane-control">
            {renderRightPaneToggleButton("in-thread")}
          </div>
        ) : null}
      </div>

      {toastFeedback ? (
        <div className={`toast ${toastFeedback.tone}`}>{toastFeedback.message}</div>
      ) : null}

      <HoverTooltipLayer />
    </div>
  );
}
