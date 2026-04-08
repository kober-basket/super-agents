import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  createRuntimeModelId,
  ensureActiveModelId,
  getActiveModelOption,
  getSelectableModels,
  normalizeProviderModels,
  sanitizeModelProviderId,
} from "./lib/model-config";
import type {
  AppConfig,
  AppSection,
  BootstrapPayload,
  ChatMessage,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeBaseSummary,
  McpServerConfig,
  McpServerStatus,
  ModelProviderConfig,
  RuntimeSkill,
  SkillConfig,
  ThreadRecord,
  ThreadSummary,
  WorkspaceTool,
} from "./types";
import { workspaceClient } from "./services/workspace-client";
import { ChatView } from "./features/chat/ChatView";
import { PreviewPane } from "./features/chat/PreviewPane";
import { AutomationView } from "./features/automation/AutomationView";
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
import {
  displayThreadTitle,
  fileKind,
  sanitizeMcpName,
} from "./features/shared/utils";

const WORKSPACE_SNAPSHOT_KEY = "super-agents-workspace-snapshot-v1";
const LEGACY_WORKSPACE_SNAPSHOT_KEYS = ["kober-workspace-snapshot-v1"];
const SKILL_MESSAGE_MARKERS_KEY = "super-agents-skill-message-markers-v1";
const LEGACY_SKILL_MESSAGE_MARKER_KEYS = ["kober-skill-message-markers-v1"];

type ComposerSkill = {
  id: string;
  name: string;
  description?: string;
  kind: SkillConfig["kind"] | "reference";
  source: "installed" | "reference";
  enabled: boolean;
};

type SkillMessageMarker = {
  displayText: string;
  skillName: string;
};

type WorkspaceSnapshot = {
  config: AppConfig;
  threads: ThreadSummary[];
  activeThreadId: string;
  currentThread: ThreadRecord | null;
  availableSkills: RuntimeSkill[];
  mcpStatuses: McpServerStatus[];
};

function emptyConfig(): AppConfig {
  return {
    opencodeRoot: "",
    bridgeUrl: "",
    environment: "local",
    activeModelId: "ifly-azure-gpt-5-mini",
    contextTier: "high",
    proxy: {
      http: "",
      https: "",
      bypass: "localhost,127.0.0.1",
    },
    modelProviders: [],
    mcpServers: [],
    skills: [],
    hiddenCodexSkillIds: [],
    knowledgeBase: {
      enabled: false,
      embeddingProviderId: "",
      embeddingModel: "text-embedding-3-small",
      selectedBaseIds: [],
      documentCount: 5,
      chunkSize: 1200,
      chunkOverlap: 160,
    },
  };
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function cloneConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function normalizeConfig(config?: Partial<AppConfig> | null): AppConfig {
  const fallback = emptyConfig();
  if (!config) return fallback;

  return {
    ...fallback,
    ...config,
    proxy: {
      ...fallback.proxy,
      ...(config.proxy ?? {}),
    },
    modelProviders: Array.isArray(config.modelProviders) ? config.modelProviders : fallback.modelProviders,
    mcpServers: Array.isArray(config.mcpServers) ? config.mcpServers : fallback.mcpServers,
    skills: Array.isArray(config.skills) ? config.skills : fallback.skills,
    hiddenCodexSkillIds: Array.isArray(config.hiddenCodexSkillIds)
      ? config.hiddenCodexSkillIds
      : fallback.hiddenCodexSkillIds,
    knowledgeBase: {
      ...fallback.knowledgeBase,
      ...(config.knowledgeBase ?? {}),
      selectedBaseIds: Array.isArray(config.knowledgeBase?.selectedBaseIds)
        ? config.knowledgeBase.selectedBaseIds
        : fallback.knowledgeBase.selectedBaseIds,
      documentCount:
        typeof config.knowledgeBase?.documentCount === "number"
          ? config.knowledgeBase.documentCount
          : fallback.knowledgeBase.documentCount,
      chunkSize:
        typeof config.knowledgeBase?.chunkSize === "number"
          ? config.knowledgeBase.chunkSize
          : fallback.knowledgeBase.chunkSize,
      chunkOverlap:
        typeof config.knowledgeBase?.chunkOverlap === "number"
          ? config.knowledgeBase.chunkOverlap
          : fallback.knowledgeBase.chunkOverlap,
    },
  };
}

function matchQuery(query: string, values: Array<string | undefined>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function normalizeSkillToken(value: string) {
  return value.trim().toLowerCase();
}

function workspaceLabel(value: string) {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "閫夋嫨鐩綍";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function parseSlashSkillCommand(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  return {
    skillToken: normalizeSkillToken(match[1] ?? ""),
    prompt: (match[2] ?? "").trim(),
  };
}

function readJsonStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readJsonStorageFromKeys<T>(keys: string[]) {
  for (const key of keys) {
    const value = readJsonStorage<T>(key);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors and keep the live session responsive.
  }
}

function sortThreadSummaries(items: ThreadSummary[]) {
  return [...items].sort((left, right) => {
    if (left.archived !== right.archived) {
      return Number(left.archived) - Number(right.archived);
    }
    return right.updatedAt - left.updatedAt;
  });
}

function summarizeThreadLastMessage(messages: ChatMessage[]) {
  const lastText =
    [...messages]
      .reverse()
      .map((message) => message.text.trim())
      .find(Boolean) ?? "";
  return lastText.slice(0, 120);
}

function summarizeThreadRecord(thread: ThreadRecord): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    lastMessage: summarizeThreadLastMessage(thread.messages),
    messageCount: thread.messages.length,
    archived: thread.archived,
    workspaceRoot: thread.workspaceRoot,
  };
}

function extractErrorText(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as {
      name?: string;
      message?: string;
      data?: {
        message?: string;
        issues?: Array<{ path?: Array<string | number>; message?: string }>;
      };
      error?: {
        message?: string;
        code?: string;
      };
      errors?: Array<{ message?: string }>;
    };

    if (parsed.name === "ConfigInvalidError") {
      /*
      const firstIssue = parsed.data?.issues?.[0];
      const issuePath = Array.isArray(firstIssue?.path) ? firstIssue.path.join(".") : "";
      if (issuePath.includes(".status")) {
        return "杩愯鏃舵ā鍨嬮厤缃棤鏁堬紝璇峰埛鏂版ā鍨嬪垪琛ㄦ垨鍒犻櫎寮傚父妯″瀷鍚庨噸璇曘€?;
      }
      return firstIssue?.message || "杩愯鏃堕厤缃棤鏁堬紝璇锋鏌ユā鍨嬨€丮CP 鎴栦唬鐞嗚缃悗閲嶈瘯銆?;
      */
      const firstIssue = parsed.data?.issues?.[0];
      const issuePath = Array.isArray(firstIssue?.path) ? firstIssue.path.join(".") : "";
      if (issuePath.includes(".status")) {
        return "Runtime model status is invalid. Refresh the model list or remove the broken model and try again.";
      }
      return firstIssue?.message || "Runtime configuration is invalid. Check the model, MCP, or proxy settings and try again.";
    }

    return (
      parsed.error?.message ??
      parsed.data?.message ??
      parsed.errors?.[0]?.message ??
      parsed.message ??
      trimmed
    );
  } catch {
    return trimmed;
  }
}

function formatErrorMessage(error: unknown, fallback: string) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const text = extractErrorText(raw);
  const normalized = text.toLowerCase();

  /*

  if (
    normalized.includes("unsupported_country_region_territory") ||
    normalized.includes("country, region, or territory not supported")
  ) {
    return "褰撳墠缃戠粶鎴栧湴鍖哄鑷寸櫥褰曠姸鎬佸埛鏂板け璐ワ紝璇峰垏鎹㈢綉缁溿€佷唬鐞嗘垨閲嶆柊鐧诲綍鍚庨噸璇曘€?;
  }
  if (normalized.includes("failed to refresh token")) {
    return "鐧诲綍鐘舵€佸埛鏂板け璐ワ紝璇烽噸鏂扮櫥褰曞悗鍐嶈瘯銆?;
  }
  if (normalized.includes("configinvaliderror")) {
    return "杩愯鏃堕厤缃棤鏁堬紝璇锋鏌ユā鍨嬮厤缃悗閲嶈瘯銆?;
  }
  if (normalized.includes("timed out starting opencode server")) {
    return "杩愯鏃跺惎鍔ㄨ秴鏃讹紝璇锋鏌ユā鍨嬨€佷唬鐞嗘垨鏈湴鏈嶅姟閰嶇疆銆?;
  }
  if (normalized.includes("opencode server exited early")) {
    return "杩愯鏃跺惎鍔ㄥけ璐ワ紝璇锋鏌ユā鍨嬨€佷唬鐞嗘垨鏈湴鏈嶅姟閰嶇疆銆?;
  }

  return text || fallback;
}

export default function App() {
  const hydratedSnapshotRef = useRef<WorkspaceSnapshot | null>(
    readJsonStorageFromKeys<WorkspaceSnapshot>([WORKSPACE_SNAPSHOT_KEY, ...LEGACY_WORKSPACE_SNAPSHOT_KEYS]),
  );
  const initialSnapshot = hydratedSnapshotRef.current;
  const [view, setView] = useState<AppSection>("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [config, setConfig] = useState<AppConfig>(normalizeConfig(initialSnapshot?.config));
  const [threads, setThreads] = useState<ThreadSummary[]>(initialSnapshot?.threads ?? []);
  const [activeThreadId, setActiveThreadId] = useState(initialSnapshot?.activeThreadId ?? "");
  const [threadCache, setThreadCache] = useState<Record<string, ThreadRecord>>(
    initialSnapshot?.currentThread ? { [initialSnapshot.currentThread.id]: initialSnapshot.currentThread } : {},
  );
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<FileDropEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [composerComposing, setComposerComposing] = useState(false);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [workspaceIssue, setWorkspaceIssue] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<RuntimeSkill[]>(initialSnapshot?.availableSkills ?? []);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>(initialSnapshot?.mcpStatuses ?? []);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillsRefreshing, setSkillsRefreshing] = useState(false);
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [toolsRefreshing, setToolsRefreshing] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [knowledgeRefreshing, setKnowledgeRefreshing] = useState(false);
  const [knowledgeDraftName, setKnowledgeDraftName] = useState("");
  const [knowledgeDraftDescription, setKnowledgeDraftDescription] = useState("");
  const [knowledgeNoteTitle, setKnowledgeNoteTitle] = useState("");
  const [knowledgeNoteContent, setKnowledgeNoteContent] = useState("");
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpAdvancedOpen, setMcpAdvancedOpen] = useState(false);
  const [providerRefreshingId, setProviderRefreshingId] = useState<string | null>(null);
  const [selectedModelProviderId, setSelectedModelProviderId] = useState("");
  const [selectedComposerSkill, setSelectedComposerSkill] = useState<ComposerSkill | null>(null);
  const [skillMessageMarkers, setSkillMessageMarkers] = useState<Record<string, SkillMessageMarker>>(
    () =>
      readJsonStorageFromKeys<Record<string, SkillMessageMarker>>([
        SKILL_MESSAGE_MARKERS_KEY,
        ...LEGACY_SKILL_MESSAGE_MARKER_KEYS,
      ]) ?? {},
  );
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const pendingConfigSaveRef = useRef<number | null>(null);
  const configSaveVersionRef = useRef(0);
  const skillMessageMarkersRef = useRef(skillMessageMarkers);
  const threadCacheRef = useRef(threadCache);
  const localThreadOverridesRef = useRef<Record<string, ThreadRecord>>({});

  const activeThread = threadCache[activeThreadId] ?? null;
  const activeSummary = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const activeThreads = useMemo(() => threads.filter((thread) => !thread.archived), [threads]);
  const archivedThreads = useMemo(() => threads.filter((thread) => thread.archived), [threads]);
  const activeModel = useMemo(
    () => getActiveModelOption(config.modelProviders, config.activeModelId),
    [config.activeModelId, config.modelProviders],
  );
  const selectableModels = useMemo(
    () => getSelectableModels(config.modelProviders),
    [config.modelProviders],
  );
  const composerModelId = selectableModels.some((item) => item.id === config.activeModelId)
    ? config.activeModelId
    : selectableModels[0]?.id ?? "";
  const mcpStatusMap = useMemo(
    () => Object.fromEntries(mcpStatuses.map((item) => [item.name, item])) as Record<string, McpServerStatus>,
    [mcpStatuses],
  );
  const configuredSkills = useMemo(
    () =>
      config.skills.map((skill) => ({
        ...skill,
        location:
          skill.kind === "codex"
            ? skill.system
              ? "Codex 绯荤粺鎶€鑳?
              : skill.sourcePath || "Codex 鏈湴鎶€鑳?
            : "宸ヤ綔鍙板唴缃兘鍔?,
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
  const installedSkillMap = useMemo(
    () =>
      new Map(
        config.skills.flatMap((skill) => {
          const entries: Array<readonly [string, SkillConfig]> = [];
          const nameKey = normalizeSkillToken(skill.name);
          const idKey = normalizeSkillToken(skill.id);
          if (nameKey) entries.push([nameKey, skill] as const);
          if (idKey && idKey !== nameKey) entries.push([idKey, skill] as const);
          return entries;
        }),
      ),
    [config.skills],
  );
  const referenceSkillMap = useMemo(
    () =>
      new Map(
        availableSkills.flatMap((skill) => {
          const entries: Array<readonly [string, RuntimeSkill]> = [];
          const nameKey = normalizeSkillToken(skill.name);
          const idKey = normalizeSkillToken(skill.id);
          if (nameKey) entries.push([nameKey, skill] as const);
          if (idKey && idKey !== nameKey) entries.push([idKey, skill] as const);
          return entries;
        }),
      ),
    [availableSkills],
  );
  const composerSkillOptions = useMemo(() => {
    const installed = config.skills
      .filter((skill) => skill.enabled !== false)
      .map(
        (skill) =>
          ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            kind: skill.kind,
            source: "installed",
            enabled: skill.enabled !== false,
          }) satisfies ComposerSkill,
      );

    const knownNames = new Set(installed.map((skill) => normalizeSkillToken(skill.name || skill.id)));
    const discovered = availableSkills
      .filter((skill) => !knownNames.has(normalizeSkillToken(skill.name || skill.id)))
      .map(
        (skill) =>
          ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            kind: "reference",
            source: "reference",
            enabled: true,
          }) satisfies ComposerSkill,
      );

    return [...installed, ...discovered];
  }, [availableSkills, config.skills]);
  const composerSkillOptionsById = useMemo(
    () => new Map(composerSkillOptions.map((skill) => [skill.id, skill] as const)),
    [composerSkillOptions],
  );
  const slashSkillSuggestions = useMemo(() => {
    if (selectedComposerSkill) return [];

    const match = composer.match(/^\/([^\s]*)$/);
    if (!match) return [];

    const query = normalizeSkillToken(match[1] ?? "");
    const merged = new Map<string, ComposerSkill>();

    for (const skill of config.skills) {
      if (skill.enabled === false) continue;
      const candidate: ComposerSkill = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        kind: skill.kind,
        source: "installed",
        enabled: skill.enabled !== false,
      };
      merged.set(normalizeSkillToken(skill.name || skill.id), candidate);
    }

    for (const skill of availableSkills) {
      const candidate: ComposerSkill = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        kind: "reference",
        source: "reference",
        enabled: true,
      };
      const key = normalizeSkillToken(skill.name || skill.id);
      if (!merged.has(key)) {
        merged.set(key, candidate);
      }
    }

    return Array.from(merged.values())
      .filter((skill) => {
        if (!query) return true;
        return [skill.name, skill.id, skill.description].some((value) =>
          normalizeSkillToken(value ?? "").includes(query),
        );
      })
      .slice(0, 8);
  }, [availableSkills, composer, config.skills, selectedComposerSkill]);

  useEffect(() => {
    threadCacheRef.current = threadCache;
  }, [threadCache]);

  function decorateThread(thread: ThreadRecord): ThreadRecord {
    return {
      ...thread,
      messages: thread.messages.map((message) => {
        const marker = skillMessageMarkersRef.current[message.id];
        if (!marker) return message;

        return {
          ...message,
          text: marker.displayText,
          skillName: marker.skillName,
        };
      }),
    };
  }

  function saveWorkspaceSnapshot(payload: BootstrapPayload) {
    writeJsonStorage(WORKSPACE_SNAPSHOT_KEY, {
      config: payload.config,
      threads: payload.threads,
      activeThreadId: payload.activeThreadId,
      currentThread: payload.currentThread,
      availableSkills: payload.availableSkills,
      mcpStatuses: payload.mcpStatuses,
    } satisfies WorkspaceSnapshot);
  }

  function updateSkillMessageMarker(
    messageId: string,
    marker: SkillMessageMarker,
  ) {
    setSkillMessageMarkers((previous) => {
      const next = {
        ...previous,
        [messageId]: marker,
      };
      skillMessageMarkersRef.current = next;
      return next;
    });
  }

  function registerSkillMessage(
    thread: ThreadRecord,
    transportText: string,
    displayText: string,
    skillName: string,
  ) {
    const target = [...thread.messages]
      .reverse()
      .find((message) => message.role === "user" && message.text === transportText);

    if (!target) {
      return decorateThread(thread);
    }

    updateSkillMessageMarker(target.id, {
      displayText,
      skillName,
    });

    return decorateThread({
      ...thread,
      messages: thread.messages.map((message) =>
        message.id === target.id
          ? {
              ...message,
              text: displayText,
              skillName,
            }
          : message,
      ),
    });
  }

  function rememberThread(thread: ThreadRecord) {
    const decorated = decorateThread(thread);
    setThreadCache((previous) => ({
      ...previous,
      [thread.id]: decorated,
    }));
    setThreads((previous) => {
      const summary = summarizeThreadRecord(decorated);
      const next = previous.filter((item) => item.id !== summary.id);
      next.push(summary);
      return sortThreadSummaries(next);
    });
  }

  function threadProgressScore(thread: ThreadRecord) {
    return thread.messages.reduce((score, message) => {
      const textScore = message.text.trim().length;
      const attachmentScore = message.attachments?.length ?? 0;
      const statusScore = message.status === "error" ? 40 : message.status === "loading" ? 20 : 0;
      return score + 1000 + textScore + attachmentScore * 10 + statusScore;
    }, 0);
  }

  function shouldKeepLocalThreadOverride(localThread: ThreadRecord, incomingThread: ThreadRecord) {
    const lastMessage = localThread.messages.at(-1);
    const keepsLocalState =
      lastMessage?.role === "assistant" && (lastMessage.status === "loading" || lastMessage.status === "error");
    if (!keepsLocalState) {
      return false;
    }

    return threadProgressScore(localThread) > threadProgressScore(incomingThread);
  }

  function clearLocalThreadOverride(threadId: string) {
    if (localThreadOverridesRef.current[threadId]) {
      delete localThreadOverridesRef.current[threadId];
    }
  }

  function rememberLocalThreadOverride(thread: ThreadRecord) {
    const decorated = decorateThread(thread);
    localThreadOverridesRef.current[thread.id] = decorated;
    rememberThread(decorated);
  }

  function preferLocalThreadState(thread: ThreadRecord) {
    const localThread = localThreadOverridesRef.current[thread.id];
    if (!localThread) {
      return decorateThread(thread);
    }

    const decoratedIncoming = decorateThread(thread);
    if (shouldKeepLocalThreadOverride(localThread, decoratedIncoming)) {
      return localThread;
    }

    clearLocalThreadOverride(thread.id);
    return decoratedIncoming;
  }

  function mergeThreadSummariesWithLocalOverrides(items: ThreadSummary[]) {
    const merged = [...items];

    for (const localThread of Object.values(localThreadOverridesRef.current)) {
      const summary = summarizeThreadRecord(localThread);
      const index = merged.findIndex((item) => item.id === summary.id);
      if (index >= 0) {
        merged[index] = summary;
      } else {
        merged.push(summary);
      }
    }

    return sortThreadSummaries(merged);
  }

  function markThreadRequestFailed(thread: ThreadRecord, errorMessage: string) {
    const messages = [...thread.messages];
    const errorText = `鍙戦€佸け璐ワ細${errorMessage}`;
    const loadingIndex = messages.findLastIndex(
      (message) => message.role === "assistant" && message.status === "loading",
    );

    if (loadingIndex >= 0) {
      messages[loadingIndex] = {
        ...messages[loadingIndex],
        text: errorText,
        status: "error",
      };
    } else {
      messages.push({
        id: uid(),
        role: "assistant",
        text: errorText,
        createdAt: Date.now(),
        status: "error",
      });
    }

    return {
      ...thread,
      updatedAt: Date.now(),
      lastMessage: errorText,
      messageCount: messages.length,
      messages,
    };
  }

  function applyWorkspace(payload: BootstrapPayload) {
    const currentThread = preferLocalThreadState(payload.currentThread);
    const mergedThreads = mergeThreadSummariesWithLocalOverrides([
      ...payload.threads.filter((thread) => thread.id !== currentThread.id),
      summarizeThreadRecord(currentThread),
    ]);
    const nextPayload = {
      ...payload,
      currentThread,
      threads: mergedThreads,
    } satisfies BootstrapPayload;

    saveWorkspaceSnapshot(nextPayload);
    setConfig(normalizeConfig(nextPayload.config));
    setThreads(nextPayload.threads);
    setActiveThreadId(nextPayload.activeThreadId);
    setAvailableSkills(nextPayload.availableSkills);
    setMcpStatuses(nextPayload.mcpStatuses);
    setWorkspaceIssue(null);
    rememberThread(currentThread);
  }

  async function bootstrapWorkspace(maxAttempts = 3) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await workspaceClient.bootstrap();
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await wait(350 * attempt);
        }
      }
    }

    throw lastError;
  }

  useEffect(() => {
    let mounted = true;

    const unsubscribe = workspaceClient.onWorkspaceChanged((payload) => {
      if (!mounted) return;
      applyWorkspace(payload);
    });

    void bootstrapWorkspace()
      .then((payload) => {
        if (!mounted) return;
        applyWorkspace(payload);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = formatErrorMessage(error, "鍚姩宸ヤ綔鍙板け璐?);
        setWorkspaceIssue(message);
        setToast(message);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!messageListRef.current) return;
    messageListRef.current.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeThread?.messages.length, activeThreadId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    skillMessageMarkersRef.current = skillMessageMarkers;
    writeJsonStorage(SKILL_MESSAGE_MARKERS_KEY, skillMessageMarkers);
  }, [skillMessageMarkers]);

  useEffect(() => {
    if (!selectedComposerSkill) return;
    if (composer.trim().startsWith("/")) {
      setSelectedComposerSkill(null);
    }
  }, [composer, selectedComposerSkill]);

  useEffect(() => {
    return () => {
      if (pendingConfigSaveRef.current) {
        window.clearTimeout(pendingConfigSaveRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (view !== "tools" || toolsRefreshing || tools.length > 0) {
      return;
    }

    void refreshToolsView();
  }, [tools.length, toolsRefreshing, view]);

  useEffect(() => {
    if (view !== "knowledge" || knowledgeRefreshing || knowledgeBases.length > 0) {
      return;
    }

    void refreshKnowledgeView();
  }, [knowledgeBases.length, knowledgeRefreshing, view]);

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

  async function refreshWorkspaceSnapshot(message?: string) {
    try {
      const payload = await workspaceClient.bootstrap();
      applyWorkspace(payload);
      if (message) setToast(message);
    } catch (error) {
      const nextMessage = formatErrorMessage(error, "鍒锋柊澶辫触");
      setWorkspaceIssue(nextMessage);
      setToast(nextMessage);
    }
  }

  async function refreshThreadList() {
    try {
      setThreads(mergeThreadSummariesWithLocalOverrides(await workspaceClient.listThreads()));
      setWorkspaceIssue(null);
    } catch (error) {
      const message = formatErrorMessage(error, "浼氳瘽鍒楄〃鍒锋柊澶辫触");
      setWorkspaceIssue(message);
      setToast(message);
    }
  }

  async function createThread() {
    try {
      const payload = await workspaceClient.createThread();
      applyWorkspace(payload);
      setComposer("");
      setAttachments([]);
      setView("chat");
      setToast("宸叉柊寤轰細璇?);
    } catch (error) {
      const message = formatErrorMessage(error, "鏂板缓浼氳瘽澶辫触");
      setWorkspaceIssue(message);
      setToast(message);
    }
  }

  async function openThread(threadId: string) {
    try {
      const thread = await workspaceClient.setActiveThread(threadId);
      setActiveThreadId(thread.id);
      rememberThread(thread);
      await refreshThreadList();
      setView("chat");
    } catch (error) {
      const message = formatErrorMessage(error, "鍒囨崲浼氳瘽澶辫触");
      setWorkspaceIssue(message);
      setToast(message);
    }
  }

  async function archiveThread(thread: ThreadSummary, archived: boolean) {
    try {
      const payload = await workspaceClient.archiveThread(thread.id, archived);
      applyWorkspace(payload);
      if (thread.id === activeThreadId && archived) {
        setComposer("");
        setAttachments([]);
      }
      setToast(archived ? `宸插綊妗?${displayThreadTitle(thread.title)}` : `宸叉仮澶?${displayThreadTitle(thread.title)}`);
    } catch {
      setToast(archived ? "褰掓。浼氳瘽澶辫触" : "鎭㈠浼氳瘽澶辫触");
    }
  }

  async function deleteThreadImmediately(thread: ThreadSummary) {
    try {
      const payload = await workspaceClient.deleteThread(thread.id);
      applyWorkspace(payload);
      setThreadCache((previous) => {
        const next = { ...previous };
        delete next[thread.id];
        return next;
      });
      if (thread.id === activeThreadId) {
        setComposer("");
        setAttachments([]);
      }
      setToast(`宸插垹闄?${displayThreadTitle(thread.title)}`);
    } catch {
      setToast("鍒犻櫎浼氳瘽澶辫触");
    }
  }

  function buildSkillPrompt(name: string, description: string | undefined, prompt: string) {
    return [
      `璇蜂紭鍏堜娇鐢ㄦ妧鑳姐€?{name}銆嶆潵澶勭悊杩欓」浠诲姟銆俙,
      prompt.trim() || description || "璇锋牴鎹妧鑳借鏄庡畬鎴愬綋鍓嶄换鍔°€?,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function sendPlainMessage(
    message: string,
    nextAttachments: FileDropEntry[],
    skillMeta?: { displayText: string; skillName: string },
  ) {
    const optimisticThread: ThreadRecord = {
      ...(activeThread ?? {
        id: activeThreadId,
        title: activeSummary?.title || "鏂颁細璇?,
        updatedAt: Date.now(),
        lastMessage: "",
        messageCount: 0,
        archived: activeSummary?.archived ?? false,
        messages: [],
      }),
      updatedAt: Date.now(),
      messages: [
        ...(activeThread?.messages ?? []),
        {
          id: uid(),
          role: "user",
          text: skillMeta?.displayText ?? message,
          createdAt: Date.now(),
          skillName: skillMeta?.skillName,
          attachments: nextAttachments.map((file) => ({
            ...file,
            kind: fileKind(file),
          })),
        },
        {
          id: uid(),
          role: "assistant",
          text: "",
          createdAt: Date.now(),
          status: "loading",
        },
      ],
    };

    rememberLocalThreadOverride(optimisticThread);
    setComposer("");
    setAttachments([]);
    setSending(true);

    try {
      const result = await workspaceClient.sendMessage({
        threadId: activeThreadId,
        message,
        attachments: nextAttachments,
      });
      clearLocalThreadOverride(result.thread.id);
      rememberThread(
        skillMeta
          ? registerSkillMessage(result.thread, message, skillMeta.displayText, skillMeta.skillName)
          : result.thread,
      );
      await refreshThreadList();
      if (result.knowledge?.warnings?.length) {
        setToast(result.knowledge.warnings[0]);
      } else if (result.knowledge?.injected) {
        setToast(`宸叉绱?${result.knowledge.resultCount} 鏉＄煡璇嗗簱鐗囨`);
      }
    } catch (error) {
      const message = formatErrorMessage(error, "鍙戦€佸け璐?);
      rememberLocalThreadOverride(markThreadRequestFailed(optimisticThread, message));
      setWorkspaceIssue(message);
      setToast(message);
    } finally {
      setSending(false);
    }
  }

  async function executeCommandSkill(
    skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">,
    promptOverride?: string,
  ) {
    if (!activeThreadId) return;
    if (skill.enabled === false) {
      setToast("璇峰厛鍚敤杩欎釜鎶€鑳?);
      return;
    }

    try {
      const result = await workspaceClient.runSkill({
        threadId: activeThreadId,
        skillId: skill.id,
        prompt: promptOverride?.trim() || composer.trim() || skill.description,
      });
      rememberThread(result.thread);
      await refreshThreadList();
      setView("chat");
      setToast(`宸茶繍琛?${skill.name}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "杩愯鎶€鑳藉け璐?);
    }
  }

  async function sendMessage() {
    if (!activeThreadId || sending || composerComposing || (!composer.trim() && attachments.length === 0)) return;
    const nextMessage = composer.trim();
    const nextAttachments = attachments;

    const optimisticThread: ThreadRecord = {
      ...(activeThread ?? {
        id: activeThreadId,
        title: activeSummary?.title || "鏂颁細璇?,
        updatedAt: Date.now(),
        lastMessage: "",
        messageCount: 0,
        archived: activeSummary?.archived ?? false,
        messages: [],
      }),
      updatedAt: Date.now(),
      messages: [
        ...(activeThread?.messages ?? []),
        {
          id: uid(),
          role: "user",
          text: nextMessage,
          createdAt: Date.now(),
          attachments: nextAttachments.map((file) => ({
            ...file,
            kind: fileKind(file),
          })),
        },
        {
          id: uid(),
          role: "assistant",
          text: "",
          createdAt: Date.now(),
          status: "loading",
        },
      ],
    };

    rememberLocalThreadOverride(optimisticThread);
    setComposer("");
    setAttachments([]);
    setSending(true);

    try {
      const result = await workspaceClient.sendMessage({
        threadId: activeThreadId,
        message: nextMessage,
        attachments: nextAttachments,
      });
      clearLocalThreadOverride(result.thread.id);
      rememberThread(result.thread);
      await refreshThreadList();
    } catch (error) {
      const message = formatErrorMessage(error, "鍙戦€佸け璐?);
      rememberLocalThreadOverride(markThreadRequestFailed(optimisticThread, message));
      setWorkspaceIssue(message);
      setToast(message);
    } finally {
      setSending(false);
    }
  }

  async function sendMessageWithSkills() {
    if (!activeThreadId || sending || composerComposing || (!composer.trim() && attachments.length === 0)) return;

    const nextMessage = composer.trim();
    const nextAttachments = attachments;
    const composerSkill = selectedComposerSkill;
    const slashCommand = parseSlashSkillCommand(nextMessage);

    if (!composerSkill && !slashCommand?.skillToken) {
      await sendPlainMessage(nextMessage, nextAttachments);
      return;
    }

    const installedSkill =
      composerSkill?.source === "installed"
        ? config.skills.find((skill) => skill.id === composerSkill.id) ?? null
        : slashCommand?.skillToken
          ? installedSkillMap.get(slashCommand.skillToken) ?? null
          : null;
    if (installedSkill) {
      const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
      setComposer("");
      setSelectedComposerSkill(null);

      if (installedSkill.kind === "codex") {
        const wrappedPrompt = buildSkillPrompt(installedSkill.name, installedSkill.description, promptText);
        await sendPlainMessage(
          wrappedPrompt,
          nextAttachments,
          {
            displayText: promptText || installedSkill.description || "",
            skillName: installedSkill.name,
          },
        );
        setToast(`宸叉寜 /${installedSkill.name} 鍙戦€乣);
        return;
      }

      if (nextAttachments.length > 0) {
        setToast("鏂滄潬鍛戒护鏆備笉鏀寔缁欏懡浠ゅ瀷鎶€鑳介檮甯﹂檮浠?);
        return;
      }

      setAttachments([]);
      await executeCommandSkill(installedSkill, promptText);
      return;
    }

    const referenceSkill =
      composerSkill?.source === "reference"
        ? availableSkills.find((skill) => skill.id === composerSkill.id) ?? null
        : slashCommand?.skillToken
          ? referenceSkillMap.get(slashCommand.skillToken) ?? null
          : null;
    if (referenceSkill) {
      const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
      setComposer("");
      setSelectedComposerSkill(null);
      const wrappedPrompt = buildSkillPrompt(referenceSkill.name, referenceSkill.description, promptText);
      await sendPlainMessage(
        wrappedPrompt,
        nextAttachments,
        {
          displayText: promptText || referenceSkill.description || "",
          skillName: referenceSkill.name,
        },
      );
      setToast(`宸叉寜 /${referenceSkill.name} 鍙戦€乣);
      return;
    }

    setToast(`娌℃湁鎵惧埌鎶€鑳?/${slashCommand.skillToken}`);
  }

  function useConfiguredCodexSkill(skill: SkillConfig) {
    const nextPrompt = [
      `璇蜂紭鍏堜娇鐢ㄦ妧鑳姐€?{skill.name}銆嶆潵澶勭悊杩欓」浠诲姟銆俙,
      composer.trim() || skill.description || "璇锋牴鎹妧鑳借鏄庡畬鎴愬綋鍓嶄换鍔°€?,
    ]
      .filter(Boolean)
      .join("\n\n");

    setComposer(nextPrompt);
    setView("chat");
    setToast(`宸插甫鍏ユ妧鑳?${skill.name}`);
  }

  async function runSkill(skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">) {
    if (!activeThreadId) return;
    if (skill.enabled === false) {
      setToast("璇峰厛鍚敤杩欎釜鎶€鑳?);
      return;
    }

    if (skill.kind === "codex") {
      useConfiguredCodexSkill(skill as SkillConfig);
      return;
    }

    try {
      const result = await workspaceClient.runSkill({
        threadId: activeThreadId,
        skillId: skill.id,
        prompt: composer.trim() || skill.description,
      });
      rememberThread(result.thread);
      await refreshThreadList();
      setView("chat");
      setToast(`宸茶繍琛?${skill.name}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "杩愯鎶€鑳藉け璐?);
    }
  }

  function updateInstalledSkill(skillId: string, patch: Partial<SkillConfig>) {
    const skills = config.skills.map((item) => (item.id === skillId ? { ...item, ...patch } : item));
    void commitConfig({ ...cloneConfig(config), skills });
  }

  async function uninstallSkill(skill: SkillConfig) {
    try {
      const payload = await workspaceClient.uninstallSkill(skill.id);
      applyWorkspace(payload);
      setToast(skill.kind === "codex" ? `宸插嵏杞?${skill.name}` : `宸插垹闄?${skill.name}`);
    } catch {
      setToast("鍗歌浇鎶€鑳藉け璐?);
    }
  }

  async function pickFiles() {
    try {
      const files = await workspaceClient.selectFiles();
      if (files.length > 0) {
        setAttachments((previous) => [...previous, ...files]);
      }
    } catch {
      setToast("璇诲彇鏂囦欢澶辫触");
    }
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
        setToast("鎵撳紑棰勮澶辫触");
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
      setToast("鎵撳紑缃戦〉棰勮澶辫触");
    }
  }

  async function openWorkspaceFolder() {
    try {
      await workspaceClient.openWorkspaceFolder(activeThreadId || undefined);
    } catch {
      setToast("鎵撳紑鐩綍澶辫触");
    }
  }

  async function chooseThreadWorkspace() {
    if (!activeThreadId) return;

    try {
      const selected = await workspaceClient.selectWorkspaceFolder();
      if (!selected) {
        return;
      }

      const payload = await workspaceClient.setThreadWorkspace(activeThreadId, selected);
      applyWorkspace(payload);
      setToast(`宸插垏鎹㈠埌 ${workspaceLabel(selected)}`);
    } catch {
      setToast("宸ヤ綔鐩綍鍒囨崲澶辫触");
    }
  }

  function clearPendingConfigSave() {
    if (!pendingConfigSaveRef.current) return;
    window.clearTimeout(pendingConfigSaveRef.current);
    pendingConfigSaveRef.current = null;
  }

  async function persistConfig(next: AppConfig, mutationVersion: number, message?: string) {
    try {
      const payload = await workspaceClient.updateConfig(next);
      if (mutationVersion !== configSaveVersionRef.current) {
        return;
      }
      applyWorkspace(payload);
      if (message) {
        setToast(message);
      }
    } catch {
      if (mutationVersion !== configSaveVersionRef.current) {
        return;
      }
      setToast("淇濆瓨璁剧疆澶辫触");
    }
  }

  async function commitConfig(next: AppConfig, message = "璁剧疆宸蹭繚瀛?) {
    clearPendingConfigSave();
    const mutationVersion = ++configSaveVersionRef.current;
    await persistConfig(next, mutationVersion, message);
  }

  /*

  function commitConfigOptimistic(next: AppConfig, message = "鐠佸墽鐤嗗韫箽鐎?) {
    clearPendingConfigSave();
    setConfig(next);

    const mutationVersion = ++configSaveVersionRef.current;
    void persistConfig(next, mutationVersion, message);
  }

  */

  function commitConfigOptimistic(next: AppConfig, message = "Settings saved") {
    clearPendingConfigSave();
    setConfig(next);

    const mutationVersion = ++configSaveVersionRef.current;
    void persistConfig(next, mutationVersion, message);
  }

  function scheduleConfigPersist(next: AppConfig) {
    clearPendingConfigSave();
    setConfig(next);

    const mutationVersion = ++configSaveVersionRef.current;
    pendingConfigSaveRef.current = window.setTimeout(() => {
      pendingConfigSaveRef.current = null;
      void persistConfig(next, mutationVersion);
    }, 320);
  }

  function updateConfigField<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    scheduleConfigPersist({ ...cloneConfig(config), [key]: value } as AppConfig);
  }

  function commitModelProviders(modelProviders: ModelProviderConfig[], message = "璁剧疆宸蹭繚瀛?) {
    commitConfigOptimistic(buildConfigWithModelProviders(modelProviders), message);
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

  function addModelProvider() {
    const providerId = sanitizeModelProviderId(`provider-${uid()}`);
    const modelProviders = [
      ...config.modelProviders,
      {
        id: providerId,
        name: "鏂颁緵搴斿晢",
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
    commitModelProviders(modelProviders, "宸叉柊澧炰緵搴斿晢");
  }

  function removeModelProvider(providerId: string) {
    const target = config.modelProviders.find((item) => item.id === providerId);
    const modelProviders = config.modelProviders.filter((item) => item.id !== providerId);
    commitModelProviders(
      modelProviders,
      target ? `宸插垹闄?${target.name || "渚涘簲鍟?} 閰嶇疆` : "宸插垹闄や緵搴斿晢閰嶇疆",
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

    commitConfigOptimistic(
      buildConfigWithModelProviders(modelProviders, createRuntimeModelId(providerId, modelId)),
      "榛樿妯″瀷宸叉洿鏂?,
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
          enabled: previousEnabled.get(item.id) ?? true,
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
      commitModelProviders(modelProviders, `${provider.name} 妯″瀷鍒楄〃宸插埛鏂癭);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "妯″瀷鍒楄〃鎷夊彇澶辫触");
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
      target ? `宸插垹闄?${target.name || "MCP"} 閰嶇疆` : "宸插垹闄?MCP 閰嶇疆",
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
    void commitConfig({ ...cloneConfig(config), mcpServers }, "宸叉柊澧?MCP");
  }

  function addRecommendedMcpServer(server: {
    id: string;
    name: string;
    transport: "local" | "remote";
  }) {
    const normalized = sanitizeMcpName(server.name);
    if (config.mcpServers.some((item) => sanitizeMcpName(item.name) === normalized)) {
      setToast("杩欎釜鏈嶅姟鍣ㄨ崏绋垮凡缁忓瓨鍦?);
      setSettingsSection("mcp");
      return;
    }

    const isPlaywrightPreset = server.id === "browser-automation";
    const mcpServers = [
      ...config.mcpServers,
      {
        id: `mcp-${uid()}`,
        name: server.name,
        transport: server.transport,
        command: server.transport === "local" ? (isPlaywrightPreset ? "npx" : "node") : "",
        args: isPlaywrightPreset ? ["-y", "@playwright/mcp@latest"] : [],
        url: "",
        headersJson: "{}",
        envJson: "{}",
        enabled: false,
        timeoutMs: 30000,
      },
    ];

    void commitConfig({ ...cloneConfig(config), mcpServers }, "宸叉坊鍔犳湇鍔″櫒鑽夌");
    setSettingsSection("mcp");
  }

  function removeAttachment(id: string) {
    setAttachments((previous) => previous.filter((item) => item.id !== id));
  }

  function applySuggestion(prompt: string) {
    setComposer(prompt);
  }

  function selectComposerSkill(skillId: string) {
    const skill = composerSkillOptionsById.get(skillId);
    if (!skill) return;

    setSelectedComposerSkill(skill);
    setComposer("");
    setToast(`宸查€夋嫨鎶€鑳?${skill.name}`);
  }

  function prepareSkillDraft(name?: string, description?: string) {
    const nextPrompt = [
      name ? `甯垜鍒涘缓涓€涓悕涓恒€?{name}銆嶇殑鏂版妧鑳姐€俙 : "甯垜鍒涘缓涓€涓柊鎶€鑳姐€?,
      description ? `鐩爣锛?{description}` : "鐩爣锛氳甯垜姊崇悊鐢ㄩ€斻€佽緭鍏ヨ緭鍑恒€佺洰褰曠粨鏋勫拰鍒濈増瀹炵幇銆?,
      "璇锋寜鍙洿鎺ヨ惤鍦扮殑鏂瑰紡缁欏嚭寤鸿銆?,
    ]
      .filter(Boolean)
      .join("\n");

    setComposer(nextPrompt);
    setView("chat");
    setToast("宸插垏鎹㈠埌瀵硅瘽鍖猴紝鍙互缁х画琛ュ厖鎶€鑳介渶姹?);
  }

  function useReferenceSkill(skill: RuntimeSkill) {
    const nextPrompt = [
      `璇蜂紭鍏堜娇鐢ㄦ妧鑳姐€?{skill.name}銆嶆潵澶勭悊杩欓」浠诲姟銆俙,
      composer.trim() || skill.description || "璇锋牴鎹妧鑳借鏄庡畬鎴愬綋鍓嶄换鍔°€?,
    ]
      .filter(Boolean)
      .join("\n\n");

    setComposer(nextPrompt);
    setView("chat");
    setToast(`宸插甫鍏ユ妧鑳?${skill.name}`);
  }

  async function refreshSkillsView() {
    setSkillsRefreshing(true);
    await refreshWorkspaceSnapshot("鎶€鑳藉垪琛ㄥ凡鍒锋柊");
    setSkillsRefreshing(false);
  }

  async function refreshMcpView() {
    setMcpRefreshing(true);
    await refreshWorkspaceSnapshot("MCP 鐘舵€佸凡鍒锋柊");
    setMcpRefreshing(false);
  }

  async function refreshToolsView() {
    setToolsRefreshing(true);
    try {
      const payload = await workspaceClient.listTools();
      setTools(payload.tools);
    } catch {
      setToast("宸ュ叿鍒楄〃鍒锋柊澶辫触");
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
      selectedBaseIds: Array.from(selected),
    });
  }

  async function refreshKnowledgeView() {
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
            selectedBaseIds,
          },
        });
      }

      setToast("鐭ヨ瘑搴撳垪琛ㄥ凡鍒锋柊");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "鐭ヨ瘑搴撳垪琛ㄥ埛鏂板け璐?);
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function createKnowledgeBase() {
    const name = knowledgeDraftName.trim();
    if (!name) {
      setToast("璇峰厛濉啓鐭ヨ瘑搴撳悕绉?);
      return;
    }

    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.createKnowledgeBase({
        name,
        description: knowledgeDraftDescription.trim(),
      });
      setKnowledgeBases(payload.knowledgeBases);
      setKnowledgeDraftName("");
      setKnowledgeDraftDescription("");
      setToast(`宸插垱寤虹煡璇嗗簱 ${name}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "鍒涘缓鐭ヨ瘑搴撳け璐?);
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
        selectedBaseIds: config.knowledgeBase.selectedBaseIds.filter((item) => item !== baseId),
      });
      setToast("鐭ヨ瘑搴撳凡鍒犻櫎");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "鍒犻櫎鐭ヨ瘑搴撳け璐?);
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
      setToast(`宸插鍏?${files.length} 涓枃浠禶);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "瀵煎叆鐭ヨ瘑鏂囦欢澶辫触");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  async function addKnowledgeNote(baseId: string) {
    if (!knowledgeNoteTitle.trim() || !knowledgeNoteContent.trim()) {
      setToast("璇峰厛濉啓绗旇鏍囬鍜屽唴瀹?);
      return;
    }

    setKnowledgeRefreshing(true);
    try {
      const payload = await workspaceClient.addKnowledgeNote({
        baseId,
        title: knowledgeNoteTitle.trim(),
        content: knowledgeNoteContent.trim(),
      });
      setKnowledgeBases(payload.knowledgeBases);
      setKnowledgeNoteTitle("");
      setKnowledgeNoteContent("");
      setToast("鐭ヨ瘑绗旇宸插姞鍏ョ煡璇嗗簱");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "娣诲姞鐭ヨ瘑绗旇澶辫触");
    } finally {
      setKnowledgeRefreshing(false);
    }
  }

  const showPreviewPane = view === "chat" && preview && previewOpen;
  const currentWorkspacePath = activeThread?.workspaceRoot || activeSummary?.workspaceRoot || config.opencodeRoot || "";
  const currentWorkspaceLabel = workspaceLabel(currentWorkspacePath);
  const title = displayThreadTitle(activeSummary?.title || activeThread?.title || "鏂颁細璇?);
  const settingsStats = {
    threadCount: threads.length,
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
    if (view === "automation") {
      return (
        <AutomationView
          onUseAutomation={(prompt) => {
            setComposer(prompt);
            setView("chat");
          }}
        />
      );
    }

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
          draftName={knowledgeDraftName}
          draftDescription={knowledgeDraftDescription}
          noteTitle={knowledgeNoteTitle}
          noteContent={knowledgeNoteContent}
          onDraftNameChange={setKnowledgeDraftName}
          onDraftDescriptionChange={setKnowledgeDraftDescription}
          onNoteTitleChange={setKnowledgeNoteTitle}
          onNoteContentChange={setKnowledgeNoteContent}
          onRefresh={refreshKnowledgeView}
          onToggleEnabled={(enabled) => updateKnowledgeBaseConfig({ enabled })}
          onChangeEmbeddingProvider={(embeddingProviderId) => updateKnowledgeBaseConfig({ embeddingProviderId })}
          onChangeEmbeddingModel={(embeddingModel) => updateKnowledgeBaseConfig({ embeddingModel })}
          onChangeDocumentCount={(documentCount) => updateKnowledgeBaseConfig({ documentCount })}
          onChangeChunkSize={(chunkSize) => updateKnowledgeBaseConfig({ chunkSize })}
          onChangeChunkOverlap={(chunkOverlap) => updateKnowledgeBaseConfig({ chunkOverlap })}
          onToggleKnowledgeBase={toggleKnowledgeBaseSelection}
          onCreateKnowledgeBase={createKnowledgeBase}
          onDeleteKnowledgeBase={deleteKnowledgeBase}
          onAddKnowledgeFiles={addKnowledgeFiles}
          onAddKnowledgeNote={addKnowledgeNote}
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
          messageListRef={messageListRef}
        previewAvailable={Boolean(preview)}
        previewOpen={previewOpen}
          selectedSkillName={selectedComposerSkill?.name ?? null}
          selectableModels={selectableModels}
          sending={sending}
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
          onFilesDropped={(files) => setAttachments((previous) => [...previous, ...files])}
          onCompositionChange={setComposerComposing}
          onOpenAutomation={() => setView("automation")}
          onOpenFile={openPreview}
          onOpenLink={openPreviewLink}
          onPickFiles={pickFiles}
        onModelChange={(value) => updateConfigField("activeModelId", value)}
        onRemoveAttachment={removeAttachment}
        onRemoveSelectedSkill={() => setSelectedComposerSkill(null)}
        onSelectSlashSkill={selectComposerSkill}
        onSend={sendMessageWithSkills}
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
          view={view}
          workspaceIssue={workspaceIssue}
          onArchiveThread={archiveThread}
          onCreateThread={createThread}
          onDeleteThread={deleteThreadImmediately}
          onOpenThread={openThread}
          onRefreshThreadList={refreshThreadList}
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
