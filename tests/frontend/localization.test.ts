import assert from "node:assert/strict";
import test from "node:test";

import { describePreviewItem, formatMcpStatusLabel } from "../../src/features/shared/utils";
import {
  DEFAULT_WORKSPACE_TITLE,
  NO_WORKSPACE_SELECTED_LABEL,
  workspaceLabel,
} from "../../src/features/workspace/labels";

test("preview item labels use Chinese copy", () => {
  assert.equal(describePreviewItem({ kind: "pdf", name: "guide.pdf" }).label, "PDF \u6587\u6863");
  assert.equal(describePreviewItem({ kind: "image", name: "cover.png" }).label, "\u56fe\u7247\u8d44\u6e90");
  assert.equal(describePreviewItem({ kind: "web", name: "https://example.com" }).label, "\u7f51\u9875");
  assert.equal(describePreviewItem({ kind: "code", name: "main.ts" }).label, "\u6e90\u4ee3\u7801\u6587\u4ef6");
  assert.equal(describePreviewItem({ kind: "text", name: "notes.txt" }).label, "\u6587\u672c\u6587\u4ef6");
  assert.equal(describePreviewItem({ name: "archive.bin" }).label, "\u4e8c\u8fdb\u5236\u6587\u4ef6");
});

test("workspace labels default to Chinese copy", () => {
  assert.equal(DEFAULT_WORKSPACE_TITLE, "\u5de5\u4f5c\u53f0");
  assert.equal(NO_WORKSPACE_SELECTED_LABEL, "\u672a\u9009\u62e9\u5de5\u4f5c\u533a");
  assert.equal(workspaceLabel(""), "\u672a\u9009\u62e9\u5de5\u4f5c\u533a");
  assert.equal(workspaceLabel("F:/work/github/super-agents"), "super-agents");
});

test("mcp statuses use Chinese copy", () => {
  assert.equal(formatMcpStatusLabel("connected"), "\u5df2\u8fde\u63a5");
  assert.equal(formatMcpStatusLabel("disabled"), "\u672a\u542f\u7528");
  assert.equal(formatMcpStatusLabel("needs_auth"), "\u5f85\u8ba4\u8bc1");
});

