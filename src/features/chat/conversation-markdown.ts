import { parseChatMessageContent } from "../../lib/chat-visuals";
import { formatBytes } from "../../lib/format";
import {
  getRuntimeToolDisplay,
  buildRuntimeToolDiffs,
} from "../../lib/runtime-tool-display";
import { sanitizeTimelineStatusText } from "../../lib/runtime-timeline";
import type {
  ChatConversation,
  ChatMessage,
  ChatMessageRuntimeTrace,
  ChatToolCall,
  ChatToolCallStatus,
  ChatVisual,
} from "../../types";

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

function statusLabel(status?: ChatToolCallStatus) {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "取消";
  if (status === "pending") return "待执行";
  if (status === "in_progress") return "执行中";
  return "处理中";
}

function longestBacktickRun(value: string) {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function fencedBlock(language: string, value: string) {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
  return [language ? `${fence}${language}` : fence, value, fence].join("\n");
}

function buildRuntimeToolMarkdown(
  toolCall: ChatToolCall,
  terminalOutputs: ChatMessageRuntimeTrace["terminalOutputs"],
) {
  const display = getRuntimeToolDisplay(toolCall);
  const blocks = [`#### ${display.title} · ${statusLabel(toolCall.status)}`];
  const detail = display.detail.trim();

  if (detail && detail !== display.command?.trim()) {
    blocks.push(`说明：${detail}`);
  }

  if (display.command?.trim()) {
    blocks.push(["命令：", fencedBlock("bash", display.command.trim())].join("\n"));
  }

  const generatedDiffs = buildRuntimeToolDiffs(toolCall);
  generatedDiffs.forEach((diff) => {
    const diffBlocks = [`变更：${diff.path}`];
    if (diff.oldText !== undefined && diff.oldText !== null) {
      diffBlocks.push("原内容：", fencedBlock("text", diff.oldText));
    }
    diffBlocks.push("新内容：", fencedBlock("text", diff.newText));
    blocks.push(diffBlocks.join("\n"));
  });

  toolCall.content.forEach((content) => {
    if (content.type === "text" && content.text.trim()) {
      blocks.push(["输出：", fencedBlock("text", content.text.trim())].join("\n"));
      return;
    }

    if (content.type === "diff") {
      const diffBlocks = [`变更：${content.path}`];
      if (content.oldText !== undefined && content.oldText !== null) {
        diffBlocks.push("原内容：", fencedBlock("text", content.oldText));
      }
      diffBlocks.push("新内容：", fencedBlock("text", content.newText));
      blocks.push(diffBlocks.join("\n"));
      return;
    }

    if (content.type === "terminal") {
      const terminal = terminalOutputs[content.terminalId];
      if (terminal?.output.trim()) {
        blocks.push([`终端 ${content.terminalId.slice(0, 8)}：`, fencedBlock("text", terminal.output.trim())].join("\n"));
      }
    }
  });

  return blocks.join("\n\n").trim();
}

function buildRuntimeTraceMarkdown(trace: ChatMessageRuntimeTrace) {
  const blocks = ["### 执行过程"];
  const toolCallsById = new Map(trace.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall]));
  const renderedToolCallIds = new Set<string>();
  const linkedTerminalIds = new Set<string>();

  trace.toolCalls.forEach((toolCall) => {
    toolCall.content.forEach((content) => {
      if (content.type === "terminal") {
        linkedTerminalIds.add(content.terminalId);
      }
    });
  });

  trace.timelineItems.forEach((item) => {
    if (item.type === "status") {
      const text = sanitizeTimelineStatusText(item.text);
      if (text.trim()) {
        blocks.push(text.trim());
      }
      return;
    }

    if (item.type === "tool") {
      const toolCall = toolCallsById.get(item.toolCallId);
      if (!toolCall) {
        return;
      }
      const markdown = buildRuntimeToolMarkdown(toolCall, trace.terminalOutputs);
      if (markdown) {
        blocks.push(markdown);
        renderedToolCallIds.add(toolCall.toolCallId);
      }
    }
  });

  trace.toolCalls.forEach((toolCall) => {
    if (renderedToolCallIds.has(toolCall.toolCallId)) {
      return;
    }
    const markdown = buildRuntimeToolMarkdown(toolCall, trace.terminalOutputs);
    if (markdown) {
      blocks.push(markdown);
    }
  });

  Object.values(trace.terminalOutputs).forEach((terminal) => {
    if (linkedTerminalIds.has(terminal.terminalId) || !terminal.output.trim()) {
      return;
    }
    blocks.push([`#### 终端 ${terminal.terminalId.slice(0, 8)}`, fencedBlock("text", terminal.output.trim())].join("\n\n"));
  });

  if (trace.error?.trim()) {
    blocks.push(`执行失败：${trace.error.trim()}`);
  }

  return blocks.length > 1 ? blocks.join("\n\n") : "";
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

  if (message.role === "assistant" && message.runtimeTrace) {
    const runtimeMarkdown = buildRuntimeTraceMarkdown(message.runtimeTrace);
    if (runtimeMarkdown) {
      blocks.push("", runtimeMarkdown);
    }
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
