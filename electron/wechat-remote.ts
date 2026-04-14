import { createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";

import {
  DEFAULT_WECHAT_BASE_URL,
  DEFAULT_WECHAT_CDN_BASE_URL,
} from "../src/lib/remote-control-config";
import type {
  WechatLoginStartResult,
  WechatLoginWaitResult,
} from "../src/types";

const WECHAT_LOGIN_BASE_URL = "https://ilinkai.weixin.qq.com";
const WECHAT_BOT_TYPE = "3";
const WECHAT_APP_ID = "bot";
const WECHAT_APP_CLIENT_VERSION = String((2 << 16) | (1 << 8) | 7);
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const MAX_QR_REFRESH_COUNT = 3;

type ActiveLogin = {
  sessionKey: string;
  qrcode: string;
  qrCodeUrl: string;
  startedAt: number;
  currentApiBaseUrl: string;
  abortController: AbortController;
};

type WaitForWechatQrLoginOptions = {
  onQrCodeRefresh?: (qrCodeUrl: string) => void;
};

type WechatCdnMedia = {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
};

type WechatTextItem = {
  text?: string;
};

type WechatImageItem = {
  media?: WechatCdnMedia;
  aeskey?: string;
};

type WechatFileItem = {
  media?: WechatCdnMedia;
  file_name?: string;
};

type WechatVideoItem = {
  media?: WechatCdnMedia;
};

export type WechatMessageItem = {
  type?: number;
  text_item?: WechatTextItem;
  image_item?: WechatImageItem;
  file_item?: WechatFileItem;
  video_item?: WechatVideoItem;
};

export type WechatProtocolMessage = {
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  message_state?: number;
  item_list?: WechatMessageItem[];
  context_token?: string;
};

export type WechatGetUpdatesResponse = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WechatProtocolMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

export type WechatAccountProfile = {
  baseUrl: string;
  cdnBaseUrl: string;
  botToken: string;
  accountId: string;
  userId: string;
};

const activeLogins = new Map<string, ActiveLogin>();

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeWechatQrCodeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("<svg")) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
  }
  return `data:image/png;base64,${trimmed}`;
}

function buildCommonHeaders() {
  return {
    "iLink-App-Id": WECHAT_APP_ID,
    "iLink-App-ClientVersion": WECHAT_APP_CLIENT_VERSION,
  };
}

function buildJsonHeaders(body: string, token?: string) {
  return {
    ...buildCommonHeaders(),
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64"),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  }
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function apiGet(baseUrl: string, endpoint: string, timeoutMs = DEFAULT_API_TIMEOUT_MS, signal?: AbortSignal) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  return await fetchTextWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: buildCommonHeaders(),
    },
    timeoutMs,
    signal,
  );
}

async function apiPost<TResponse>(
  baseUrl: string,
  endpoint: string,
  payload: Record<string, unknown>,
  token?: string,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  const body = JSON.stringify(payload);
  const text = await fetchTextWithTimeout(
    url.toString(),
    {
      method: "POST",
      headers: buildJsonHeaders(body, token),
      body,
    },
    timeoutMs,
  );
  return (text ? JSON.parse(text) : {}) as TResponse;
}

function purgeExpiredLogins() {
  const now = Date.now();
  for (const [sessionKey, item] of activeLogins) {
    if (now - item.startedAt >= ACTIVE_LOGIN_TTL_MS) {
      activeLogins.delete(sessionKey);
    }
  }
}

async function fetchQrCode() {
  const text = await apiGet(
    WECHAT_LOGIN_BASE_URL,
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WECHAT_BOT_TYPE)}`,
  );
  const payload = JSON.parse(text) as {
    qrcode: string;
    qrcode_img_content: string;
  };
  return {
    ...payload,
    qrcode_img_content: normalizeWechatQrCodeUrl(payload.qrcode_img_content),
  };
}

export function cancelWechatQrLogin(sessionKey?: string) {
  if (sessionKey?.trim()) {
    const active = activeLogins.get(sessionKey);
    if (active) {
      active.abortController.abort();
      activeLogins.delete(sessionKey);
    }
    return;
  }

  for (const [key, active] of activeLogins) {
    active.abortController.abort();
    activeLogins.delete(key);
  }
}

async function pollQrStatus(baseUrl: string, qrcode: string, signal?: AbortSignal) {
  try {
    const text = await apiGet(
      baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      DEFAULT_LONG_POLL_TIMEOUT_MS,
      signal,
    );
    return JSON.parse(text) as {
      status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect" | "cancelled";
      bot_token?: string;
      ilink_bot_id?: string;
      ilink_user_id?: string;
      baseurl?: string;
      redirect_host?: string;
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) {
        return { status: "cancelled" as const };
      }
      return { status: "wait" as const };
    }
    return { status: "wait" as const };
  }
}

export async function startWechatQrLogin(): Promise<WechatLoginStartResult> {
  purgeExpiredLogins();
  const sessionKey = randomUUID();
  const qr = await fetchQrCode();
  const abortController = new AbortController();
  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode: qr.qrcode,
    qrCodeUrl: qr.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: WECHAT_LOGIN_BASE_URL,
    abortController,
  });
  return {
    sessionKey,
    qrCodeUrl: qr.qrcode_img_content,
    message: "请使用微信扫码完成连接。",
  };
}

export async function waitForWechatQrLogin(
  sessionKey: string,
  timeoutMs = 480_000,
  options: WaitForWechatQrLoginOptions = {},
): Promise<WechatLoginWaitResult & { profile?: WechatAccountProfile }> {
  const login = activeLogins.get(sessionKey);
  if (!login) {
    return {
      connected: false,
      message: "当前没有进行中的微信登录，请重新生成二维码。",
    };
  }

  let refreshCount = 1;
  const deadline = Date.now() + Math.max(timeoutMs, 1_000);

  while (Date.now() < deadline) {
    if (login.abortController.signal.aborted) {
      activeLogins.delete(sessionKey);
      return {
        connected: false,
        message: "微信连接已取消。",
      };
    }

    const status = await pollQrStatus(login.currentApiBaseUrl, login.qrcode, login.abortController.signal);

    if (status.status === "cancelled") {
      activeLogins.delete(sessionKey);
      return {
        connected: false,
        message: "微信连接已取消。",
      };
    }

    if (status.status === "scaned_but_redirect" && status.redirect_host) {
      login.currentApiBaseUrl = `https://${status.redirect_host}`;
      continue;
    }

    if (status.status === "expired") {
      refreshCount += 1;
      if (refreshCount > MAX_QR_REFRESH_COUNT) {
        activeLogins.delete(sessionKey);
        return {
          connected: false,
          message: "二维码多次过期，请重新发起连接。",
        };
      }
      const qr = await fetchQrCode();
      login.qrcode = qr.qrcode;
      login.qrCodeUrl = qr.qrcode_img_content;
      login.startedAt = Date.now();
      options.onQrCodeRefresh?.(qr.qrcode_img_content);
      continue;
    }

    if (status.status === "confirmed" && status.bot_token && status.ilink_bot_id) {
      activeLogins.delete(sessionKey);
      return {
        connected: true,
        accountId: status.ilink_bot_id,
        userId: status.ilink_user_id,
        message: "微信连接成功。",
        profile: {
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id ?? "",
          botToken: status.bot_token,
          baseUrl: status.baseurl?.trim() || DEFAULT_WECHAT_BASE_URL,
          cdnBaseUrl: DEFAULT_WECHAT_CDN_BASE_URL,
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  activeLogins.delete(sessionKey);
  return {
    connected: false,
    message: "等待扫码确认超时，请重试。",
  };
}

export async function getWechatUpdates(params: {
  baseUrl: string;
  botToken: string;
  syncCursor?: string;
  timeoutMs?: number;
}): Promise<WechatGetUpdatesResponse> {
  try {
    return await apiPost<WechatGetUpdatesResponse>(
      params.baseUrl,
      "ilink/bot/getupdates",
      {
        get_updates_buf: params.syncCursor ?? "",
        base_info: {
          channel_version: "super-agents",
        },
      },
      params.botToken,
      params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ret: 0,
        msgs: [],
        get_updates_buf: params.syncCursor ?? "",
      };
    }
    throw error;
  }
}

export async function sendWechatTextMessage(params: {
  baseUrl: string;
  botToken: string;
  toUserId: string;
  text: string;
  contextToken?: string;
}) {
  await apiPost(
    params.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: `super-agents-${randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: params.text.trim()
          ? [
              {
                type: 1,
                text_item: {
                  text: params.text,
                },
              },
            ]
          : undefined,
        context_token: params.contextToken || undefined,
      },
      base_info: {
        channel_version: "super-agents",
      },
    },
    params.botToken,
  );
}

export function extractWechatText(message: WechatProtocolMessage) {
  const textParts: string[] = [];
  for (const item of message.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) {
      textParts.push(item.text_item.text);
    }
  }
  return textParts.join("\n").trim();
}

function parseAesKey(item: WechatCdnMedia, rawHexKey?: string) {
  if (rawHexKey?.trim()) {
    return Buffer.from(rawHexKey.trim(), "hex");
  }
  if (!item.aes_key?.trim()) {
    return null;
  }
  const decoded = Buffer.from(item.aes_key, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  return null;
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer) {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function buildWechatDownloadUrl(cdnBaseUrl: string, media: WechatCdnMedia) {
  if (media.full_url?.trim()) {
    return media.full_url.trim();
  }
  if (!media.encrypt_query_param?.trim()) {
    throw new Error("微信附件缺少下载参数。");
  }
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;
}

async function saveWechatAttachment(params: {
  directory: string;
  fileName: string;
  buffer: Buffer;
}) {
  await mkdir(params.directory, { recursive: true });
  const safeName = params.fileName.replace(/[\\/:*?"<>|]+/g, "-");
  const targetPath = path.join(params.directory, `${Date.now()}-${randomUUID()}-${safeName}`);
  await writeFile(targetPath, params.buffer);
  return targetPath;
}

async function downloadWechatMedia(params: {
  directory: string;
  cdnBaseUrl: string;
  media: WechatCdnMedia;
  fileName: string;
  rawHexKey?: string;
}) {
  const url = buildWechatDownloadUrl(params.cdnBaseUrl, params.media);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载微信附件失败: ${response.status} ${response.statusText}`);
  }
  const encrypted = Buffer.from(await response.arrayBuffer());
  const key = parseAesKey(params.media, params.rawHexKey);
  const buffer = key ? decryptAesEcb(encrypted, key) : encrypted;
  return await saveWechatAttachment({
    directory: params.directory,
    fileName: params.fileName,
    buffer,
  });
}

export async function downloadWechatAttachments(params: {
  message: WechatProtocolMessage;
  directory: string;
  cdnBaseUrl?: string;
}) {
  const files: string[] = [];
  const cdnBaseUrl = params.cdnBaseUrl?.trim() || DEFAULT_WECHAT_CDN_BASE_URL;

  for (const item of params.message.item_list ?? []) {
    if (item.type === 2 && item.image_item?.media) {
      const filePath = await downloadWechatMedia({
        directory: params.directory,
        cdnBaseUrl,
        media: item.image_item.media,
        rawHexKey: item.image_item.aeskey,
        fileName: `wechat-image.${mime.extension("image/jpeg") || "jpg"}`,
      });
      files.push(filePath);
      continue;
    }

    if (item.type === 4 && item.file_item?.media) {
      const filePath = await downloadWechatMedia({
        directory: params.directory,
        cdnBaseUrl,
        media: item.file_item.media,
        fileName: item.file_item.file_name || "wechat-file.bin",
      });
      files.push(filePath);
      continue;
    }

    if (item.type === 5 && item.video_item?.media) {
      const filePath = await downloadWechatMedia({
        directory: params.directory,
        cdnBaseUrl,
        media: item.video_item.media,
        fileName: "wechat-video.mp4",
      });
      files.push(filePath);
    }
  }

  return files;
}

export function isWechatUserMessage(message: WechatProtocolMessage) {
  return Boolean(message.from_user_id?.trim()) && message.message_type !== 2;
}
