import clsx from "clsx";
import { ChevronDown, LoaderCircle, Sparkles, Wrench } from "lucide-react";

import { formatDateTime, markdownToHtml } from "../../lib/format";
import type { ChatMessage, FileDropEntry } from "../../types";
import { FileCard } from "./FileCard";

interface MessageBlockProps {
  message: ChatMessage;
  onOpenFile: (file: FileDropEntry) => void;
  onOpenLink: (url: string) => void;
}

function summarizeToolMessage(message: ChatMessage) {
  const normalized = message.text
    .replace(/\s+/g, " ")
    .replace(/^Input:\s*/i, "")
    .trim();

  if (!normalized) {
    if (message.status === "loading") return "正在执行";
    if (message.status === "error") return "执行失败";
    return "查看详情";
  }

  return normalized.length > 88 ? `${normalized.slice(0, 88)}…` : normalized;
}

function toolStatusLabel(message: ChatMessage) {
  if (message.status === "loading") return "执行中";
  if (message.status === "error") return "失败";
  return "完成";
}

export function MessageBlock({ message, onOpenFile, onOpenLink }: MessageBlockProps) {
  if (message.role === "tool") {
    const summary = summarizeToolMessage(message);
    const statusLabel = toolStatusLabel(message);

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
            {message.text ? <pre>{message.text}</pre> : null}
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
            <span>正在生成…</span>
          </div>
        ) : null}

        {message.text ? (
          <div
            className={clsx("message-text", message.role, message.status === "error" && "error")}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(message.text) }}
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
      </div>
    </article>
  );
}
