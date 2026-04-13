import path from "node:path";

import type {
  AppConfig,
  ChatMessage,
  RemoteControlStatus,
  WechatLoginStartResult,
  WechatLoginWaitResult,
} from "../src/types";
import { readJsonFile, writeJsonFile } from "./store";
import type { WorkspaceService } from "./workspace-service";
import {
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

interface WechatThreadBinding {
  accountId: string;
  peerId: string;
  threadId: string;
  title: string;
  contextToken?: string;
  updatedAt: number;
}

interface RemoteControlPersistedState {
  wechat: {
    syncCursorByAccountId: Record<string, string>;
    bindings: WechatThreadBinding[];
  };
}

interface RemoteControlServiceOptions {
  onWorkspaceChanged?: () => Promise<void>;
}

const DEFAULT_STATE: RemoteControlPersistedState = {
  wechat: {
    syncCursorByAccountId: {},
    bindings: [],
  },
};

function cloneDefaultState(): RemoteControlPersistedState {
  return {
    wechat: {
      syncCursorByAccountId: {},
      bindings: [],
    },
  };
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "unknown";
}

function describeWechatPeer(peerId: string) {
  return `微信 · ${peerId}`;
}

export class RemoteControlService {
  private readonly statePath: string;
  private state: RemoteControlPersistedState = cloneDefaultState();
  private config: AppConfig | null = null;
  private monitorAbort: AbortController | null = null;
  private monitorPromise: Promise<void> | null = null;
  private processingQueues = new Map<string, Promise<void>>();
  private pendingWechatLogin:
    | {
        sessionKey: string;
        qrCodeUrl?: string;
      }
    | null = null;
  private wechatRuntime = {
    running: false,
    lastError: "",
    lastInboundAt: 0,
    lastOutboundAt: 0,
  };

  constructor(
    workspaceStatePath: string,
    private readonly workspace: WorkspaceService,
    private readonly options: RemoteControlServiceOptions = {},
  ) {
    this.statePath = path.join(path.dirname(workspaceStatePath), "remote-control.json");
  }

  async initialize(config: AppConfig) {
    const loaded = await readJsonFile(this.statePath, cloneDefaultState());
    this.state = {
      wechat: {
        syncCursorByAccountId:
          loaded?.wechat?.syncCursorByAccountId &&
          typeof loaded.wechat.syncCursorByAccountId === "object"
            ? loaded.wechat.syncCursorByAccountId
            : {},
        bindings: Array.isArray(loaded?.wechat?.bindings) ? loaded.wechat.bindings : [],
      },
    };
    await this.syncWithConfig(config);
  }

  async shutdown() {
    await this.stopWechatMonitor();
  }

  async syncWithConfig(config: AppConfig) {
    this.config = config;
    const wechat = config.remoteControl.wechat;
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

  async getStatus(config: AppConfig | null = this.config): Promise<RemoteControlStatus> {
    const wechat = config?.remoteControl.wechat;
    return {
      wechat: {
        enabled: wechat?.enabled === true,
        connected: Boolean(wechat?.botToken && wechat?.accountId),
        running: this.wechatRuntime.running,
        pendingLogin: Boolean(this.pendingWechatLogin),
        pendingLoginQrCodeUrl: this.pendingWechatLogin?.qrCodeUrl,
        accountId: wechat?.accountId || "",
        userId: wechat?.userId || "",
        lastError: this.wechatRuntime.lastError || undefined,
        lastInboundAt: this.wechatRuntime.lastInboundAt || undefined,
        lastOutboundAt: this.wechatRuntime.lastOutboundAt || undefined,
        activePeerCount: this.state.wechat.bindings.filter((item) => item.accountId === (wechat?.accountId || "")).length,
      },
    };
  }

  async startWechatLogin(): Promise<WechatLoginStartResult> {
    const result = await startWechatQrLogin();
    this.pendingWechatLogin = {
      sessionKey: result.sessionKey,
      qrCodeUrl: result.qrCodeUrl,
    };
    return result;
  }

  async waitWechatLogin(sessionKey: string, timeoutMs?: number): Promise<WechatLoginWaitResult & { profile?: WechatAccountProfile }> {
    const result = await waitForWechatQrLogin(sessionKey, timeoutMs);
    if (this.pendingWechatLogin?.sessionKey === sessionKey) {
      this.pendingWechatLogin = null;
    }
    return result;
  }

  private async ensureWechatMonitor(profile: WechatAccountProfile) {
    if (
      this.monitorAbort &&
      !this.monitorAbort.signal.aborted &&
      this.wechatRuntime.running &&
      this.config?.remoteControl.wechat.accountId === profile.accountId
    ) {
      return;
    }

    await this.stopWechatMonitor();

    const abortController = new AbortController();
    this.monitorAbort = abortController;
    this.wechatRuntime.running = true;
    this.wechatRuntime.lastError = "";
    this.monitorPromise = this.runWechatMonitor(profile, abortController.signal)
      .catch((error) => {
        if (!abortController.signal.aborted) {
          this.wechatRuntime.lastError =
            error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        if (this.monitorAbort === abortController) {
          this.monitorAbort = null;
        }
        this.wechatRuntime.running = false;
      });
  }

  private async stopWechatMonitor() {
    if (this.monitorAbort) {
      this.monitorAbort.abort();
      this.monitorAbort = null;
    }
    if (this.monitorPromise) {
      await this.monitorPromise.catch(() => undefined);
      this.monitorPromise = null;
    }
    this.wechatRuntime.running = false;
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
        this.wechatRuntime.lastError =
          response.errmsg || `微信轮询失败: ret=${response.ret} errcode=${response.errcode}`;
        await this.delay(2_000, signal);
        continue;
      }

      for (const message of response.msgs ?? []) {
        if (!isWechatUserMessage(message)) {
          continue;
        }
        this.wechatRuntime.lastInboundAt = Date.now();
        this.enqueueWechatMessage(profile, message);
      }
    }
  }

  private enqueueWechatMessage(profile: WechatAccountProfile, message: WechatProtocolMessage) {
    const peerId = message.from_user_id?.trim() || "";
    if (!peerId) {
      return;
    }
    const queueKey = `${profile.accountId}:${peerId}`;
    const previous = this.processingQueues.get(queueKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.handleWechatMessage(profile, message))
      .catch((error) => {
        this.wechatRuntime.lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (this.processingQueues.get(queueKey) === next) {
          this.processingQueues.delete(queueKey);
        }
      });
    this.processingQueues.set(queueKey, next);
  }

  private async handleWechatMessage(profile: WechatAccountProfile, message: WechatProtocolMessage) {
    const peerId = message.from_user_id?.trim() || "";
    if (!peerId) {
      return;
    }

    let binding = await this.ensureWechatBinding(profile, peerId);
    if (message.context_token?.trim()) {
      binding = await this.upsertWechatBinding({
        ...binding,
        contextToken: message.context_token.trim(),
        updatedAt: Date.now(),
      });
    }

    const attachmentDirectory = path.join(
      path.dirname(this.statePath),
      "remote-control-media",
      "wechat",
      sanitizePathSegment(profile.accountId),
      sanitizePathSegment(peerId),
    );
    const attachmentPaths = await downloadWechatAttachments({
      message,
      directory: attachmentDirectory,
      cdnBaseUrl: profile.cdnBaseUrl,
    }).catch(() => []);
    const attachments =
      attachmentPaths.length > 0
        ? await this.workspace.prepareAttachments(attachmentPaths)
        : [];
    const text = extractWechatText(message);
    const prompt = text || (attachments.length > 0 ? "请查看我刚刚发来的附件并继续处理。" : "");

    if (!prompt.trim() && attachments.length === 0) {
      return;
    }

    let thread = await this.workspace.getThread(binding.threadId).catch(() => null);
    if (!thread) {
      binding = await this.createWechatBinding(profile, peerId);
      thread = await this.workspace.getThread(binding.threadId).catch(() => null);
    }

    const previousMessageIds = new Set((thread?.messages ?? []).map((item) => item.id));

    await this.workspace.sendMessage({
      threadId: binding.threadId,
      message: prompt,
      attachments,
    });
    await this.options.onWorkspaceChanged?.();

    const outcome = await this.waitForThreadOutcome(binding.threadId, 15 * 60_000);
    if (outcome === "question") {
      await sendWechatTextMessage({
        baseUrl: profile.baseUrl,
        botToken: profile.botToken,
        toUserId: peerId,
        text: "这个请求需要在桌面端确认，我已经挂起到 super-agents 中，请到应用里继续处理。",
        contextToken: binding.contextToken,
      });
      this.wechatRuntime.lastOutboundAt = Date.now();
      return;
    }

    if (outcome === "timeout") {
      await sendWechatTextMessage({
        baseUrl: profile.baseUrl,
        botToken: profile.botToken,
        toUserId: peerId,
        text: "任务还在处理中，我先继续执行。你也可以到 super-agents 桌面端查看当前进度。",
        contextToken: binding.contextToken,
      });
      this.wechatRuntime.lastOutboundAt = Date.now();
      return;
    }

    const completedThread = await this.workspace.getThread(binding.threadId);
    const replyText = this.collectAssistantReply(completedThread.messages, previousMessageIds);

    await sendWechatTextMessage({
      baseUrl: profile.baseUrl,
      botToken: profile.botToken,
      toUserId: peerId,
      text:
        replyText ||
        "请求已经处理完成，但这次没有生成可发送的文本回复。请到 super-agents 桌面端查看详情。",
      contextToken: binding.contextToken,
    });
    this.wechatRuntime.lastOutboundAt = Date.now();
    await this.options.onWorkspaceChanged?.();
  }

  private async ensureWechatBinding(profile: WechatAccountProfile, peerId: string) {
    const existing = this.state.wechat.bindings.find(
      (item) => item.accountId === profile.accountId && item.peerId === peerId,
    );
    if (existing) {
      return existing;
    }
    return await this.createWechatBinding(profile, peerId);
  }

  private async createWechatBinding(profile: WechatAccountProfile, peerId: string) {
    const title = describeWechatPeer(peerId);
    const thread = await this.workspace.createBackgroundThread(title);
    return await this.upsertWechatBinding({
      accountId: profile.accountId,
      peerId,
      threadId: thread.id,
      title,
      updatedAt: Date.now(),
    });
  }

  private async upsertWechatBinding(binding: WechatThreadBinding) {
    const existingIndex = this.state.wechat.bindings.findIndex(
      (item) => item.accountId === binding.accountId && item.peerId === binding.peerId,
    );
    if (existingIndex >= 0) {
      this.state.wechat.bindings[existingIndex] = binding;
    } else {
      this.state.wechat.bindings.push(binding);
    }
    await this.saveState();
    return binding;
  }

  private async waitForThreadOutcome(threadId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const progress = await this.workspace.getThreadProgress(threadId).catch(() => ({
        busy: false,
        blockedOnQuestion: false,
      }));
      if (progress.blockedOnQuestion) {
        return "question" as const;
      }
      if (!progress.busy) {
        return "done" as const;
      }
      await this.delay(1_000);
    }
    return "timeout" as const;
  }

  private collectAssistantReply(messages: ChatMessage[], previousMessageIds: Set<string>) {
    return messages
      .filter(
        (item) =>
          item.role === "assistant" &&
          !previousMessageIds.has(item.id) &&
          item.text.trim(),
      )
      .map((item) => item.text.trim())
      .join("\n\n");
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
