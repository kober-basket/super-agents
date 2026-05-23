import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  BookOpen,
  ChevronDown,
  FileText,
  Folder,
  Globe,
  HelpCircle,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import { createRuntimeModelId, isEmbeddingModel } from "../../lib/model-config";
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
  | "update-base"
  | "delete-base"
  | "add-file"
  | "add-note"
  | "add-directory"
  | "add-url"
  | "add-website"
  | `delete-item:${string}`;
type KnowledgeComposerModal = Extract<KnowledgeTabKey, "note" | "url" | "website"> | null;
type KnowledgeBaseModal = "create" | "edit" | null;

interface KnowledgeViewProps {
  config: AppConfig["knowledgeBase"];
  modelProviders: ModelProviderConfig[];
  knowledgeBases: KnowledgeBaseSummary[];
  knowledgeRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  onChangeEmbeddingSelection: (providerId: string, modelId: string) => void;
  onToast: (message: string) => void;
  onCreateKnowledgeBase: (name: string, description: string) => Promise<string | null> | string | null;
  onUpdateKnowledgeBase: (baseId: string, name: string, description: string) => Promise<boolean> | boolean;
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

function getKnowledgeBaseToneSeed(base: KnowledgeBaseSummary) {
  const value = `${base.id}:${base.name}`;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 8;
  }
  return hash;
}

function buildKnowledgeBaseToneMap(knowledgeBases: KnowledgeBaseSummary[]) {
  const tones = new Map<string, number>();
  const usedTones = new Set<number>();

  for (const base of knowledgeBases) {
    const seed = getKnowledgeBaseToneSeed(base);
    let tone = seed;

    if (usedTones.size < 8 && usedTones.has(tone)) {
      for (let offset = 1; offset < 8; offset += 1) {
        const candidate = (seed + offset) % 8;
        if (!usedTones.has(candidate)) {
          tone = candidate;
          break;
        }
      }
    }

    usedTones.add(tone);
    tones.set(base.id, tone);
  }

  return tones;
}

export interface KnowledgeEmbeddingModelOption {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelLabel: string;
}

export function buildEmbeddingModelOptions(modelProviders: ModelProviderConfig[]): KnowledgeEmbeddingModelOption[] {
  return modelProviders.flatMap((provider) => {
    if (provider.enabled === false) return [];

    return provider.models
      .filter((model) => model.enabled !== false && isEmbeddingModel(model))
      .map((model) => ({
        id: createRuntimeModelId(provider.id, model.id),
        label: `${provider.name} / ${model.label}`,
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelLabel: model.label,
      }));
  });
}

export function KnowledgeView({
  config,
  modelProviders,
  knowledgeBases,
  knowledgeRefreshing,
  onChangeEmbeddingSelection,
  onToast,
  onCreateKnowledgeBase,
  onUpdateKnowledgeBase,
  onDeleteKnowledgeBase,
  onAddKnowledgeFiles,
  onAddKnowledgeDirectory,
  onAddKnowledgeNote,
  onAddKnowledgeUrl,
  onAddKnowledgeWebsite,
  onDeleteKnowledgeItem,
}: KnowledgeViewProps) {
  const embeddingPickerRef = useRef<HTMLDivElement | null>(null);
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
  const [baseModal, setBaseModal] = useState<KnowledgeBaseModal>(null);
  const [embeddingPickerOpen, setEmbeddingPickerOpen] = useState(false);
  const [openBaseActionMenuId, setOpenBaseActionMenuId] = useState<string | null>(null);
  const [confirmDeleteBaseId, setConfirmDeleteBaseId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [composerModal, setComposerModal] = useState<KnowledgeComposerModal>(null);

  const selectedBase = knowledgeBases.find((base) => base.id === selectedBaseId) ?? knowledgeBases[0] ?? null;

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
    setConfirmDeleteBaseId(null);
    setOpenBaseActionMenuId(null);
    setConfirmDeleteItemId(null);
    setComposerModal(null);
  }, [selectedBaseId]);

  useEffect(() => {
    setConfirmDeleteItemId(null);
    setComposerModal(null);
  }, [activeTab]);

  useEffect(() => {
    if (!embeddingPickerOpen && !openBaseActionMenuId) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (embeddingPickerRef.current && !embeddingPickerRef.current.contains(target)) {
        setEmbeddingPickerOpen(false);
      }
      const actionMenuTarget = event.target instanceof Element ? event.target.closest(".knowledge-base-row-actions") : null;
      if (!actionMenuTarget) {
        setOpenBaseActionMenuId(null);
        setConfirmDeleteBaseId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEmbeddingPickerOpen(false);
        setOpenBaseActionMenuId(null);
        setConfirmDeleteBaseId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [embeddingPickerOpen, openBaseActionMenuId]);

  const currentType = TAB_ITEMS.find((item) => item.key === activeTab)?.itemType ?? "file";
  const currentTypeLabel = formatItemType(currentType);
  const activeTabMeta = getItemMeta(currentType);
  const embeddingModelOptions = useMemo(() => buildEmbeddingModelOptions(modelProviders), [modelProviders]);
  const knowledgeBaseToneMap = useMemo(() => buildKnowledgeBaseToneMap(knowledgeBases), [knowledgeBases]);
  const activeEmbeddingModel =
    embeddingModelOptions.find(
      (model) => model.providerId === config.embeddingProviderId && model.modelId === config.embeddingModel,
    ) ??
    embeddingModelOptions[0] ??
    null;
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
  const isSearchActive = itemQuery.trim().length > 0;
  const showToolbarActions = currentItems.length > 0 || isSearchActive;
  const hasFilteredItems = filteredItems.length > 0;

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

  function openCreateBaseModal() {
    setDraftBaseName("");
    setDraftBaseDescription("");
    setBaseModal("create");
    setOpenBaseActionMenuId(null);
    setConfirmDeleteBaseId(null);
  }

  function openEditBaseModal(base: KnowledgeBaseSummary) {
    setSelectedBaseId(base.id);
    setDraftBaseName(base.name);
    setDraftBaseDescription(base.description ?? "");
    setBaseModal("edit");
    setOpenBaseActionMenuId(null);
    setConfirmDeleteBaseId(null);
  }

  function closeBaseModal() {
    if (busyAction === "create-base" || busyAction === "update-base") {
      return;
    }
    setBaseModal(null);
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

  async function handleCreateBase() {
    const name = draftBaseName.trim();
    if (!name) {
      onToast("请先输入知识库名称");
      return;
    }
    const createdBaseId = await runBusyAction("create-base", async () =>
      onCreateKnowledgeBase(name, draftBaseDescription.trim()),
    );
    if (createdBaseId) {
      setDraftBaseName("");
      setDraftBaseDescription("");
      setSelectedBaseId(createdBaseId);
      setBaseModal(null);
    }
  }

  async function handleUpdateBase() {
    if (!selectedBase) return;
    const name = draftBaseName.trim();
    if (!name) {
      onToast("请先输入知识库名称");
      return;
    }
    const updated = await runBusyAction("update-base", async () =>
      onUpdateKnowledgeBase(selectedBase.id, name, draftBaseDescription.trim()),
    );
    if (updated) {
      setBaseModal(null);
    }
  }

  async function handleDeleteBase(baseId: string) {
    await runBusyAction("delete-base", async () => {
      await onDeleteKnowledgeBase(baseId);
    });
    setConfirmDeleteBaseId(null);
    setOpenBaseActionMenuId(null);
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

  function renderEmbeddingPicker() {
    const disabled = controlsDisabled || embeddingModelOptions.length === 0;
    const activeModelLabel = activeEmbeddingModel?.modelLabel.trim() || "未配置嵌入模型";

    return (
      <div ref={embeddingPickerRef} className="chat-model-picker knowledge-embedding-picker">
        <button
          aria-label={disabled ? "未配置嵌入模型" : `当前嵌入模型 ${activeModelLabel}`}
          className={`chat-model-trigger ${embeddingPickerOpen ? "open" : ""}`}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setEmbeddingPickerOpen((current) => !current);
          }}
          title={activeModelLabel}
          type="button"
        >
          <span className="chat-model-trigger-text">{activeModelLabel}</span>
          <ChevronDown size={14} />
        </button>

        {embeddingPickerOpen ? (
          <div className="chat-model-panel">
            <div className="chat-model-panel-head">
              <strong>选择嵌入模型</strong>
            </div>

            <div className="chat-model-list">
              {embeddingModelOptions.map((model) => {
                const selected = activeEmbeddingModel
                  ? model.providerId === activeEmbeddingModel.providerId && model.modelId === activeEmbeddingModel.modelId
                  : false;
                const fullLabel = model.modelLabel.trim() || model.modelId;
                const providerLabel = model.providerName.trim();

                return (
                  <button
                    key={model.id}
                    className={`chat-model-option ${selected ? "selected" : ""}`}
                    onClick={() => {
                      onChangeEmbeddingSelection(model.providerId, model.modelId);
                      setEmbeddingPickerOpen(false);
                    }}
                    aria-current={selected ? "true" : undefined}
                    type="button"
                  >
                    <strong className="chat-model-option-name" title={fullLabel}>
                      {fullLabel}
                    </strong>
                    <span className="chat-model-option-provider" title={providerLabel}>
                      {providerLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderBaseModal() {
    if (!baseModal) return null;

    const editing = baseModal === "edit";
    const busy = editing ? busyAction === "update-base" : busyAction === "create-base";
    const selectedTone = selectedBase ? knowledgeBaseToneMap.get(selectedBase.id) ?? getKnowledgeBaseToneSeed(selectedBase) : null;

    return (
      <div className="modal-scrim" onClick={closeBaseModal}>
        <div className="knowledge-modal knowledge-base-modal" onClick={(event) => event.stopPropagation()}>
          <div className="knowledge-base-modal-head">
            <span className={clsx("knowledge-base-modal-icon", selectedTone !== null && `tone-${selectedTone}`)}>
              <BookOpen size={18} />
            </span>
            <div className="knowledge-base-modal-title">
              <strong>{editing ? "编辑知识库" : "创建知识库"}</strong>
            </div>
            <button className="knowledge-icon-button" onClick={closeBaseModal} disabled={controlsDisabled} title="关闭">
              <X size={16} />
            </button>
          </div>
          <div className="knowledge-base-modal-fields">
            <label>
              <span>名称</span>
              <input
                value={draftBaseName}
                onChange={(event) => setDraftBaseName(event.target.value)}
                placeholder="知识库名称"
                disabled={controlsDisabled}
              />
            </label>
            <label>
              <span>描述</span>
              <textarea
                value={draftBaseDescription}
                onChange={(event) => setDraftBaseDescription(event.target.value)}
                placeholder="描述"
                disabled={controlsDisabled}
                rows={3}
              />
            </label>
          </div>
          <div className="knowledge-modal-actions">
            <button className="secondary-button" onClick={closeBaseModal} disabled={controlsDisabled}>
              取消
            </button>
            <button
              className="primary-button"
              onClick={() => void (editing ? handleUpdateBase() : handleCreateBase())}
              disabled={controlsDisabled}
            >
              {busy ? <LoaderCircle size={14} className="spin" /> : editing ? <Pencil size={14} /> : <Plus size={14} />}
              {busy ? (editing ? "保存中…" : "创建中…") : editing ? "保存修改" : "创建知识库"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderComposerTrigger() {
    if (!selectedBase) return null;

    const composerCopy: Record<
      KnowledgeTabKey,
      {
        title: string;
        action: string;
        busyTitle?: string;
        busyAction?: KnowledgeBusyAction;
      }
    > = {
      file: {
        title: "添加文件",
        action: "添加文件",
        busyTitle: "正在导入文件…",
        busyAction: "add-file",
      },
      note: { title: "添加笔记", action: "新建笔记" },
      directory: {
        title: "导入目录",
        action: "选择目录",
        busyTitle: "正在导入目录…",
        busyAction: "add-directory",
      },
      url: { title: "添加网址", action: "添加网址" },
      website: { title: "添加网站", action: "添加网站" },
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

    return (
      <div className={clsx("knowledge-ingest-panel", actionBusy && "busy")} aria-busy={actionBusy}>
        <span className="knowledge-ingest-icon" aria-hidden="true">
          {actionBusy ? <LoaderCircle size={16} className="spin" /> : <Icon size={17} />}
        </span>
        <strong>{actionBusy ? (copy.busyTitle ?? "处理中…") : copy.title}</strong>
        <button
          className="primary-button knowledge-ingest-action knowledge-upload-button"
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
            <div className="knowledge-sidebar-title-row">
              <h2>
                知识库
              </h2>
              <button
                aria-label="新建知识库"
                className="knowledge-icon-button knowledge-sidebar-create-trigger"
                disabled={controlsDisabled}
                onClick={openCreateBaseModal}
                title="新建知识库"
                type="button"
              >
                <Plus size={16} />
              </button>
            </div>
          </header>

          <div className="knowledge-base-list">
            {knowledgeBases.map((base) => {
              const active = selectedBase?.id === base.id;
              const menuOpen = openBaseActionMenuId === base.id;
              const confirmingDelete = confirmDeleteBaseId === base.id;
              const tone = knowledgeBaseToneMap.get(base.id) ?? getKnowledgeBaseToneSeed(base);

              return (
                <div
                  key={base.id}
                  className={clsx("knowledge-base-row", `tone-${tone}`, active && "active", menuOpen && "menu-open")}
                >
                  <button
                    className="knowledge-base-select"
                    onClick={() => setSelectedBaseId(base.id)}
                    disabled={controlsDisabled}
                    type="button"
                  >
                    <span className={clsx("knowledge-base-icon", `tone-${tone}`)} aria-hidden="true">
                      <BookOpen size={15} />
                    </span>
                    <div className="knowledge-base-copy">
                      <strong>{base.name}</strong>
                    </div>
                    <b className="knowledge-base-count" aria-label={`${base.itemCount} 条资料`}>
                      {base.itemCount}
                    </b>
                  </button>

                  <div className="knowledge-base-row-actions">
                    <button
                      aria-label={`管理知识库 ${base.name}`}
                      className="knowledge-icon-button knowledge-base-menu-trigger"
                      disabled={controlsDisabled}
                      onClick={() => {
                        setOpenBaseActionMenuId((current) => (current === base.id ? null : base.id));
                        setConfirmDeleteBaseId(null);
                      }}
                      title="更多操作"
                      type="button"
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {menuOpen ? (
                      <div className="knowledge-base-action-menu">
                        {confirmingDelete ? (
                          <>
                            <button
                              className="knowledge-inline-action"
                              onClick={() => setConfirmDeleteBaseId(null)}
                              disabled={controlsDisabled}
                              type="button"
                            >
                              取消
                            </button>
                            <button
                              className="knowledge-inline-action danger"
                              onClick={() => void handleDeleteBase(base.id)}
                              disabled={controlsDisabled}
                              type="button"
                            >
                              {busyAction === "delete-base" ? (
                                <LoaderCircle size={14} className="spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                              删除
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="knowledge-base-menu-item"
                              onClick={() => openEditBaseModal(base)}
                              disabled={controlsDisabled}
                              type="button"
                            >
                              <Pencil size={14} />
                              编辑
                            </button>
                            <button
                              className="knowledge-base-menu-item danger"
                              onClick={() => setConfirmDeleteBaseId(base.id)}
                              disabled={controlsDisabled}
                              type="button"
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="knowledge-main">
          <div className="knowledge-panel">
            {selectedBase ? (
              <div className="knowledge-detail">
                <section className="knowledge-hero simple">
                  <div className="knowledge-hero-main">
                    <div className="knowledge-embedding-row">
                      <div className="knowledge-setting-card knowledge-embedding-card">
                        <span className="knowledge-setting-label">
                          <Settings2 size={14} />
                          嵌入模型
                          <span className="knowledge-help-tip" aria-label="嵌入模型说明" tabIndex={0}>
                            <HelpCircle size={13} />
                            <span className="knowledge-help-tooltip" role="tooltip">
                              把资料转换成可检索向量，影响知识库搜索效果。
                            </span>
                          </span>
                        </span>
                        {renderEmbeddingPicker()}
                      </div>
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

      {renderBaseModal()}
      {renderComposerModal()}
    </>
  );
}
