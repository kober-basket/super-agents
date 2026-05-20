import { parseChatMessageContent } from "../../lib/chat-visuals";
import { formatBytes } from "../../lib/format";
import type { ChatConversation, ChatMessage, ChatVisual } from "../../types";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatMarkdownDateTime(value: number) {
  const date = new Date(value);
  return [
    date.getUTCFullYear(),
    "-",
    pad2(date.getUTCMonth() + 1),
    "-",
    pad2(date.getUTCDate()),
    " ",
    pad2(date.getUTCHours()),
    ":",
    pad2(date.getUTCMinutes()),
  ].join("");
}

function messageRoleLabel(role: ChatMessage["role"]) {
  return role === "user" ? "用户" : "Agent";
}

function normalizeMessageContent(message: ChatMessage) {
  if (message.role === "assistant") {
    return parseChatMessageContent(message.content, message.visuals);
  }

  return {
    text: message.content.trim(),
    visuals: message.visuals ?? [],
    hasPendingVisualBlock: false,
    invalidVisualCount: 0,
  };
}

function visualTitle(visual: ChatVisual, index: number) {
  return visual.title?.trim() || visual.description?.trim() || `可视化 ${index + 1}`;
}

function buildVisualMarkdown(visual: ChatVisual, index: number) {
  const title = visualTitle(visual, index);

  if (visual.type === "diagram") {
    return [`### 可视化：${title}`, "", "```mermaid", visual.code, "```"].join("\n");
  }

  return [
    `### 可视化：${title}`,
    "",
    "```json",
    JSON.stringify(visual.spec, null, 2),
    "```",
  ].join("\n");
}

function buildMessageMarkdown(message: ChatMessage) {
  const parsed = normalizeMessageContent(message);
  const blocks = [`## ${messageRoleLabel(message.role)} · ${formatMarkdownDateTime(message.createdAt)}`];

  if (message.attachments?.length) {
    blocks.push(
      "",
      "附件：",
      ...message.attachments.map((attachment) => `- ${attachment.name} (${formatBytes(attachment.size)})`),
    );
  }

  if (parsed.text.trim()) {
    blocks.push("", parsed.text.trim());
  }

  if (parsed.visuals.length > 0) {
    blocks.push("", ...parsed.visuals.flatMap((visual, index) => [buildVisualMarkdown(visual, index), ""]));
  }

  return blocks.join("\n").trim();
}

export function buildConversationCopyMarkdown(conversation: ChatConversation) {
  const header = [
    `# ${conversation.title}`,
    "",
    `创建时间：${formatMarkdownDateTime(conversation.createdAt)}`,
    `消息数：${conversation.messages.length}`,
    "",
    "---",
  ];

  const messages = conversation.messages.map(buildMessageMarkdown);
  return [...header, ...messages].join("\n\n").trimEnd() + "\n";
}
