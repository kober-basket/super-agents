import { useEffect, useMemo, useReducer, useRef } from "react";

import { getActiveModelOption, getSelectableModels } from "../../lib/model-config";
import { workspaceClient } from "../../services/workspace-client";
import type {
  AppConfig,
  BootstrapPayload,
  FileDropEntry,
  McpServerStatus,
  PendingQuestion,
  RuntimeSkill,
  SkillConfig,
  ThreadRecord,
  ThreadSummary,
} from "../../types";
import { displayThreadTitle } from "../shared/utils";
import type {
  ComposerSkill,
  SessionStatus,
  SkillMessageMarker,
  SkillPromptMeta,
  WorkspaceSnapshot,
} from "./types";
import {
  LEGACY_SKILL_MESSAGE_MARKER_KEYS,
  LEGACY_WORKSPACE_SNAPSHOT_KEYS,
  SKILL_MESSAGE_MARKERS_KEY,
  WORKSPACE_SNAPSHOT_KEY,
  buildSkillPrompt,
  cloneConfig,
  createOptimisticThread,
  formatErrorMessage,
  markThreadRequestFailed,
  normalizeConfig,
  normalizeSkillToken,
  parseSlashSkillCommand,
  readJsonStorageFromKeys,
  shouldKeepLocalThreadOverride,
  sortThreadSummaries,
  summarizeThreadRecord,
  wait,
  workspaceLabel,
  writeJsonStorage,
} from "./utils";

type SessionState = {
  config: AppConfig;
  threads: ThreadSummary[];
  activeThreadId: string;
  threadCache: Record<string, ThreadRecord>;
  composer: string;
  attachments: FileDropEntry[];
  composerComposing: boolean;
  dragActive: boolean;
  workspaceIssue: string | null;
  availableSkills: RuntimeSkill[];
  mcpStatuses: McpServerStatus[];
  selectedComposerSkill: ComposerSkill | null;
  skillMessageMarkers: Record<string, SkillMessageMarker>;
  pendingQuestions: PendingQuestion[];
  status: SessionStatus;
};

type SessionAction =
  | { type: "workspace/hydrate"; payload: BootstrapPayload & { currentThread: ThreadRecord; threads: ThreadSummary[] } }
  | { type: "workspace/issue"; payload: string | null }
  | { type: "config/set"; payload: AppConfig }
  | { type: "thread/remember"; payload: ThreadRecord }
  | { type: "threads/set"; payload: ThreadSummary[] }
  | { type: "thread/remove"; payload: string }
  | { type: "composer/set"; payload: string }
  | { type: "composer/clear" }
  | { type: "attachments/set"; payload: FileDropEntry[] }
  | { type: "attachments/append"; payload: FileDropEntry[] }
  | { type: "attachment/remove"; payload: string }
  | { type: "composer/composing"; payload: boolean }
  | { type: "drag/set"; payload: boolean }
  | { type: "composerSkill/set"; payload: ComposerSkill | null }
  | { type: "skillMarkers/set"; payload: Record<string, SkillMessageMarker> }
  | { type: "status/merge"; payload: Partial<SessionStatus> };

function createInitialState(snapshot: WorkspaceSnapshot | null): SessionState {
  return {
    config: normalizeConfig(snapshot?.config),
    threads: snapshot?.threads ?? [],
    activeThreadId: snapshot?.activeThreadId ?? "",
    threadCache: snapshot?.currentThread ? { [snapshot.currentThread.id]: snapshot.currentThread } : {},
    composer: "",
    attachments: [],
    composerComposing: false,
    dragActive: false,
    workspaceIssue: null,
    availableSkills: snapshot?.availableSkills ?? [],
    mcpStatuses: snapshot?.mcpStatuses ?? [],
    selectedComposerSkill: null,
    skillMessageMarkers:
      readJsonStorageFromKeys<Record<string, SkillMessageMarker>>([
        SKILL_MESSAGE_MARKERS_KEY,
        ...LEGACY_SKILL_MESSAGE_MARKER_KEYS,
      ]) ?? {},
    pendingQuestions: snapshot?.pendingQuestions ?? [],
    status: {
      bootstrapping: true,
      creatingThread: false,
      refreshingThreads: false,
      openingThreadId: null,
      mutatingThreadId: null,
      sending: false,
    },
  };
}

function upsertThread(threadCache: Record<string, ThreadRecord>, threads: ThreadSummary[], thread: ThreadRecord) {
  const summary = summarizeThreadRecord(thread);
  const nextThreads = threads.filter((item) => item.id !== summary.id);
  nextThreads.push(summary);

  return {
    threadCache: {
      ...threadCache,
      [thread.id]: thread,
    },
    threads: sortThreadSummaries(nextThreads),
  };
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "workspace/hydrate":
      return {
        ...state,
        config: normalizeConfig(action.payload.config),
        threads: action.payload.threads,
        activeThreadId: action.payload.activeThreadId,
        threadCache: {
          ...state.threadCache,
          [action.payload.currentThread.id]: action.payload.currentThread,
        },
        availableSkills: action.payload.availableSkills,
        mcpStatuses: action.payload.mcpStatuses,
        pendingQuestions: action.payload.pendingQuestions,
        workspaceIssue: null,
        status: {
          ...state.status,
          bootstrapping: false,
          creatingThread: false,
          refreshingThreads: false,
          openingThreadId: null,
          mutatingThreadId: null,
        },
      };
    case "workspace/issue":
      return { ...state, workspaceIssue: action.payload };
    case "config/set":
      return { ...state, config: action.payload };
    case "thread/remember": {
      const next = upsertThread(state.threadCache, state.threads, action.payload);
      return { ...state, threadCache: next.threadCache, threads: next.threads };
    }
    case "threads/set":
      return { ...state, threads: sortThreadSummaries(action.payload) };
    case "thread/remove": {
      const nextCache = { ...state.threadCache };
      delete nextCache[action.payload];
      return {
        ...state,
        threadCache: nextCache,
        threads: state.threads.filter((thread) => thread.id !== action.payload),
      };
    }
    case "composer/set":
      return { ...state, composer: action.payload };
    case "composer/clear":
      return { ...state, composer: "", attachments: [] };
    case "attachments/set":
      return { ...state, attachments: action.payload };
    case "attachments/append":
      return { ...state, attachments: [...state.attachments, ...action.payload] };
    case "attachment/remove":
      return { ...state, attachments: state.attachments.filter((item) => item.id !== action.payload) };
    case "composer/composing":
      return { ...state, composerComposing: action.payload };
    case "drag/set":
      return { ...state, dragActive: action.payload };
    case "composerSkill/set":
      return { ...state, selectedComposerSkill: action.payload };
    case "skillMarkers/set":
      return { ...state, skillMessageMarkers: action.payload };
    case "status/merge":
      return { ...state, status: { ...state.status, ...action.payload } };
    default:
      return state;
  }
}

type UseSessionControllerOptions = {
  onOpenChat: () => void;
  onToast: (message: string) => void;
};

export function useSessionController({ onOpenChat, onToast }: UseSessionControllerOptions) {
  const initialSnapshotRef = useRef<WorkspaceSnapshot | null>(
    readJsonStorageFromKeys<WorkspaceSnapshot>([WORKSPACE_SNAPSHOT_KEY, ...LEGACY_WORKSPACE_SNAPSHOT_KEYS]),
  );
  const [state, dispatch] = useReducer(sessionReducer, initialSnapshotRef.current, createInitialState);
  const messageListRef = useRef<HTMLDivElement>(null);
  const pendingConfigSaveRef = useRef<number | null>(null);
  const configSaveVersionRef = useRef(0);
  const skillMessageMarkersRef = useRef(state.skillMessageMarkers);
  const localThreadOverridesRef = useRef<Record<string, ThreadRecord>>({});

  const activeThread = state.threadCache[state.activeThreadId] ?? null;
  const activeSummary = useMemo(
    () => state.threads.find((thread) => thread.id === state.activeThreadId) ?? null,
    [state.activeThreadId, state.threads],
  );
  const activeThreads = useMemo(() => state.threads.filter((thread) => !thread.archived), [state.threads]);
  const archivedThreads = useMemo(() => state.threads.filter((thread) => thread.archived), [state.threads]);
  const activeModel = useMemo(
    () => getActiveModelOption(state.config.modelProviders, state.config.activeModelId),
    [state.config.activeModelId, state.config.modelProviders],
  );
  const selectableModels = useMemo(() => getSelectableModels(state.config.modelProviders), [state.config.modelProviders]);
  const composerModelId = selectableModels.some((item) => item.id === state.config.activeModelId)
    ? state.config.activeModelId
    : selectableModels[0]?.id ?? "";
  const hasAvailableModel = Boolean(activeModel && composerModelId);
  const mcpStatusMap = useMemo(
    () => Object.fromEntries(state.mcpStatuses.map((item) => [item.name, item])) as Record<string, McpServerStatus>,
    [state.mcpStatuses],
  );
  const currentWorkspacePath =
    activeThread?.workspaceRoot || activeSummary?.workspaceRoot || state.config.opencodeRoot || "";
  const currentWorkspaceLabel = workspaceLabel(currentWorkspacePath);
  const title = displayThreadTitle(activeSummary?.title || activeThread?.title || "New Thread");

  const composerSkillOptions = useMemo(() => {
    const installed = state.config.skills
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
    const discovered = state.availableSkills
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
  }, [state.availableSkills, state.config.skills]);

  const composerSkillOptionsById = useMemo(
    () => new Map(composerSkillOptions.map((skill) => [skill.id, skill] as const)),
    [composerSkillOptions],
  );

  const installedSkillMap = useMemo(
    () =>
      new Map(
        state.config.skills.flatMap((skill) => {
          const entries: Array<readonly [string, SkillConfig]> = [];
          const nameKey = normalizeSkillToken(skill.name);
          const idKey = normalizeSkillToken(skill.id);
          if (nameKey) entries.push([nameKey, skill] as const);
          if (idKey && idKey !== nameKey) entries.push([idKey, skill] as const);
          return entries;
        }),
      ),
    [state.config.skills],
  );

  const referenceSkillMap = useMemo(
    () =>
      new Map(
        state.availableSkills.flatMap((skill) => {
          const entries: Array<readonly [string, RuntimeSkill]> = [];
          const nameKey = normalizeSkillToken(skill.name);
          const idKey = normalizeSkillToken(skill.id);
          if (nameKey) entries.push([nameKey, skill] as const);
          if (idKey && idKey !== nameKey) entries.push([idKey, skill] as const);
          return entries;
        }),
      ),
    [state.availableSkills],
  );

  const slashSkillSuggestions = useMemo(() => {
    if (state.selectedComposerSkill) return [];

    const match = state.composer.match(/^\/([^\s]*)$/);
    if (!match) return [];

    const query = normalizeSkillToken(match[1] ?? "");
    const merged = new Map<string, ComposerSkill>();

    for (const skill of state.config.skills) {
      if (skill.enabled === false) continue;
      merged.set(normalizeSkillToken(skill.name || skill.id), {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        kind: skill.kind,
        source: "installed",
        enabled: true,
      });
    }

    for (const skill of state.availableSkills) {
      const key = normalizeSkillToken(skill.name || skill.id);
      if (!merged.has(key)) {
        merged.set(key, {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          kind: "reference",
          source: "reference",
          enabled: true,
        });
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
  }, [state.availableSkills, state.composer, state.config.skills, state.selectedComposerSkill]);

  function decorateThread(thread: ThreadRecord): ThreadRecord {
    return {
      ...thread,
      messages: thread.messages.map((message) => {
        const marker = skillMessageMarkersRef.current[message.id];
        if (!marker) return message;
        return { ...message, text: marker.displayText, skillName: marker.skillName };
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
      pendingQuestions: payload.pendingQuestions,
    } satisfies WorkspaceSnapshot);
  }

  function setSkillMessageMarker(messageId: string, marker: SkillMessageMarker) {
    const nextMarkers = { ...skillMessageMarkersRef.current, [messageId]: marker };
    skillMessageMarkersRef.current = nextMarkers;
    dispatch({ type: "skillMarkers/set", payload: nextMarkers });
  }

  function registerSkillMessage(thread: ThreadRecord, transportText: string, displayText: string, skillName: string) {
    const target = [...thread.messages]
      .reverse()
      .find((message) => message.role === "user" && message.text === transportText);

    if (!target) return decorateThread(thread);

    setSkillMessageMarker(target.id, { displayText, skillName });
    return decorateThread({
      ...thread,
      messages: thread.messages.map((message) =>
        message.id === target.id ? { ...message, text: displayText, skillName } : message,
      ),
    });
  }

  function rememberThread(thread: ThreadRecord) {
    dispatch({ type: "thread/remember", payload: decorateThread(thread) });
  }

  function clearLocalThreadOverride(threadId: string) {
    delete localThreadOverridesRef.current[threadId];
  }

  function rememberLocalThreadOverride(thread: ThreadRecord) {
    const decorated = decorateThread(thread);
    localThreadOverridesRef.current[thread.id] = decorated;
    dispatch({ type: "thread/remember", payload: decorated });
  }

  function preferLocalThreadState(thread: ThreadRecord) {
    const localThread = localThreadOverridesRef.current[thread.id];
    if (!localThread) return decorateThread(thread);

    const incoming = decorateThread(thread);
    if (shouldKeepLocalThreadOverride(localThread, incoming)) {
      return localThread;
    }

    clearLocalThreadOverride(thread.id);
    return incoming;
  }

  function mergeThreadSummariesWithLocalOverrides(items: ThreadSummary[]) {
    const merged = [...items];
    for (const localThread of Object.values(localThreadOverridesRef.current)) {
      const summary = summarizeThreadRecord(localThread);
      const index = merged.findIndex((item) => item.id === summary.id);
      if (index >= 0) merged[index] = summary;
      else merged.push(summary);
    }
    return sortThreadSummaries(merged);
  }

  function applyWorkspacePayload(payload: BootstrapPayload) {
    const currentThread = preferLocalThreadState(payload.currentThread);
    const mergedThreads = mergeThreadSummariesWithLocalOverrides([
      ...payload.threads.filter((thread) => thread.id !== currentThread.id),
      summarizeThreadRecord(currentThread),
    ]);
    const nextPayload = { ...payload, currentThread, threads: mergedThreads } satisfies BootstrapPayload;
    saveWorkspaceSnapshot(nextPayload);
    dispatch({ type: "workspace/hydrate", payload: nextPayload });
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
    skillMessageMarkersRef.current = state.skillMessageMarkers;
    writeJsonStorage(SKILL_MESSAGE_MARKERS_KEY, state.skillMessageMarkers);
  }, [state.skillMessageMarkers]);

  useEffect(() => {
    if (!state.selectedComposerSkill) return;
    if (state.composer.trim().startsWith("/")) {
      dispatch({ type: "composerSkill/set", payload: null });
    }
  }, [state.composer, state.selectedComposerSkill]);

  useEffect(() => {
    if (!messageListRef.current) return;
    messageListRef.current.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeThread?.messages.length, state.activeThreadId]);

  useEffect(() => {
    return () => {
      if (pendingConfigSaveRef.current) {
        window.clearTimeout(pendingConfigSaveRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = workspaceClient.onWorkspaceChanged((payload) => {
      if (mounted) applyWorkspacePayload(payload);
    });

    void bootstrapWorkspace()
      .then((payload) => {
        if (mounted) applyWorkspacePayload(payload);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = formatErrorMessage(error, "Workspace bootstrap failed");
        dispatch({ type: "workspace/issue", payload: message });
        dispatch({ type: "status/merge", payload: { bootstrapping: false } });
        onToast(message);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function refreshWorkspaceSnapshot(message?: string) {
    try {
      const payload = await workspaceClient.bootstrap();
      applyWorkspacePayload(payload);
      if (message) onToast(message);
    } catch (error) {
      const nextMessage = formatErrorMessage(error, "Refresh failed");
      dispatch({ type: "workspace/issue", payload: nextMessage });
      onToast(nextMessage);
    }
  }

  async function refreshThreadList() {
    dispatch({ type: "status/merge", payload: { refreshingThreads: true } });
    try {
      dispatch({
        type: "threads/set",
        payload: mergeThreadSummariesWithLocalOverrides(await workspaceClient.listThreads()),
      });
      dispatch({ type: "workspace/issue", payload: null });
    } catch (error) {
      const message = formatErrorMessage(error, "Refresh thread list failed");
      dispatch({ type: "workspace/issue", payload: message });
      onToast(message);
    } finally {
      dispatch({ type: "status/merge", payload: { refreshingThreads: false } });
    }
  }

  async function createThread() {
    dispatch({ type: "status/merge", payload: { creatingThread: true } });
    try {
      const payload = await workspaceClient.createThread();
      applyWorkspacePayload(payload);
      dispatch({ type: "composer/clear" });
      onOpenChat();
      onToast("Thread created");
    } catch (error) {
      const message = formatErrorMessage(error, "Create thread failed");
      dispatch({ type: "workspace/issue", payload: message });
      onToast(message);
    } finally {
      dispatch({ type: "status/merge", payload: { creatingThread: false } });
    }
  }

  async function openThread(threadId: string) {
    dispatch({ type: "status/merge", payload: { openingThreadId: threadId } });
    try {
      const thread = decorateThread(await workspaceClient.setActiveThread(threadId));
      dispatch({ type: "thread/remember", payload: thread });
      dispatch({
        type: "workspace/hydrate",
        payload: {
          config: state.config,
          threads: state.threads,
          activeThreadId: thread.id,
          currentThread: thread,
          availableSkills: state.availableSkills,
          availableAgents: [],
          mcpStatuses: state.mcpStatuses,
          pendingQuestions: state.pendingQuestions,
        },
      });
      await refreshThreadList();
      dispatch({ type: "workspace/issue", payload: null });
      onOpenChat();
    } catch (error) {
      const message = formatErrorMessage(error, "Open thread failed");
      dispatch({ type: "workspace/issue", payload: message });
      onToast(message);
    } finally {
      dispatch({ type: "status/merge", payload: { openingThreadId: null } });
    }
  }

  async function archiveThread(thread: ThreadSummary, archived: boolean) {
    dispatch({ type: "status/merge", payload: { mutatingThreadId: thread.id } });
    try {
      const payload = await workspaceClient.archiveThread(thread.id, archived);
      applyWorkspacePayload(payload);
      if (thread.id === state.activeThreadId && archived) {
        dispatch({ type: "composer/clear" });
      }
      onToast(archived ? `Archived ${displayThreadTitle(thread.title)}` : `Restored ${displayThreadTitle(thread.title)}`);
    } catch (error) {
      onToast(formatErrorMessage(error, archived ? "Archive thread failed" : "Restore thread failed"));
    } finally {
      dispatch({ type: "status/merge", payload: { mutatingThreadId: null } });
    }
  }

  async function deleteThread(thread: ThreadSummary) {
    dispatch({ type: "status/merge", payload: { mutatingThreadId: thread.id } });
    try {
      const payload = await workspaceClient.deleteThread(thread.id);
      applyWorkspacePayload(payload);
      dispatch({ type: "thread/remove", payload: thread.id });
      if (thread.id === state.activeThreadId) {
        dispatch({ type: "composer/clear" });
      }
      onToast(`Deleted ${displayThreadTitle(thread.title)}`);
    } catch (error) {
      onToast(formatErrorMessage(error, "Delete thread failed"));
    } finally {
      dispatch({ type: "status/merge", payload: { mutatingThreadId: null } });
    }
  }

  async function sendPlainMessage(message: string, nextAttachments: FileDropEntry[], skillMeta?: SkillPromptMeta) {
    const optimisticThread = createOptimisticThread({
      activeThread,
      activeThreadId: state.activeThreadId,
      activeSummary,
      message,
      attachments: nextAttachments,
      skillMeta,
    });

    rememberLocalThreadOverride(optimisticThread);
    dispatch({ type: "composer/clear" });
    dispatch({ type: "status/merge", payload: { sending: true } });

    try {
      const result = await workspaceClient.sendMessage({
        threadId: state.activeThreadId,
        message,
        attachments: nextAttachments,
      });
      const nextThread = skillMeta
        ? registerSkillMessage(result.thread, message, skillMeta.displayText, skillMeta.skillName)
        : decorateThread(result.thread);
      const localOverride = localThreadOverridesRef.current[result.thread.id];

      if (localOverride && shouldKeepLocalThreadOverride(localOverride, nextThread)) {
        rememberLocalThreadOverride(localOverride);
      } else {
        clearLocalThreadOverride(result.thread.id);
        rememberThread(nextThread);
      }
      await refreshThreadList();
      if (result.knowledge?.warnings?.length) {
        onToast(result.knowledge.warnings[0]);
      } else if (result.knowledge?.injected) {
        onToast(`Injected ${result.knowledge.resultCount} knowledge snippets`);
      }
    } catch (error) {
      const nextMessage = formatErrorMessage(error, "Send message failed");
      rememberLocalThreadOverride(markThreadRequestFailed(optimisticThread, nextMessage));
      onToast(nextMessage);
    } finally {
      dispatch({ type: "status/merge", payload: { sending: false } });
    }
  }

  async function executeCommandSkill(
    skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">,
    promptOverride?: string,
  ) {
    if (!state.activeThreadId) return;
    if (!hasAvailableModel) {
      onToast("当前没有可用模型，请先在设置里配置并启用模型。");
      return;
    }
    if (skill.enabled === false) {
      onToast("Enable this skill first");
      return;
    }

    try {
      const result = await workspaceClient.runSkill({
        threadId: state.activeThreadId,
        skillId: skill.id,
        prompt: promptOverride?.trim() || state.composer.trim() || skill.description,
      });
      rememberThread(result.thread);
      await refreshThreadList();
      onOpenChat();
      onToast(`Ran ${skill.name}`);
    } catch (error) {
      onToast(formatErrorMessage(error, "Run skill failed"));
    }
  }

  async function sendMessageWithSkills() {
    if (
      !state.activeThreadId ||
      state.status.sending ||
      state.composerComposing ||
      (!state.composer.trim() && state.attachments.length === 0)
    ) {
      return;
    }

    if (!hasAvailableModel) {
      onToast("当前没有可用模型，请先在设置里配置并启用模型。");
      return;
    }

    const nextMessage = state.composer.trim();
    const nextAttachments = state.attachments;
    const composerSkill = state.selectedComposerSkill;
    const slashCommand = parseSlashSkillCommand(nextMessage);

    if (!composerSkill && !slashCommand?.skillToken) {
      await sendPlainMessage(nextMessage, nextAttachments);
      return;
    }

    const installedSkill =
      composerSkill?.source === "installed"
        ? state.config.skills.find((skill) => skill.id === composerSkill.id) ?? null
        : slashCommand?.skillToken
          ? installedSkillMap.get(slashCommand.skillToken) ?? null
          : null;

    if (installedSkill) {
      const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";

      if (installedSkill.kind === "codex") {
        dispatch({ type: "composerSkill/set", payload: null });
        await sendPlainMessage(
          buildSkillPrompt(installedSkill.name, installedSkill.description, promptText),
          nextAttachments,
          {
            displayText: promptText || installedSkill.description || "",
            skillName: installedSkill.name,
          },
        );
        onToast(`Sent with /${installedSkill.name}`);
        return;
      }

      if (nextAttachments.length > 0) {
        onToast("Command skills do not support attachments yet");
        return;
      }

      dispatch({ type: "composerSkill/set", payload: null });
      dispatch({ type: "composer/set", payload: "" });
      dispatch({ type: "attachments/set", payload: [] });
      await executeCommandSkill(installedSkill, promptText);
      return;
    }

    const referenceSkill =
      composerSkill?.source === "reference"
        ? state.availableSkills.find((skill) => skill.id === composerSkill.id) ?? null
        : slashCommand?.skillToken
          ? referenceSkillMap.get(slashCommand.skillToken) ?? null
          : null;

    if (referenceSkill) {
      const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
      dispatch({ type: "composerSkill/set", payload: null });
      await sendPlainMessage(
        buildSkillPrompt(referenceSkill.name, referenceSkill.description, promptText),
        nextAttachments,
        {
          displayText: promptText || referenceSkill.description || "",
          skillName: referenceSkill.name,
        },
      );
      onToast(`Sent with /${referenceSkill.name}`);
      return;
    }

    onToast(`Skill not found: /${slashCommand?.skillToken ?? ""}`);
  }

  function useConfiguredCodexSkill(skill: Pick<SkillConfig, "name" | "description">) {
    dispatch({ type: "composer/set", payload: buildSkillPrompt(skill.name, skill.description, state.composer.trim()) });
    onOpenChat();
    onToast(`Loaded ${skill.name} into composer`);
  }

  async function runSkill(skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">) {
    if (!state.activeThreadId) return;
    if (skill.enabled === false) {
      onToast("Enable this skill first");
      return;
    }

    if (skill.kind === "codex") {
      useConfiguredCodexSkill(skill);
      return;
    }

    await executeCommandSkill(skill);
  }

  function prepareSkillDraft(name?: string, description?: string) {
    const nextPrompt = [
      name ? `Help me create a new skill named "${name}".` : "Help me create a new skill.",
      description ? `Goal: ${description}` : "Goal: define the purpose, inputs, outputs, folder structure, and first implementation.",
      "Please make it directly implementable.",
    ]
      .filter(Boolean)
      .join("\n");

    dispatch({ type: "composer/set", payload: nextPrompt });
    onOpenChat();
    onToast("Skill draft prepared");
  }

  function useReferenceSkill(skill: RuntimeSkill) {
    dispatch({ type: "composer/set", payload: buildSkillPrompt(skill.name, skill.description, state.composer.trim()) });
    onOpenChat();
    onToast(`Loaded ${skill.name} into composer`);
  }

  async function uninstallSkill(skill: SkillConfig) {
    try {
      const payload = await workspaceClient.uninstallSkill(skill.id);
      applyWorkspacePayload(payload);
      onToast(`Removed ${skill.name}`);
    } catch (error) {
      onToast(formatErrorMessage(error, "Uninstall skill failed"));
    }
  }

  async function pickFiles() {
    try {
      const files = await workspaceClient.selectFiles();
      if (files.length > 0) {
        dispatch({ type: "attachments/append", payload: files });
      }
    } catch {
      onToast("Read files failed");
    }
  }

  async function openWorkspaceFolder() {
    try {
      await workspaceClient.openWorkspaceFolder(state.activeThreadId || undefined);
    } catch {
      onToast("Open workspace failed");
    }
  }

  async function chooseThreadWorkspace() {
    if (!state.activeThreadId) return;

    try {
      const selected = await workspaceClient.selectWorkspaceFolder();
      if (!selected) return;

      const payload = await workspaceClient.setThreadWorkspace(state.activeThreadId, selected);
      applyWorkspacePayload(payload);
      onToast(`Switched workspace to ${workspaceLabel(selected)}`);
    } catch {
      onToast("Switch workspace failed");
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
      if (mutationVersion !== configSaveVersionRef.current) return;
      applyWorkspacePayload(payload);
      if (message) onToast(message);
    } catch {
      if (mutationVersion !== configSaveVersionRef.current) return;
      onToast("Save settings failed");
    }
  }

  async function commitConfig(next: AppConfig, message = "Settings saved") {
    clearPendingConfigSave();
    const mutationVersion = ++configSaveVersionRef.current;
    dispatch({ type: "config/set", payload: next });
    await persistConfig(next, mutationVersion, message);
  }

  function scheduleConfigPersist(next: AppConfig) {
    clearPendingConfigSave();
    dispatch({ type: "config/set", payload: next });
    const mutationVersion = ++configSaveVersionRef.current;
    pendingConfigSaveRef.current = window.setTimeout(() => {
      pendingConfigSaveRef.current = null;
      void persistConfig(next, mutationVersion);
    }, 320);
  }

  function updateConfigField<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    void commitConfig({ ...cloneConfig(state.config), [key]: value } as AppConfig);
  }

  function appendAttachments(files: FileDropEntry[]) {
    dispatch({ type: "attachments/append", payload: files });
  }

  function setComposer(value: string) {
    dispatch({ type: "composer/set", payload: value });
  }

  function applySuggestion(prompt: string) {
    dispatch({ type: "composer/set", payload: prompt });
  }

  function removeAttachment(id: string) {
    dispatch({ type: "attachment/remove", payload: id });
  }

  function selectComposerSkill(skillId: string) {
    const skill = composerSkillOptionsById.get(skillId);
    if (!skill) return;
    dispatch({ type: "composerSkill/set", payload: skill });
    dispatch({ type: "composer/set", payload: "" });
    onToast(`Selected ${skill.name}`);
  }

  function clearSelectedComposerSkill() {
    dispatch({ type: "composerSkill/set", payload: null });
  }

  async function replyQuestion(requestId: string, sessionId: string, answers: string[][]) {
    try {
      const payload = await workspaceClient.replyQuestion({ requestId, sessionId, answers });
      applyWorkspacePayload(payload);
      onToast("Answer submitted");
    } catch (error) {
      const message = formatErrorMessage(error, "Reply question failed");
      onToast(message);
      throw error;
    }
  }

  async function rejectQuestion(requestId: string, sessionId: string) {
    try {
      const payload = await workspaceClient.rejectQuestion({ requestId, sessionId });
      applyWorkspacePayload(payload);
      onToast("Question rejected");
    } catch (error) {
      const message = formatErrorMessage(error, "Reject question failed");
      onToast(message);
      throw error;
    }
  }

  async function abortThread(threadId = state.activeThreadId) {
    if (!threadId) return;

    clearLocalThreadOverride(threadId);

    try {
      const payload = await workspaceClient.abortThread(threadId);
      applyWorkspacePayload(payload);
      onToast("Current run stopped");
    } catch (error) {
      const message = formatErrorMessage(error, "Stop thread failed");
      onToast(message);
      throw error;
    }
  }

  return {
    activeModel,
    activeSummary,
    activeThread,
    activeThreadId: state.activeThreadId,
    activeThreads,
    applySuggestion,
    appendAttachments,
    archiveThread,
    abortThread,
    archivedThreads,
    attachments: state.attachments,
    availableSkills: state.availableSkills,
    chooseThreadWorkspace,
    clearSelectedComposerSkill,
    commitConfig,
    composer: state.composer,
    composerComposing: state.composerComposing,
    composerModelId,
    config: state.config,
    createThread,
    currentWorkspaceLabel,
    currentWorkspacePath,
    deleteThread,
    dragActive: state.dragActive,
    mcpStatuses: state.mcpStatuses,
    mcpStatusMap,
    messageListRef,
    openThread,
    openWorkspaceFolder,
    pendingQuestions: state.pendingQuestions,
    pickFiles,
    prepareSkillDraft,
    refreshThreadList,
    refreshWorkspaceSnapshot,
    removeAttachment,
    rejectQuestion,
    replyQuestion,
    runSkill,
    scheduleConfigPersist,
    selectableModels,
    selectedComposerSkill: state.selectedComposerSkill,
    selectComposerSkill,
    sendMessageWithSkills,
    sending: state.status.sending,
    setComposer,
    setComposerComposing: (composing: boolean) => dispatch({ type: "composer/composing", payload: composing }),
    setDragActive: (active: boolean) => dispatch({ type: "drag/set", payload: active }),
    slashSkillSuggestions,
    status: state.status,
    title,
    uninstallSkill,
    updateConfigField,
    useReferenceSkill,
    workspaceIssue: state.workspaceIssue,
  };
}
