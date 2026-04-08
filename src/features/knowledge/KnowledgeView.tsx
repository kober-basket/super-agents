import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  isEmbeddingModel,
} from "../../lib/model-config";
import {
  BookOpen,
  FileText,
  Folder,
  Globe,
  Link2,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";

import type {
  AppConfig,
  KnowledgeBaseSummary,
  KnowledgeItemSummary,
  KnowledgeItemType,
  ModelProviderConfig,
} from "../../types";

type KnowledgeTabKey = "file" | "note" | "directory" | "url" | "website";

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

function itemSecondary(item: KnowledgeItemSummary) {
  return `${item.source} · ${item.chunkCount} chunks`;
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
}: KnowledgeViewProps) {
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [activeTab, setActiveTab] = useState<KnowledgeTabKey>("file");
  const [draftBaseName, setDraftBaseName] = useState("");
  const [draftBaseDescription, setDraftBaseDescription] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [websiteValue, setWebsiteValue] = useState("");

  const selectedBase =
    knowledgeBases.find((base) => base.id === selectedBaseId) ??
    knowledgeBases[0] ??
    null;

  useEffect(() => {
    if (!selectedBaseId && knowledgeBases[0]?.id) {
      setSelectedBaseId(knowledgeBases[0].id);
      return;
    }

    if (selectedBaseId && !knowledgeBases.some((base) => base.id === selectedBaseId)) {
      setSelectedBaseId(knowledgeBases[0]?.id ?? "");
    }
  }, [knowledgeBases, selectedBaseId]);

  const currentType = TAB_ITEMS.find((item) => item.key === activeTab)?.itemType ?? "file";
  const embeddingProvider =
    modelProviders.find((provider) => provider.id === config.embeddingProviderId) ??
    modelProviders[0] ??
    null;
  const embeddingModels = useMemo(() => {
    if (!embeddingProvider) return [];
    return embeddingProvider.models.filter(isEmbeddingModel);
  }, [embeddingProvider]);

  const currentItems = useMemo(() => {
    if (!selectedBase) return [];
    return selectedBase.items.filter((item) => item.type === currentType);
  }, [currentType, selectedBase]);

  const tabCounts = useMemo(() => {
    const counts = new Map<KnowledgeItemType, number>();
    if (!selectedBase) return counts;
    for (const item of selectedBase.items) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    }
    return counts;
  }, [selectedBase]);

  async function handleCreateBase() {
    const name = draftBaseName.trim() || `新知识库 ${knowledgeBases.length + 1}`;
    const createdBaseId = await onCreateKnowledgeBase(name, draftBaseDescription.trim());
    setDraftBaseName("");
    setDraftBaseDescription("");
    if (createdBaseId) {
      setSelectedBaseId(createdBaseId);
    }
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
    await onAddKnowledgeNote(selectedBase.id, title, content);
    setNoteTitle("");
    setNoteContent("");
  }

  async function handleAddUrl() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    const url = urlValue.trim();
    if (!url) {
      onToast("请先输入网址");
      return;
    }
    await onAddKnowledgeUrl(selectedBase.id, url);
    setUrlValue("");
  }

  async function handleAddWebsite() {
    if (!selectedBase) {
      onToast("请先创建或选择一个知识库");
      return;
    }
    const url = websiteValue.trim();
    if (!url) {
      onToast("请先输入网站地址");
      return;
    }
    await onAddKnowledgeWebsite(selectedBase.id, url);
    setWebsiteValue("");
  }

  function renderComposer() {
    if (!selectedBase) return null;

    if (activeTab === "file") {
      return (
        <button className="knowledge-dropzone" onClick={() => void onAddKnowledgeFiles(selectedBase.id)}>
          <strong>拖拽文件到这里</strong>
          <span>当前稳定支持 TXT、MD、HTML 等文本内容，点击这里也可以直接选择文件。</span>
        </button>
      );
    }

    if (activeTab === "directory") {
      return (
        <div className="knowledge-composer-card compact">
          <div className="knowledge-composer-copy">
            <strong>添加目录</strong>
            <span>导入整个文件夹中的文本内容，适合项目文档或资料目录。</span>
          </div>
          <button className="primary-button" onClick={() => void onAddKnowledgeDirectory(selectedBase.id)} disabled={knowledgeRefreshing}>
            <Plus size={14} />
            选择目录
          </button>
        </div>
      );
    }

    if (activeTab === "note") {
      return (
        <div className="knowledge-composer-card">
          <div className="knowledge-composer-grid">
            <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="笔记标题" />
            <textarea value={noteContent} onChange={(event) => setNoteContent(event.target.value)} rows={4} placeholder="写一段笔记内容" />
          </div>
          <button className="primary-button" onClick={() => void handleAddNote()} disabled={knowledgeRefreshing}>
            <Plus size={14} />
            添加笔记
          </button>
        </div>
      );
    }

    if (activeTab === "url") {
      return (
        <div className="knowledge-composer-card compact">
          <div className="knowledge-composer-grid single">
            <input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.com/page" />
          </div>
          <button className="primary-button" onClick={() => void handleAddUrl()} disabled={knowledgeRefreshing}>
            <Plus size={14} />
            添加网址
          </button>
        </div>
      );
    }

    return (
      <div className="knowledge-composer-card compact">
        <div className="knowledge-composer-grid single">
          <input value={websiteValue} onChange={(event) => setWebsiteValue(event.target.value)} placeholder="https://example.com 或 sitemap.xml" />
        </div>
        <button className="primary-button" onClick={() => void handleAddWebsite()} disabled={knowledgeRefreshing}>
          <Plus size={14} />
          添加网站
        </button>
      </div>
    );
  }

  return (
    <section className="knowledge-shell">
      <aside className="knowledge-sidebar">
        <header className="knowledge-sidebar-head">
          <h2>知识库</h2>
          <p>按库管理内容，再决定哪些库参与对话检索。</p>
        </header>

        <div className="knowledge-base-list">
          {knowledgeBases.map((base) => (
            <button
              key={base.id}
              className={clsx("knowledge-base-row", selectedBase?.id === base.id && "active")}
              onClick={() => setSelectedBaseId(base.id)}
            >
              <BookOpen size={16} />
              <div className="knowledge-base-copy">
                <strong>{base.name}</strong>
                <span>{base.itemCount} 项内容</span>
              </div>
            </button>
          ))}
        </div>

        <div className="knowledge-sidebar-create">
          <strong>新建知识库</strong>
          <input value={draftBaseName} onChange={(event) => setDraftBaseName(event.target.value)} placeholder="例如：产品文档" />
          <textarea
            value={draftBaseDescription}
            onChange={(event) => setDraftBaseDescription(event.target.value)}
            rows={3}
            placeholder="一句话描述这个知识库里放什么"
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleCreateBase()}
            disabled={knowledgeRefreshing}
          >
            <Plus size={14} />
            添加
          </button>
        </div>
      </aside>

      <div className="knowledge-main">
        <div className="knowledge-topbar">
          <div className="knowledge-topbar-copy">
            <h3>{selectedBase?.name ?? "知识库"}</h3>
            <span>{selectedBase?.description || "选择一个知识库后，在右侧管理文件、笔记、目录、网址和网站。对话检索的开启和选择已经移到聊天输入框旁边。"}</span>
          </div>

          <div className="knowledge-topbar-actions">
            <button className="ghost-icon" onClick={() => void onRefresh()} title="刷新">
              <RefreshCw size={18} className={clsx(knowledgeRefreshing && "spin")} />
            </button>
            {selectedBase ? (
              <button className="ghost-icon" onClick={() => void onDeleteKnowledgeBase(selectedBase.id)} title="删除知识库">
                <Trash2 size={18} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="knowledge-settings-strip">
          <div className="knowledge-chip">
            <Settings size={14} />
            <span>嵌入提供商</span>
            <select value={config.embeddingProviderId} onChange={(event) => onChangeEmbeddingProvider(event.target.value)}>
              {modelProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div className="knowledge-chip grow">
            <span>嵌入模型</span>
            {embeddingModels.length > 0 ? (
              <select value={config.embeddingModel} onChange={(event) => onChangeEmbeddingModel(event.target.value)}>
                {embeddingModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            ) : (
              <input value={config.embeddingModel} onChange={(event) => onChangeEmbeddingModel(event.target.value)} placeholder="先去模型设置里刷新模型列表" />
            )}
          </div>
        </div>

        {selectedBase ? (
          <>
            <div className="knowledge-tabs">
              {TAB_ITEMS.map((item) => {
                const Icon = item.icon;
                const count = tabCounts.get(item.itemType) ?? 0;
                return (
                  <button
                    key={item.key}
                    className={clsx("knowledge-tab", activeTab === item.key && "active")}
                    onClick={() => setActiveTab(item.key)}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                    <em>{count}</em>
                  </button>
                );
              })}
            </div>

            <div className="knowledge-panel">
              {renderComposer()}

              {currentItems.length > 0 ? (
                <div className="knowledge-item-stack">
                  {currentItems.map((item) => (
                    <article key={item.id} className="knowledge-list-row">
                      <div className="knowledge-list-copy">
                        <strong>{item.title}</strong>
                        <span>{itemSecondary(item)}</span>
                      </div>
                      <div className="knowledge-list-meta">
                        <span>{formatItemType(item.type)}</span>
                        <span>{item.chunkCount}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="knowledge-empty">
                  <strong>暂无数据</strong>
                  <span>当前标签下还没有内容，先用上面的入口添加一些资料。</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="knowledge-empty wide">
            <strong>还没有知识库</strong>
            <span>先在左侧创建一个知识库，再往里添加内容。</span>
          </div>
        )}
      </div>
    </section>
  );
}
