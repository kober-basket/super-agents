import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileSearch,
  LoaderCircle,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react";

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

type ParsedToolMessage = {
  inputText: string;
  inputObject: Record<string, unknown> | null;
  outputText: string;
};

function clipText(value: string, max = 88) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function parseToolMessage(text: string): ParsedToolMessage {
  const normalized = text.trim();
  if (!normalized) {
    return { inputText: "", inputObject: null, outputText: "" };
  }

  if (!normalized.startsWith("Input:")) {
    return { inputText: "", inputObject: null, outputText: normalized };
  }

  const body = normalized.replace(/^Input:\s*/i, "").trim();
  const [inputText = "", ...rest] = body.split(/\n{2,}/);
  const outputText = rest.join("\n\n").trim();

  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { inputText, inputObject: parsed, outputText };
    }
  } catch {
    // Keep the raw input text when it is not valid JSON.
  }

  return { inputText, inputObject: null, outputText };
}

function summarizeInputValue(value: unknown) {
  if (typeof value === "string") return clipText(value, 64);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? `${value.length} items` : "[]";
  if (value && typeof value === "object") return "{...}";
  return "";
}

function summarizeInputObject(toolName: string | undefined, inputObject: Record<string, unknown> | null) {
  if (!inputObject) return "";

  const command = inputObject.command;
  if (typeof command === "string" && command.trim()) {
    return clipText(command, 96);
  }

  const prompt = inputObject.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    return clipText(prompt, 96);
  }

  const primary = inputObject.q ?? inputObject.query ?? inputObject.location ?? inputObject.url ?? inputObject.path;
  if (typeof primary === "string" && primary.trim()) {
    return clipText(primary, 96);
  }

  const entries = Object.entries(inputObject)
    .map(([key, value]) => {
      const preview = summarizeInputValue(value);
      return preview ? `${key}: ${preview}` : "";
    })
    .filter(Boolean)
    .slice(0, 2);

  if (entries.length > 0) {
    return clipText(entries.join(" · "), 96);
  }

  const count = Object.keys(inputObject).length;
  return count > 0 ? `${toolName || "工具调用"} 参数 ${count} 项` : "";
}

function summarizeToolMessage(message: ChatMessage, questionRequest?: PendingQuestion) {
  if (questionRequest?.questions.length) {
    return questionRequest.questions[0]?.question || "需要你回答";
  }

  const parsed = parseToolMessage(message.text);
  const normalized =
    summarizeInputObject(message.toolName, parsed.inputObject) || parsed.outputText || parsed.inputText || message.text;

  if (!normalized) {
    if (message.status === "loading") return "正在执行...";
    if (message.status === "paused") return "已停止";
    if (message.status === "error") return "执行失败";
    return "查看详情";
  }

  return clipText(normalized, 96);
}

function toolStatusMeta(
  message: ChatMessage,
  questionRequest?: PendingQuestion,
): { label: string; icon: ReactNode; tone: "default" | "loading" | "success" | "error" } {
  if (questionRequest) {
    return {
      label: "待回答",
      icon: <Clock3 size={12} />,
      tone: "default",
    };
  }

  if (message.status === "loading") {
    return {
      label: "运行中",
      icon: <LoaderCircle size={12} className="spin" />,
      tone: "loading",
    };
  }

  if (message.status === "paused") {
    return {
      label: "已停止",
      icon: <Square size={11} />,
      tone: "default",
    };
  }

  if (message.status === "error") {
    return {
      label: "失败",
      icon: <AlertCircle size={12} />,
      tone: "error",
    };
  }

  return {
    label: "完成",
    icon: <CheckCircle2 size={12} />,
    tone: "success",
  };
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
  const parsedToolMessage = message.role === "tool" ? parseToolMessage(message.text) : null;
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
    const statusMeta = toolStatusMeta(message, questionRequest);

    return (
      <article className="activity-row">
        <details
          className={clsx("activity-card", "tool-message-card", message.status)}
          open={message.status === "loading" || Boolean(questionRequest)}
        >
          <summary className="activity-summary">
            <div className="activity-summary-main">
              <div className="activity-summary-title">
                <span className="activity-tool-icon">
                  <Wrench size={13} />
                </span>
                <strong>{message.toolName || "工具调用"}</strong>
                <em className={clsx("activity-status-pill", statusMeta.tone)}>
                  {statusMeta.icon}
                  <span>{statusMeta.label}</span>
                </em>
              </div>
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

            {!questionRequest ? (
              <section className="activity-panel activity-panel-summary">
                <div className="activity-panel-label">概览</div>
                <p>{summary}</p>
              </section>
            ) : null}

            {!questionRequest && parsedToolMessage?.inputText ? (
              <section className="activity-panel">
                <div className="activity-panel-label">参数</div>
                <pre>{parsedToolMessage.inputText}</pre>
              </section>
            ) : !questionRequest && message.text ? (
              <section className="activity-panel">
                <div className="activity-panel-label">详情</div>
                <pre>{message.text}</pre>
              </section>
            ) : null}

            {!questionRequest && parsedToolMessage?.outputText ? (
              <section className="activity-panel">
                <div className="activity-panel-label">{message.status === "error" ? "错误" : "结果"}</div>
                <pre>{parsedToolMessage.outputText}</pre>
              </section>
            ) : null}

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

        {message.role === "assistant" && message.status === "paused" && !message.text ? (
          <div className="message-loading">
            <Square size={12} />
            <span>已停止</span>
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
