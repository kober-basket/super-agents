import {
  WSClient,
  type FileMessage,
  type ImageMessage,
  type MixedMessage,
  type TextMessage,
  type VideoMessage,
  type VoiceMessage,
  type WsFrame,
} from "@wecom/aibot-node-sdk";

import type { WecomRemoteControlConfig } from "../src/types";
import {
  type RemoteChannelCallbacks,
  type RemoteChannelMonitor,
  writeRemoteAttachment,
} from "./remote-control-common";

type SupportedWeComFrame =
  | WsFrame<TextMessage>
  | WsFrame<ImageMessage>
  | WsFrame<MixedMessage>
  | WsFrame<VoiceMessage>
  | WsFrame<FileMessage>
  | WsFrame<VideoMessage>;

function resolvePeerId(frame: SupportedWeComFrame) {
  return frame.body.chatid || frame.body.from.userid;
}

function buildTitle(frame: SupportedWeComFrame) {
  const peerId = resolvePeerId(frame);
  return frame.body.chattype === "group" ? `企微群 · ${peerId}` : `企微 · ${frame.body.from.userid}`;
}

function extractText(frame: SupportedWeComFrame) {
  if (frame.body.msgtype === "text") {
    return frame.body.text.content.trim();
  }

  if (frame.body.msgtype === "voice") {
    return frame.body.voice.content.trim();
  }

  if (frame.body.msgtype === "mixed") {
    return frame.body.mixed.msg_item
      .map((item) => (item.msgtype === "text" ? item.text?.content?.trim() || "" : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

async function collectAttachments(
  client: WSClient,
  config: WecomRemoteControlConfig,
  rootDir: string,
  frame: SupportedWeComFrame,
) {
  const peerId = resolvePeerId(frame);
  const files: string[] = [];

  async function saveDownloaded(url: string, aeskey: string | undefined, fallbackName: string) {
    const result = await client.downloadFile(url, aeskey);
    files.push(
      await writeRemoteAttachment({
        rootDir,
        channel: "wecom",
        accountId: config.botId,
        peerId,
        fileName: result.filename || fallbackName,
        buffer: result.buffer,
      }),
    );
  }

  if (frame.body.msgtype === "image") {
    await saveDownloaded(frame.body.image.url, frame.body.image.aeskey, "wecom-image.jpg");
    return files;
  }

  if (frame.body.msgtype === "file") {
    await saveDownloaded(frame.body.file.url, frame.body.file.aeskey, "wecom-file.bin");
    return files;
  }

  if (frame.body.msgtype === "video") {
    await saveDownloaded(frame.body.video.url, frame.body.video.aeskey, "wecom-video.mp4");
    return files;
  }

  if (frame.body.msgtype === "mixed") {
    let imageIndex = 0;
    for (const item of frame.body.mixed.msg_item) {
      if (item.msgtype !== "image" || !item.image?.url) {
        continue;
      }
      imageIndex += 1;
      await saveDownloaded(
        item.image.url,
        item.image.aeskey,
        `wecom-mixed-image-${imageIndex}.jpg`,
      );
    }
  }

  return files;
}

export async function startWecomRemoteMonitor(params: {
  config: WecomRemoteControlConfig;
  rootDir: string;
  callbacks: RemoteChannelCallbacks;
}): Promise<RemoteChannelMonitor> {
  const { config, rootDir, callbacks } = params;
  const client = new WSClient({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.websocketUrl,
  });
  let stopped = false;

  const handleFrame = async (frame: SupportedWeComFrame) => {
    const attachmentPaths = await collectAttachments(client, config, rootDir, frame);
    callbacks.onMessage({
      accountId: config.botId,
      peerId: resolvePeerId(frame),
      title: buildTitle(frame),
      text: extractText(frame),
      attachmentPaths,
      replyText: async (reply) => {
        await client.sendMessage(resolvePeerId(frame), {
          msgtype: "markdown",
          markdown: {
            content: reply,
          },
        });
      },
    });
  };

  client.on("authenticated", () => {
    callbacks.onRunningChange?.(true);
  });
  client.on("disconnected", () => {
    callbacks.onRunningChange?.(false);
  });
  client.on("error", (error) => {
    callbacks.onError?.(error);
  });

  client.on("message.text", (frame) => {
    void handleFrame(frame).catch((error) => callbacks.onError?.(error));
  });
  client.on("message.image", (frame) => {
    void handleFrame(frame).catch((error) => callbacks.onError?.(error));
  });
  client.on("message.file", (frame) => {
    void handleFrame(frame).catch((error) => callbacks.onError?.(error));
  });
  client.on("message.video", (frame) => {
    void handleFrame(frame).catch((error) => callbacks.onError?.(error));
  });
  client.on("message.voice", (frame) => {
    void handleFrame(frame).catch((error) => callbacks.onError?.(error));
  });
  client.on("message.mixed", (frame) => {
    void handleFrame(frame).catch((error) => callbacks.onError?.(error));
  });

  client.connect();

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
