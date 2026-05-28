import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("routine successful settings and refresh actions avoid global toast", () => {
  const appSource = readSource("src/App.tsx");
  const workspaceControllerSource = readSource("src/features/workspace/useWorkspaceController.ts");

  assert.doesNotMatch(workspaceControllerSource, /"设置已保存"/);
  assert.doesNotMatch(appSource, /"设置已保存"/);
  assert.doesNotMatch(appSource, /"已添加提供方"/);
  assert.doesNotMatch(appSource, /"已移除 .*提供方.*配置"/);
  assert.doesNotMatch(appSource, /"已添加 MCP 服务"/);
  assert.doesNotMatch(appSource, /"已移除 .*MCP.*配置"/);
  assert.doesNotMatch(appSource, /"知识库已刷新"/);
  assert.doesNotMatch(appSource, /"远程控制状态已刷新"/);
});

test("copy and voice success states stay inline instead of using global toast", () => {
  const appSource = readSource("src/App.tsx");
  const chatSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.doesNotMatch(chatSource, /onToast\("已复制"\)/);
  assert.doesNotMatch(chatSource, /onToast\("已复制 Markdown"\)/);
  assert.doesNotMatch(chatSource, /onToast\(`已添加 \$\{normalizedFiles\.length\} 个附件`\)/);
  assert.doesNotMatch(appSource, /setToast\("语音已转成文字"\)/);
  assert.doesNotMatch(appSource, /setToast\("正在录音，点击麦克风结束"\)/);
});

test("knowledge base list mutations rely on visible UI changes instead of success toast", () => {
  const appSource = readSource("src/App.tsx");

  assert.doesNotMatch(appSource, /setToast\(`已创建知识库/);
  assert.doesNotMatch(appSource, /setToast\("知识库已删除"\)/);
  assert.doesNotMatch(appSource, /setToast\("笔记已添加"\)/);
  assert.doesNotMatch(appSource, /setToast\("目录已添加"\)/);
  assert.doesNotMatch(appSource, /setToast\("链接已添加"\)/);
  assert.doesNotMatch(appSource, /setToast\("网站已添加"\)/);
  assert.doesNotMatch(appSource, /setToast\("知识项已删除"\)/);
});

test("agent turn failures stay in conversation output instead of global toast", () => {
  const appSource = readSource("src/App.tsx");

  assert.doesNotMatch(appSource, /setToast\(event\.error\)/);
});
