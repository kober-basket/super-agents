import path from "node:path";

import type {
  AppConfig,
  RemoteChannelId,
  RemoteControlStatus,
  WechatLoginStartResult,
  WechatLoginWaitResult,
} from "../src/types";
import { readJsonFile, writeJsonFile } from "./store";
import type { RemoteChannelMonitor } from "./remote-control-common";
import type { WorkspaceService } from "./workspace-service";
import { startDingtalkRemoteMonitor } from "./dingtalk-remote";
import { startFeishuRemoteMonitor } from "./feishu-remote";
import { startWecomRemoteMonitor } from "./wecom-remote";
import {
  cancelWechatQrLogin,
  downloadWechatAttachments,
  extractWechatText,
  getWechatUpdates,
  isWechatUserMessage,
  sendWechatTextMessage,
  startWechatQrLogin,
  waitForWechatQrLogin,
  type WechatAccountProfile,
  type WechatProtocolMessage,
} from "./wechat-remote";

interface RemotePeerBinding {
  channel: RemoteChannelId;
  accountId: string;
  peerId: string;
  title: string;
  contextToken?: string;
  updatedAt: number;
}

interface RemoteControlPersistedState {
  peers: RemotePeerBinding[];
  wechat: {
    syncCursorByAccountId: Record<string, string>;
  };
}

interface RemoteControlServiceOptions {
  onWorkspaceChanged?: () => Promise<void>;
}

interface RemoteChannelRuntimeState {
  running: boolean;
  lastError: string;
  lastInboundAt: number;
  lastOutboundAt: number;
}

interface InboundBridgeMessage {
  channel: RemoteChannelId;
  accountId: string;
  peerId: string;
  title: string;
  text: string;
  attachmentPaths: string[];
  contextToken?: string;
  replyText: (text: string, binding: RemotePeerBinding) => Promise<void>;
}

const DEFAULT_STATE: RemoteControlPersistedState = {
  peers: [],
  wechat: {
    syncCursorByAccountId: {},
  },
};

function cloneDefaultState(): RemoteControlPersistedState {
  return {
    peers: [],
    wechat: {
      syncCursorByAccountId: {},
    },
  };
}

function createRuntimeState(): RemoteChannelRuntimeState {
  return {
    running: false,
    lastError: "",
    lastInboundAt: 0,
    lastOutboundAt: 0,
  };
}

function describeWechatPeer(peerId: string) {
  return `寰俊 路 ${peerId}`;
}

const LEGACY_PEERS_KEY = ["bind", "ings"].join("");

function normalizePeerBindings(value: unknown): RemotePeerBinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const channel =
        item.channel === "dingtalk" ||
        item.channel === "feishu" ||
        item.channel === "wechat" ||
        item.channel === "wecom"
          ? item.channel
          : "wechat";
      return {
        channel,
        accountId: typeof item.accountId === "string" ? item.accountId.trim() : "",
        peerId: typeof item.peerId === "string" ? item.peerId.trim() : "",
        title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "远程连接",
        contextToken:
          typeof item.contextToken === "string" && item.contextToken.trim()
            ? item.contextToken.trim()
            : undefined,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
      };
    })
    .filter((item) => item.accountId && item.peerId);
}

export class RemoteControlService {
  private readonly statePath: string;
  private readonly mediaRootDir: string;
  private state: RemoteControlPersistedState = cloneDefaultState();
  private config: AppConfig | null = null;
  private processingQueues = new Map<string, Promise<void>>();
  private pendingWechatLogin:
    | {
        sessionKey: string;
        qrCodeUrl?: string;
      }
    | null = null;
  private readonly runtimes = {
    dingtalk: createRuntimeState(),
    feishu: createRuntimeState(),
    wechat: createRuntimeState(),
    wecom: createRuntimeState(),
  };
  private dingtalkMonitor: RemoteChannelMonitor | null = null;
  private dingtalkMonitorKey = "";
  private feishuMonitor: RemoteChannelMonitor | null = null;
  private feishuMonitorKey = "";
  private wecomMonitor: RemoteChannelMonitor | null = null;
  private wecomMonitorKey = "";
  private wechatMonitorAbort: AbortController | null = null;
  private wechatMonitorPromise: Promise<void> | null = null;

  constructor(
    workspaceStatePath: string,
    private readonly workspace: WorkspaceService,
    private readonly options: RemoteControlServiceOptions = {},
  ) {
    this.statePath = path.join(path.dirname(workspaceStatePath), "remote-control.json");
    this.mediaRootDir = path.join(path.dirname(workspaceStatePath), "remote-control-media");
  }

  async initialize(config: AppConfig) {
    const loaded = await readJsonFile(this.statePath, cloneDefaultState());
    const directPeers = normalizePeerBindings((loaded as { peers?: unknown[] } | null)?.peers);
    const legacyPeers = normalizePeerBindings(
      (loaded as Record<string, unknown> | null | undefined)?.[LEGACY_PEERS_KEY],
    );
    const legacyWechatPeers = normalizePeerBindings(
      Array.isArray(
        ((loaded as { wechat?: Record<string, unknown> } | null)?.wechat ?? {})[LEGACY_PEERS_KEY],
      )
        ? (((loaded as { wechat?: Record<string, unknown> } | null)?.wechat ?? {})[
            LEGACY_PEERS_KEY
          ] as unknown[])?.map((item) => ({
            ...(item as Record<string, unknown>),
            channel: "wechat",
          }))
        : [],
    );
    this.state = {
      peers:
        directPeers.length > 0
          ? directPeers
          : legacyPeers.length > 0
            ? legacyPeers
            : legacyWechatPeers,
      wechat: {
        syncCursorByAccountId:
          loaded?.wechat?.syncCursorByAccountId &&
          typeof loaded.wechat.syncCursorByAccountId === "object"
            ? loaded.wechat.syncCursorByAccountId
            : {},
      },
    };
    await this.syncWithConfig(config);
  }

  async shutdown() {
    await Promise.all([
      this.stopDingtalkMonitor(),
      this.stopFeishuMonitor(),
      this.stopWechatMonitor(),
      this.stopWecomMonitor(),
    ]);
  }

  async syncWithConfig(config: AppConfig) {
    this.config = config;

    await Promise.allSettled([
      this.syncDingtalkMonitor(config),
      this.syncFeishuMonitor(config),
      this.syncWechatMonitor(config),
      this.syncWecomMonitor(config),
    ]);
  }

  async getStatus(config: AppConfig | null = this.config): Promise<RemoteControlStatus> {
    const dingtalk = config?.remoteControl.dingtalk;
    const feishu = config?.remoteControl.feishu;
    const wechat = config?.remoteControl.wechat;
    const wecom = config?.remoteControl.wecom;

    return {
      dingtalk: {
        enabled: dingtalk?.enabled === true,
        configured: Boolean(dingtalk?.clientId && dingtalk?.clientSecret),
        connected: this.runtimes.dingtalk.running,
        running: this.runtimes.dingtalk.running,
        lastError: this.runtimes.dingtalk.lastError || undefined,
        lastInboundAt: this.runtimes.dingtalk.lastInboundAt || undefined,
        lastOutboundAt: this.runtimes.dingtalk.lastOutboundAt || undefined,
        activePeerCount: this.countPeers("dingtalk", dingtalk?.clientId || ""),
      },
      feishu: {
        enabled: feishu?.enabled === true,
        configured: Boolean(feishu?.appId && feishu?.appSecret),
        connected: this.runtimes.feishu.running,
        running: this.runtimes.feishu.running,
        lastError: this.runtimes.feishu.lastError || undefined,
        lastInboundAt: this.runtimes.feishu.lastInboundAt || undefined,
        lastOutboundAt: this.runtimes.feishu.lastOutboundAt || undefined,
        activePeerCount: this.countPeers("feishu", feishu?.appId || ""),
      },
      wechat: {
        enabled: wechat?.enabled === true,
        configured: Boolean(wechat?.botToken && wechat?.accountId),
        connected: Boolean(wechat?.botToken && wechat?.accountId),
        running: this.runtimes.wechat.running,
        pendingLogin: Boolean(this.pendingWechatLogin),
        pendingLoginQrCodeUrl: this.pendingWechatLogin?.qrCodeUrl,
        accountId: wechat?.accountId || "",
        userId: wechat?.userId || "",
        lastError: this.runtimes.wechat.lastError || undefined,
        lastInboundAt: this.runtimes.wechat.lastInboundAt || undefined,
        lastOutboundAt: this.runtimes.wechat.lastOutboundAt || undefined,
        activePeerCount: this.countPeers("wechat", wechat?.accountId || ""),
      },
      wecom: {
        enabled: wecom?.enabled === true,
        configured: Boolean(wecom?.botId && wecom?.secret),
        connected: this.runtimes.wecom.running,
        running: this.runtimes.wecom.running,
        lastError: this.runtimes.wecom.lastError || undefined,
        lastInboundAt: this.runtimes.wecom.lastInboundAt || undefined,
        lastOutboundAt: this.runtimes.wecom.lastOutboundAt || undefined,
        activePeerCount: this.countPeers("wecom", wecom?.botId || ""),
      },
    };
  }

  async startWechatLogin(): Promise<WechatLoginStartResult> {
    this.cancelWechatLogin();
    const result = await startWechatQrLogin();
    this.pendingWechatLogin = {
      sessionKey: result.sessionKey,
      qrCodeUrl: result.qrCodeUrl,
    };
    return result;
  }

  async waitWechatLogin(
    sessionKey: string,
    timeoutMs?: number,
  ): Promise<WechatLoginWaitResult & { profile?: WechatAccountProfile }> {
    const result = await waitForWechatQrLogin(sessionKey, timeoutMs, {
      onQrCodeRefresh: (qrCodeUrl) => {
        if (this.pendingWechatLogin?.sessionKey === sessionKey) {
          this.pendingWechatLogin = {
            ...this.pendingWechatLogin,
            qrCodeUrl,
          };
        }
      },
    });
    if (this.pendingWechatLogin?.sessionKey === sessionKey) {
      this.pendingWechatLogin = null;
    }
    return result;
  }

  cancelWechatLogin(sessionKey?: string) {
    const targetSessionKey = sessionKey?.trim() || this.pendingWechatLogin?.sessionKey;
    if (targetSessionKey) {
      cancelWechatQrLogin(targetSessionKey);
    } else {
      cancelWechatQrLogin();
    }

    if (!sessionKey || this.pendingWechatLogin?.sessionKey === targetSessionKey) {
      this.pendingWechatLogin = null;
    }
  }

  private async syncDingtalkMonitor(config: AppConfig) {
    const channelConfig = config.remoteControl.dingtalk;
    const shouldRun = channelConfig.enabled && Boolean(channelConfig.clientId && channelConfig.clientSecret);
    if (!shouldRun) {
      await this.stopDingtalkMonitor();
      return;
    }

    const nextKey = `${channelConfig.clientId}::${channelConfig.clientSecret}`;
    if (this.dingtalkMonitor && this.dingtalkMonitorKey === nextKey) {
      return;
    }

    await this.stopDingtalkMonitor();
    this.runtimes.dingtalk.lastError = "";

    try {
      this.dingtalkMonitor = await startDingtalkRemoteMonitor({
        config: channelConfig,
        rootDir: this.mediaRootDir,
        callbacks: {
          onMessage: (message) => {
            this.noteInbound("dingtalk");
            this.enqueueInboundMessage({
              channel: "dingtalk",
              accountId: message.accountId,
              peerId: message.peerId,
              title: message.title,
              text: message.text,
              attachmentPaths: message.attachmentPaths,
              contextToken: message.contextToken,
              replyText: async (reply) => {
                await message.replyText(reply);
                this.noteOutbound("dingtalk");
              },
            });
          },
          onError: (error) => {
            this.noteError("dingtalk", error);
          },
          onRunningChange: (running) => {
            this.runtimes.dingtalk.running = running;
          },
        },
      });
      this.dingtalkMonitorKey = nextKey;
    } catch (error) {
      this.noteError("dingtalk", error);
      this.runtimes.dingtalk.running = false;
      this.dingtalkMonitor = null;
      this.dingtalkMonitorKey = "";
    }
  }

  private async syncFeishuMonitor(config: AppConfig) {
    const channelConfig = config.remoteControl.feishu;
    const shouldRun = channelConfig.enabled && Boolean(channelConfig.appId && channelConfig.appSecret);
    if (!shouldRun) {
      await this.stopFeishuMonitor();
      return;
    }

    const nextKey = `${channelConfig.appId}::${channelConfig.appSecret}::${channelConfig.domain}`;
    if (this.feishuMonitor && this.feishuMonitorKey === nextKey) {
      return;
    }

    await this.stopFeishuMonitor();
    this.runtimes.feishu.lastError = "";

    try {
      this.feishuMonitor = await startFeishuRemoteMonitor({
        config: channelConfig,
        rootDir: this.mediaRootDir,
        callbacks: {
          onMessage: (message) => {
            this.noteInbound("feishu");
            this.enqueueInboundMessage({
              channel: "feishu",
              accountId: message.accountId,
              peerId: message.peerId,
              title: message.title,
              text: message.text,
              attachmentPaths: message.attachmentPaths,
              replyText: async (reply) => {
                await message.replyText(reply);
                this.noteOutbound("feishu");
              },
            });
          },
          onError: (error) => {
            this.noteError("feishu", error);
          },
          onRunningChange: (running) => {
            this.runtimes.feishu.running = running;
          },
        },
      });
      this.feishuMonitorKey = nextKey;
    } catch (error) {
      this.noteError("feishu", error);
      this.runtimes.feishu.running = false;
      this.feishuMonitor = null;
      this.feishuMonitorKey = "";
    }
  }

  private async syncWechatMonitor(config: AppConfig) {
    const wechat = config.remoteControl.wechat;
    if (!wechat.enabled) {
      this.cancelWechatLogin();
      await this.stopWechatMonitor();
      return;
    }

    const shouldRun = wechat.enabled && Boolean(wechat.botToken && wechat.accountId);
    if (!shouldRun) {
      await this.stopWechatMonitor();
      return;
    }

    await this.ensureWechatMonitor({
      accountId: wechat.accountId,
      baseUrl: wechat.baseUrl,
      cdnBaseUrl: wechat.cdnBaseUrl,
      botToken: wechat.botToken,
      userId: wechat.userId,
    });
  }

  private async syncWecomMonitor(config: AppConfig) {
    const channelConfig = config.remoteControl.wecom;
    const shouldRun = channelConfig.enabled && Boolean(channelConfig.botId && channelConfig.secret);
    if (!shouldRun) {
      await this.stopWecomMonitor();
      return;
    }

    const nextKey = `${channelConfig.botId}::${channelConfig.secret}::${channelConfig.websocketUrl}`;
    if (this.wecomMonitor && this.wecomMonitorKey === nextKey) {
      return;
    }

    await this.stopWecomMonitor();
    this.runtimes.wecom.lastError = "";

    try {
      this.wecomMonitor = await startWecomRemoteMonitor({
        config: channelConfig,
        rootDir: this.mediaRootDir,
        callbacks: {
          onMessage: (message) => {
            this.noteInbound("wecom");
            this.enqueueInboundMessage({
              channel: "wecom",
              accountId: message.accountId,
              peerId: message.peerId,
              title: message.title,
              text: message.text,
              attachmentPaths: message.attachmentPaths,
              replyText: async (reply) => {
                await message.replyText(reply);
                this.noteOutbound("wecom");
              },
            });
          },
          onError: (error) => {
            this.noteError("wecom", error);
          },
          onRunningChange: (running) => {
            this.runtimes.wecom.running = running;
          },
        },
      });
      this.wecomMonitorKey = nextKey;
    } catch (error) {
      this.noteError("wecom", error);
      this.runtimes.wecom.running = false;
      this.wecomMonitor = null;
      this.wecomMonitorKey = "";
    }
  }

  private async stopDingtalkMonitor() {
    if (!this.dingtalkMonitor) {
      this.runtimes.dingtalk.running = false;
      this.dingtalkMonitorKey = "";
      return;
    }
    await this.dingtalkMonitor.stop().catch(() => undefined);
    this.dingtalkMonitor = null;
    this.dingtalkMonitorKey = "";
    this.runtimes.dingtalk.running = false;
  }

  private async stopFeishuMonitor() {
    if (!this.feishuMonitor) {
      this.runtimes.feishu.running = false;
      this.feishuMonitorKey = "";
      return;
    }
    await this.feishuMonitor.stop().catch(() => undefined);
    this.feishuMonitor = null;
    this.feishuMonitorKey = "";
    this.runtimes.feishu.running = false;
  }

  private async stopWechatMonitor() {
    if (this.wechatMonitorAbort) {
      this.wechatMonitorAbort.abort();
      this.wechatMonitorAbort = null;
    }
    if (this.wechatMonitorPromise) {
      await this.wechatMonitorPromise.catch(() => undefined);
      this.wechatMonitorPromise = null;
    }
    this.runtimes.wechat.running = false;
  }

  private async stopWecomMonitor() {
    if (!this.wecomMonitor) {
      this.runtimes.wecom.running = false;
      this.wecomMonitorKey = "";
      return;
    }
    await this.wecomMonitor.stop().catch(() => undefined);
    this.wecomMonitor = null;
    this.wecomMonitorKey = "";
    this.runtimes.wecom.running = false;
  }

  private async ensureWechatMonitor(profile: WechatAccountProfile) {
    if (
      this.wechatMonitorAbort &&
      !this.wechatMonitorAbort.signal.aborted &&
      this.runtimes.wechat.running &&
      this.config?.remoteControl.wechat.accountId === profile.accountId
    ) {
      return;
    }

    await this.stopWechatMonitor();

    const abortController = new AbortController();
    this.wechatMonitorAbort = abortController;
    this.runtimes.wechat.running = true;
    this.runtimes.wechat.lastError = "";
    this.wechatMonitorPromise = this.runWechatMonitor(profile, abortController.signal)
      .catch((error) => {
        if (!abortController.signal.aborted) {
          this.noteError("wechat", error);
        }
      })
      .finally(() => {
        if (this.wechatMonitorAbort === abortController) {
          this.wechatMonitorAbort = null;
        }
        this.runtimes.wechat.running = false;
      });
  }

  private async runWechatMonitor(profile: WechatAccountProfile, signal: AbortSignal) {
    let longPollTimeoutMs = 35_000;
    while (!signal.aborted) {
      const syncCursor = this.state.wechat.syncCursorByAccountId[profile.accountId] || "";
      const response = await getWechatUpdates({
        baseUrl: profile.baseUrl,
        botToken: profile.botToken,
        syncCursor,
        timeoutMs: longPollTimeoutMs,
      });

      if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
        longPollTimeoutMs = response.longpolling_timeout_ms;
      }

      if (response.get_updates_buf !== undefined) {
        this.state.wechat.syncCursorByAccountId[profile.accountId] = response.get_updates_buf || "";
        await this.saveState();
      }

      if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
        this.runtimes.wechat.lastError =
          response.errmsg || `寰俊杞澶辫触: ret=${response.ret} errcode=${response.errcode}`;
        await this.delay(2_000, signal);
        continue;
      }

      for (const message of response.msgs ?? []) {
        if (!isWechatUserMessage(message)) {
          continue;
        }
        this.noteInbound("wechat");
        this.enqueueWechatMessage(profile, message);
      }
    }
  }

  private enqueueWechatMessage(profile: WechatAccountProfile, message: WechatProtocolMessage) {
    const peerId = message.from_user_id?.trim() || "";
    if (!peerId) {
      return;
    }

    this.enqueueInboundMessage({
      channel: "wechat",
      accountId: profile.accountId,
      peerId,
      title: describeWechatPeer(peerId),
      text: extractWechatText(message),
      attachmentPathsPromise: async () =>
        await downloadWechatAttachments({
          message,
          directory: path.join(this.mediaRootDir, "wechat", profile.accountId, peerId),
          cdnBaseUrl: profile.cdnBaseUrl,
        }).catch(() => []),
      contextToken: message.context_token?.trim() || undefined,
      replyText: async (reply, binding) => {
        await sendWechatTextMessage({
          baseUrl: profile.baseUrl,
          botToken: profile.botToken,
          toUserId: peerId,
          text: reply,
          contextToken: binding.contextToken,
        });
        this.noteOutbound("wechat");
      },
    });
  }

  private enqueueInboundMessage(
    input:
      | InboundBridgeMessage
      | (Omit<InboundBridgeMessage, "attachmentPaths"> & {
          attachmentPathsPromise?: () => Promise<string[]>;
        }),
  ) {
    const queueKey = `${input.channel}:${input.accountId}:${input.peerId}`;
    const previous = this.processingQueues.get(queueKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const attachmentPaths =
          "attachmentPathsPromise" in input && input.attachmentPathsPromise
            ? await input.attachmentPathsPromise()
            : input.attachmentPaths;
        await this.handleInboundMessage({
          ...input,
          attachmentPaths,
        } as InboundBridgeMessage);
      })
      .catch((error) => {
        this.noteError(input.channel, error);
      })
      .finally(() => {
        if (this.processingQueues.get(queueKey) === next) {
          this.processingQueues.delete(queueKey);
        }
      });
    this.processingQueues.set(queueKey, next);
  }

  private async handleInboundMessage(message: InboundBridgeMessage) {
    let binding = await this.ensureBinding(
      message.channel,
      message.accountId,
      message.peerId,
      message.title,
    );

    if (message.contextToken) {
      binding = await this.upsertBinding({
        ...binding,
        title: message.title,
        contextToken: message.contextToken,
        updatedAt: Date.now(),
      });
    }

    const hasText = Boolean(message.text.trim());
    const attachments =
      message.attachmentPaths.length > 0
        ? await this.workspace.prepareAttachments(message.attachmentPaths)
        : [];

    if (!hasText && attachments.length === 0) {
      return;
    }

    await message.replyText(
      "super-agents desktop runtime has been simplified. Remote control can still receive messages, but it no longer starts local conversations or runs a built-in Q&A flow. Please return to the desktop app for file preview and the remaining workspace features.",
      binding,
    );
    await this.options.onWorkspaceChanged?.();
  }

  private async ensureBinding(
    channel: RemoteChannelId,
    accountId: string,
    peerId: string,
    title: string,
  ) {
    const existing = this.state.peers.find(
      (item) =>
        item.channel === channel && item.accountId === accountId && item.peerId === peerId,
    );
    if (existing) {
      if (existing.title !== title) {
        return await this.upsertBinding({
          ...existing,
          title,
          updatedAt: Date.now(),
        });
      }
      return existing;
    }
    return await this.createBinding(channel, accountId, peerId, title);
  }

  private async createBinding(
    channel: RemoteChannelId,
    accountId: string,
    peerId: string,
    title: string,
    contextToken?: string,
  ) {
    return await this.upsertBinding({
      channel,
      accountId,
      peerId,
      title,
      contextToken,
      updatedAt: Date.now(),
    });
  }

  private async upsertBinding(binding: RemotePeerBinding) {
    const existingIndex = this.state.peers.findIndex(
      (item) =>
        item.channel === binding.channel &&
        item.accountId === binding.accountId &&
        item.peerId === binding.peerId,
    );
    if (existingIndex >= 0) {
      this.state.peers[existingIndex] = binding;
    } else {
      this.state.peers.push(binding);
    }
    await this.saveState();
    return binding;
  }

  private countPeers(channel: RemoteChannelId, accountId: string) {
    return this.state.peers.filter(
      (item) => item.channel === channel && item.accountId === accountId,
    ).length;
  }

  private noteInbound(channel: RemoteChannelId) {
    this.runtimes[channel].lastInboundAt = Date.now();
  }

  private noteOutbound(channel: RemoteChannelId) {
    this.runtimes[channel].lastOutboundAt = Date.now();
  }

  private noteError(channel: RemoteChannelId, error: unknown) {
    this.runtimes[channel].lastError = error instanceof Error ? error.message : String(error);
  }

  private async saveState() {
    await writeJsonFile(this.statePath, this.state);
  }

  private async delay(ms: number, signal?: AbortSignal) {
    return await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (!signal) {
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }
}

