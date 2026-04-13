import type { RemoteControlConfig } from "../types";

export const DEFAULT_FEISHU_DOMAIN = "feishu";
export const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const DEFAULT_WECOM_WEBSOCKET_URL = "wss://openws.work.weixin.qq.com";

export const DEFAULT_REMOTE_CONTROL_CONFIG: RemoteControlConfig = {
  dingtalk: {
    enabled: false,
    clientId: "",
    clientSecret: "",
  },
  feishu: {
    enabled: false,
    appId: "",
    appSecret: "",
    domain: DEFAULT_FEISHU_DOMAIN,
  },
  wechat: {
    enabled: false,
    baseUrl: DEFAULT_WECHAT_BASE_URL,
    cdnBaseUrl: DEFAULT_WECHAT_CDN_BASE_URL,
    botToken: "",
    accountId: "",
    userId: "",
    connectedAt: null,
  },
  wecom: {
    enabled: false,
    botId: "",
    secret: "",
    websocketUrl: DEFAULT_WECOM_WEBSOCKET_URL,
  },
};

export function normalizeRemoteControlConfig(
  value?: Partial<RemoteControlConfig> | null,
): RemoteControlConfig {
  return {
    dingtalk: {
      enabled: value?.dingtalk?.enabled === true,
      clientId:
        typeof value?.dingtalk?.clientId === "string" ? value.dingtalk.clientId.trim() : "",
      clientSecret:
        typeof value?.dingtalk?.clientSecret === "string"
          ? value.dingtalk.clientSecret.trim()
          : "",
    },
    feishu: {
      enabled: value?.feishu?.enabled === true,
      appId: typeof value?.feishu?.appId === "string" ? value.feishu.appId.trim() : "",
      appSecret:
        typeof value?.feishu?.appSecret === "string" ? value.feishu.appSecret.trim() : "",
      domain:
        value?.feishu?.domain === "lark" || value?.feishu?.domain === "feishu"
          ? value.feishu.domain
          : DEFAULT_FEISHU_DOMAIN,
    },
    wechat: {
      enabled: value?.wechat?.enabled === true,
      baseUrl:
        typeof value?.wechat?.baseUrl === "string" && value.wechat.baseUrl.trim()
          ? value.wechat.baseUrl.trim()
          : DEFAULT_WECHAT_BASE_URL,
      cdnBaseUrl:
        typeof value?.wechat?.cdnBaseUrl === "string" && value.wechat.cdnBaseUrl.trim()
          ? value.wechat.cdnBaseUrl.trim()
          : DEFAULT_WECHAT_CDN_BASE_URL,
      botToken:
        typeof value?.wechat?.botToken === "string" ? value.wechat.botToken.trim() : "",
      accountId:
        typeof value?.wechat?.accountId === "string" ? value.wechat.accountId.trim() : "",
      userId: typeof value?.wechat?.userId === "string" ? value.wechat.userId.trim() : "",
      connectedAt:
        typeof value?.wechat?.connectedAt === "number" ? value.wechat.connectedAt : null,
    },
    wecom: {
      enabled: value?.wecom?.enabled === true,
      botId: typeof value?.wecom?.botId === "string" ? value.wecom.botId.trim() : "",
      secret: typeof value?.wecom?.secret === "string" ? value.wecom.secret.trim() : "",
      websocketUrl:
        typeof value?.wecom?.websocketUrl === "string" && value.wecom.websocketUrl.trim()
          ? value.wecom.websocketUrl.trim()
          : DEFAULT_WECOM_WEBSOCKET_URL,
    },
  };
}
