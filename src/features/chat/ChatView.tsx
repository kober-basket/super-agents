import { useEffect, useRef, useState, type RefObject } from "react";
import clsx from "clsx";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import type { ChatMessage, FileDropEntry } from "../../types";
import { normalizeDroppedFiles } from "../shared/utils";
import { MessageBlock } from "./MessageBlock";
import type { ChatHomeQuickPrompt } from "./home-state";

interface ChatViewProps {
  attachments: FileDropEntry[];
  canSend: boolean;
  chatBusy: boolean;
  composer: string;
  composerKnowledgeBaseIds: string[];
  composerModelId: string;
  composing?: boolean;
  currentWorkspaceLabel: string;
  currentWorkspacePath: string;
  dragActive: boolean;
  knowledgeBaseOptions: Array<{ id: string; name: string }>;
  messageListRef: RefObject<HTMLDivElement>;
  messages: ChatMessage[];
  modelOptions: Array<{ id: string; label: string }>;
  previewAvailable: boolean;
  previewOpen: boolean;
  quickPrompts: ChatHomeQuickPrompt[];
  showHome: boolean;
  title: string;
  onChooseWorkspace: () => void | Promise<void>;
  onComposerChange: (value: string) => void;
  onComposerKnowledgeBaseIdsChange: (value: string[]) => void;
  onComposerModelChange: (value: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  onDragActiveChange: (active: boolean) => void;
  onFilesDropped: (files: FileDropEntry[]) => void | Promise<void>;
  onOpenFile: (file: FileDropEntry) => void;
  onOpenLink: (url: string) => void;
  onPickFiles: () => void | Promise<void>;
  onQuickPrompt: (prompt: string) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onTogglePreviewPane: () => void;
}

export function ChatView({
  attachments,
  canSend,
  chatBusy,
  composer,
  composerKnowledgeBaseIds,
  composerModelId,
  composing,
  currentWorkspaceLabel,
  currentWorkspacePath,
  dragActive,
  knowledgeBaseOptions,
  messageListRef,
  messages,
  modelOptions,
  previewAvailable,
  previewOpen,
  quickPrompts,
  showHome,
  title,
  onChooseWorkspace,
  onComposerChange,
  onComposerKnowledgeBaseIdsChange,
  onComposerModelChange,
  onCompositionChange,
  onDragActiveChange,
  onFilesDropped,
  onOpenFile,
  onOpenLink,
  onPickFiles,
  onQuickPrompt,
  onRemoveAttachment,
  onSend,
  onStop,
  onTogglePreviewPane,
}: ChatViewProps) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const knowledgePickerRef = useRef<HTMLDivElement>(null);
  const hasMessages = messages.length > 0;
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const selectedKnowledgeBases = knowledgeBaseOptions.filter((option) =>
    composerKnowledgeBaseIds.includes(option.id),
  );
  const knowledgeTriggerLabel =
    selectedKnowledgeBases.length === 0
      ? "未使用知识库"
      : selectedKnowledgeBases.length === 1
        ? selectedKnowledgeBases[0]?.name ?? "1 个知识库"
        : `已选 ${selectedKnowledgeBases.length} 个知识库`;

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!knowledgePickerRef.current?.contains(event.target as Node)) {
        setKnowledgePickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setKnowledgePickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [knowledgePickerOpen]);

  const toggleKnowledgeBase = (id: string) => {
    onComposerKnowledgeBaseIdsChange(
      composerKnowledgeBaseIds.includes(id)
        ? composerKnowledgeBaseIds.filter((item) => item !== id)
        : [...composerKnowledgeBaseIds, id],
    );
  };

  return (
    <section className="workspace-body">
      <header className="workspace-header">
        <div className="workspace-title">
          <div className="workspace-title-copy">
            <span className="workspace-label">{showHome ? "对话首页" : "当前区域"}</span>
            <h1>{showHome ? "开始新的对话" : title}</h1>
            <span className="workspace-path">
              {showHome ? "发送第一条消息后会自动创建新会话。" : currentWorkspacePath}
            </span>
          </div>
        </div>

        <div className="workspace-actions">
          <button
            className="folder-button workspace-folder-button"
            onClick={() => void onChooseWorkspace()}
            title="切换工作区"
            type="button"
          >
            <FolderOpen size={16} />
            <span>{currentWorkspaceLabel}</span>
          </button>
          <button
            className="ghost-icon"
            onClick={onTogglePreviewPane}
            title="切换预览栏"
            disabled={!previewAvailable}
            type="button"
          >
            {previewOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div
        className={clsx(
          "workspace-main",
          showHome && "is-home",
          !showHome && !hasMessages && "is-empty",
        )}
        ref={messageListRef}
      >
        <div className="chat-column">
          {showHome ? (
            <section className="chat-home">
              <div className="chat-home-badge">
                <Sparkles size={14} />
                <span>super-agents</span>
              </div>
              <div className="chat-home-copy">
                <h2>从一个问题开始</h2>
                <p>先告诉我你的目标，我会在发送第一条消息后创建会话。</p>
              </div>
              <div className="chat-home-prompt-grid">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    className="chat-home-prompt"
                    onClick={() => {
                      onQuickPrompt(prompt.prompt);
                      composerRef.current?.focus();
                    }}
                    type="button"
                  >
                    <strong>{prompt.title}</strong>
                    <span>{prompt.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : hasMessages ? (
            <div className="message-list">
              {messages.map((message) => (
                <MessageBlock
                  key={message.id}
                  message={message}
                  onOpenFile={onOpenFile}
                  onOpenLink={onOpenLink}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <footer className="composer-shell">
        <div className="chat-column">
          <div className={clsx("composer-card", showHome && "home-mode")}>
            {attachments.length > 0 ? (
              <div className="composer-files">
                {attachments.map((file) => (
                  <span key={file.id} className="composer-file-chip">
                    {file.name}
                    <button onClick={() => onRemoveAttachment(file.id)} type="button">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="composer-input-wrap">
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => onComposerChange(event.target.value)}
                onCompositionStart={() => onCompositionChange?.(true)}
                onCompositionEnd={() => onCompositionChange?.(false)}
                placeholder={
                  showHome
                    ? "输入你的问题，发送后会创建新会话..."
                    : "可拖入文件，点击附件卡片后在右侧预览。"
                }
                rows={4}
                className={clsx(dragActive && "drag-active")}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || composing) {
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey && !chatBusy) {
                    event.preventDefault();
                    void onSend();
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onDragActiveChange(false);
                  const files = normalizeDroppedFiles(event.dataTransfer.files);
                  if (files.length > 0) {
                    void onFilesDropped(files);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  onDragActiveChange(true);
                }}
                onDragLeave={() => onDragActiveChange(false)}
              />
            </div>

            <div className="composer-toolbar">
              <div className="toolbar-left">
                <button
                  className="toolbar-icon toolbar-resource-button"
                  onClick={() => void onPickFiles()}
                  title="添加文件"
                  type="button"
                >
                  <Paperclip size={16} />
                </button>

                <label className="select-shell toolbar-select composer-select">
                  <select
                    aria-label="选择模型"
                    value={composerModelId}
                    onChange={(event) => onComposerModelChange(event.target.value)}
                  >
                    {modelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </label>

                <div className="knowledge-picker composer-knowledge-picker" ref={knowledgePickerRef}>
                  <button
                    aria-expanded={knowledgePickerOpen}
                    aria-haspopup="dialog"
                    className={clsx(
                      "toolbar-icon",
                      "knowledge-toolbar-trigger",
                      "composer-knowledge-trigger",
                      composerKnowledgeBaseIds.length > 0 && "active",
                    )}
                    onClick={() => setKnowledgePickerOpen((open) => !open)}
                    type="button"
                  >
                    <strong>KB</strong>
                    <span>{knowledgeTriggerLabel}</span>
                    <ChevronDown
                      className={clsx("knowledge-trigger-arrow", knowledgePickerOpen && "open")}
                      size={14}
                    />
                  </button>

                  {knowledgePickerOpen ? (
                    <div className="knowledge-picker-panel composer-knowledge-panel" role="dialog">
                      <div className="knowledge-picker-head">
                        <div className="knowledge-picker-head-copy">
                          <strong>选择知识库</strong>
                          <span>支持多选，发送消息时会一起参与检索。</span>
                        </div>
                        {composerKnowledgeBaseIds.length > 0 ? (
                          <button
                            className="knowledge-picker-clear"
                            onClick={() => onComposerKnowledgeBaseIdsChange([])}
                            type="button"
                          >
                            清空
                          </button>
                        ) : null}
                      </div>

                      {selectedKnowledgeBases.length > 0 ? (
                        <div className="composer-knowledge-chips" aria-label="已选知识库">
                          {selectedKnowledgeBases.map((option) => (
                            <span key={option.id} className="composer-knowledge-chip">
                              {option.name}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {knowledgeBaseOptions.length > 0 ? (
                        <div className="knowledge-picker-list">
                          {knowledgeBaseOptions.map((option) => {
                            const selected = composerKnowledgeBaseIds.includes(option.id);
                            return (
                              <button
                                key={option.id}
                                className={clsx("knowledge-picker-row", selected && "selected")}
                                onClick={() => toggleKnowledgeBase(option.id)}
                                type="button"
                              >
                                <div className="knowledge-picker-copy">
                                  <strong>{option.name}</strong>
                                  <span>{selected ? "已加入当前对话上下文" : "点击加入当前对话检索范围"}</span>
                                </div>
                                <span className={clsx("knowledge-picker-check", selected && "selected")}>
                                  <Check size={13} />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="knowledge-picker-empty">
                          <strong>还没有知识库</strong>
                          <span>先去知识库页面创建内容，这里就可以直接多选使用了。</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="toolbar-right">
                <button
                  className="send-button"
                  onClick={() => void (chatBusy ? onStop() : onSend())}
                  disabled={chatBusy ? false : !canSend}
                  title={chatBusy ? "停止当前生成" : "发送消息"}
                  type="button"
                >
                  {chatBusy ? <Square size={16} /> : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}
