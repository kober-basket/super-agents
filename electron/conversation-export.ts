import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseChatMessageContent } from "../src/lib/chat-visuals";
import type {
  ChatConversation,
  ChatConversationExportFormat,
  ChatConversationExportResult,
  ChatMessage,
  ChatVisual,
} from "../src/types";

export interface ConversationExportOptions {
  exportedAt?: number;
}

export interface ExportConversationToFileInput extends ConversationExportOptions {
  workspaceRoot: string;
  conversation: ChatConversation;
  format: ChatConversationExportFormat;
  renderPdf?: (html: string) => Promise<Buffer | Uint8Array>;
}

const EXPORT_DIRECTORY_SEGMENTS = ["exports", "conversations"] as const;
const FORMAT_EXTENSIONS: Record<ChatConversationExportFormat, string> = {
  markdown: "md",
  pdf: "pdf",
  word: "docx",
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value: number) {
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

function formatFileTimestamp(value: number) {
  const date = new Date(value);
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    "-",
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join("");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanFileNameSegment(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();

  return cleaned.slice(0, 80).replace(/^-|-$/g, "") || "conversation";
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

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value: string) {
  return escapeXml(value);
}

function buildMessageMarkdown(message: ChatMessage) {
  const parsed = normalizeMessageContent(message);
  const blocks = [`## ${messageRoleLabel(message.role)} · ${formatDateTime(message.createdAt)}`];

  if (message.attachments?.length) {
    blocks.push(
      "",
      "附件：",
      ...message.attachments.map((attachment) => `- ${attachment.name} (${formatBytes(attachment.size)})`),
    );
  }

  if (parsed.text) {
    blocks.push("", parsed.text);
  }

  if (parsed.visuals.length > 0) {
    blocks.push("", ...parsed.visuals.flatMap((visual, index) => [buildVisualMarkdown(visual, index), ""]));
  }

  return blocks.join("\n").trim();
}

function buildMessagePlainTextBlocks(message: ChatMessage) {
  const parsed = normalizeMessageContent(message);
  const blocks = [`${messageRoleLabel(message.role)} · ${formatDateTime(message.createdAt)}`];

  if (message.attachments?.length) {
    blocks.push("附件：");
    blocks.push(...message.attachments.map((attachment) => `${attachment.name} (${formatBytes(attachment.size)})`));
  }

  if (parsed.text) {
    blocks.push(...parsed.text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean));
  }

  parsed.visuals.forEach((visual, index) => {
    blocks.push(`可视化：${visualTitle(visual, index)}`);
    if (visual.type === "diagram") {
      blocks.push(visual.code);
    }
  });

  return blocks;
}

export function createConversationExportFileName(
  conversation: Pick<ChatConversation, "title" | "id">,
  format: ChatConversationExportFormat,
  options: ConversationExportOptions = {},
) {
  const exportedAt = options.exportedAt ?? Date.now();
  const title = cleanFileNameSegment(conversation.title || conversation.id);
  return `${title}-${formatFileTimestamp(exportedAt)}.${FORMAT_EXTENSIONS[format]}`;
}

export function resolveConversationExportPath(
  workspaceRoot: string,
  conversation: Pick<ChatConversation, "title" | "id">,
  format: ChatConversationExportFormat,
  options: ConversationExportOptions = {},
) {
  return path.join(
    workspaceRoot,
    ...EXPORT_DIRECTORY_SEGMENTS,
    createConversationExportFileName(conversation, format, options),
  );
}

export function buildConversationMarkdown(
  conversation: ChatConversation,
  options: ConversationExportOptions = {},
) {
  const exportedAt = options.exportedAt ?? Date.now();
  const header = [
    `# ${conversation.title}`,
    "",
    `导出时间：${formatDateTime(exportedAt)}`,
    `创建时间：${formatDateTime(conversation.createdAt)}`,
    `消息数：${conversation.messages.length}`,
    "",
    "---",
  ];

  const messages = conversation.messages.map(buildMessageMarkdown);
  return [...header, ...messages].join("\n\n").trimEnd() + "\n";
}

function buildConversationHtml(conversation: ChatConversation, options: ConversationExportOptions = {}) {
  const exportedAt = options.exportedAt ?? Date.now();
  const messageHtml = conversation.messages
    .map((message) => {
      const parsed = normalizeMessageContent(message);
      const attachments = message.attachments?.length
        ? `<ul class="attachments">${message.attachments
            .map((attachment) => `<li>${escapeHtml(attachment.name)} (${formatBytes(attachment.size)})</li>`)
            .join("")}</ul>`
        : "";
      const text = parsed.text
        ? `<div class="message-text">${escapeHtml(parsed.text)}</div>`
        : "";
      const visuals = parsed.visuals
        .map((visual, index) => {
          const body =
            visual.type === "diagram"
              ? `<pre>${escapeHtml(visual.code)}</pre>`
              : `<pre>${escapeHtml(JSON.stringify(visual.spec, null, 2))}</pre>`;
          return `<section class="visual"><h3>可视化：${escapeHtml(visualTitle(visual, index))}</h3>${body}</section>`;
        })
        .join("");

      return [
        `<article class="message ${message.role}">`,
        `<h2>${messageRoleLabel(message.role)} · ${formatDateTime(message.createdAt)}</h2>`,
        attachments,
        text,
        visuals,
        "</article>",
      ].join("");
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #101828; margin: 36px; line-height: 1.62; }
    h1 { font-size: 26px; margin: 0 0 12px; }
    .meta { color: #667085; font-size: 12px; margin-bottom: 22px; }
    .message { border-top: 1px solid #e4e7ec; padding-top: 18px; margin-top: 18px; page-break-inside: avoid; }
    .message h2 { font-size: 16px; margin: 0 0 10px; }
    .message-text { white-space: pre-wrap; }
    .attachments { margin: 8px 0 12px; color: #475467; }
    .visual h3 { font-size: 14px; margin-bottom: 6px; }
    pre { white-space: pre-wrap; background: #f8fafc; border: 1px solid #e4e7ec; border-radius: 8px; padding: 10px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(conversation.title)}</h1>
  <div class="meta">导出时间：${formatDateTime(exportedAt)} · 创建时间：${formatDateTime(conversation.createdAt)} · 消息数：${conversation.messages.length}</div>
  ${messageHtml}
</body>
</html>`;
}

function buildDocxDocumentXml(conversation: ChatConversation, options: ConversationExportOptions = {}) {
  const exportedAt = options.exportedAt ?? Date.now();
  const paragraphs = [
    conversation.title,
    `导出时间：${formatDateTime(exportedAt)}`,
    `创建时间：${formatDateTime(conversation.createdAt)}`,
    `消息数：${conversation.messages.length}`,
    "",
    ...conversation.messages.flatMap(buildMessagePlainTextBlocks),
  ];

  const body = paragraphs
    .map((paragraph) => {
      const preserveSpace = /^\s|\s$|\s{2,}/.test(paragraph) ? ' xml:space="preserve"' : "";
      return `<w:p><w:r><w:t${preserveSpace}>${escapeXml(paragraph)}</w:t></w:r></w:p>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries: Array<{ name: string; content: string | Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const contentBuffer = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    const checksum = crc32(contentBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contentBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contentBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function buildConversationDocx(conversation: ChatConversation, options: ConversationExportOptions = {}) {
  return createZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: "word/document.xml",
      content: buildDocxDocumentXml(conversation, options),
    },
  ]);
}

export async function exportConversationToFile(
  input: ExportConversationToFileInput,
): Promise<ChatConversationExportResult> {
  const workspaceRoot = input.workspaceRoot.trim();
  if (!workspaceRoot) {
    throw new Error("Missing workspace root for conversation export");
  }

  const exportPath = resolveConversationExportPath(workspaceRoot, input.conversation, input.format, {
    exportedAt: input.exportedAt,
  });
  await mkdir(path.dirname(exportPath), { recursive: true });

  if (input.format === "markdown") {
    await writeFile(exportPath, buildConversationMarkdown(input.conversation, input), "utf8");
  } else if (input.format === "word") {
    await writeFile(exportPath, buildConversationDocx(input.conversation, input));
  } else {
    if (!input.renderPdf) {
      throw new Error("PDF export requires a renderer");
    }
    await writeFile(exportPath, Buffer.from(await input.renderPdf(buildConversationHtml(input.conversation, input))));
  }

  return {
    path: exportPath,
    fileName: path.basename(exportPath),
    format: input.format,
  };
}
