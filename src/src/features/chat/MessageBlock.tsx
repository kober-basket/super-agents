import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown, FileSearch, LoaderCircle, Sparkles, Wrench, X } from "lucide-react";

import { formatDateTime, markdownToHtml } from "../../lib/format";
import type { ChatMessage, FileDropEntry, PendingQuestion } from "../../types";
import { FileCard } from "./FileCard";
import { QuestionCard } from "./QuestionCard";

interface MessageBlockProps {
  message: ChatMessage;
  questionRequest?: PendingQuestion;
  onOpenFile: (file: FileDropEntry) => void;
  onOpenLink: (url: string) => void;
  onReplyQuestion: (requestId: string, sessionId: string, answers: string[][]) => Promise<void> | void;
  onRejectQuestion: (requestId: string, sessionId: string) => Promise<void> | void;
  onAbortThread: (threadId: string) => Promise<void> | void;
}

function summarizeToolMessage(message: ChatMessage, questionRequest?: PendingQuestion) {
  if (questionRequest?.questions.length) {
    return questionRequest.questions[0]?.question || "需要你回答";
  }

  const normalized = message.text
    .replace(/\s+/g, " ")
    .replace(/^Input:\s*/i, "")
    .trim();

  if (!normalized) {
    if (message.status === "loading") return "正在执行...";
    if (message.status === "error") return "执行失败";
    return "查看详情";
  }

  return normalized.length > 88 ? `${normalized.slice(0, 88)}...` : normalized;
}

function toolStatusLabel(message: ChatMessage, questionRequest?: PendingQuestion) {
  if (questionRequest) return "待回答";
  if (message.status === "loading") return "执行中";
  if (message.status === "error") return "失败";
  return "完成";
}

export function MessageBlock({
  message,
  questionRequest,
  onOpenFile,
  onOpenLink,
  onReplyQuestion,
  onRejectQuestion,
  onAbortThread,
}: MessageBlockProps) {
  const renderedText = message.displayText ?? message.text;
  const knowledgeResults = message.knowledge?.results ?? [];
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [activeKnowledgeIndex, setActiveKnowledgeIndex] = useState(0);
  const activeKnowledge = knowledgeResults[activeKnowledgeIndex] ?? knowledgeResults[0] ?? null;

  useEffect(() => {
    if (!knowledgeModalOpen) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setKnowledgeModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [knowledgeModalOpen]);

  useEffect(() => {
    setActiveKnowledgeIndex(0);
  }, [message.id]);

  if (message.role === "tool") {
    const summary = summarizeToolMessage(message, questionRequest);
    const statusLabel = toolStatusLabel(message, questionRequest);

    return (
      <article className="activity-row">
        <details className={clsx("activity-card", "tool-message-card", message.status)} open={message.status === "loading"}>
          <summary className="activity-summary">
            <div className="activity-summary-main">
              <div className="activity-summary-title">
                <span className="activity-tool-icon">
                  {message.status === "loading" ? <LoaderCircle size={13} className="spin" /> : <Wrench size={13} />}
                </span>
                <strong>{message.toolName || "工具调用"}</strong>
                <em className={clsx("activity-status-pill", message.status)}>{statusLabel}</em>
              </div>
              <p>{summary}</p>
            </div>
            <div className="activity-summary-side">
              <time>{formatDateTime(message.createdAt)}</time>
              <ChevronDown size={16} />
            </div>
          </summary>

          <div className="activity-detail">
            {questionRequest ? (
              <QuestionCard
                request={questionRequest}
                onSubmit={(answers) => onReplyQuestion(questionRequest.id, questionRequest.sessionID, answers)}
                onReject={() => onRejectQuestion(questionRequest.id, questionRequest.sessionID)}
                onAbort={() => onAbortThread(questionRequest.sessionID)}
              />
            ) : null}

            {message.text && !questionRequest ? <pre>{message.text}</pre> : null}

            {message.attachments?.length ? (
              <div className="file-stack">
                {message.attachments.map((file) => (
                  <FileCard key={file.id} file={file} onOpen={onOpenFile} />
                ))}
              </div>
            ) : null}
          </div>
        </details>
      </article>
    );
  }

  const isUser = message.role === "user";

  return (
    <article className={clsx("message-row", message.role)}>
      {!isUser ? (
        <div className="message-avatar">
          <Sparkles size={13} />
        </div>
      ) : null}

      <div className={clsx("message-bubble", message.role)}>
        {message.skillName ? (
          <div className="message-skill-chip">
            <Sparkles size={12} />
            <span>{message.skillName}</span>
          </div>
        ) : null}

        {message.role === "assistant" && message.status === "loading" && !message.text ? (
          <div className="message-loading">
            <LoaderCircle size={14} className="spin" />
            <span>正在生成...</span>
          </div>
        ) : null}

        {renderedText ? (
          <div
            className={clsx("message-text", message.role, message.status === "error" && "error")}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(renderedText) }}
            onClick={(event) => {
              const target = event.target;
              if (!(target instanceof HTMLElement)) return;
              const link = target.closest("a[data-preview-link='true']");
              if (!(link instanceof HTMLAnchorElement)) return;
              const href = link.getAttribute("href")?.trim();
              if (!href) return;
              event.preventDefault();
              onOpenLink(href);
            }}
          />
        ) : null}

        {message.attachments?.length ? (
          <div className="file-stack">
            {message.attachments.map((file) => (
              <FileCard key={file.id} file={file} onOpen={onOpenFile} />
            ))}
          </div>
        ) : null}

        {message.role === "user" && message.knowledge?.injected && knowledgeResults.length > 0 ? (
          <button
            type="button"
            className="message-reference-button"
            onClick={() => setKnowledgeModalOpen(true)}
          >
            <FileSearch size={13} />
            <span>参考来源</span>
            <em>{message.knowledge.resultCount} 条片段</em>
          </button>
        ) : null}
      </div>

      {message.role === "user" && knowledgeModalOpen && knowledgeResults.length > 0 ? (
        <div className="modal-scrim" onClick={() => setKnowledgeModalOpen(false)}>
          <div className="knowledge-reference-modal" onClick={(event) => event.stopPropagation()}>
            <div className="knowledge-reference-head">
              <div className="knowledge-reference-title">
                <strong>参考来源</strong>
                <span>{message.knowledge?.query || renderedText}</span>
              </div>
              <button
                type="button"
                className="knowledge-icon-button"
                onClick={() => setKnowledgeModalOpen(false)}
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="knowledge-reference-body">
              <div className="knowledge-reference-rail">
                {knowledgeResults.map((item, index) => (
                  <button
                    key={`${message.id}-knowledge-item-${index}`}
                    type="button"
                    className={clsx("knowledge-reference-row", index === activeKnowledgeIndex && "active")}
                    onClick={() => setActiveKnowledgeIndex(index)}
                  >
                    <strong>{item.knowledgeBaseName}</strong>
                    <span>
                      {typeof item.metadata.source === "string" ? item.metadata.source : "知识库片段"}
                    </span>
                    <p>{item.pageContent.trim().slice(0, 72)}</p>
                  </button>
                ))}
              </div>

              <div className="knowledge-reference-detail">
                {activeKnowledge ? (
                  <>
                    <div className="knowledge-reference-meta">
                      <strong>{activeKnowledge.knowledgeBaseName}</strong>
                      <span>
                        {typeof activeKnowledge.metadata.source === "string"
                          ? activeKnowledge.metadata.source
                          : "知识库片段"}
                        {" · "}
                        相似度 {activeKnowledge.score.toFixed(3)}
                      </span>
                    </div>
                    <div className="knowledge-reference-content">
                      <p>{activeKnowledge.pageContent.trim()}</p>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
