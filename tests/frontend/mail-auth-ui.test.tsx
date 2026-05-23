import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DesktopApprovalRequest, MailProviderSetup } from "../../src/types";

const qqSetup: MailProviderSetup = {
  email: "owner@qq.com",
  domain: "qq.com",
  providerId: "qq",
  providerName: "QQ Mail",
  authType: "password",
  incoming: { host: "imap.qq.com", port: 993, secure: true },
  outgoing: { host: "smtp.qq.com", port: 465, secure: true },
  advancedRequired: false,
  helpText: "Use an app password or authorization code from QQ Mail settings.",
};

function mailAuthRequest(): DesktopApprovalRequest {
  return {
    approvalId: "approval-1",
    kind: "mail_auth",
    sessionId: "session-1",
    agentId: "agent-1",
    toolCallId: "tool-call-1",
    toolName: "mail_auth",
    reason: "Connect QQ Mail",
    createdAt: Date.UTC(2026, 4, 23, 8, 0, 0),
    metadata: {
      email: "owner@qq.com",
      provider: "qq",
      providerName: "QQ Mail",
      authType: "password",
      setup: qqSetup,
    },
  };
}

test("in-chat QQ mail authorization keeps the default form short", async () => {
  (globalThis as any).window = {};
  const { MailAuthRequestCard } = await import("../../src/features/chat/MailAuthRequestCard.js");

  const html = renderToStaticMarkup(
    <MailAuthRequestCard request={mailAuthRequest()} onResolve={async () => undefined} onToast={() => undefined} />,
  );

  assert.match(html, /连接 QQ Mail/);
  assert.match(html, /邮箱地址/);
  assert.match(html, /授权码/);
  assert.doesNotMatch(html, /显示名称/);
  assert.doesNotMatch(html, /用户名/);
  assert.doesNotMatch(html, /高级服务器配置/);
  assert.doesNotMatch(html, /IMAP Host/);
  assert.doesNotMatch(html, /SMTP Host/);
  assert.doesNotMatch(html, /不是 QQ 登录密码/);
  assert.doesNotMatch(html, /授权信息只保存/);
});

test("mail settings keeps optional account fields hidden by default", async () => {
  (globalThis as any).window = {};
  const { MailSettings } = await import("../../src/features/settings/MailSettings.js");

  const html = renderToStaticMarkup(<MailSettings />);

  assert.match(html, /添加邮箱/);
  assert.match(html, /邮箱地址/);
  assert.match(html, /密码 \/ 授权码/);
  assert.doesNotMatch(html, /为 agent 接入/);
  assert.doesNotMatch(html, /显示名称/);
  assert.doesNotMatch(html, /用户名/);
  assert.doesNotMatch(html, /高级服务器配置/);
  assert.doesNotMatch(html, /IMAP Host/);
  assert.doesNotMatch(html, /SMTP Host/);
});
