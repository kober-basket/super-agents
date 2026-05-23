import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolveToastFeedback } from "../../src/lib/toast-feedback";

function readStyles() {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");

  return readFileSync(cssPath, "utf8");
}

test("low priority success and status messages do not show global toast", () => {
  const lowPriorityMessages = [
    "设置已保存",
    "已添加提供方",
    "默认模型已更新",
    "知识库已刷新",
    "远程控制状态已刷新",
    "已复制",
    "已复制 Markdown",
    "语音已转成文字",
    "正在录音，点击麦克风结束",
    "已添加 2 个附件",
    "笔记已添加",
    "知识项已删除",
    "微信远程控制已启用",
  ];

  for (const message of lowPriorityMessages) {
    assert.equal(resolveToastFeedback(message), null, message);
  }
});

test("toast feedback keeps errors, blockers, and important completion messages", () => {
  assert.deepEqual(resolveToastFeedback("刷新知识库失败"), {
    message: "刷新知识库失败",
    tone: "error",
  });
  assert.deepEqual(resolveToastFeedback("请先输入知识库名称"), {
    message: "请先输入知识库名称",
    tone: "warning",
  });
  assert.deepEqual(resolveToastFeedback("已导入 2 个文件"), {
    message: "已导入 2 个文件",
    tone: "info",
  });
  assert.deepEqual(resolveToastFeedback("已导出：demo.md"), {
    message: "已导出：demo.md",
    tone: "info",
  });
});

test("toast uses a light desktop-style floating surface", () => {
  const css = readStyles();

  assert.match(css, /--toast-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.9\)/);
  assert.match(css, /--toast-border:\s*rgba\(226,\s*232,\s*240,\s*0\.9\)/);
  assert.match(css, /\.toast\s*{[^}]*display:\s*inline-flex[^}]*border:\s*1px solid var\(--toast-border\)/s);
  assert.match(css, /\.toast\s*{[^}]*backdrop-filter:\s*blur\(18px\)/s);
  assert.match(css, /\.toast::before\s*{[^}]*border-radius:\s*999px/s);
  assert.match(css, /\.toast\.error::before\s*{[^}]*background:\s*#ef4444/s);
  assert.match(css, /\.toast\.warning::before\s*{[^}]*background:\s*#f59e0b/s);
});
