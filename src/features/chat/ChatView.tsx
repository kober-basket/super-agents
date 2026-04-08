import type { RefObject } from "react";
import clsx from "clsx";
import {
  ArrowUp,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import type { FileDropEntry, RuntimeModelOption, ThreadRecord } from "../../types";
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
  messageListRef: RefObject<HTMLDivElement | null>;
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
  onOpenAutomation: () => void;
  onOpenFile: (file: FileDropEntry) => void;
  onOpenLink: (url: string) => void;
  onPickFiles: () => void | Promise<void>;
  onModelChange: (modelId: string) => void;
  onRemoveAttachment: (id: string) => void;
  onRemoveSelectedSkill: () => void;
  onSelectSlashSkill: (skillId: string) => void;
  onSend: () => void | Promise<void>;
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
  onOpenAutomation,
  onOpenFile,
  onOpenLink,
  onPickFiles,
  onModelChange,
  onRemoveAttachment,
  onRemoveSelectedSkill,
  onSelectSlashSkill,
  onSend,
  onTogglePreviewPane,
}: ChatViewProps) {
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
          <button className="folder-button workspace-folder-button" onClick={() => void onChooseWorkspace()} title="切换当前会话工作目录">
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
              <span>你可以先切换当前会话的工作目录，再继续提问、附文件或直接使用技能。</span>
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

                  if (event.key === "Enter" && !event.shiftKey) {
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
                    <button
                      key={skill.id}
                      className="slash-skill-option"
                      onClick={() => onSelectSlashSkill(skill.id)}
                    >
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
                <button className="toolbar-icon" onClick={onOpenAutomation} title="灵感入口">
                  <Zap size={16} />
                </button>
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
                  disabled={Boolean(composing) || sending || (!composer.trim() && attachments.length === 0)}
                  title={composing ? "请先确认输入法候选词" : "发送"}
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
