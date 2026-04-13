import type { RemoteControlConfig } from "../types";

export const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

export const DEFAULT_REMOTE_CONTROL_CONFIG: RemoteControlConfig = {
  dingtalk: {
    enabled: false,
  },
  feishu: {
    enabled: false,
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
  },
};

export function normalizeRemoteControlConfig(
  value?: Partial<RemoteControlConfig> | null,
): RemoteControlConfig {
  return {
    dingtalk: {
      enabled: value?.dingtalk?.enabled === true,
    },
    feishu: {
      enabled: value?.feishu?.enabled === true,
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
    },
  };
}
