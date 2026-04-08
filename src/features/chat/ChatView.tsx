import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import clsx from "clsx";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";

import type {
  AppConfig,
  FileDropEntry,
  KnowledgeBaseSummary,
  RuntimeModelOption,
  ThreadRecord,
} from "../../types";
import { normalizeDroppedFiles } from "../shared/utils";
import { EMPTY_SUGGESTIONS } from "./constants";
import { MessageBlock } from "./MessageBlock";

interface ChatViewProps {
  activeThread: ThreadRecord | null;
  attachments: FileDropEntry[];
  composer: string;
  composerModelId: string;
  composing?: boolean;
  currentWorkspaceLabel: string;
  currentWorkspacePath: string;
  dragActive: boolean;
  knowledgeBases: KnowledgeBaseSummary[];
  knowledgeConfig: AppConfig["knowledgeBase"];
  messageListRef: RefObject<HTMLDivElement>;
  previewAvailable: boolean;
  previewOpen: boolean;
  selectedSkillName: string | null;
  selectableModels: RuntimeModelOption[];
  sending: boolean;
  slashSkillSuggestions: Array<{ id: string; name: string; description?: string; source: string }>;
  title: string;
  workspaceIssue?: string | null;
  onApplySuggestion: (prompt: string) => void;
  onChooseWorkspace: () => void | Promise<void>;
  onComposerChange: (value: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  onDragActiveChange: (active: boolean) => void;
  onFilesDropped: (files: FileDropEntry[]) => void;
  onOpenFile: (file: FileDropEntry) => void;
  onOpenKnowledge: () => void;
  onOpenLink: (url: string) => void;
  onPickFiles: () => void | Promise<void>;
  onModelChange: (modelId: string) => void;
  onRemoveAttachment: (id: string) => void;
  onRemoveSelectedSkill: () => void;
  onSelectSlashSkill: (skillId: string) => void;
  onSend: () => void | Promise<void>;
  onToggleKnowledgeBase: (baseId: string) => void;
  onTogglePreviewPane: () => void;
}

export function ChatView({
  activeThread,
  attachments,
  composer,
  composerModelId,
  composing,
  currentWorkspaceLabel,
  currentWorkspacePath,
  dragActive,
  knowledgeBases,
  knowledgeConfig,
  messageListRef,
  previewAvailable,
  previewOpen,
  selectedSkillName,
  selectableModels,
  sending,
  slashSkillSuggestions,
  title,
  workspaceIssue,
  onApplySuggestion,
  onChooseWorkspace,
  onComposerChange,
  onCompositionChange,
  onDragActiveChange,
  onFilesDropped,
  onOpenFile,
  onOpenKnowledge,
  onOpenLink,
  onPickFiles,
  onModelChange,
  onRemoveAttachment,
  onRemoveSelectedSkill,
  onSelectSlashSkill,
  onSend,
  onToggleKnowledgeBase,
  onTogglePreviewPane,
}: ChatViewProps) {
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const knowledgePickerRef = useRef<HTMLDivElement>(null);
  const hasAvailableModel = Boolean(composerModelId && selectableModels.length > 0);
  const canSend = hasAvailableModel && !composing && !sending && (Boolean(composer.trim()) || attachments.length > 0);
  const selectedKnowledgeBases = useMemo(
    () => knowledgeBases.filter((base) => knowledgeConfig.selectedBaseIds.includes(base.id)),
    [knowledgeBases, knowledgeConfig.selectedBaseIds],
  );
  const knowledgeSummary = selectedKnowledgeBases.length > 0 ? `已选 ${selectedKnowledgeBases.length} 个` : "未选知识库";

  useEffect(() => {
    if (!knowledgePickerOpen) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!knowledgePickerRef.current?.contains(event.target as Node)) {
        setKnowledgePickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [knowledgePickerOpen]);

  return (
    <section className="workspace-body">
      <header className="workspace-header">
        <div className="workspace-title">
          <div className="workspace-title-copy">
            <span className="workspace-label">当前会话</span>
            <h1>{title}</h1>
            <span className="workspace-path">{currentWorkspacePath}</span>
          </div>
        </div>

        <div className="workspace-actions">
          <button
            className="folder-button workspace-folder-button"
            onClick={() => void onChooseWorkspace()}
            title="切换当前会话工作目录"
          >
            <FolderOpen size={16} />
            <span>{currentWorkspaceLabel}</span>
            <ChevronDown size={14} />
          </button>
          <button
            className="ghost-icon"
            onClick={onTogglePreviewPane}
            title="切换右侧预览"
            disabled={!previewAvailable}
          >
            {previewOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div className="workspace-main" ref={messageListRef}>
        <div className="chat-column">
          {workspaceIssue ? (
            <div className="workspace-issue" role="alert">
              <strong>当前状态未完全刷新</strong>
              <span>{workspaceIssue}</span>
            </div>
          ) : null}

          {activeThread?.messages.length ? (
            <div className="message-list">
              {activeThread.messages.map((message) => (
                <MessageBlock key={message.id} message={message} onOpenFile={onOpenFile} onOpenLink={onOpenLink} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-mark">
                <Sparkles size={20} />
              </div>
              <strong>从这里开始这一轮工作</strong>
              <span>你可以先切换当前会话的工作目录，再继续提问、附文件，或者直接使用技能。</span>
              <div className="suggestion-row">
                {EMPTY_SUGGESTIONS.map((item) => (
                  <button key={item} className="suggestion-chip" onClick={() => onApplySuggestion(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="composer-shell">
        <div className="chat-column">
          <div className="composer-card">
            {selectedSkillName ? (
              <div className="composer-skill-chip">
                <span>技能</span>
                <strong>{selectedSkillName}</strong>
                <button onClick={onRemoveSelectedSkill} title="取消技能">
                  <X size={11} />
                </button>
              </div>
            ) : null}

            {attachments.length > 0 ? (
              <div className="composer-files">
                {attachments.map((file) => (
                  <span key={file.id} className="composer-file-chip">
                    {file.name}
                    <button onClick={() => onRemoveAttachment(file.id)}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="composer-input-wrap">
              <textarea
                value={composer}
                onChange={(event) => onComposerChange(event.target.value)}
                onCompositionStart={() => onCompositionChange?.(true)}
                onCompositionEnd={() => onCompositionChange?.(false)}
                placeholder="写点什么，输入 / 可以选择技能"
                rows={5}
                className={clsx(dragActive && "drag-active")}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) {
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey && hasAvailableModel) {
                    event.preventDefault();
                    void onSend();
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onDragActiveChange(false);
                  const files = normalizeDroppedFiles(event.dataTransfer.files);
                  if (files.length > 0) {
                    onFilesDropped(files);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  onDragActiveChange(true);
                }}
                onDragLeave={() => onDragActiveChange(false)}
              />

              {slashSkillSuggestions.length > 0 ? (
                <div className="slash-skill-panel" role="listbox" aria-label="技能选择">
                  {slashSkillSuggestions.map((skill) => (
                    <button key={skill.id} className="slash-skill-option" onClick={() => onSelectSlashSkill(skill.id)}>
                      <div className="slash-skill-copy">
                        <strong>{skill.name}</strong>
                        <span>{skill.description || "技能"}</span>
                      </div>
                      <small>{skill.source === "installed" ? "已安装" : "已发现"}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="composer-toolbar">
              <div className="toolbar-left">
                <div className="knowledge-picker" ref={knowledgePickerRef}>
                  <button
                    type="button"
                    className={clsx("toolbar-chip", "knowledge-toolbar-trigger", selectedKnowledgeBases.length > 0 && "active")}
                    onClick={() => setKnowledgePickerOpen((value) => !value)}
                    title="选择对话里要检索的知识库"
                  >
                    <BookOpen size={14} />
                    <span>知识库</span>
                    <em>{knowledgeSummary}</em>
                    <ChevronDown size={13} className={clsx("knowledge-trigger-arrow", knowledgePickerOpen && "open")} />
                  </button>

                  {knowledgePickerOpen ? (
                    <div className="knowledge-picker-panel">
                      <div className="knowledge-picker-head">
                        <div className="knowledge-picker-head-copy">
                          <strong>对话知识库</strong>
                          <span>选中某个知识库后，会在当前聊天里自动启用检索。</span>
                        </div>
                      </div>

                      {knowledgeBases.length > 0 ? (
                        <div className="knowledge-picker-list">
                          {knowledgeBases.map((base) => {
                            const selected = knowledgeConfig.selectedBaseIds.includes(base.id);
                            return (
                              <button
                                key={base.id}
                                type="button"
                                className={clsx("knowledge-picker-row", selected && "selected")}
                                onClick={() => onToggleKnowledgeBase(base.id)}
                              >
                                <div className="knowledge-picker-copy">
                                  <strong>{base.name}</strong>
                                  <span>{base.itemCount} 项内容</span>
                                </div>
                                <span className={clsx("knowledge-picker-check", selected && "selected")}>
                                  {selected ? <Check size={13} /> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="knowledge-picker-empty">
                          <strong>还没有知识库</strong>
                          <span>先去知识库页创建一个，再回来这里选择。</span>
                        </div>
                      )}

                      <button
                        type="button"
                        className="knowledge-picker-manage"
                        onClick={() => {
                          setKnowledgePickerOpen(false);
                          onOpenKnowledge();
                        }}
                      >
                        管理知识库内容
                      </button>
                    </div>
                  ) : null}
                </div>
                <label className="select-shell toolbar-select" title="选择模型">
                  <select value={composerModelId} onChange={(event) => onModelChange(event.target.value)}>
                    {selectableModels.length > 0 ? (
                      selectableModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))
                    ) : (
                      <option value="">暂无可用模型</option>
                    )}
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>

              <div className="toolbar-right">
                <button className="toolbar-icon" onClick={() => void onPickFiles()} title="选择附件">
                  <Paperclip size={16} />
                </button>
                <button
                  className="send-button"
                  onClick={() => void onSend()}
                  disabled={!canSend}
                  title={
                    !hasAvailableModel
                      ? "请先配置并启用可用模型"
                      : composing
                        ? "请先确认输入法候选词"
                        : "发送"
                  }
                >
                  {sending ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}
