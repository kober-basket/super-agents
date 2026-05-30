import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readStyles() {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");

  return readFileSync(cssPath, "utf8");
}

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("chat permission mode stays compact and keeps approval details in hover copy", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(workspaceSource, /const permissionModeOptions: Array<\{/);
  assert.match(workspaceSource, /Bot,/);
  assert.match(workspaceSource, /OctagonAlert,/);
  assert.match(workspaceSource, /UserCheck,/);
  assert.match(workspaceSource, /const \[displayPermissionMode, setDisplayPermissionMode\] = useState\(permissionMode\)/);
  assert.match(workspaceSource, /setDisplayPermissionMode\(permissionMode\)/);
  assert.match(workspaceSource, /permissionModeOptions\.find\(\(option\) => option\.value === displayPermissionMode\)/);
  assert.match(workspaceSource, /const ActivePermissionIcon = activeOption\.icon/);
  assert.match(workspaceSource, /icon: UserCheck/);
  assert.match(workspaceSource, /icon: Bot/);
  assert.match(workspaceSource, /icon: OctagonAlert/);
  assert.match(workspaceSource, /setDisplayPermissionMode\(option\.value\)/);
  assert.match(workspaceSource, /detail: string;/);
  assert.match(workspaceSource, /detail: "人工审批：高风险工具和越界访问会停下来等你确认。"/);
  assert.match(workspaceSource, /detail: "Agent 审批：可判断的请求交给审查 Agent，敏感输入仍问你。"/);
  assert.match(workspaceSource, /detail: "直接放行：跳过大多数审批，允许访问本机文件和高风险工具。"/);
  assert.match(workspaceSource, /className="chat-permission-mode-panel"/);
  assert.match(workspaceSource, /className="chat-permission-mode-detail"/);
  assert.match(workspaceSource, /title={option\.detail}/);
  assert.doesNotMatch(workspaceSource, /approvalLabel/);
  assert.doesNotMatch(workspaceSource, /chat-permission-mode-approval/);
  assert.doesNotMatch(workspaceSource, /chat-permission-mode-trigger-approval/);
  assert.match(
    workspaceSource,
    /<div className="chat-composer-left">[\s\S]*\{renderKnowledgePicker\(\)\}[\s\S]*\{renderPermissionModeControl\(\)\}[\s\S]*<\/div>\s*<div className="chat-composer-right">[\s\S]*\{renderModelPicker\(\)\}/,
  );
  assert.doesNotMatch(workspaceSource, /<select\s+[^>]*aria-label=/s);

  assert.match(css, /\.chat-permission-mode-trigger\s*{[^}]*min-height:\s*30px/s);
  assert.match(css, /\.chat-permission-mode-trigger\s*{[^}]*border:\s*0/s);
  assert.match(css, /\.chat-permission-mode-trigger\s*{[^}]*background:\s*transparent/s);
  assert.match(css, /\.chat-permission-mode-trigger\.permission-full-access\s*{[^}]*color:\s*#f97316/s);
  assert.match(css, /\.chat-permission-mode-trigger\.permission-full-access\s+svg\s*{[^}]*color:\s*#f97316/s);
  assert.match(css, /\.chat-permission-mode-option\.permission-full-access\s*{[^}]*color:\s*#fb923c/s);
  assert.match(css, /\.chat-permission-mode-panel\s*{[^}]*width:\s*min\(188px,\s*calc\(100vw - 40px\)\)/s);
  assert.match(css, /\.chat-permission-mode-panel\s*{[^}]*padding:\s*4px/s);
  assert.match(css, /\.chat-permission-mode-option\s*{[^}]*min-height:\s*34px/s);
  assert.match(css, /\.chat-permission-mode-option\s*{[^}]*grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.chat-permission-mode-option\s*{[^}]*padding:\s*6px\s+8px/s);
  assert.match(css, /\.chat-permission-mode-detail\s*{[^}]*position:\s*absolute/s);
  assert.match(css, /\.chat-permission-mode-option:hover\s+\.chat-permission-mode-detail/s);
  assert.doesNotMatch(css, /\.chat-permission-mode-approval/);
  assert.doesNotMatch(css, /\.chat-permission-mode-trigger-approval/);
});
