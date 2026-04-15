import { ArrowUp, ChevronDown, Paperclip, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { formatBytes } from "../../lib/format";
import type { ChatConversation, FileDropEntry } from "../../types";
import { fileKind, getFileExtension, isOfficeDocument } from "../shared/utils";

interface ChatWorkspaceProps {
  activeConversation: ChatConversation | null;
  attachments: FileDropEntry[];
  draftMessage: string;
  onDraftMessageChange: (value: string) => void;
  onOpenAttachment: (file: FileDropEntry) => void;
  onPickFiles: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSendMessage: () => void;
  scrollToBottomRequest: number;
}

const HOME_PROMPTS = [
  { label: "拆解需求", value: "帮我拆解这个需求" },
  { label: "写页面文案", value: "帮我写这页的文案" },
  { label: "规划任务", value: "帮我规划实现任务" },
  { label: "优化界面", value: "帮我优化这个界面" },
];

export function ChatWorkspace({
  activeConversation,
  attachments,
  draftMessage,
  onDraftMessageChange,
  onOpenAttachment,
  onPickFiles,
  onRemoveAttachment,
  onSendMessage,
  scrollToBottomRequest,
}: ChatWorkspaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }, [draftMessage]);

  const isHome = activeConversation === null;
  const canSend = draftMessage.trim().length > 0 || attachments.length > 0;
  const activeConversationId = activeConversation?.id ?? null;
  const messageCount = activeConversation?.messages.length ?? 0;
  const lastMessageId = activeConversation?.messages[messageCount - 1]?.id ?? null;

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !activeConversationId) return undefined;

    const scrollToBottom = () => {
      messageList.scrollTop = messageList.scrollHeight;
    };

    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversationId, messageCount, lastMessageId, scrollToBottomRequest]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSendMessage();
    }
  }

  function renderAttachmentList(files: FileDropEntry[], removable = false) {
    if (files.length === 0) return null;

    if (!removable) {
      return (
        <div className="chat-attachment-card-list">
          {files.map((file) => {
            const kind = fileKind(file);
            const extension = getFileExtension(file.name || file.path);
            const badge = extension ? extension.toUpperCase().slice(0, 4) : "FILE";
            const office = isOfficeDocument(file.name || file.path, file.mimeType);
            const categoryLabel =
              kind === "pdf"
                ? "PDF document"
                : office
                  ? "Office document"
                  : kind === "text"
                    ? "Text document"
                    : kind === "markdown"
                      ? "Markdown note"
                      : kind === "code"
                        ? "Code file"
                        : kind === "image"
                          ? "Image file"
                          : "File";
            const toneClass =
              kind === "pdf"
                ? "tone-pdf"
                : office
                  ? "tone-office"
                  : kind === "text"
                    ? "tone-text"
                    : kind === "image"
                      ? "tone-image"
                      : "tone-file";

            return (
              <button
                key={file.id}
                className={`chat-attachment-card ${toneClass}`}
                onClick={() => onOpenAttachment(file)}
                type="button"
              >
                <div className="chat-attachment-card-badge">{badge}</div>
                <div className="chat-attachment-card-copy">
                  <strong title={file.name}>{file.name}</strong>
                  <span>{formatBytes(file.size)}</span>
                </div>
                <div className="chat-attachment-card-tag">{categoryLabel}</div>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="chat-attachment-list">
        {files.map((file) => (
          <div key={file.id} className="chat-attachment-chip">
            <button
              className="chat-attachment-trigger"
              onClick={() => onOpenAttachment(file)}
              type="button"
            >
              <Paperclip size={14} />
              <span title={file.name}>{file.name}</span>
            </button>
            {removable ? (
              <button
                aria-label={`移除附件 ${file.name}`}
                className="chat-attachment-remove"
                onClick={() => onRemoveAttachment(file.id)}
                type="button"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  function renderComposer(home = false) {
    return (
      <div className={`chat-composer-card ${home ? "chat-composer-home" : ""}`}>
        {renderAttachmentList(attachments, true)}
        <textarea
          ref={textareaRef}
          onChange={(event) => onDraftMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={home ? "输入消息，Enter 发送" : "继续输入消息"}
          rows={1}
          value={draftMessage}
        />
        <div className="chat-composer-actions">
          <div className="chat-composer-meta">
            <button className="chat-composer-icon" onClick={onPickFiles} type="button">
              <Paperclip size={16} />
            </button>
            {!home ? (
              <>
                <button className="chat-composer-pill" type="button">
                  <span>Auto</span>
                  <ChevronDown size={14} />
                </button>
                <button className="chat-composer-pill chat-composer-pill-kb" type="button">
                  <span>KB 未使用知识库</span>
                  <ChevronDown size={14} />
                </button>
              </>
            ) : (
              <span className="chat-composer-hint">Shift + Enter 换行</span>
            )}
          </div>
          <button
            className="chat-send-button"
            disabled={!canSend}
            onClick={onSendMessage}
            type="button"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className={`workspace-main ${isHome ? "is-home" : "is-thread"}`}>
      <div className="chat-column chat-workspace-shell">
        {isHome ? (
          <div className="chat-home chat-home-upgraded">
            <div className="chat-home-hero">
              <div className="chat-home-orb chat-home-orb-left" aria-hidden="true" />
              <div className="chat-home-orb chat-home-orb-right" aria-hidden="true" />
              <div className="chat-home-badge">
                <Sparkles size={14} />
                <span>开始新对话</span>
              </div>
              <div className="chat-home-copy">
                <h2>把问题说清楚</h2>
                <p>发出第一条消息后，会话会出现在左侧。</p>
              </div>
            </div>

            {renderComposer(true)}

            <div className="chat-home-prompt-grid">
              {HOME_PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  className="chat-home-prompt"
                  onClick={() => onDraftMessageChange(prompt.value)}
                  type="button"
                >
                  <strong>{prompt.label}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-thread-layout">
            <div ref={messageListRef} className="message-list">
              {activeConversation.messages.map((message) => (
                <div key={message.id} className={`message-row ${message.role === "user" ? "user" : ""}`}>
                  <div className={`message-bubble ${message.role === "user" ? "user" : ""}`}>
                    {message.attachments?.length ? renderAttachmentList(message.attachments) : null}
                    {message.content ? (
                      <div className={`message-text ${message.role === "user" ? "user" : ""}`}>
                        {message.content}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {renderComposer(false)}
          </div>
        )}
      </div>
    </section>
  );
}
