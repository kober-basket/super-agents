import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RemoteControlSettings } from "../../src/features/settings/RemoteControlSettings";
import type { RemoteControlConfig, RemoteControlStatus } from "../../src/types";

const remoteControl: RemoteControlConfig = {
  dingtalk: { enabled: false, clientId: "", clientSecret: "" },
  feishu: { enabled: false, appId: "", appSecret: "", domain: "feishu" },
  wechat: {
    enabled: false,
    baseUrl: "https://ilinkai.weixin.qq.com",
    cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
    botToken: "",
    accountId: "",
    userId: "",
    connectedAt: null,
  },
  wecom: { enabled: false, botId: "", secret: "", websocketUrl: "wss://openws.work.weixin.qq.com" },
};

function createStatus(wechat: Partial<RemoteControlStatus["wechat"]> = {}): RemoteControlStatus {
  return {
    dingtalk: {
      enabled: false,
      configured: false,
      connected: false,
      running: false,
      activePeerCount: 0,
    },
    feishu: {
      enabled: false,
      configured: false,
      connected: false,
      running: false,
      activePeerCount: 0,
    },
    wechat: {
      enabled: false,
      configured: false,
      connected: false,
      running: false,
      pendingLogin: false,
      accountId: "",
      userId: "",
      activePeerCount: 0,
      ...wechat,
    },
    wecom: {
      enabled: false,
      configured: false,
      connected: false,
      running: false,
      activePeerCount: 0,
    },
  };
}

function renderRemoteControl(status: RemoteControlStatus) {
  return renderToStaticMarkup(
    <RemoteControlSettings
      remoteControl={remoteControl}
      remoteStatus={status}
      refreshing={false}
      wechatConnecting={false}
      onDisconnectWechat={async () => undefined}
      onRefresh={async () => undefined}
      onStartWechatLogin={async () => undefined}
      onToggleWechatEnabled={() => undefined}
    />,
  );
}

test("remote control page translates expired WeChat sessions into a recovery hint", () => {
  const html = renderRemoteControl(
    createStatus({
      enabled: true,
      configured: true,
      connected: true,
      lastError: "session timeout",
    }),
  );

  assert.match(html, /微信登录已过期/);
  assert.match(html, /重新扫码绑定/);
  assert.doesNotMatch(html, /session timeout/);
});

test("remote control page hides stale WeChat errors while the channel is closed", () => {
  const html = renderRemoteControl(
    createStatus({
      enabled: false,
      configured: false,
      connected: false,
      lastError: "session timeout",
    }),
  );

  assert.doesNotMatch(html, /微信登录已过期/);
  assert.doesNotMatch(html, /session timeout/);
});

test("remote control page uses a channel list and detail panel without overview chrome", () => {
  const html = renderRemoteControl(createStatus());

  assert.match(html, /remote-channel-list/);
  assert.match(html, /remote-channel-detail/);
  assert.match(html, /微信配置/);
  assert.doesNotMatch(html, /刷新/);
  assert.doesNotMatch(html, /选择一个消息通道|通道已关闭|通道已接入|远程入口已接入|选择通道开始接入|待处理/);
});
