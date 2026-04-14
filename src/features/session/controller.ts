import { useEffect, useMemo, useReducer, useRef } from "react";

import { getActiveModelOption, getSelectableModels } from "../../lib/model-config";
import { DEFAULT_THREAD_TITLE, formatThreadTitle, isGenericThreadTitle } from "../../lib/thread-title";
import { workspaceClient } from "../../services/workspace-client";
import type {
  AppConfig,
  BootstrapPayload,
  ChatMessage,
  FileDropEntry,
  McpServerStatus,
  PendingQuestion,
  RuntimeSkill,
  SkillConfig,
  ThreadRecord,
  ThreadSummary,
} from "../../types";
import type {
  ComposerSkill,
  SessionStatus,
  SkillMessageMarker,
} from "./types";
import {
  buildSkillPrompt,
  cloneConfig,
  createOptimisticThread,
  formatErrorMessage,
  markThreadRequestFailed,
  normalizeConfig,
  normalizeSkillToken,
  parseSlashSkillCommand,
  readJsonStorageFromKeys,
  LEGACY_SKILL_MESSAGE_MARKER_KEYS,
  LEGACY_WORKSPACE_SNAPSHOT_KEYS,
  SKILL_MESSAGE_MARKERS_KEY,
  shouldKeepLocalThreadOverride,
  WORKSPACE_SNAPSHOT_KEY,
  workspaceLabel,
  writeJsonStorage,
} from "./utils";
import type { WorkspaceSnapshot } from "./types";

// ── state ────────────────────────────────────────────────────────────────────

type SessionState = {
  config: AppConfig;
  composer: string;
  attachments: FileDropEntry[];
  composerComposing: boolean;
  dragActive: boolean;
  availableSkills: RuntimeSkill[];
  mcpStatuses: McpServerStatus[];
  selectedComposerSkill: ComposerSkill | null;
  skillMessageMarkers: Record<string, SkillMessageMarker>;
  // ── session (stub — to be implemented) ───────────────────────────────────
  threads: ThreadSummary[];
  activeThreadId: string;
  activeThread: ThreadRecord | null;
  pendingQuestions: PendingQuestion[];
  drafting: boolean;
  workspaceIssue: string | null;
  status: SessionStatus;
};

type SessionAction =
  | { type: "config/set"; payload: AppConfig }
  | { type: "composer/set"; payload: string }
  | { type: "composer/clear" }
  | { type: "attachments/set"; payload: FileDropEntry[] }
  | { type: "attachments/append"; payload: FileDropEntry[] }
  | { type: "attachment/remove"; payload: string }
  | { type: "composer/composing"; payload: boolean }
  | { type: "drag/set"; payload: boolean }
  | { type: "composerSkill/set"; payload: ComposerSkill | null }
  | { type: "skillMarkers/set"; payload: Record<string, SkillMessageMarker> }
  | { type: "skills/set"; payload: RuntimeSkill[] }
  | { type: "mcpStatuses/set"; payload: McpServerStatus[] }
  | { type: "threads/set"; payload: ThreadSummary[] }
  | { type: "thread/create"; payload: ThreadSummary }
  | { type: "thread/open"; payload: { threadId: string; thread: ThreadRecord } }
  | { type: "thread/archive"; payload: { threadId: string; archived: boolean } }
  | { type: "thread/delete"; payload: string }
  | { type: "pendingQuestions/set"; payload: PendingQuestion[] }
  | { type: "status/set"; payload: Partial<SessionStatus> };

function sortThreadSummaries(threads: ThreadSummary[]) {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

function mergeThreadSummaries(existing: ThreadSummary[], incoming: ThreadSummary[]) {
  const existingById = new Map(existing.map((thread) => [thread.id, thread] as const));

  return sortThreadSummaries(
    incoming.map((thread) => {
      const previous = existingById.get(thread.id);
      if (!previous) {
        return thread;
      }

      return {
        ...thread,
        title:
          isGenericThreadTitle(thread.title) && !isGenericThreadTitle(previous.title)
            ? previous.title
            : thread.title,
        lastMessage: thread.lastMessage?.trim() ? thread.lastMessage : previous.lastMessage,
        messageCount: thread.messageCount > 0 ? thread.messageCount : previous.messageCount,
      };
    }),
  );
}

function upsertThreadSummary(threads: ThreadSummary[], nextThread: ThreadSummary) {
  const existing = threads.some((thread) => thread.id === nextThread.id);
  return sortThreadSummaries(
    existing
      ? threads.map((thread) => (thread.id === nextThread.id ? nextThread : thread))
      : [nextThread, ...threads],
  );
}

function hasLoadingAssistantMessage(thread: Pick<ThreadRecord, "messages"> | null | undefined) {
  return thread?.messages.some((message) => message.role === "assistant" && message.status === "loading") ?? false;
}

function latestStableThreadText(thread: ThreadRecord) {
  return (
    [...thread.messages]
      .reverse()
      .find((message) => message.text.trim() && message.status !== "loading")
      ?.text.trim() ?? ""
  );
}

function summarizeThreadForDisplay(thread: ThreadRecord, previous?: ThreadSummary | null): ThreadSummary {
  const stableLastMessage = latestStableThreadText(thread);
  const loading = hasLoadingAssistantMessage(thread);

  if (loading) {
    return {
      id: thread.id,
      title: previous?.title || formatThreadTitle(thread.title, stableLastMessage || thread.lastMessage),
      updatedAt: previous?.updatedAt ?? thread.updatedAt,
      lastMessage: previous?.lastMessage || stableLastMessage || thread.lastMessage,
      messageCount: Math.max(previous?.messageCount ?? 0, thread.messageCount),
      archived: thread.archived,
      workspaceRoot: thread.workspaceRoot,
    };
  }

  return {
    id: thread.id,
    title: formatThreadTitle(thread.title, stableLastMessage || thread.lastMessage),
    updatedAt: thread.updatedAt,
    lastMessage: stableLastMessage || thread.lastMessage,
    messageCount: thread.messageCount,
    archived: thread.archived,
    workspaceRoot: thread.workspaceRoot,
  };
}

function shouldPreserveLocalThread(localThread: ThreadRecord, incomingThread: ThreadRecord) {
  if (shouldKeepLocalThreadOverride(localThread, incomingThread)) {
    return true;
  }

  if (incomingThread.messages.length < localThread.messages.length) {
    return true;
  }

  const localStableText = latestStableThreadText(localThread);
  const incomingStableText = latestStableThreadText(incomingThread);

  if (localStableText && !incomingStableText) {
    return true;
  }

  if (
    localStableText &&
    incomingStableText &&
    localThread.updatedAt > incomingThread.updatedAt &&
    incomingThread.messages.length <= localThread.messages.length
  ) {
    return true;
  }

  return false;
}

function isAbsoluteAttachmentPath(value: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
}

function isSupportedComposerAttachment(file: FileDropEntry) {
  if (file.dataUrl || file.mimeType.startsWith("image/")) return true;
  if (typeof file.content === "string") return true;
  if (file.url?.startsWith("data:image/") || file.url?.startsWith("data:text/")) return true;
  if (file.mimeType === "application/pdf" || file.name.match(/\.pdf$/i)) return true;
  return false;
}

function describeUnsupportedAttachments(files: FileDropEntry[]) {
  const names = files.slice(0, 3).map((file) => file.name).join("、");
  const suffix = files.length > 3 ? "等文件" : "";
  return `当前暂不支持直接发送这些附件：${names}${suffix}。请转成 PDF、TXT、Markdown，或重新上传可提取文本的 DOCX。`;
}

function createInitialState(snapshot: WorkspaceSnapshot | null): SessionState {
  return {
    config: normalizeConfig(snapshot?.config),
    composer: "",
    attachments: [],
    composerComposing: false,
    dragActive: false,
    availableSkills: snapshot?.availableSkills ?? [],
    mcpStatuses: snapshot?.mcpStatuses ?? [],
    selectedComposerSkill: null,
    skillMessageMarkers:
      readJsonStorageFromKeys<Record<string, SkillMessageMarker>>([
        SKILL_MESSAGE_MARKERS_KEY,
        ...LEGACY_SKILL_MESSAGE_MARKER_KEYS,
      ]) ?? {},
    threads: snapshot?.threads ?? [],
    activeThreadId: snapshot?.activeThreadId ?? "",
    activeThread: snapshot?.currentThread ?? null,
    pendingQuestions: snapshot?.pendingQuestions ?? [],
    drafting: false,
    workspaceIssue: null,
    status: {
      bootstrapping: false,
      creatingThread: false,
      refreshingThreads: false,
      openingThreadId: null,
      mutatingThreadId: null,
      sending: false,
    },
  };
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "config/set":
      return { ...state, config: action.payload };
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
    case "skills/set":
      return { ...state, availableSkills: action.payload };
    case "mcpStatuses/set":
      return { ...state, mcpStatuses: action.payload };
    case "threads/set":
      return { ...state, threads: mergeThreadSummaries(state.threads, action.payload) };
    case "thread/create":
      return {
        ...state,
        threads: upsertThreadSummary(state.threads, action.payload),
        activeThreadId: action.payload.id,
        activeThread: { ...action.payload, messages: [] },
        status: { ...state.status, creatingThread: false },
      };
    case "thread/open": {
      const openedThread = action.payload.thread;
      // Draft thread (empty id) — just set active state, don't touch threads list
      if (!openedThread.id) {
        return {
          ...state,
          activeThreadId: "",
          activeThread: openedThread,
          status: { ...state.status, openingThreadId: null },
        };
      }
      const previousSummary = state.threads.find((thread) => thread.id === openedThread.id) ?? null;
      const updatedSummary = summarizeThreadForDisplay(openedThread, previousSummary);
      return {
        ...state,
        activeThreadId: action.payload.threadId,
        activeThread: openedThread,
        threads: upsertThreadSummary(state.threads, updatedSummary),
        status: { ...state.status, openingThreadId: null },
      };
    }
    case "thread/archive":
      return {
        ...state,
        threads: sortThreadSummaries(
          state.threads.map((t) =>
            t.id === action.payload.threadId ? { ...t, archived: action.payload.archived } : t,
          ),
        ),
        status: { ...state.status, mutatingThreadId: null },
      };
    case "thread/delete":
      return {
        ...state,
        threads: state.threads.filter((t) => t.id !== action.payload),
        activeThreadId: state.activeThreadId === action.payload ? "" : state.activeThreadId,
        activeThread: state.activeThreadId === action.payload ? null : state.activeThread,
        status: { ...state.status, mutatingThreadId: null },
      };
    case "pendingQuestions/set":
      return { ...state, pendingQuestions: action.payload };
    case "status/set":
      return { ...state, status: { ...state.status, ...action.payload } };
    default:
      return state;
  }
}

// ── hook ─────────────────────────────────────────────────────────────────────

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
  const latestBootstrapRef = useRef(0);
  const skillMessageMarkersRef = useRef(state.skillMessageMarkers);
  const stateRef = useRef(state);
  const threadRunVersionRef = useRef(new Map<string, number>());
  const stoppingThreadsRef = useRef(new Map<string, number>());
  stateRef.current = state;

  function bumpThreadRunVersion(threadId: string) {
    const nextVersion = (threadRunVersionRef.current.get(threadId) ?? 0) + 1;
    threadRunVersionRef.current.set(threadId, nextVersion);
    return nextVersion;
  }

  function isLatestThreadRun(threadId: string, version: number) {
    return (threadRunVersionRef.current.get(threadId) ?? 0) === version;
  }

  function clearThreadStopping(threadId?: string) {
    if (!threadId) return;
    stoppingThreadsRef.current.delete(threadId);
  }

  function isThreadStopping(threadId?: string) {
    if (!threadId) return false;
    const startedAt = stoppingThreadsRef.current.get(threadId);
    if (!startedAt) return false;
    if (Date.now() - startedAt > 5_000) {
      stoppingThreadsRef.current.delete(threadId);
      return false;
    }
    return true;
  }

  function markThreadStopping(threadId: string) {
    stoppingThreadsRef.current.set(threadId, Date.now());
    bumpThreadRunVersion(threadId);
  }

  function beginThreadRun(threadId: string) {
    clearThreadStopping(threadId);
    return bumpThreadRunVersion(threadId);
  }

  function normalizeThreadForDisplay(thread: ThreadRecord, threadId = thread.id) {
    if (!isThreadStopping(threadId)) {
      return thread;
    }

    let changed = false;
    const messages = thread.messages.map((message) => {
      if (message.status !== "loading") {
        return message;
      }
      changed = true;
      return { ...message, status: "paused" as const };
    });

    if (!changed) {
      clearThreadStopping(threadId);
      return thread;
    }

    return {
      ...thread,
      messages,
    };
  }

  function syncThreadStateRef(threadId: string, thread: ThreadRecord) {
    const previousSummary = stateRef.current.threads.find((item) => item.id === thread.id) ?? null;
    const updatedSummary = summarizeThreadForDisplay(thread, previousSummary);

    stateRef.current = {
      ...stateRef.current,
      activeThreadId: threadId,
      activeThread: thread,
      threads: upsertThreadSummary(stateRef.current.threads, updatedSummary),
    };
  }

  function openOptimisticThread(input: {
    threadId: string;
    baseThread?: ThreadRecord | null;
    message: string;
    attachments: FileDropEntry[];
    skillName?: string;
  }) {
    const optimisticThread = createOptimisticThread({
      activeThread:
        input.baseThread ??
        (stateRef.current.activeThread?.id === input.threadId ? stateRef.current.activeThread : null),
      activeThreadId: input.threadId,
      activeSummary: stateRef.current.threads.find((thread) => thread.id === input.threadId) ?? null,
      message: input.message,
      attachments: input.attachments,
      skillMeta: input.skillName
        ? {
            displayText: input.message,
            skillName: input.skillName,
          }
        : undefined,
    });

    dispatch({
      type: "thread/open",
      payload: {
        threadId: input.threadId,
        thread: optimisticThread,
      },
    });
    syncThreadStateRef(input.threadId, optimisticThread);
    return optimisticThread;
  }

  function handleSendFailure(threadId: string | null, error: unknown, fallback: string) {
    if (threadId && isThreadStopping(threadId)) {
      return;
    }

    const errorMessage = formatErrorMessage(error, fallback);
    const activeThread = threadId && stateRef.current.activeThread?.id === threadId
      ? stateRef.current.activeThread
      : null;

    if (threadId && activeThread) {
      const failedThread = markThreadRequestFailed(activeThread, errorMessage);
      dispatch({
        type: "thread/open",
        payload: {
          threadId,
          thread: failedThread,
        },
      });
      syncThreadStateRef(threadId, failedThread);
    }

    onToast(errorMessage);
  }

  function applyThreadSnapshot(threadId: string, thread: ThreadRecord) {
    const hadLoadingBeforeNormalize = thread.messages.some((item) => item.status === "loading");
    const normalizedThread = normalizeThreadForDisplay(thread, threadId);
    const localActiveThread =
      stateRef.current.activeThread?.id === threadId ? stateRef.current.activeThread : null;
    const effectiveThread =
      localActiveThread && shouldPreserveLocalThread(localActiveThread, normalizedThread)
        ? {
            ...normalizedThread,
            updatedAt: Math.max(normalizedThread.updatedAt, localActiveThread.updatedAt),
            lastMessage: localActiveThread.lastMessage || normalizedThread.lastMessage,
            messageCount: Math.max(normalizedThread.messageCount, localActiveThread.messageCount),
            messages: localActiveThread.messages,
          }
        : normalizedThread;

    dispatch({ type: "thread/open", payload: { threadId, thread: effectiveThread } });
    syncThreadStateRef(threadId, effectiveThread);
    if (!effectiveThread.messages.some((item) => item.status === "loading")) {
      dispatch({ type: "status/set", payload: { sending: false } });
      if (!hadLoadingBeforeNormalize) {
        clearThreadStopping(threadId);
      }
    }
    return effectiveThread;
  }

  async function prepareComposerAttachments(files: FileDropEntry[]) {
    const localPaths = Array.from(
      new Set(
        files
          .filter((file) => !file.content && !file.dataUrl && !file.url)
          .map((file) => file.path)
          .filter((filePath): filePath is string => Boolean(filePath) && isAbsoluteAttachmentPath(filePath)),
      ),
    );

    if (localPaths.length === 0) {
      return files;
    }

    const prepared = await workspaceClient.prepareAttachments(localPaths);
    const preparedByPath = new Map(prepared.map((file) => [file.path, file] as const));

    return files.map((file) => {
      if (!isAbsoluteAttachmentPath(file.path)) {
        return file;
      }
      return preparedByPath.get(file.path) ?? file;
    });
  }

  function validateComposerAttachments(files: FileDropEntry[]) {
    const unsupported = files.filter((file) => !isSupportedComposerAttachment(file));
    if (unsupported.length > 0) {
      onToast(describeUnsupportedAttachments(unsupported));
      return false;
    }
    return true;
  }

  // ── derived ────────────────────────────────────────────────────────────────

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
  const activeThreads = useMemo(() => state.threads.filter((t) => !t.archived), [state.threads]);
  const archivedThreads = useMemo(() => state.threads.filter((t) => t.archived), [state.threads]);
  const activeSummary = useMemo(
    () => state.threads.find((t) => t.id === state.activeThreadId) ?? null,
    [state.activeThreadId, state.threads],
  );
  const currentWorkspacePath =
    state.activeThread?.workspaceRoot || activeSummary?.workspaceRoot || state.config.opencodeRoot || "";
  const currentWorkspaceLabel = workspaceLabel(currentWorkspacePath);
  const title = formatThreadTitle(
    activeSummary?.title || state.activeThread?.title,
    state.activeThread?.lastMessage || activeSummary?.lastMessage,
  );

  const composerSkillOptionsById = useMemo(() => {
    const installed = state.config.skills
      .filter((skill) => skill.enabled !== false)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        kind: skill.kind,
        source: "installed" as const,
        enabled: true,
      } satisfies ComposerSkill));

    const knownNames = new Set(installed.map((s) => normalizeSkillToken(s.name || s.id)));
    const discovered = state.availableSkills
      .filter((s) => !knownNames.has(normalizeSkillToken(s.name || s.id)))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        kind: "reference" as const,
        source: "reference" as const,
        enabled: true,
      } satisfies ComposerSkill));

    return new Map([...installed, ...discovered].map((s) => [s.id, s] as const));
  }, [state.availableSkills, state.config.skills]);

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
        id: skill.id, name: skill.name, description: skill.description,
        kind: skill.kind, source: "installed", enabled: true,
      });
    }
    for (const skill of state.availableSkills) {
      const key = normalizeSkillToken(skill.name || skill.id);
      if (!merged.has(key)) {
        merged.set(key, {
          id: skill.id, name: skill.name, description: skill.description,
          kind: "reference", source: "reference", enabled: true,
        });
      }
    }
    return Array.from(merged.values())
      .filter((s) => !query || [s.name, s.id, s.description].some((v) => normalizeSkillToken(v ?? "").includes(query)))
      .slice(0, 8);
  }, [state.availableSkills, state.composer, state.config.skills, state.selectedComposerSkill]);

  // ── effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    skillMessageMarkersRef.current = state.skillMessageMarkers;
    writeJsonStorage(SKILL_MESSAGE_MARKERS_KEY, state.skillMessageMarkers);
  }, [state.skillMessageMarkers]);

  useEffect(() => {
    writeJsonStorage(WORKSPACE_SNAPSHOT_KEY, {
      config: state.config,
      threads: state.threads,
      activeThreadId: state.activeThreadId,
      currentThread: state.activeThread,
      availableSkills: state.availableSkills,
      mcpStatuses: state.mcpStatuses,
      pendingQuestions: state.pendingQuestions,
    } satisfies WorkspaceSnapshot);
  }, [
    state.activeThread,
    state.activeThreadId,
    state.availableSkills,
    state.config,
    state.mcpStatuses,
    state.pendingQuestions,
    state.threads,
  ]);

  useEffect(() => {
    if (!state.selectedComposerSkill) return;
    if (state.composer.trim().startsWith("/")) {
      dispatch({ type: "composerSkill/set", payload: null });
    }
  }, [state.composer, state.selectedComposerSkill]);

  useEffect(() => {
    return () => {
      if (pendingConfigSaveRef.current) {
        window.clearTimeout(pendingConfigSaveRef.current);
      }
    };
  }, []);

  // ── config ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    return workspaceClient.onWorkspaceChanged((payload) => {
      applyBootstrapPayload(payload);
    });
  }, []);

  const activeThreadHasLoading = useMemo(
    () => hasLoadingAssistantMessage(state.activeThread),
    [state.activeThread],
  );

  useEffect(() => {
    const threadId = state.activeThreadId;
    if (!threadId || (!state.status.sending && !activeThreadHasLoading)) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const thread = await workspaceClient.getThread(threadId);
        if (cancelled || stateRef.current.activeThreadId !== threadId) {
          return;
        }

        applyThreadSnapshot(threadId, thread);
      } catch {
        // Keep the active thread responsive even if one poll fails.
      }

      if (cancelled || stateRef.current.activeThreadId !== threadId) {
        return;
      }

      const shouldContinue =
        stateRef.current.status.sending || hasLoadingAssistantMessage(stateRef.current.activeThread);
      if (!shouldContinue) {
        return;
      }

      timer = window.setTimeout(() => {
        void poll();
      }, 700);
    };

    timer = window.setTimeout(() => {
      void poll();
    }, state.status.sending && !activeThreadHasLoading ? 250 : 500);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeThreadHasLoading, state.activeThreadId, state.status.sending]);

  useEffect(() => {
    dispatch({ type: "status/set", payload: { bootstrapping: true } });
    void refreshWorkspaceSnapshot().finally(() => {
      dispatch({ type: "status/set", payload: { bootstrapping: false } });
    });
  }, []);

  function applyBootstrapPayload(payload: BootstrapPayload, message?: string) {
    if (payload.snapshotAt < latestBootstrapRef.current) {
      return;
    }
    latestBootstrapRef.current = payload.snapshotAt;

    const stabilizedThreads = payload.currentThread
      ? payload.threads.map((thread) =>
          thread.id === payload.currentThread!.id
            ? summarizeThreadForDisplay(
                payload.currentThread!,
                stateRef.current.threads.find((item) => item.id === thread.id) ?? thread,
              )
            : thread,
        )
      : payload.threads;

    dispatch({ type: "config/set", payload: payload.config });
    dispatch({ type: "skills/set", payload: payload.availableSkills });
    dispatch({ type: "mcpStatuses/set", payload: payload.mcpStatuses });
    dispatch({ type: "threads/set", payload: stabilizedThreads });
    dispatch({ type: "pendingQuestions/set", payload: payload.pendingQuestions });

    if (payload.currentThread) {
      const threadId = payload.activeThreadId || payload.currentThread.id;
      applyThreadSnapshot(threadId, payload.currentThread);
    }

    if (message) {
      onToast(message);
    }
  }

  async function ensureBackendThread() {
    const existingThreadId = stateRef.current.activeThreadId;
    if (existingThreadId) {
      return {
        threadId: existingThreadId,
        thread: stateRef.current.activeThread,
      };
    }

    const payload = await workspaceClient.createThread(DEFAULT_THREAD_TITLE);
    applyBootstrapPayload(payload);
    return {
      threadId: payload.activeThreadId,
      thread: payload.currentThread,
    };
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
      dispatch({ type: "config/set", payload: payload.config });
      dispatch({ type: "skills/set", payload: payload.availableSkills });
      dispatch({ type: "mcpStatuses/set", payload: payload.mcpStatuses });
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

  // ── skills ─────────────────────────────────────────────────────────────────

  async function refreshWorkspaceSnapshot(message?: string) {
    try {
      const payload = await workspaceClient.bootstrap();
      applyBootstrapPayload(payload, message);
    } catch (error) {
      onToast(formatErrorMessage(error, "Refresh failed"));
    }
  }

  async function uninstallSkill(skill: SkillConfig) {
    try {
      const payload = await workspaceClient.uninstallSkill(skill.id);
      dispatch({ type: "config/set", payload: payload.config });
      dispatch({ type: "skills/set", payload: payload.availableSkills });
      onToast(`Removed ${skill.name}`);
    } catch (error) {
      onToast(formatErrorMessage(error, "Uninstall skill failed"));
    }
  }

  function prepareSkillDraft(name?: string, description?: string) {
    const nextPrompt = [
      name ? `Help me create a new skill named "${name}".` : "Help me create a new skill.",
      description ? `Goal: ${description}` : "Goal: define the purpose, inputs, outputs, folder structure, and first implementation.",
      "Please make it directly implementable.",
    ].filter(Boolean).join("\n");
    dispatch({ type: "composer/set", payload: nextPrompt });
    onOpenChat();
    onToast("Skill draft prepared");
  }

  function useReferenceSkill(skill: RuntimeSkill) {
    dispatch({ type: "composer/set", payload: buildSkillPrompt(skill.name, skill.description, state.composer.trim()) });
    onOpenChat();
    onToast(`Loaded ${skill.name} into composer`);
  }

  function useConfiguredCodexSkill(skill: Pick<SkillConfig, "name" | "description">) {
    dispatch({ type: "composer/set", payload: buildSkillPrompt(skill.name, skill.description, state.composer.trim()) });
    onOpenChat();
    onToast(`Loaded ${skill.name} into composer`);
  }

  async function executeCommandSkill(
    skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">,
    promptOverride?: string,
  ) {
    if (!hasAvailableModel) { onToast("当前没有可用模型，请先在设置里配置并启用模型。"); return; }
    if (skill.enabled === false) { onToast("Enable this skill first"); return; }
    const existingThreadId = stateRef.current.activeThreadId;
    const runVersion = existingThreadId ? beginThreadRun(existingThreadId) : null;
    try {
      const result = await workspaceClient.runSkill({
        threadId: existingThreadId || undefined,
        workspaceRoot: !existingThreadId ? state.config.opencodeRoot || undefined : undefined,
        skillId: skill.id,
        prompt: promptOverride?.trim() || state.composer.trim() || skill.description,
      });
      if (existingThreadId && runVersion !== null && !isLatestThreadRun(existingThreadId, runVersion)) {
        return;
      }
      onOpenChat();
      onToast(`Ran ${skill.name}`);
      if (result?.thread) {
        applyThreadSnapshot(result.thread.id, result.thread);
        await refreshThreadList();
      }
    } catch (error) {
      if (existingThreadId && isThreadStopping(existingThreadId)) {
        return;
      }
      onToast(formatErrorMessage(error, "Run skill failed"));
    }
  }

  async function runSkill(skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">) {
    if (skill.enabled === false) { onToast("Enable this skill first"); return; }
    if (skill.kind === "codex") { useConfiguredCodexSkill(skill); return; }
    await executeCommandSkill(skill);
  }

  // ── composer ───────────────────────────────────────────────────────────────

  async function sendMessageWithSkills() {
    if (stateRef.current.status.sending || state.composerComposing || (!state.composer.trim() && state.attachments.length === 0)) return;
    if (!hasAvailableModel) { onToast("当前没有可用模型，请先在设置里配置并启用模型。"); return; }

    const nextMessage = state.composer.trim();
    const nextAttachments = state.attachments;
    const composerSkill = state.selectedComposerSkill;
    const slashCommand = parseSlashSkillCommand(nextMessage);

    if (!validateComposerAttachments(nextAttachments)) return;

    if (!composerSkill && !slashCommand?.skillToken) {
      // Plain message send (no skill)
      dispatch({ type: "status/set", payload: { sending: true } });
      dispatch({ type: "composer/clear" });
      try {
        // Use ref for fresh state — React state may be stale in closure
        const ensured = await ensureBackendThread();
        let threadId = ensured.threadId;
        const currentThread = ensured.thread;

        // No active thread → create session on backend

        // Show user message + loading assistant placeholder immediately
        const userMsg: ChatMessage = {
          id: `temp-user-${Date.now()}`,
          role: "user",
          text: nextMessage,
          createdAt: Date.now(),
          status: "done",
        };
        const assistantMsg: ChatMessage = {
          id: `temp-assistant-${Date.now()}`,
          role: "assistant",
          text: "",
          createdAt: Date.now(),
          status: "loading",
        };
        const currentMessages = currentThread?.messages ?? [];
        dispatch({
          type: "thread/open",
          payload: {
            threadId,
            thread: {
              id: threadId,
              title: stateRef.current.activeThread?.title || "新会话",
              updatedAt: Date.now(),
              lastMessage: nextMessage,
              messageCount: currentMessages.length + 2,
              archived: false,
              workspaceRoot: stateRef.current.activeThread?.workspaceRoot,
              messages: [...currentMessages, userMsg, assistantMsg],
            },
          },
        });

        // Send message (async dispatch + poll for completion)
        const result = await workspaceClient.sendMessage({
          threadId,
          message: nextMessage,
          attachments: nextAttachments,
        });
        if (result?.thread) {
          dispatch({ type: "thread/open", payload: { threadId, thread: result.thread } });
        }
        onOpenChat();
      } catch (error) {
        onToast(formatErrorMessage(error, "Send message failed"));
      } finally {
        dispatch({ type: "status/set", payload: { sending: false } });
      }
      return;
    }

    const installedSkill =
      composerSkill?.source === "installed"
        ? state.config.skills.find((s) => s.id === composerSkill.id) ?? null
        : slashCommand?.skillToken ? installedSkillMap.get(slashCommand.skillToken) ?? null : null;

    if (installedSkill) {
      const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
      if (installedSkill.kind === "codex") {
        dispatch({ type: "composerSkill/set", payload: null });
        dispatch({ type: "status/set", payload: { sending: true } });
        dispatch({ type: "composer/clear" });
        try {
          let threadId = stateRef.current.activeThreadId;
          if (!threadId) {
            const bp = await workspaceClient.createThread();
            threadId = bp.activeThreadId;
            if (bp.currentThread) {
              dispatch({ type: "thread/open", payload: { threadId, thread: bp.currentThread } });
            }
          }
          const result = await workspaceClient.sendMessage({
            threadId,
            message: promptText,
            attachments: nextAttachments,
          });
          if (result?.thread) {
            dispatch({ type: "thread/open", payload: { threadId, thread: result.thread } });
          }
          onOpenChat();
          onToast(`Sent with /${installedSkill.name}`);
        } catch (error) {
          onToast(formatErrorMessage(error, "Send message failed"));
        } finally {
          dispatch({ type: "status/set", payload: { sending: false } });
        }
        return;
      }
      if (nextAttachments.length > 0) { onToast("Command skills do not support attachments yet"); return; }
      dispatch({ type: "composerSkill/set", payload: null });
      dispatch({ type: "composer/set", payload: "" });
      dispatch({ type: "attachments/set", payload: [] });
      await executeCommandSkill(installedSkill, promptText);
      return;
    }

    const referenceSkill =
      composerSkill?.source === "reference"
        ? state.availableSkills.find((s) => s.id === composerSkill.id) ?? null
        : slashCommand?.skillToken ? referenceSkillMap.get(slashCommand.skillToken) ?? null : null;

    if (referenceSkill) {
      dispatch({ type: "composerSkill/set", payload: null });
      dispatch({ type: "status/set", payload: { sending: true } });
      dispatch({ type: "composer/clear" });
      try {
        let threadId = stateRef.current.activeThreadId;
        if (!threadId) {
          const bp = await workspaceClient.createThread();
          threadId = bp.activeThreadId;
          if (bp.currentThread) {
            dispatch({ type: "thread/open", payload: { threadId, thread: bp.currentThread } });
          }
        }
        const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
        const result = await workspaceClient.sendMessage({
          threadId,
          message: buildSkillPrompt(referenceSkill.name, referenceSkill.description, promptText),
          attachments: nextAttachments,
        });
        if (result?.thread) {
          dispatch({ type: "thread/open", payload: { threadId, thread: result.thread } });
        }
        onOpenChat();
        onToast(`Sent with /${referenceSkill.name}`);
      } catch (error) {
        onToast(formatErrorMessage(error, "Send message failed"));
      } finally {
        dispatch({ type: "status/set", payload: { sending: false } });
      }
      return;
    }

    onToast(`Skill not found: /${slashCommand?.skillToken ?? ""}`);
  }

  async function sendMessageWithSkillsStable() {
    if (stateRef.current.status.sending || state.composerComposing || (!state.composer.trim() && state.attachments.length === 0)) return;
    if (!hasAvailableModel) { onToast("当前没有可用模型，请先在设置里启用模型。"); return; }

    const nextMessage = state.composer.trim();
    const nextAttachments = state.attachments;
    const composerSkill = state.selectedComposerSkill;
    const slashCommand = parseSlashSkillCommand(nextMessage);

    if (!validateComposerAttachments(nextAttachments)) return;

    if (!composerSkill && !slashCommand?.skillToken) {
      dispatch({ type: "status/set", payload: { sending: true } });
      dispatch({ type: "composer/clear" });
      let threadId: string | null = null;
      try {
        const ensured = await ensureBackendThread();
        threadId = ensured.threadId;
        const runVersion = beginThreadRun(threadId);
        openOptimisticThread({
          threadId,
          baseThread: ensured.thread,
          message: nextMessage,
          attachments: nextAttachments,
        });

        const result = await workspaceClient.sendMessage({
          threadId,
          message: nextMessage,
          attachments: nextAttachments,
        });
        if (!isLatestThreadRun(threadId, runVersion)) {
          return;
        }
        if (result?.thread) {
          applyThreadSnapshot(threadId, result.thread);
        }
        onOpenChat();
      } catch (error) {
        handleSendFailure(threadId, error, "Send message failed");
      } finally {
        dispatch({ type: "status/set", payload: { sending: false } });
      }
      return;
    }

    const installedSkill =
      composerSkill?.source === "installed"
        ? state.config.skills.find((s) => s.id === composerSkill.id) ?? null
        : slashCommand?.skillToken ? installedSkillMap.get(slashCommand.skillToken) ?? null : null;

    if (installedSkill) {
      const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
      if (installedSkill.kind === "codex") {
        dispatch({ type: "composerSkill/set", payload: null });
        dispatch({ type: "status/set", payload: { sending: true } });
        dispatch({ type: "composer/clear" });
        let threadId: string | null = null;
        try {
          const ensured = await ensureBackendThread();
          threadId = ensured.threadId;
          const runVersion = beginThreadRun(threadId);
          openOptimisticThread({
            threadId,
            baseThread: ensured.thread,
            message: promptText,
            attachments: nextAttachments,
            skillName: installedSkill.name,
          });
          const result = await workspaceClient.sendMessage({
            threadId,
            message: promptText,
            attachments: nextAttachments,
          });
          if (!isLatestThreadRun(threadId, runVersion)) {
            return;
          }
          if (result?.thread) {
            applyThreadSnapshot(threadId, result.thread);
          }
          onOpenChat();
          onToast(`Sent with /${installedSkill.name}`);
        } catch (error) {
          handleSendFailure(threadId, error, "Send message failed");
        } finally {
          dispatch({ type: "status/set", payload: { sending: false } });
        }
        return;
      }

      if (nextAttachments.length > 0) { onToast("Command skills do not support attachments yet"); return; }
      dispatch({ type: "composerSkill/set", payload: null });
      dispatch({ type: "composer/set", payload: "" });
      dispatch({ type: "attachments/set", payload: [] });
      await executeCommandSkill(installedSkill, promptText);
      return;
    }

    const referenceSkill =
      composerSkill?.source === "reference"
        ? state.availableSkills.find((s) => s.id === composerSkill.id) ?? null
        : slashCommand?.skillToken ? referenceSkillMap.get(slashCommand.skillToken) ?? null : null;

    if (referenceSkill) {
      dispatch({ type: "composerSkill/set", payload: null });
      dispatch({ type: "status/set", payload: { sending: true } });
      dispatch({ type: "composer/clear" });
      let threadId: string | null = null;
      try {
        const ensured = await ensureBackendThread();
        threadId = ensured.threadId;
        const runVersion = beginThreadRun(threadId);
        const promptText = composerSkill ? nextMessage : slashCommand?.prompt ?? "";
        openOptimisticThread({
          threadId,
          baseThread: ensured.thread,
          message: promptText,
          attachments: nextAttachments,
          skillName: referenceSkill.name,
        });
        const result = await workspaceClient.sendMessage({
          threadId,
          message: buildSkillPrompt(referenceSkill.name, referenceSkill.description, promptText),
          attachments: nextAttachments,
        });
        if (!isLatestThreadRun(threadId, runVersion)) {
          return;
        }
        if (result?.thread) {
          applyThreadSnapshot(threadId, result.thread);
        }
        onOpenChat();
        onToast(`Sent with /${referenceSkill.name}`);
      } catch (error) {
        handleSendFailure(threadId, error, "Send message failed");
      } finally {
        dispatch({ type: "status/set", payload: { sending: false } });
      }
      return;
    }

    onToast(`Skill not found: /${slashCommand?.skillToken ?? ""}`);
  }

  async function appendAttachments(files: FileDropEntry[]) {
    try {
      const prepared = await prepareComposerAttachments(files);
      const supported = prepared.filter(isSupportedComposerAttachment);
      const unsupported = prepared.filter((file) => !isSupportedComposerAttachment(file));

      if (supported.length > 0) {
        dispatch({ type: "attachments/append", payload: supported });
      }
      if (unsupported.length > 0) {
        onToast(describeUnsupportedAttachments(unsupported));
      }
    } catch {
      onToast("Read files failed");
    }
  }
  function setComposer(value: string) { dispatch({ type: "composer/set", payload: value }); }
  function applySuggestion(prompt: string) { dispatch({ type: "composer/set", payload: prompt }); }
  function removeAttachment(id: string) { dispatch({ type: "attachment/remove", payload: id }); }

  function selectComposerSkill(skillId: string) {
    const skill = composerSkillOptionsById.get(skillId);
    if (!skill) return;
    dispatch({ type: "composerSkill/set", payload: skill });
    dispatch({ type: "composer/set", payload: "" });
    onToast(`Selected ${skill.name}`);
  }

  function clearSelectedComposerSkill() { dispatch({ type: "composerSkill/set", payload: null }); }

  // ── files / workspace ──────────────────────────────────────────────────────

  async function pickFiles() {
    try {
      const files = await workspaceClient.selectFiles();
      if (files.length > 0) {
        await appendAttachments(files);
      }
    } catch { onToast("Read files failed"); }
  }

  async function openWorkspaceFolder() {
    try { await workspaceClient.openWorkspaceFolder(state.activeThreadId || undefined); }
    catch { onToast("Open workspace failed"); }
  }

  async function chooseThreadWorkspace() {
    try {
      const selected = await workspaceClient.selectWorkspaceFolder();
      if (!selected) return;
      if (!state.activeThreadId) { onToast(`Switched workspace to ${workspaceLabel(selected)}`); return; }
      const payload = await workspaceClient.setThreadWorkspace(state.activeThreadId, selected);
      dispatch({ type: "config/set", payload: payload.config });
      onToast(`Switched workspace to ${workspaceLabel(selected)}`);
    } catch { onToast("Switch workspace failed"); }
  }

  // ── session functions ─────────────────────────────────────────────────────

  async function createThread() {
    // Pure frontend — just reset to empty chat page, no backend call
    dispatch({ type: "status/set", payload: { sending: false } });
    dispatch({ type: "composer/clear" });
    dispatch({
      type: "thread/open",
      payload: {
        threadId: "",
        thread: { id: "", title: "新会话", updatedAt: Date.now(), lastMessage: "", messageCount: 0, archived: false, messages: [] },
      },
    });
    onOpenChat();
  }

  async function createThreadStable() {
    try {
      dispatch({ type: "status/set", payload: { sending: false, creatingThread: true } });
      dispatch({ type: "composer/clear" });
      const payload = await workspaceClient.createThread(DEFAULT_THREAD_TITLE);
      applyBootstrapPayload(payload);
      onOpenChat();
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to create thread"));
    } finally {
      dispatch({ type: "status/set", payload: { creatingThread: false } });
    }
  }

  async function openThread(threadId: string) {
    try {
      onOpenChat();
      const thread = await workspaceClient.setActiveThread(threadId);
      applyThreadSnapshot(threadId, thread);
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to open thread"));
      dispatch({ type: "status/set", payload: { openingThreadId: null } });
    }
  }

  async function archiveThread(thread: ThreadSummary, archived: boolean) {
    try {
      dispatch({ type: "status/set", payload: { mutatingThreadId: thread.id } });
      const payload = await workspaceClient.archiveThread(thread.id, archived);
      dispatch({ type: "threads/set", payload: payload.threads });
      dispatch({ type: "status/set", payload: { mutatingThreadId: null } });
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to archive thread"));
      dispatch({ type: "status/set", payload: { mutatingThreadId: null } });
    }
  }

  async function deleteThread(thread: ThreadSummary) {
    try {
      dispatch({ type: "status/set", payload: { mutatingThreadId: thread.id } });
      const payload = await workspaceClient.deleteThread(thread.id);
      dispatch({ type: "threads/set", payload: payload.threads });
      if (payload.activeThreadId !== state.activeThreadId) {
        dispatch({
          type: "thread/open",
          payload: { threadId: payload.activeThreadId, thread: payload.currentThread! },
        });
      }
      dispatch({ type: "status/set", payload: { mutatingThreadId: null } });
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to delete thread"));
      dispatch({ type: "status/set", payload: { mutatingThreadId: null } });
    }
  }

  async function abortThread(threadId?: string) {
    const target = threadId || stateRef.current.activeThreadId;
    if (!target) return;
    markThreadStopping(target);

    const activeThread = stateRef.current.activeThread;
    if (activeThread?.id === target && activeThread.messages.some((message) => message.status === "loading")) {
      dispatch({
        type: "thread/open",
        payload: {
          threadId: target,
          thread: {
            ...activeThread,
            updatedAt: Date.now(),
            messages: activeThread.messages.map((message) =>
              message.status === "loading" ? { ...message, status: "paused" } : message,
            ),
          },
        },
      });
    }

    dispatch({ type: "status/set", payload: { sending: false } });

    try {
      const payload = await workspaceClient.abortThread(target);
      dispatch({ type: "pendingQuestions/set", payload: payload.pendingQuestions });
      // Refresh thread to show partial response
      const thread = await workspaceClient.getThread(target).catch(() => null);
      if (thread) {
        applyThreadSnapshot(target, thread);
      } else {
        clearThreadStopping(target);
      }
    } catch (error) {
      clearThreadStopping(target);
      onToast(formatErrorMessage(error, "Failed to abort thread"));
    }
  }

  async function refreshThreadList() {
    try {
      dispatch({ type: "status/set", payload: { refreshingThreads: true } });
      const threads = await workspaceClient.listThreads();
      dispatch({ type: "threads/set", payload: threads });
      dispatch({ type: "status/set", payload: { refreshingThreads: false } });
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to refresh threads"));
      dispatch({ type: "status/set", payload: { refreshingThreads: false } });
    }
  }

  async function replyQuestion(requestId: string, sessionId: string, answers: string[][]) {
    try {
      const payload = await workspaceClient.replyQuestion({ requestId, sessionId, answers });
      dispatch({ type: "pendingQuestions/set", payload: payload.pendingQuestions });
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to reply to question"));
    }
  }

  async function rejectQuestion(requestId: string, sessionId: string) {
    try {
      const payload = await workspaceClient.rejectQuestion({ requestId, sessionId });
      dispatch({ type: "pendingQuestions/set", payload: payload.pendingQuestions });
    } catch (error) {
      onToast(formatErrorMessage(error, "Failed to reject question"));
    }
  }

  // ── return ─────────────────────────────────────────────────────────────────

  return {
    activeModel,
    activeSummary,
    activeThread: state.activeThread,
    activeThreadId: state.activeThreadId,
    activeThreadStopping: isThreadStopping(state.activeThreadId),
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
    drafting: state.drafting,
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
    sendMessageWithSkills: sendMessageWithSkillsStable,
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
