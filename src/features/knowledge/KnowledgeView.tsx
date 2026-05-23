import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  BookOpen,
  FileText,
  Folder,
  Globe,
  Link2,
  LoaderCircle,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import { isEmbeddingModel } from "../../lib/model-config";
import { SurfaceSelect } from "../shared/SurfaceSelect";
import type {
  AppConfig,
  KnowledgeBaseSummary,
  KnowledgeItemSummary,
  KnowledgeItemType,
  ModelProviderConfig,
} from "../../types";

type KnowledgeTabKey = "file" | "note" | "directory" | "url" | "website";
type KnowledgeSortKey = "updated-desc" | "updated-asc" | "chunks-desc" | "title-asc";
type KnowledgeBusyAction =
  | "refresh"
  | "create-base"
  | "delete-base"
  | "add-file"
  | "add-note"
  | "add-directory"
  | "add-url"
  | "add-website"
  | `delete-item:${string}`;
type KnowledgeComposerModal = Extract<KnowledgeTabKey, "note" | "url" | "website"> | null;

interface KnowledgeViewProps {
  config: AppConfig["knowledgeBase"];
  modelProviders: ModelProviderConfig[];
  knowledgeBases: KnowledgeBaseSummary[];
  knowledgeRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  onChangeEmbeddingProvider: (value: string) => void;
  onChangeEmbeddingModel: (value: string) => void;
  onToast: (message: string) => void;
  onCreateKnowledgeBase: (name: string, description: string) => Promise<string | null> | string | null;
  onDeleteKnowledgeBase: (baseId: string) => void | Promise<void>;
  onAddKnowledgeFiles: (baseId: string) => void | Promise<void>;
  onAddKnowledgeDirectory: (baseId: string) => void | Promise<void>;
  onAddKnowledgeNote: (baseId: string, title: string, content: string) => void | Promise<void>;
  onAddKnowledgeUrl: (baseId: string, url: string) => void | Promise<void>;
  onAddKnowledgeWebsite: (baseId: string, url: string) => void | Promise<void>;
  onDeleteKnowledgeItem: (baseId: string, itemId: string) => void | Promise<void>;
}

const TAB_ITEMS: Array<{
  key: KnowledgeTabKey;
  label: string;
  icon: typeof FileText;
  itemType: KnowledgeItemType;
}> = [
  { key: "file", label: "文件", icon: FileText, itemType: "file" },
  { key: "note", label: "笔记", icon: NotebookPen, itemType: "note" },
  { key: "directory", label: "目录", icon: Folder, itemType: "directory" },
  { key: "url", label: "网址", icon: Link2, itemType: "url" },
  { key: "website", label: "网站", icon: Globe, itemType: "website" },
];

const SORT_OPTIONS: Array<{ value: KnowledgeSortKey; label: string }> = [
  { value: "updated-desc", label: "最近更新" },
  { value: "updated-asc", label: "最早更新" },
  { value: "chunks-desc", label: "切片最多" },
  { value: "title-asc", label: "标题排序" },
];

function formatItemType(type: KnowledgeItemType) {
  switch (type) {
    case "file":
      return "文件";
    case "note":
      return "笔记";
    case "directory":
      return "目录";
    case "url":
      return "网址";
    case "website":
      return "网站";
    default:
      return type;
  }
}

function resolveItemSource(item: KnowledgeItemSummary) {
  if (item.type === "note") {
    return "手动笔记";
  }
  return item.source;
}

function getItemMeta(type: KnowledgeItemType) {
  return TAB_ITEMS.find((item) => item.itemType === type) ?? TAB_ITEMS[0];
}

function compareItems(left: KnowledgeItemSummary, right: KnowledgeItemSummary, sortKey: KnowledgeSortKey) {
  switch (sortKey) {
    case "updated-asc":
      return left.updatedAt - right.updatedAt;
    case "chunks-desc":
      if (right.chunkCount !== left.chunkCount) {
        return right.chunkCount - left.chunkCount;
      }
      return right.updatedAt - left.updatedAt;
    case "title-asc":
      return left.title.localeCompare(right.title, "zh-CN");
    case "updated-desc":
    default:
      return right.updatedAt - left.updatedAt;
  }
}

export function KnowledgeView({
  config,
  modelProviders,
  knowledgeBases,
  knowledgeRefreshing,
  onRefresh,
  onChangeEmbeddingProvider,
  onChangeEmbeddingModel,
  onToast,
  onCreateKnowledgeBase,
  onDeleteKnowledgeBase,
  onAddKnowledgeFiles,
  onAddKnowledgeDirectory,
  onAddKnowledgeNote,
  onAddKnowledgeUrl,
  onAddKnowledgeWebsite,
  onDeleteKnowledgeItem,
}: KnowledgeViewProps) {
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [activeTab, setActiveTab] = useState<KnowledgeTabKey>("file");
  const [draftBaseName, setDraftBaseName] = useState("");
  const [draftBaseDescription, setDraftBaseDescription] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [websiteValue, setWebsiteValue] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [sortKey, setSortKey] = useState<KnowledgeSortKey>("updated-desc");
  const [busyAction, setBusyAction] = useState<KnowledgeBusyAction | null>(null);
  const [confirmDeleteBase, setConfirmDeleteBase] = useState(false);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [composerModal, setComposerModal] = useState<KnowledgeComposerModal>(null);

  const selectedBase = knowledgeBases.find((base) => base.id === selectedBaseId) ?? knowledgeBases[0] ?? null;
  const knowledgeBaseCount = knowledgeBases.length;
  const totalItemCount = useMemo(
    () => knowledgeBases.reduce((sum, base) => sum + base.itemCount, 0),
    [knowledgeBases],
  );
  const totalChunkCount = useMemo(
    () => knowledgeBases.reduce((sum, base) => sum + base.chunkCount, 0),
    [knowledgeBases],
  );

  useEffect(() => {
    if (!selectedBaseId && knowledgeBases[0]?.id) {
      setSelectedBaseId(knowledgeBases[0].id);
      return;
    }

    if (selectedBaseId && !knowledgeBases.some((base) => base.id === selectedBaseId)) {
      setSelectedBaseId(knowledgeBases[0]?.id ?? "");
    }
  }, [knowledgeBases, selectedBaseId]);

  useEffect(() => {
    setConfirmDeleteBase(false);
    setConfirmDeleteItemId(null);
    setComposerModal(null);
  }, [selectedBaseId]);

  useEffect(() => {
    setConfirmDeleteItemId(null);
    setComposerModal(null);
  }, [activeTab]);

  const currentType = TAB_ITEMS.find((item) => item.key === activeTab)?.itemType ?? "file";
  const currentTypeLabel = formatItemType(currentType);
  const activeTabMeta = getItemMeta(currentType);
  const embeddingProvider =
    modelProviders.find((provider) => provider.id === config.embeddingProviderId) ?? modelProviders[0] ?? null;
  const embeddingModels = useMemo(() => {
    if (!embeddingProvider) return [];
    return embeddingProvider.models.filter(isEmbeddingModel);
  }, [embeddingProvider]);
  const activeEmbeddingModel =
    embeddingModels.find((model) => model.id === config.embeddingModel) ?? embeddingModels[0] ?? null;
  const embeddingProviderOptions = useMemo(
    () =>
      modelProviders.map((provider) => {
        const embeddingCount = provider.models.filter(isEmbeddingModel).length;

        return {
          value: provider.id,
          label: provider.name,
          description: embeddingCount > 0 ? `${embeddingCount} 个 Embedding 模型` : "无可用的 Embedding 模型",
        };
      }),
    [modelProviders],
  );
  const embeddingModelOptions = useMemo(
    () =>
      embeddingModels.map((model) => ({
        value: model.id,
        label: model.label,
        description: model.id !== model.label ? model.id : undefined,
      })),
    [embeddingModels],
  );
  const sortOptions = useMemo(
    () =>
      SORT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  );

  const currentItems = useMemo(() => {
    if (!selectedBase) return [];
    return selectedBase.items.filter((item) => item.type === currentType);
  }, [currentType, selectedBase]);

  const filteredItems = useMemo(() => {
    const keyword = itemQuery.trim().toLowerCase();
    const next = currentItems.filter((item) => {
      if (!keyword) return true;
      return [item.title, resolveItemSource(item)].join(" ").toLowerCase().includes(keyword);
    });

    return [...next].sort((left, right) => compareItems(left, right, sortKey));
  }, [currentItems, itemQuery, sortKey]);

  const tabCounts = useMemo(() => {
    const counts = new Map<KnowledgeItemType, number>();
    if (!selectedBase) return counts;
    for (const item of selectedBase.items) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    }
    return counts;
  }, [selectedBase]);

  const controlsDisabled = knowledgeRefreshing || busyAction !== null;
  const refreshBusy = busyAction === "refresh" || (knowledgeRefreshing && busyAction === null);
  const isSearchActive = itemQuery.trim().length > 0;
  const showToolbarActions = currentItems.length > 0 || isSearchActive;
  const hasFilteredItems = filteredItems.length > 0;
  const showEmptyComposerStage = currentItems.length === 0 && !isSearchActive;

  async function runBusyAction<T>(action: KnowledgeBusyAction, task: () => Promise<T>) {
    if (knowledgeRefreshing || busyAction !== null) {
      return null;
    }
    setBusyAction(action);
    try {
      return await task();
    } finally {
      setBusyAction((current) => (current === action ? null : current));
    }
  }

  function openComposerModal(type: KnowledgeComposerModal) {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    setComposerModal(type);
  }

  function closeComposerModal() {
    if (busyAction === "add-note" || busyAction === "add-url" || busyAction === "add-website") {
      return;
    }
    setComposerModal(null);
  }

  async function handleRefresh() {
    await runBusyAction("refresh", async () => {
      await onRefresh();
    });
  }

  async function handleCreateBase() {
    const name = draftBaseName.trim() || `新知识库 ${knowledgeBases.length + 1}`;
    const createdBaseId = await runBusyAction("create-base", async () =>
      onCreateKnowledgeBase(name, draftBaseDescription.trim()),
    );
    setDraftBaseName("");
    setDraftBaseDescription("");
    if (createdBaseId) {
      setSelectedBaseId(createdBaseId);
    }
  }

  async function handleDeleteBase() {
    if (!selectedBase) return;
    await runBusyAction("delete-base", async () => {
      await onDeleteKnowledgeBase(selectedBase.id);
    });
    setConfirmDeleteBase(false);
  }

  async function handleDeleteItem(itemId: string) {
    if (!selectedBase) return;
    await runBusyAction(`delete-item:${itemId}`, async () => {
      await onDeleteKnowledgeItem(selectedBase.id, itemId);
    });
    setConfirmDeleteItemId(null);
  }

  async function handleAddFiles() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    await runBusyAction("add-file", async () => {
      await onAddKnowledgeFiles(selectedBase.id);
    });
  }

  async function handleAddDirectory() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    await runBusyAction("add-directory", async () => {
      await onAddKnowledgeDirectory(selectedBase.id);
    });
  }

  async function handleAddNote() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    const title = noteTitle.trim();
    const content = noteContent.trim();
    if (!title || !content) {
      onToast("请先填写笔记标题和内容");
      return;
    }
    const result = await runBusyAction("add-note", async () => {
      await onAddKnowledgeNote(selectedBase.id, title, content);
    });
    if (result !== null) {
      setNoteTitle("");
      setNoteContent("");
      setComposerModal(null);
    }
  }

  async function handleAddUrl() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    const url = urlValue.trim();
    if (!url) {
      onToast("请输入网址");
      return;
    }
    const result = await runBusyAction("add-url", async () => {
      await onAddKnowledgeUrl(selectedBase.id, url);
    });
    if (result !== null) {
      setUrlValue("");
      setComposerModal(null);
    }
  }

  async function handleAddWebsite() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    const url = websiteValue.trim();
    if (!url) {
      onToast("请输入网站地址");
      return;
    }
    const result = await runBusyAction("add-website", async () => {
      await onAddKnowledgeWebsite(selectedBase.id, url);
    });
    if (result !== null) {
      setWebsiteValue("");
      setComposerModal(null);
    }
  }

  function renderComposerTrigger() {
    if (!selectedBase) return null;

    const composerCopy: Record<
      KnowledgeTabKey,
      {
        title: string;
        emptyTitle: string;
        action: string;
        busyTitle?: string;
        busyAction?: KnowledgeBusyAction;
      }
    > = {
      file: {
        title: "添加文件",
        emptyTitle: "还没有文件",
        action: "添加文件",
        busyTitle: "正在导入文件…",
        busyAction: "add-file",
      },
      note: { title: "添加笔记", emptyTitle: "还没有笔记", action: "新建笔记" },
      directory: {
        title: "导入目录",
        emptyTitle: "还没有目录",
        action: "选择目录",
        busyTitle: "正在导入目录…",
        busyAction: "add-directory",
      },
      url: { title: "添加网址", emptyTitle: "还没有网址", action: "添加网址" },
      website: { title: "添加网站", emptyTitle: "还没有网站", action: "添加网站" },
    };
    const copy = composerCopy[activeTab];
    const Icon = activeTab === "file" ? UploadCloud : activeTabMeta.icon;
    const actionBusy = copy.busyAction ? busyAction === copy.busyAction : false;

    function handleComposerAction() {
      if (activeTab === "file") {
        void handleAddFiles();
        return;
      }

      if (activeTab === "directory") {
        void handleAddDirectory();
        return;
      }

      openComposerModal(activeTab as KnowledgeComposerModal);
    }

    if (showEmptyComposerStage) {
      return (
        <div className={clsx("knowledge-empty-upload", actionBusy && "busy")} aria-busy={actionBusy}>
          <span className="knowledge-upload-illustration" aria-hidden="true">
            {actionBusy ? <LoaderCircle size={30} className="spin" /> : <Icon size={34} />}
          </span>
          <div className="knowledge-empty-upload-copy">
            <strong>{actionBusy ? (copy.busyTitle ?? "处理中…") : copy.emptyTitle}</strong>
            <span>{selectedBase.name}</span>
          </div>
          <button
            className="primary-button knowledge-upload-button"
            onClick={handleComposerAction}
            disabled={controlsDisabled}
            type="button"
          >
            {actionBusy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
            {actionBusy ? "处理中…" : copy.action}
          </button>
        </div>
      );
    }

    return (
      <div className={clsx("knowledge-composer-card", "compact", "trigger-only", actionBusy && "busy")}>
        <span className="knowledge-composer-icon" aria-hidden="true">
          {actionBusy ? <LoaderCircle size={16} className="spin" /> : <Icon size={16} />}
        </span>
        <div className="knowledge-composer-copy">
          <strong>{copy.title}</strong>
          <span>
            {currentItems.length} 项{currentTypeLabel}
          </span>
        </div>
        <button
          className="primary-button"
          onClick={handleComposerAction}
          disabled={controlsDisabled}
          type="button"
        >
          {actionBusy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
          {actionBusy ? "处理中…" : copy.action}
        </button>
      </div>
    );
  }

  function renderComposerModal() {
    if (!composerModal || !selectedBase) return null;

    if (composerModal === "note") {
      return (
        <div className="modal-scrim" onClick={closeComposerModal}>
          <div className="knowledge-modal" onClick={(event) => event.stopPropagation()}>
            <div className="knowledge-modal-head">
              <div>
                <strong>添加笔记</strong>
              </div>
              <button className="knowledge-icon-button" onClick={closeComposerModal} disabled={controlsDisabled} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="knowledge-modal-body">
              <input
                value={noteTitle}
                onChange={(event) => setNoteTitle(event.target.value)}
                placeholder="笔记标题"
                disabled={controlsDisabled}
              />
              <textarea
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                rows={8}
                placeholder="写下要保存的说明或摘要"
                disabled={controlsDisabled}
              />
            </div>
            <div className="knowledge-modal-actions">
              <button className="secondary-button" onClick={closeComposerModal} disabled={controlsDisabled}>
                取消
              </button>
              <button className="primary-button" onClick={() => void handleAddNote()} disabled={controlsDisabled}>
                {busyAction === "add-note" ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                {busyAction === "add-note" ? "保存中…" : "保存笔记"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    const isUrl = composerModal === "url";
    const value = isUrl ? urlValue : websiteValue;
    const setValue = isUrl ? setUrlValue : setWebsiteValue;
    const busy = isUrl ? busyAction === "add-url" : busyAction === "add-website";
    const submit = isUrl ? handleAddUrl : handleAddWebsite;

    return (
      <div className="modal-scrim" onClick={closeComposerModal}>
        <div className="knowledge-modal small" onClick={(event) => event.stopPropagation()}>
          <div className="knowledge-modal-head">
            <div>
              <strong>{isUrl ? "添加网址" : "添加网站"}</strong>
            </div>
            <button className="knowledge-icon-button" onClick={closeComposerModal} disabled={controlsDisabled} title="关闭">
              <X size={16} />
            </button>
          </div>
          <div className="knowledge-modal-body">
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={isUrl ? "https://example.com/page" : "https://example.com"}
              disabled={controlsDisabled}
            />
          </div>
          <div className="knowledge-modal-actions">
            <button className="secondary-button" onClick={closeComposerModal} disabled={controlsDisabled}>
              取消
            </button>
            <button className="primary-button" onClick={() => void submit()} disabled={controlsDisabled}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
              {busy ? "添加中…" : isUrl ? "添加网址" : "添加网站"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="knowledge-shell">
        <aside className="knowledge-sidebar">
          <header className="knowledge-sidebar-head">
            <h2>
              <span className="knowledge-sidebar-title-icon">
                <BookOpen size={18} />
              </span>
              知识库
            </h2>
            <div className="knowledge-sidebar-overview" aria-label="知识库概览">
              <span>
                <strong>{knowledgeBaseCount}</strong>
                <em>库</em>
              </span>
              <span>
                <strong>{totalItemCount}</strong>
                <em>资料</em>
              </span>
              <span>
                <strong>{totalChunkCount}</strong>
                <em>切片</em>
              </span>
            </div>
          </header>

          <div className="knowledge-base-list">
            {knowledgeBases.map((base) => (
              <button
                key={base.id}
                className={clsx("knowledge-base-row", selectedBase?.id === base.id && "active")}
                onClick={() => setSelectedBaseId(base.id)}
                disabled={controlsDisabled}
              >
                <span className="knowledge-base-icon">
                  <BookOpen size={16} />
                </span>
                <div className="knowledge-base-copy">
                  <strong>{base.name}</strong>
                  <span>{base.itemCount} 条资料</span>
                </div>
                <em>{formatRelativeTime(base.updatedAt)}</em>
              </button>
            ))}
          </div>

          <div className="knowledge-sidebar-create">
            <div className="knowledge-sidebar-create-head">
              <strong>新建知识库</strong>
            </div>
            <input
              value={draftBaseName}
              onChange={(event) => setDraftBaseName(event.target.value)}
              placeholder="例如：产品文档"
              disabled={controlsDisabled}
            />
            <textarea
              value={draftBaseDescription}
              onChange={(event) => setDraftBaseDescription(event.target.value)}
              placeholder="可选描述"
              disabled={controlsDisabled}
              rows={3}
            />
            <button
              type="button"
              className="primary-button knowledge-create-button"
              onClick={() => void handleCreateBase()}
              disabled={controlsDisabled}
            >
              {busyAction === "create-base" ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
              {busyAction === "create-base" ? "创建中…" : "创建知识库"}
            </button>
          </div>
        </aside>

        <div className="knowledge-main">
          <div className="knowledge-panel">
            {selectedBase ? (
              <div className="knowledge-detail">
                <section className="knowledge-hero simple">
                  <div className="knowledge-hero-head">
                    <div className="knowledge-hero-copy">
                      <span className="knowledge-kicker">当前知识库</span>
                      <h3>{selectedBase.name}</h3>
                      <p>{selectedBase.description?.trim() || `${selectedBase.itemCount} 条资料`}</p>
                    </div>
                    <div className="knowledge-hero-metrics" aria-label="当前知识库统计">
                      <span className="knowledge-stat-card">
                        <strong>{selectedBase.itemCount}</strong>
                        <em>资料</em>
                      </span>
                      <span className="knowledge-stat-card">
                        <strong>{selectedBase.chunkCount}</strong>
                        <em>切片</em>
                      </span>
                      <span className="knowledge-stat-card">
                        <strong>{formatRelativeTime(selectedBase.updatedAt)}</strong>
                        <em>更新</em>
                      </span>
                    </div>
                    <div className="knowledge-hero-actions">
                      <button
                        className="knowledge-icon-button"
                        onClick={() => void handleRefresh()}
                        disabled={controlsDisabled}
                        title="刷新知识库"
                      >
                        {refreshBusy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                      </button>

                      {confirmDeleteBase ? (
                        <>
                          <button
                            className="knowledge-icon-button"
                            onClick={() => setConfirmDeleteBase(false)}
                            disabled={controlsDisabled}
                            title="取消删除"
                          >
                            <X size={16} />
                          </button>
                          <button
                            className="knowledge-icon-button danger"
                            onClick={() => void handleDeleteBase()}
                            disabled={controlsDisabled}
                            title="确认删除知识库"
                          >
                            {busyAction === "delete-base" ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        </>
                      ) : (
                        <button
                          className="knowledge-icon-button"
                          onClick={() => setConfirmDeleteBase(true)}
                          disabled={controlsDisabled}
                          title="删除知识库"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="knowledge-hero-main">
                    <div className="knowledge-settings-strip">
                      <label className="knowledge-setting-card">
                        <span className="knowledge-setting-label">
                          <Settings2 size={14} />
                          提供商
                        </span>
                        <SurfaceSelect
                          align="left"
                          ariaLabel="选择 Embedding 提供商"
                          className="knowledge-setting-select"
                          disabled={controlsDisabled}
                          emptyLabel="暂无提供商"
                          fullWidth
                          onChange={onChangeEmbeddingProvider}
                          options={embeddingProviderOptions}
                          value={embeddingProvider?.id ?? config.embeddingProviderId}
                        />
                      </label>

                      <label className="knowledge-setting-card grow">
                        <span className="knowledge-setting-label">模型</span>
                        {embeddingModels.length > 0 ? (
                          <SurfaceSelect
                            align="left"
                            ariaLabel="选择 Embedding 模型"
                            className="knowledge-setting-select wide"
                            disabled={controlsDisabled}
                            emptyLabel="无可用的 Embedding 模型"
                            fullWidth
                            onChange={onChangeEmbeddingModel}
                            options={embeddingModelOptions}
                            value={activeEmbeddingModel?.id ?? config.embeddingModel}
                          />
                        ) : (
                          <div
                            className="knowledge-setting-empty"
                            title={`${embeddingProvider?.name ?? "当前提供商"} 无可用的 Embedding 模型`}
                          >
                            <strong>无可用的 Embedding 模型</strong>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>
                </section>

                <section className="knowledge-content-toolbar compact">
                  <div className="knowledge-tabs">
                    {TAB_ITEMS.map((item) => {
                      const Icon = item.icon;
                      const count = tabCounts.get(item.itemType) ?? 0;
                      return (
                        <button
                          key={item.key}
                          className={clsx("knowledge-tab", activeTab === item.key && "active")}
                          onClick={() => setActiveTab(item.key)}
                          disabled={controlsDisabled}
                        >
                          <Icon size={15} />
                          <span>{item.label}</span>
                          <em>{count}</em>
                        </button>
                      );
                    })}
                  </div>

                  {showToolbarActions ? (
                    <div className="knowledge-toolbar-actions">
                      <label className="search-field knowledge-search-field">
                        <Search size={15} />
                        <input
                          value={itemQuery}
                          onChange={(event) => setItemQuery(event.target.value)}
                          placeholder={`搜索${currentTypeLabel}`}
                          disabled={controlsDisabled}
                        />
                      </label>

                      <div className="knowledge-sort-field">
                        <SurfaceSelect
                          align="right"
                          ariaLabel="选择排序方式"
                          disabled={controlsDisabled}
                          fullWidth
                          onChange={(value) => setSortKey(value as KnowledgeSortKey)}
                          options={sortOptions}
                          value={sortKey}
                        />
                      </div>
                    </div>
                  ) : null}
                </section>

                <div className="knowledge-detail-body">
                  {renderComposerTrigger()}

                  <div className="knowledge-results">
                    {hasFilteredItems ? (
                      <div className="knowledge-item-stack">
                        {filteredItems.map((item) => {
                          const itemMeta = getItemMeta(item.type);
                          const Icon = itemMeta.icon;
                          const confirmingDelete = confirmDeleteItemId === item.id;

                          return (
                            <article
                              key={item.id}
                              className={clsx("knowledge-list-row", confirmingDelete && "confirming-delete")}
                            >
                              <div className="knowledge-list-icon compact">
                                <Icon size={15} />
                              </div>

                              <div className="knowledge-list-copy">
                                <div className="knowledge-list-title-row">
                                  <strong title={item.title}>{item.title}</strong>
                                  <time>{formatRelativeTime(item.updatedAt)}</time>
                                </div>
                                <span title={resolveItemSource(item)}>{resolveItemSource(item)}</span>
                              </div>

                              <div className="knowledge-list-actions">
                                {confirmingDelete ? (
                                  <>
                                    <button
                                      className="knowledge-inline-action"
                                      onClick={() => setConfirmDeleteItemId(null)}
                                      disabled={controlsDisabled}
                                    >
                                      取消
                                    </button>
                                    <button
                                      className="knowledge-inline-action danger"
                                      onClick={() => void handleDeleteItem(item.id)}
                                      disabled={controlsDisabled}
                                    >
                                      {busyAction === `delete-item:${item.id}` ? (
                                        <LoaderCircle size={14} className="spin" />
                                      ) : (
                                        <Trash2 size={14} />
                                      )}
                                      删除
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    className="knowledge-icon-button"
                                    onClick={() => setConfirmDeleteItemId(item.id)}
                                    disabled={controlsDisabled}
                                    title="删除资料"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : isSearchActive ? (
                      <div className="knowledge-empty simple knowledge-search-empty">
                        <strong>未找到匹配资料</strong>
                        <span>{currentTypeLabel}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="knowledge-empty wide knowledge-empty-stage simple">
                <BookOpen size={34} />
                <strong>还没有知识库</strong>
                <span>0 库 · 0 资料</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {renderComposerModal()}
    </>
  );
}
