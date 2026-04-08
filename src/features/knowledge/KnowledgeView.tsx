import clsx from "clsx";
import {
  CircleHelp,
  Database,
  FilePlus2,
  LoaderCircle,
  NotebookPen,
  RefreshCw,
  Trash2,
} from "lucide-react";

import type { AppConfig, KnowledgeBaseSummary, ModelProviderConfig } from "../../types";

interface KnowledgeViewProps {
  config: AppConfig["knowledgeBase"];
  modelProviders: ModelProviderConfig[];
  knowledgeBases: KnowledgeBaseSummary[];
  knowledgeRefreshing: boolean;
  draftName: string;
  draftDescription: string;
  noteTitle: string;
  noteContent: string;
  onDraftNameChange: (value: string) => void;
  onDraftDescriptionChange: (value: string) => void;
  onNoteTitleChange: (value: string) => void;
  onNoteContentChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onToggleEnabled: (enabled: boolean) => void;
  onChangeEmbeddingProvider: (value: string) => void;
  onChangeEmbeddingModel: (value: string) => void;
  onChangeDocumentCount: (value: number) => void;
  onChangeChunkSize: (value: number) => void;
  onChangeChunkOverlap: (value: number) => void;
  onToggleKnowledgeBase: (baseId: string) => void;
  onCreateKnowledgeBase: () => void | Promise<void>;
  onDeleteKnowledgeBase: (baseId: string) => void | Promise<void>;
  onAddKnowledgeFiles: (baseId: string) => void | Promise<void>;
  onAddKnowledgeNote: (baseId: string) => void | Promise<void>;
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text} aria-label={text}>
      <CircleHelp size={14} />
    </span>
  );
}

function LabeledTitle({ title, tip }: { title: string; tip?: string }) {
  return (
    <span className="knowledge-label">
      <span>{title}</span>
      {tip ? <HelpTip text={tip} /> : null}
    </span>
  );
}

export function KnowledgeView({
  config,
  modelProviders,
  knowledgeBases,
  knowledgeRefreshing,
  draftName,
  draftDescription,
  noteTitle,
  noteContent,
  onDraftNameChange,
  onDraftDescriptionChange,
  onNoteTitleChange,
  onNoteContentChange,
  onRefresh,
  onToggleEnabled,
  onChangeEmbeddingProvider,
  onChangeEmbeddingModel,
  onChangeDocumentCount,
  onToggleKnowledgeBase,
  onCreateKnowledgeBase,
  onDeleteKnowledgeBase,
  onAddKnowledgeFiles,
  onAddKnowledgeNote,
}: KnowledgeViewProps) {
  const selectedIds = new Set(config.selectedBaseIds);
  const latestBaseId = knowledgeBases[0]?.id ?? "";
  const selectedCount = selectedIds.size;

  return (
    <section className="skills-page">
      <div className="skills-inner knowledge-page">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>知识库</h2>
            <p>这里是你自己的知识库。把文件或笔记放进来后，和 agent 对话时会先检索这里的内容。</p>
          </div>

          <div className="skills-toolbar-actions">
            <button className={clsx("toggle-button", config.enabled && "active")} onClick={() => onToggleEnabled(!config.enabled)}>
              {config.enabled ? "已开启对话检索" : "未开启对话检索"}
            </button>
            <button className="secondary-button" onClick={() => void onRefresh()} disabled={knowledgeRefreshing}>
              {knowledgeRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              刷新
            </button>
          </div>
        </header>

        <div className="panel-grid knowledge-config-grid">
          <section className="panel-card form-card">
            <strong>最少配置</strong>
            <label>
              <LabeledTitle title="嵌入 Provider" tip="知识库需要先把文字转成向量，才能做语义检索。这里通常选你已经可用的模型提供商。" />
              <div className="select-shell field-select">
                <select value={config.embeddingProviderId} onChange={(event) => onChangeEmbeddingProvider(event.target.value)}>
                  {modelProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              <LabeledTitle title="嵌入模型" tip="这是用来做检索的模型，不是对话模型。一般填 embedding 模型，比如 text-embedding-3-small。" />
              <input
                value={config.embeddingModel}
                onChange={(event) => onChangeEmbeddingModel(event.target.value)}
                placeholder="text-embedding-3-small"
              />
            </label>
            <label>
              <LabeledTitle title="每次检索返回几条" tip="数值越大，agent 能看到的候选片段越多。小白先用默认值 5 就够了。" />
              <input
                value={String(config.documentCount)}
                onChange={(event) => onChangeDocumentCount(Number.parseInt(event.target.value || "5", 10) || 5)}
              />
            </label>
            <p className="field-note">不用先理解 chunk、overlap 这些概念，我已经用默认值处理好了，先直接用就行。</p>
          </section>

          <section className="panel-card action-card knowledge-status-card">
            <div className="knowledge-status-mark">
              <Database size={18} />
            </div>
            <strong>{config.enabled ? "发送消息时会自动先查知识库" : "当前不会自动把知识库内容带进对话"}</strong>
            <p>
              {selectedCount > 0
                ? `当前有 ${selectedCount} 个知识库会参与检索。`
                : "你还没有选择参与检索的知识库。"}
            </p>
          </section>
        </div>

        <div className="panel-grid knowledge-config-grid">
          <section className="panel-card form-card">
            <strong>1. 新建知识库</strong>
            <label>
              <LabeledTitle title="名称" tip="建议按主题来起名，比如“产品文档”“售前话术”“项目经验”。" />
              <input value={draftName} onChange={(event) => onDraftNameChange(event.target.value)} placeholder="例如：产品文档" />
            </label>
            <label>
              <LabeledTitle title="描述" tip="可选。写一句用途说明，后面回来看会更清楚。" />
              <textarea
                value={draftDescription}
                onChange={(event) => onDraftDescriptionChange(event.target.value)}
                rows={4}
                placeholder="这个知识库主要放什么内容"
              />
            </label>
            <button className="primary-button" onClick={() => void onCreateKnowledgeBase()} disabled={knowledgeRefreshing}>
              <Database size={16} />
              创建知识库
            </button>
          </section>

          <section className="panel-card form-card">
            <strong>2. 快速加一条笔记</strong>
            <label>
              <LabeledTitle title="笔记标题" tip="适合放固定规则、常用回复、步骤说明这类短内容。" />
              <input value={noteTitle} onChange={(event) => onNoteTitleChange(event.target.value)} placeholder="例如：部署步骤" />
            </label>
            <label>
              <LabeledTitle title="笔记内容" tip="会自动切分后存进知识库。建议一条笔记只讲一个主题。" />
              <textarea
                value={noteContent}
                onChange={(event) => onNoteContentChange(event.target.value)}
                rows={6}
                placeholder="把想加入知识库的内容直接贴进来"
              />
            </label>
            <button className="secondary-button" onClick={() => void onAddKnowledgeNote(latestBaseId)} disabled={!latestBaseId || knowledgeRefreshing}>
              <NotebookPen size={16} />
              加到最新知识库
            </button>
          </section>
        </div>

        <div className="skills-section">
          <div className="skills-section-head">
            <h3>3. 管理知识库</h3>
          </div>

          {knowledgeBases.length > 0 ? (
            <div className="tool-grid">
              {knowledgeBases.map((base) => (
                <article key={base.id} className={clsx("tool-card", selectedIds.has(base.id) && "knowledge-card-selected")}>
                  <div className="tool-card-head">
                    <div>
                      <strong>{base.name}</strong>
                      <span>{base.description || "无描述"}</span>
                    </div>
                    <button
                      className={clsx("toggle-button", selectedIds.has(base.id) && "active")}
                      onClick={() => onToggleKnowledgeBase(base.id)}
                      title="勾上后，这个知识库会参与和 agent 的对话检索。"
                    >
                      {selectedIds.has(base.id) ? "参与检索" : "加入检索"}
                    </button>
                  </div>
                  <p>{base.description || "这个知识库还没有描述。"}</p>
                  <div className="knowledge-card-meta">
                    <span>条目: {base.itemCount}</span>
                    <span>片段: {base.chunkCount}</span>
                  </div>
                  {base.items.length > 0 ? (
                    <div className="knowledge-item-list">
                      {base.items.slice(0, 3).map((item) => (
                        <div key={item.id} className="knowledge-item-row">
                          <strong>{item.title}</strong>
                          <span>{item.type} · {item.chunkCount} 段</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="knowledge-card-actions">
                    <button className="secondary-button" onClick={() => void onAddKnowledgeFiles(base.id)} disabled={knowledgeRefreshing}>
                      <FilePlus2 size={14} />
                      导入文件
                    </button>
                    <button className="ghost-text-button danger" onClick={() => void onDeleteKnowledgeBase(base.id)} disabled={knowledgeRefreshing}>
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel spacious">
              <strong>还没有知识库</strong>
              <p>先创建一个知识库，再导入文件或添加笔记，就可以让 agent 在对话里检索这些内容。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
