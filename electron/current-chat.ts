import { stat } from "node:fs/promises";
import path from "node:path";

import type { ChatMessage, CurrentChatState, FileDropEntry, MessageAttachment } from "../src/types";
import type { OpencodeFilePart, OpencodePart, OpencodeSessionMessage, OpencodeToolPart } from "./opencode-runtime";
import { formatToolMetadataLines } from "./acp/tool-metadata";

export type CurrentChatExecutionState = {
  busy: boolean;
  blockedOnQuestion: boolean;
};

function filePathFromUrl(url: string) {
  if (!url.startsWith("file:")) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1"));
  } catch {
    return null;
  }
}

function byteLengthFromDataUrl(url: string) {
  const [, payload = ""] = url.split(",", 2);
  const normalized = payload.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function detectKind(filePath: string, mimeType?: string): NonNullable<FileDropEntry["kind"]> {
  const extension = path.extname(filePath).toLowerCase();
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || extension === ".pdf") return "pdf";
  if (mimeType?.includes("text/html")) return "html";
  if ([".md", ".mdx"].includes(extension)) return "markdown";
  if ([".html", ".htm"].includes(extension)) return "html";
  if (
    [".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".yml", ".yaml", ".py", ".go", ".rs", ".java", ".sh", ".ps1"].includes(
      extension,
    )
  ) {
    return "code";
  }
  if ([".txt", ".log", ".out", ".err"].includes(extension)) return "text";
  if (mimeType?.startsWith("text/")) return "text";
  return "binary";
}

async function attachmentFromFilePart(part: OpencodeFilePart): Promise<MessageAttachment> {
  const localPath =
    part.source?.type === "file" ? part.source.path ?? filePathFromUrl(part.url) : filePathFromUrl(part.url);
  const displayPath = localPath ?? part.filename ?? part.url;
  let size = 0;

  if (localPath) {
    size = await stat(localPath).then((entry) => entry.size).catch(() => 0);
  } else if (part.url.startsWith("data:")) {
    size = byteLengthFromDataUrl(part.url);
  }

  return {
    id: part.id,
    name: part.filename ?? path.basename(displayPath) ?? "attachment",
    path: displayPath,
    size,
    mimeType: part.mime,
    kind: detectKind(displayPath, part.mime),
    url: part.url,
  };
}

function formatToolInput(input: Record<string, unknown>) {
  if (!input || Object.keys(input).length === 0) return "";
  return JSON.stringify(input, null, 2);
}

function isSessionActivelyRunning(state: CurrentChatExecutionState) {
  return state.busy || state.blockedOnQuestion;
}

async function toolMessageFromPart(
  part: OpencodeToolPart,
  executionState: CurrentChatExecutionState,
): Promise<ChatMessage> {
  const input = formatToolInput(part.state.input);
  const metadataLines = part.state.status === "completed" ? formatToolMetadataLines(part.state.metadata) : [];
  const lines: string[] = [];
  const attachments =
    part.state.status === "completed" ? await Promise.all((part.state.attachments ?? []).map(attachmentFromFilePart)) : [];

  if (input) {
    lines.push("Input:");
    lines.push(input);
  }

  if (metadataLines.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...metadataLines);
  }

  if (part.state.status === "completed") {
    if (part.state.output?.trim()) {
      if (lines.length > 0) lines.push("");
      lines.push(part.state.output.trim());
    }
  } else if (part.state.status === "error") {
    if (lines.length > 0) lines.push("");
    lines.push(part.state.error.trim());
  } else if (part.state.status === "running") {
    if (part.state.title?.trim()) {
      if (lines.length > 0) lines.push("");
      lines.push(part.state.title.trim());
    } else if (lines.length === 0) {
      lines.push("Tool is running...");
    }
  } else if (lines.length === 0) {
    lines.push("Tool call queued.");
  }

  return {
    id: part.callID,
    role: "tool",
    toolName: part.tool,
    text: lines.join("\n"),
    createdAt: part.state.status === "pending" ? Date.now() : part.state.time.start,
    status:
      part.state.status === "completed"
        ? "done"
        : part.state.status === "error"
          ? "error"
          : isSessionActivelyRunning(executionState)
            ? "loading"
            : "paused",
    attachments,
  };
}

function baseMessageText(parts: OpencodePart[]) {
  const sanitizeMessageText = (value: string) =>
    value
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
      .replace(/<\/?system-reminder>/gi, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const textParts = parts.filter(
    (part): part is Extract<OpencodePart, { type: "text" }> => part.type === "text" && !part.synthetic,
  );
  const agentParts = parts.filter((part): part is Extract<OpencodePart, { type: "agent" }> => part.type === "agent");
  const subtaskParts = parts.filter(
    (part): part is Extract<OpencodePart, { type: "subtask" }> => part.type === "subtask",
  );
  const blocks: string[] = [];

  if (textParts.length > 0) {
    blocks.push(
      textParts
        .map((part) => sanitizeMessageText(part.text))
        .filter(Boolean)
        .join("\n\n")
        .trim(),
    );
  }

  if (agentParts.length > 0) {
    blocks.push(agentParts.map((part) => `@${part.name}`).join("\n"));
  }

  if (subtaskParts.length > 0) {
    blocks.push(
      subtaskParts
        .map((part) => `${part.description}\n${part.prompt}`.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return sanitizeMessageText(blocks.filter(Boolean).join("\n\n").trim());
}

function messageTimestamp(message: OpencodeSessionMessage) {
  if (message.info.role === "assistant") {
    return message.info.time.completed ?? message.info.time.created;
  }
  return message.info.time.created;
}

export async function convertSessionMessages(
  messages: OpencodeSessionMessage[],
  executionState: CurrentChatExecutionState,
): Promise<ChatMessage[]> {
  const result: ChatMessage[] = [];

  for (const message of messages) {
    const isPendingAssistant =
      message.info.role === "assistant" &&
      !message.info.error &&
      message.info.time.completed === undefined;
    const fileAttachments = await Promise.all(
      message.parts
        .filter((part): part is OpencodeFilePart => part.type === "file")
        .map(attachmentFromFilePart),
    );

    for (const part of message.parts) {
      if (part.type === "tool") {
        result.push(await toolMessageFromPart(part, executionState));
      }
    }

    const text = baseMessageText(message.parts) || message.info.error?.data?.message || "";
    if (!text && fileAttachments.length === 0 && message.info.role === "assistant" && !isPendingAssistant) {
      continue;
    }

    result.push({
      id: message.info.id,
      role: message.info.role,
      text,
      createdAt: messageTimestamp(message),
      attachments: fileAttachments,
      status:
        message.info.error
          ? "error"
          : isPendingAssistant
            ? isSessionActivelyRunning(executionState)
              ? "loading"
              : "paused"
            : "done",
    });
  }

  if (executionState.busy && !result.some((message) => message.status === "loading")) {
    const anchorMessage = [...messages].reverse().find((message) => message.info.role === "user") ?? messages.at(-1);
    result.push({
      id: `pending:${anchorMessage?.info.id ?? "assistant"}`,
      role: "assistant",
      text: "",
      createdAt: anchorMessage ? messageTimestamp(anchorMessage) + 1 : Date.now(),
      status: "loading",
    });
  }

  return result.sort((left, right) => left.createdAt - right.createdAt);
}

export function createEmptyCurrentChatState(overrides?: Partial<CurrentChatState>): CurrentChatState {
  return {
    sessionId: null,
    title: "当前会话",
    messages: [],
    busy: false,
    blockedOnQuestion: false,
    workspaceRoot: undefined,
    ...overrides,
  };
}
