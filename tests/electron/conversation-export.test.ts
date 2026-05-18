import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildConversationMarkdown,
  createConversationExportFileName,
  exportConversationToFile,
  resolveConversationExportPath,
} from "../../electron/conversation-export";
import type { ChatConversation } from "../../src/types";

function sampleConversation(): ChatConversation {
  return {
    id: "conversation-1",
    title: "需求/导出:*测试",
    createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
    updatedAt: Date.UTC(2026, 4, 17, 8, 2, 0),
    lastMessageAt: Date.UTC(2026, 4, 17, 8, 2, 0),
    preview: "当然可以",
    messageCount: 2,
    selectedKnowledgeBaseIds: [],
    messages: [
      {
        id: "message-user",
        role: "user",
        content: "可以导出了吗？",
        attachments: [
          {
            id: "file-1",
            name: "spec.md",
            path: "/workspace/spec.md",
            size: 128,
            mimeType: "text/markdown",
            kind: "markdown",
          },
        ],
        createdAt: Date.UTC(2026, 4, 17, 8, 0, 0),
        updatedAt: Date.UTC(2026, 4, 17, 8, 0, 0),
      },
      {
        id: "message-assistant",
        role: "assistant",
        content: "当然可以。\n\n```super-agents-visual\n{\"type\":\"diagram\",\"style\":\"mermaid\",\"title\":\"导出流程\",\"code\":\"graph TD; A-->B;\"}\n```",
        createdAt: Date.UTC(2026, 4, 17, 8, 1, 0),
        updatedAt: Date.UTC(2026, 4, 17, 8, 1, 0),
      },
    ],
  };
}

test("conversation markdown export includes metadata, roles, attachments, text, and visuals", () => {
  const markdown = buildConversationMarkdown(sampleConversation(), {
    exportedAt: Date.UTC(2026, 4, 17, 9, 10, 11),
  });

  assert.match(markdown, /^# 需求\/导出:\*测试/m);
  assert.match(markdown, /导出时间：2026-05-17 09:10/);
  assert.match(markdown, /消息数：2/);
  assert.match(markdown, /## 用户 · 2026-05-17 08:00/);
  assert.match(markdown, /- spec\.md \(128 B\)/);
  assert.match(markdown, /可以导出了吗？/);
  assert.match(markdown, /## Agent · 2026-05-17 08:01/);
  assert.match(markdown, /当然可以。/);
  assert.match(markdown, /### 可视化：导出流程/);
  assert.match(markdown, /```mermaid\ngraph TD; A-->B;\n```/);
});

test("conversation export filenames keep readable text while removing unsafe path characters", () => {
  const fileName = createConversationExportFileName(sampleConversation(), "markdown", {
    exportedAt: Date.UTC(2026, 4, 17, 9, 10, 11),
  });

  assert.equal(fileName, "需求-导出-测试-20260517-091011.md");
});

test("conversation export path targets workspace exports conversation directory", () => {
  const exportPath = resolveConversationExportPath("/tmp/super-agents-workspace", sampleConversation(), "word", {
    exportedAt: Date.UTC(2026, 4, 17, 9, 10, 11),
  });

  assert.equal(
    exportPath,
    path.join(
      "/tmp/super-agents-workspace",
      "exports",
      "conversations",
      "需求-导出-测试-20260517-091011.docx",
    ),
  );
});

test("conversation markdown export writes a file under the workspace export directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-export-"));

  try {
    const result = await exportConversationToFile({
      workspaceRoot: tempDir,
      conversation: sampleConversation(),
      format: "markdown",
      exportedAt: Date.UTC(2026, 4, 17, 9, 10, 11),
    });

    assert.equal(
      result.path,
      path.join(tempDir, "exports", "conversations", "需求-导出-测试-20260517-091011.md"),
    );
    assert.equal(result.fileName, "需求-导出-测试-20260517-091011.md");
    assert.equal(result.format, "markdown");

    const content = await readFile(result.path, "utf8");
    assert.match(content, /# 需求\/导出:\*测试/);
    assert.match(content, /当然可以。/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation word export writes an openxml docx file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-export-"));

  try {
    const result = await exportConversationToFile({
      workspaceRoot: tempDir,
      conversation: sampleConversation(),
      format: "word",
      exportedAt: Date.UTC(2026, 4, 17, 9, 10, 11),
    });

    assert.equal(
      result.path,
      path.join(tempDir, "exports", "conversations", "需求-导出-测试-20260517-091011.docx"),
    );

    const buffer = await readFile(result.path);
    assert.equal(buffer.subarray(0, 4).toString("hex"), "504b0304");
    assert.match(buffer.toString("utf8"), /word\/document\.xml/);
    assert.match(buffer.toString("utf8"), /当然可以。/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("conversation pdf export writes bytes returned by the pdf renderer", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-export-"));

  try {
    const result = await exportConversationToFile({
      workspaceRoot: tempDir,
      conversation: sampleConversation(),
      format: "pdf",
      exportedAt: Date.UTC(2026, 4, 17, 9, 10, 11),
      renderPdf: async (html) => {
        assert.match(html, /当然可以。/);
        return Buffer.from("%PDF-1.4\n% super-agents test pdf\n");
      },
    });

    assert.equal(
      result.path,
      path.join(tempDir, "exports", "conversations", "需求-导出-测试-20260517-091011.pdf"),
    );
    assert.equal((await readFile(result.path, "utf8")).startsWith("%PDF-1.4"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
