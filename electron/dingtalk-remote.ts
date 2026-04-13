import { DWClient, EventAck, type DWClientDownStream } from "dingtalk-stream-sdk-nodejs";

import type { DingtalkRemoteControlConfig } from "../src/types";
import {
  type RemoteChannelCallbacks,
  type RemoteChannelMonitor,
  parseContentDispositionFileName,
  readHeader,
  writeRemoteAttachment,
} from "./remote-control-common";

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const DINGTALK_MESSAGE_TOPIC = "/v1.0/im/bot/messages/get";

type DingTalkMessageType =
  | "text"
  | "picture"
  | "richText"
  | "markdown"
  | "file"
  | "audio"
  | "video";

interface DingTalkMediaContent {
  downloadCode?: string;
  pictureDownloadCode?: string;
  fileName?: string;
  extension?: string;
  richText?: Array<
    | {
        type?: "text";
        text?: string;
      }
    | {
        type: "picture";
        downloadCode?: string;
        pictureDownloadCode?: string;
        extension?: string;
      }
  >;
}

interface DingTalkMessageData {
  conversationId: string;
  conversationType: "1" | "2";
  msgId: string;
  msgtype: DingTalkMessageType;
  senderNick?: string;
  senderStaffId?: string;
  isInAtList?: boolean;
  sessionWebhook?: string;
  conversationTitle?: string;
  openConversationId?: string;
  text?: {
    content?: string;
  };
  content?: DingTalkMediaContent;
}

interface DingTalkTokenCacheValue {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, DingTalkTokenCacheValue>();

function buildTitle(message: DingTalkMessageData, peerId: string) {
  if (message.conversationType === "2") {
    return `钉钉群 · ${message.conversationTitle?.trim() || peerId}`;
  }
  return `钉钉 · ${message.senderNick?.trim() || peerId}`;
}

function extractPeerId(message: DingTalkMessageData) {
  if (message.conversationType === "2") {
    return message.openConversationId?.trim() || message.conversationId?.trim() || "";
  }
  return message.senderStaffId?.trim() || "";
}

function extractText(message: DingTalkMessageData) {
  if (message.msgtype === "text" || message.msgtype === "markdown") {
    return message.text?.content?.trim() || "";
  }

  if (message.msgtype === "richText" && Array.isArray(message.content?.richText)) {
    return message.content.richText
      .map((item) => ("text" in item ? item.text?.trim() || "" : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

async function dingtalkApi<T>(
  apiPath: string,
  body: Record<string, unknown>,
  accessToken?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers["x-acs-dingtalk-access-token"] = accessToken;
  }

  const response = await fetch(`${DINGTALK_API_BASE}${apiPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`DingTalk API ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function getAccessToken(config: DingtalkRemoteControlConfig) {
  const cacheKey = config.clientId.trim();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const result = await dingtalkApi<{ accessToken?: string; expireIn?: number }>(
    "/v1.0/oauth2/accessToken",
    {
      appKey: config.clientId,
      appSecret: config.clientSecret,
    },
  );

  if (!result.accessToken) {
    throw new Error("DingTalk access token is empty");
  }

  tokenCache.set(cacheKey, {
    accessToken: result.accessToken,
    expiresAt: Date.now() + (result.expireIn ?? 7200) * 1000,
  });

  return result.accessToken;
}

async function getDownloadUrl(config: DingtalkRemoteControlConfig, downloadCode: string) {
  const accessToken = await getAccessToken(config);
  const result = await dingtalkApi<{ downloadUrl?: string }>(
    "/v1.0/robot/messageFiles/download",
    {
      downloadCode,
      robotCode: config.clientId,
    },
    accessToken,
  );

  if (!result.downloadUrl) {
    throw new Error("DingTalk attachment download url is empty");
  }

  return result.downloadUrl;
}

async function downloadFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DingTalk media download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentDisposition = readHeader(response.headers as unknown, "content-disposition");
  const contentType = readHeader(response.headers as unknown, "content-type");
  return {
    buffer,
    fileName: parseContentDispositionFileName(contentDisposition) ||
      (contentType?.includes("image/") ? "dingtalk-image.jpg" : "dingtalk-attachment.bin"),
  };
}

async function downloadAttachment(
  config: DingtalkRemoteControlConfig,
  rootDir: string,
  peerId: string,
  downloadCode: string,
  fileName: string,
) {
  const downloadUrl = await getDownloadUrl(config, downloadCode);
  const downloaded = await downloadFromUrl(downloadUrl);
  return await writeRemoteAttachment({
    rootDir,
    channel: "dingtalk",
    accountId: config.clientId,
    peerId,
    fileName: fileName || downloaded.fileName,
    buffer: downloaded.buffer,
  });
}

async function collectAttachments(
  message: DingTalkMessageData,
  config: DingtalkRemoteControlConfig,
  rootDir: string,
  peerId: string,
) {
  const files: string[] = [];
  const content = message.content;
  if (!content) {
    return files;
  }

  const downloadCode = content.downloadCode || content.pictureDownloadCode;
  if (
    (message.msgtype === "picture" ||
      message.msgtype === "file" ||
      message.msgtype === "audio" ||
      message.msgtype === "video") &&
    downloadCode
  ) {
    const fallbackName =
      content.fileName ||
      (message.msgtype === "picture"
        ? "dingtalk-image.jpg"
        : message.msgtype === "audio"
          ? "dingtalk-audio.amr"
          : message.msgtype === "video"
            ? "dingtalk-video.mp4"
            : "dingtalk-file.bin");
    files.push(await downloadAttachment(config, rootDir, peerId, downloadCode, fallbackName));
  }

  if (message.msgtype === "richText" && Array.isArray(content.richText)) {
    for (const item of content.richText) {
      if (!("type" in item) || item.type !== "picture") {
        continue;
      }
      const richDownloadCode = item.downloadCode || item.pictureDownloadCode;
      if (!richDownloadCode) {
        continue;
      }
      files.push(
        await downloadAttachment(
          config,
          rootDir,
          peerId,
          richDownloadCode,
          `dingtalk-rich-image.${item.extension || "jpg"}`,
        ),
      );
    }
  }

  return files;
}

async function replyViaWebhook(webhook: string, text: string) {
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title: text.slice(0, 12) || "super-agents",
        text,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`DingTalk webhook reply failed: ${response.status} ${await response.text()}`);
  }
}

async function sendProactiveReply(
  config: DingtalkRemoteControlConfig,
  message: DingTalkMessageData,
  text: string,
) {
  const accessToken = await getAccessToken(config);
  const title = text.slice(0, 12) || "super-agents";

  if (message.conversationType === "2") {
    const openConversationId = message.openConversationId?.trim() || message.conversationId?.trim();
    if (!openConversationId) {
      throw new Error("DingTalk group conversation id is missing");
    }
    await dingtalkApi(
      "/v1.0/robot/groupMessages/send",
      {
        robotCode: config.clientId,
        openConversationId,
        msgKey: "sampleMarkdown",
        msgParam: JSON.stringify({ title, text }),
      },
      accessToken,
    );
    return;
  }

  const userId = message.senderStaffId?.trim();
  if (!userId) {
    throw new Error("DingTalk sender user id is missing");
  }

  await dingtalkApi(
    "/v1.0/robot/oToMessages/batchSend",
    {
      robotCode: config.clientId,
      userIds: [userId],
      msgKey: "sampleMarkdown",
      msgParam: JSON.stringify({ title, text }),
    },
    accessToken,
  );
}

async function replyToMessage(
  config: DingtalkRemoteControlConfig,
  message: DingTalkMessageData,
  text: string,
) {
  if (message.sessionWebhook?.trim()) {
    try {
      await replyViaWebhook(message.sessionWebhook.trim(), text);
      return;
    } catch {
      // Fall through to proactive send.
    }
  }

  await sendProactiveReply(config, message, text);
}

export async function startDingtalkRemoteMonitor(params: {
  config: DingtalkRemoteControlConfig;
  rootDir: string;
  callbacks: RemoteChannelCallbacks;
}): Promise<RemoteChannelMonitor> {
  const { config, rootDir, callbacks } = params;
  const client = new DWClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  let stopped = false;

  client.on("error", (error) => {
    callbacks.onError?.(error);
  });

  client.registerCallbackListener(DINGTALK_MESSAGE_TOPIC, (event: DWClientDownStream) => {
    try {
      client.send(event.headers.messageId, { status: EventAck.SUCCESS });
    } catch (error) {
      callbacks.onError?.(error);
    }

    void (async () => {
      const payload = JSON.parse(event.data) as DingTalkMessageData;
      const peerId = extractPeerId(payload);
      if (!peerId) {
        return;
      }

      const attachmentPaths = await collectAttachments(payload, config, rootDir, peerId);
      const text = extractText(payload);

      callbacks.onMessage({
        accountId: config.clientId,
        peerId,
        title: buildTitle(payload, peerId),
        text,
        attachmentPaths,
        replyText: async (reply) => {
          await replyToMessage(config, payload, reply);
        },
      });
    })().catch((error) => {
      callbacks.onError?.(error);
    });
  });

  await client.connect();
  callbacks.onRunningChange?.(true);

  return {
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      client.disconnect();
      callbacks.onRunningChange?.(false);
    },
  };
}
