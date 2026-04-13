import { mkdir } from "node:fs/promises";
import path from "node:path";

import * as Lark from "@larksuiteoapi/node-sdk";

import type { FeishuRemoteControlConfig } from "../src/types";
import {
  type RemoteChannelCallbacks,
  type RemoteChannelMonitor,
  parseContentDispositionFileName,
  readHeader,
  sanitizeFileName,
  sanitizePathSegment,
} from "./remote-control-common";

type FeishuMessageReceiveEvent = {
  sender: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
  };
};

function resolveDomain(domain: FeishuRemoteControlConfig["domain"]) {
  return domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

function parseContent(raw: string) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function collectTextFragments(value: unknown, fragments: string[]) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      fragments.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFragments(item, fragments);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "image_key" || key === "file_key") {
      continue;
    }
    collectTextFragments(item, fragments);
  }
}

function extractText(messageType: string, content: Record<string, unknown>) {
  if (messageType === "text") {
    return typeof content.text === "string" ? content.text.trim() : "";
  }

  const fragments: string[] = [];
  collectTextFragments(content, fragments);
  return fragments.join("\n").trim();
}

function resolveResourceType(messageType: string) {
  if (messageType === "sticker") {
    return "image";
  }
  if (["image", "file", "audio", "media"].includes(messageType)) {
    return messageType;
  }
  return "";
}

function resolveResourceKey(messageType: string, content: Record<string, unknown>) {
  if (messageType === "image" || messageType === "sticker") {
    return typeof content.image_key === "string" ? content.image_key.trim() : "";
  }

  if (typeof content.file_key === "string") {
    return content.file_key.trim();
  }

  if (typeof content.audio_key === "string") {
    return content.audio_key.trim();
  }

  if (typeof content.media_key === "string") {
    return content.media_key.trim();
  }

  return "";
}

function resolveFallbackFileName(messageType: string, content: Record<string, unknown>) {
  if (typeof content.file_name === "string" && content.file_name.trim()) {
    return content.file_name.trim();
  }

  if (messageType === "image" || messageType === "sticker") {
    return "feishu-image.png";
  }
  if (messageType === "audio") {
    return "feishu-audio.mp3";
  }
  if (messageType === "media") {
    return "feishu-media.mp4";
  }
  return "feishu-file.bin";
}

async function downloadResource(params: {
  client: Lark.Client;
  rootDir: string;
  accountId: string;
  peerId: string;
  messageId: string;
  messageType: string;
  content: Record<string, unknown>;
}) {
  const resourceType = resolveResourceType(params.messageType);
  const resourceKey = resolveResourceKey(params.messageType, params.content);

  if (!resourceType || !resourceKey) {
    return [];
  }

  const resource = await params.client.im.messageResource.get({
    params: {
      type: resourceType,
    },
    path: {
      message_id: params.messageId,
      file_key: resourceKey,
    },
  });

  const contentDisposition = readHeader(resource.headers, "content-disposition");
  const fileName =
    parseContentDispositionFileName(contentDisposition) ||
    resolveFallbackFileName(params.messageType, params.content);
  const directory = path.join(
    params.rootDir,
    "feishu",
    sanitizePathSegment(params.accountId),
    sanitizePathSegment(params.peerId),
  );
  await mkdir(directory, { recursive: true });
  const targetPath = path.join(directory, `${Date.now()}-${sanitizeFileName(fileName)}`);

  await resource.writeFile(targetPath);
  return [targetPath];
}

function buildTitle(event: FeishuMessageReceiveEvent) {
  const senderId =
    event.sender.sender_id?.open_id ||
    event.sender.sender_id?.user_id ||
    event.sender.sender_id?.union_id ||
    event.message.chat_id;
  return event.message.chat_type === "p2p" ? `飞书 · ${senderId}` : `飞书群 · ${event.message.chat_id}`;
}

export async function startFeishuRemoteMonitor(params: {
  config: FeishuRemoteControlConfig;
  rootDir: string;
  callbacks: RemoteChannelCallbacks;
}): Promise<RemoteChannelMonitor> {
  const { config, rootDir, callbacks } = params;
  const baseConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
    domain: resolveDomain(config.domain),
  };
  const client = new Lark.Client(baseConfig);
  const wsClient = new Lark.WSClient(baseConfig);
  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": (event: FeishuMessageReceiveEvent) => {
      void (async () => {
        const content = parseContent(event.message.content);
        const text = extractText(event.message.message_type, content);
        const attachmentPaths = await downloadResource({
          client,
          rootDir,
          accountId: config.appId,
          peerId: event.message.chat_id,
          messageId: event.message.message_id,
          messageType: event.message.message_type,
          content,
        });

        callbacks.onMessage({
          accountId: config.appId,
          peerId: event.message.chat_id,
          title: buildTitle(event),
          text,
          attachmentPaths,
          replyText: async (reply) => {
            await client.im.message.create({
              params: {
                receive_id_type: "chat_id",
              },
              data: {
                receive_id: event.message.chat_id,
                msg_type: "text",
                content: JSON.stringify({
                  text: reply,
                }),
              },
            });
          },
        });
      })().catch((error) => {
        callbacks.onError?.(error);
      });

      return undefined;
    },
  });

  await wsClient.start({
    eventDispatcher,
  });
  callbacks.onRunningChange?.(true);

  return {
    stop: async () => {
      wsClient.close({ force: true });
      callbacks.onRunningChange?.(false);
    },
  };
}
