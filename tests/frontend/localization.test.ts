import assert from "node:assert/strict";
import test from "node:test";

import { describePreviewItem, formatMcpStatusLabel } from "../../src/features/shared/utils";
import {
  DEFAULT_CHAT_TITLE,
  NO_WORKSPACE_SELECTED_LABEL,
  workspaceLabel,
} from "../../src/features/workspace/labels";

test("preview item labels use Chinese copy", () => {
  assert.equal(describePreviewItem({ kind: "pdf", name: "guide.pdf" }).label, "PDF 文档");
  assert.equal(describePreviewItem({ kind: "image", name: "cover.png" }).label, "图片资源");
  assert.equal(describePreviewItem({ kind: "web", name: "https://example.com" }).label, "网页");
  assert.equal(describePreviewItem({ kind: "code", name: "main.ts" }).label, "源代码文件");
  assert.equal(describePreviewItem({ kind: "text", name: "notes.txt" }).label, "文本文档");
  assert.equal(describePreviewItem({ name: "archive.bin" }).label, "二进制文件");
});

test("workspace labels default to Chinese copy", () => {
  assert.equal(DEFAULT_CHAT_TITLE, "当前对话");
  assert.equal(NO_WORKSPACE_SELECTED_LABEL, "未选择工作区");
  assert.equal(workspaceLabel(""), "未选择工作区");
  assert.equal(workspaceLabel("F:/work/github/super-agents"), "super-agents");
});

test("mcp statuses use Chinese copy", () => {
  assert.equal(formatMcpStatusLabel("connected"), "已连接");
  assert.equal(formatMcpStatusLabel("disabled"), "未启用");
  assert.equal(formatMcpStatusLabel("needs_auth"), "待认证");
});
