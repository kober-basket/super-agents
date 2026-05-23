import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Brain,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import type {
  MemoryCreateInput,
  MemoryEntry,
  MemoryEntryType,
  MemoryScope,
  MemoryUpdateInput,
} from "../../types";

type MemoryTypeFilter = "all" | MemoryEntryType;
type MemoryBusyAction =
  | "refresh"
  | "create"
  | `update:${string}`
  | `delete:${string}`;
type MemoryModalState =
  | { mode: "create" }
  | { mode: "edit"; entry: MemoryEntry }
  | null;

interface MemoryViewProps {
  entries: MemoryEntry[];
  refreshing: boolean;
  workspaceRoot: string;
  onRefresh: () => void | Promise<void>;
  onCreateMemory: (input: MemoryCreateInput) => void | Promise<void>;
  onUpdateMemory: (input: MemoryUpdateInput) => void | Promise<void>;
  onDeleteMemory: (memoryId: string) => void | Promise<void>;
  onToast: (message: string) => void;
}

const MEMORY_TYPES: Array<{ key: MemoryTypeFilter; label: string; description: string }> = [
  { key: "all", label: "全部", description: "所有记忆" },
  { key: "user_preference", label: "用户偏好", description: "回答习惯和个人偏好" },
  { key: "feedback_rule", label: "反馈规则", description: "长期执行规则" },
  { key: "project_context", label: "项目背景", description: "当前项目和工作方式" },
  { key: "external_reference", label: "外部参考", description: "外部系统和资料线索" },
];

const MEMORY_TYPE_OPTIONS = MEMORY_TYPES.filter(
  (item): item is { key: MemoryEntryType; label: string; description: string } => item.key !== "all",
);

function formatMemoryType(type: MemoryEntryType) {
  return MEMORY_TYPE_OPTIONS.find((item) => item.key === type)?.label ?? type;
}

function formatMemoryScope(scope: MemoryScope) {
  return scope === "workspace" ? "工作区" : "全局";
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

function createEmptyDraft(workspaceRoot: string) {
  return {
    type: "project_context" as MemoryEntryType,
    scope: (workspaceRoot.trim() ? "workspace" : "global") as MemoryScope,
    title: "",
    content: "",
    tags: "",
    enabled: true,
  };
}

function draftFromEntry(entry: MemoryEntry) {
  return {
    type: entry.type,
    scope: entry.scope,
    title: entry.title,
    content: entry.content,
    tags: entry.tags.join(", "),
    enabled: entry.enabled,
  };
}

export function MemoryView({
  entries,
  refreshing,
  workspaceRoot,
  onRefresh,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory,
  onToast,
}: MemoryViewProps) {
  const [typeFilter, setTypeFilter] = useState<MemoryTypeFilter>("all");
  const [query, setQuery] = useState("");
  const [busyAction, setBusyAction] = useState<MemoryBusyAction | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [modal, setModal] = useState<MemoryModalState>(null);
  const [draft, setDraft] = useState(() => createEmptyDraft(workspaceRoot));

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries
      .filter((entry) => typeFilter === "all" || entry.type === typeFilter)
      .filter((entry) => {
        if (!normalizedQuery) return true;
        return [entry.title, entry.content, ...entry.tags, formatMemoryType(entry.type), formatMemoryScope(entry.scope)]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [entries, query, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts = new Map<MemoryTypeFilter, number>([["all", entries.length]]);
    for (const entry of entries) {
      counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const enabledCount = entries.filter((entry) => entry.enabled).length;
  const controlsDisabled = refreshing || busyAction !== null;
  const refreshBusy = busyAction === "refresh" || (refreshing && busyAction === null);

  async function runBusyAction<T>(action: MemoryBusyAction, task: () => Promise<T>) {
    if (controlsDisabled) {
      return null;
    }
    setBusyAction(action);
    try {
      return await task();
    } finally {
      setBusyAction((current) => (current === action ? null : current));
    }
  }

  function openCreateModal() {
    setDraft(createEmptyDraft(workspaceRoot));
    setModal({ mode: "create" });
  }

  function openEditModal(entry: MemoryEntry) {
    setDraft(draftFromEntry(entry));
    setModal({ mode: "edit", entry });
  }

  function closeModal() {
    if (busyAction === "create" || busyAction?.startsWith("update:")) {
      return;
    }
    setModal(null);
  }

  async function handleRefresh() {
    await runBusyAction("refresh", async () => {
      await onRefresh();
    });
  }

  async function handleSubmitDraft() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title || !content) {
      onToast("请填写记忆标题和内容");
      return;
    }

    const tags = parseTags(draft.tags);
    if (modal?.mode === "edit") {
      const entryId = modal.entry.id;
      const result = await runBusyAction(`update:${entryId}`, async () => {
        await onUpdateMemory({
          id: entryId,
          type: draft.type,
          scope: draft.scope,
          workspaceRoot: draft.scope === "workspace" ? workspaceRoot : undefined,
          title,
          content,
          tags,
          enabled: draft.enabled,
        });
      });
      if (result !== null) {
        setModal(null);
      }
      return;
    }

    const result = await runBusyAction("create", async () => {
      await onCreateMemory({
        type: draft.type,
        scope: draft.scope,
        workspaceRoot: draft.scope === "workspace" ? workspaceRoot : undefined,
        title,
        content,
        tags,
        enabled: draft.enabled,
      });
    });
    if (result !== null) {
      setModal(null);
    }
  }

  async function toggleEntryEnabled(entry: MemoryEntry) {
    await runBusyAction(`update:${entry.id}`, async () => {
      await onUpdateMemory({
        id: entry.id,
        enabled: !entry.enabled,
      });
    });
  }

  async function handleDelete(entry: MemoryEntry) {
    await runBusyAction(`delete:${entry.id}`, async () => {
      await onDeleteMemory(entry.id);
    });
    setConfirmDeleteId(null);
  }

  function renderModal() {
    if (!modal) return null;
    const isEditing = modal.mode === "edit";
    const saving = busyAction === "create" || (isEditing && busyAction === `update:${modal.entry.id}`);

    return (
      <div className="modal-scrim" onClick={closeModal}>
        <div className="memory-modal" onClick={(event) => event.stopPropagation()}>
          <div className="memory-modal-head">
            <strong>{isEditing ? "编辑记忆" : "新建记忆"}</strong>
            <button className="memory-icon-button" onClick={closeModal} disabled={controlsDisabled} title="关闭">
              <X size={16} />
            </button>
          </div>

          <div className="memory-modal-body">
            <div className="memory-form-grid">
              <label>
                <span>类型</span>
                <select
                  value={draft.type}
                  disabled={controlsDisabled}
                  onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as MemoryEntryType }))}
                >
                  {MEMORY_TYPE_OPTIONS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>范围</span>
                <select
                  value={draft.scope}
                  disabled={controlsDisabled}
                  onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value as MemoryScope }))}
                >
                  <option value="workspace">工作区</option>
                  <option value="global">全局</option>
                </select>
              </label>
            </div>

            <label>
              <span>标题</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="例如：回答语言"
                disabled={controlsDisabled}
              />
            </label>

            <label>
              <span>内容</span>
              <textarea
                value={draft.content}
                onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                rows={8}
                placeholder="写下需要长期保留的事实、偏好或规则"
                disabled={controlsDisabled}
              />
            </label>

            <label>
              <span>标签</span>
              <input
                value={draft.tags}
                onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                placeholder="中文, verification"
                disabled={controlsDisabled}
              />
            </label>

            <button
              className={clsx("memory-toggle-row", draft.enabled && "active")}
              onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
              type="button"
              disabled={controlsDisabled}
            >
              {draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              <span>{draft.enabled ? "启用" : "停用"}</span>
            </button>
          </div>

          <div className="memory-modal-actions">
            <button className="secondary-button" onClick={closeModal} disabled={controlsDisabled}>
              取消
            </button>
            <button className="primary-button" onClick={() => void handleSubmitDraft()} disabled={controlsDisabled}>
              {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="memory-shell">
        <aside className="memory-sidebar">
          <header className="memory-sidebar-head">
            <h2>记忆</h2>
            <p>{enabledCount} 条启用，{entries.length} 条总计</p>
          </header>

          <div className="memory-type-list">
            {MEMORY_TYPES.map((item) => (
              <button
                key={item.key}
                className={clsx("memory-type-row", typeFilter === item.key && "active")}
                onClick={() => setTypeFilter(item.key)}
                disabled={controlsDisabled}
                type="button"
              >
                <span className="memory-type-icon">
                  <Brain size={15} />
                </span>
                <span className="memory-type-copy">
                  <strong>{item.label}</strong>
                  <em>{item.description}</em>
                </span>
                <b>{typeCounts.get(item.key) ?? 0}</b>
              </button>
            ))}
          </div>

          <button className="primary-button memory-create-button" onClick={openCreateModal} disabled={controlsDisabled}>
            <Plus size={14} />
            新建记忆
          </button>
        </aside>

        <div className="memory-main">
          <div className="memory-panel">
            <section className="memory-toolbar">
              <label className="search-field memory-search-field">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索记忆"
                  disabled={controlsDisabled}
                />
              </label>

              <div className="memory-toolbar-actions">
                <button
                  className="memory-icon-button"
                  onClick={() => void handleRefresh()}
                  disabled={controlsDisabled}
                  title="刷新记忆"
                  type="button"
                >
                  {refreshBusy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                </button>
                <button className="primary-button" onClick={openCreateModal} disabled={controlsDisabled} type="button">
                  <Plus size={14} />
                  新建
                </button>
              </div>
            </section>

            <div className="memory-results">
              {visibleEntries.length > 0 ? (
                <div className="memory-entry-stack">
                  {visibleEntries.map((entry) => {
                    const confirmingDelete = confirmDeleteId === entry.id;
                    const updating = busyAction === `update:${entry.id}`;
                    const deleting = busyAction === `delete:${entry.id}`;
                    return (
                      <article
                        key={entry.id}
                        className={clsx("memory-entry-row", !entry.enabled && "disabled", confirmingDelete && "confirming-delete")}
                      >
                        <div className="memory-entry-main">
                          <div className="memory-entry-title-row">
                            <strong title={entry.title}>{entry.title}</strong>
                            <span>{formatMemoryType(entry.type)}</span>
                            <span>{formatMemoryScope(entry.scope)}</span>
                            {!entry.enabled ? <span className="memory-muted-badge">已停用</span> : null}
                          </div>
                          <p>{entry.content}</p>
                          <div className="memory-entry-meta">
                            <time>{formatRelativeTime(entry.updatedAt)}</time>
                            {entry.tags.map((tag) => (
                              <em key={tag}>{tag}</em>
                            ))}
                          </div>
                        </div>

                        <div className="memory-entry-actions">
                          {confirmingDelete ? (
                            <>
                              <button className="memory-inline-action" onClick={() => setConfirmDeleteId(null)} disabled={controlsDisabled}>
                                取消
                              </button>
                              <button className="memory-inline-action danger" onClick={() => void handleDelete(entry)} disabled={controlsDisabled}>
                                {deleting ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                                删除
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className={clsx("memory-icon-button", entry.enabled && "active")}
                                onClick={() => void toggleEntryEnabled(entry)}
                                disabled={controlsDisabled}
                                title={entry.enabled ? "停用记忆" : "启用记忆"}
                                type="button"
                              >
                                {updating ? (
                                  <LoaderCircle size={16} className="spin" />
                                ) : entry.enabled ? (
                                  <ToggleRight size={16} />
                                ) : (
                                  <ToggleLeft size={16} />
                                )}
                              </button>
                              <button
                                className="memory-icon-button"
                                onClick={() => openEditModal(entry)}
                                disabled={controlsDisabled}
                                title="编辑记忆"
                                type="button"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="memory-icon-button"
                                onClick={() => setConfirmDeleteId(entry.id)}
                                disabled={controlsDisabled}
                                title="删除记忆"
                                type="button"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="memory-empty">
                  <strong>暂无记忆</strong>
                  <span>{query.trim() ? "没有匹配的条目" : "还没有长期条目"}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {renderModal()}
    </>
  );
}
