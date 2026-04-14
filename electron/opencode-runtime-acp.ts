import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

import { getActiveModelOption } from "../src/lib/model-config";
import type {
  AppConfig,
  FileDropEntry,
  McpServerStatus,
  RuntimeAgent,
  RuntimeSkill,
} from "../src/types";
import {
  OpencodeRuntime as LegacyOpencodeRuntime,
  getRuntimeMcpServers,
  makeSignature,
  makeSpawnEnv,
  resolveMcpServers,
  resolveOpencodeCommand,
  sanitizeId,
  shouldIncludeMcpServerInRuntime,
  syncGeneratedCommands,
  type OpencodeFilePart,
  type OpencodeQuestionRequest,
  type OpencodeSessionInfo,
  type OpencodeSessionMessage,
  type OpencodeSessionStatus,
  type OpencodeToolPart,
} from "./opencode-runtime";

const execFileAsync = promisify(execFile);

type OpencodeRole = "user" | "assistant";

interface RuntimeHandle {
  signature: string;
  process: ReturnType<typeof spawn>;
  connection: acp.ClientSideConnection;
  stderr: string;
}

interface ToolCallRecord {
  callID: string;
  tool: string;
  input: Record<string, unknown>;
  title: string;
  output: string;
  attachments: OpencodeFilePart[];
  status: "pending" | "running" | "completed" | "error";
  startedAt: number;
  endedAt?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface SessionCache {
  info: OpencodeSessionInfo;
  messages: OpencodeSessionMessage[];
  messageIndex: Map<string, OpencodeSessionMessage>;
  toolIndex: Map<string, ToolCallRecord>;
  status: OpencodeSessionStatus;
  loaded: boolean;
  hydratingHistory: boolean;
  loadPromise: Promise<void> | null;
  availableSkills: RuntimeSkill[];
  modeState: acp.SessionModeState | null;
  configOptions: acp.SessionConfigOption[];
}

interface PendingPermissionRequest {
  request: OpencodeQuestionRequest;
  sessionID: string;
  optionsByLabel: Map<string, acp.PermissionOption>;
  resolve: (response: acp.RequestPermissionResponse) => void;
}

function hasActiveModel(config: AppConfig) {
  return Boolean(getActiveModelOption(config.modelProviders, config.activeModelId));
}

function getAcpRuntimeConfig(config: AppConfig): AppConfig {
  if (config.defaultAgentMode === "build") {
    return config;
  }
  return {
    ...config,
    defaultAgentMode: "build",
  };
}

function shouldUseLegacyRuntime(config: AppConfig) {
  return Boolean(config.bridgeUrl.trim());
}

function getSessionDirectory(config: AppConfig) {
  const configured = config.opencodeRoot.trim();
  if (!configured) return process.cwd();
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function timestampFromIso(value: string | null | undefined, fallback = Date.now()) {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function filePathFromUrl(url: string) {
  if (!url.startsWith("file:")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function basenameFromUri(uri: string, fallback = "attachment") {
  const filePath = filePathFromUrl(uri);
  if (filePath) return path.basename(filePath) || fallback;

  try {
    const parsed = new URL(uri);
    return path.basename(parsed.pathname) || fallback;
  } catch {
    return fallback;
  }
}

function makeDataUrl(mimeType: string, data: string) {
  return `data:${mimeType};base64,${data}`;
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+)?;base64,(.*)$/s);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    data: match[2] || "",
  };
}

function unknownToText(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function unknownToRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (value === undefined) return {};
  return { value };
}

function permissionOptionDescription(option: acp.PermissionOption) {
  switch (option.kind) {
    case "allow_once":
      return "Allow this action once";
    case "allow_always":
      return "Always allow similar actions";
    case "reject_once":
      return "Reject this action once";
    case "reject_always":
      return "Always reject similar actions";
    default:
      return option.kind;
  }
}

function runtimeSkillFromCommand(command: acp.AvailableCommand): RuntimeSkill {
  return {
    id: command.name,
    name: command.name,
    description: command.description,
    location: "ACP command",
    content: `/${command.name}\n\n${command.description}`.trim(),
  };
}

function contentBlockToText(content: acp.ContentBlock) {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource":
      return "text" in content.resource ? content.resource.text : content.resource.uri;
    case "resource_link":
      return content.title || content.name || content.uri;
    case "image":
      return content.uri || `[image:${content.mimeType}]`;
    case "audio":
      return content.uri || "[audio]";
    default:
      return "";
  }
}

function contentBlockToFilePart(content: acp.ContentBlock): OpencodeFilePart | null {
  if (content.type === "text") return null;

  if (content.type === "image") {
    const url = content.uri || makeDataUrl(content.mimeType, content.data);
    const source = content.uri
      ? content.uri.startsWith("file:")
        ? { type: "file" as const, path: filePathFromUrl(content.uri) ?? undefined }
        : { type: "resource" as const, uri: content.uri }
      : undefined;
    return {
      id: randomUUID(),
      type: "file",
      mime: content.mimeType,
      filename: content.uri ? basenameFromUri(content.uri, "image") : "image",
      url,
      source,
    };
  }

  if (content.type === "resource_link") {
    return {
      id: randomUUID(),
      type: "file",
      mime: content.mimeType || "application/octet-stream",
      filename: content.title || content.name || basenameFromUri(content.uri),
      url: content.uri,
      source: content.uri.startsWith("file:")
        ? { type: "file" as const, path: filePathFromUrl(content.uri) ?? undefined }
        : { type: "resource" as const, uri: content.uri },
    };
  }

  if ("text" in content.resource) {
    const mimeType = content.resource.mimeType || "text/plain";
    const uri = content.resource.uri || "";
    return {
      id: randomUUID(),
      type: "file",
      mime: mimeType,
      filename: basenameFromUri(uri, "context.txt"),
      url: makeDataUrl(mimeType, Buffer.from(content.resource.text, "utf8").toString("base64")),
      source: uri
        ? uri.startsWith("file:")
          ? { type: "file" as const, path: filePathFromUrl(uri) ?? undefined }
          : { type: "resource" as const, uri }
        : { type: "resource" as const, uri: "embedded:text" },
    };
  }

  const mimeType = content.resource.mimeType || "application/octet-stream";
  const uri = content.resource.uri || "";
  return {
    id: randomUUID(),
    type: "file",
    mime: mimeType,
    filename: basenameFromUri(uri, "resource.bin"),
    url: uri || makeDataUrl(mimeType, content.resource.blob),
    source: uri
      ? uri.startsWith("file:")
        ? { type: "file" as const, path: filePathFromUrl(uri) ?? undefined }
        : { type: "resource" as const, uri }
      : { type: "resource" as const, uri: "embedded:blob" },
  };
}

function toolCallContentToText(content: acp.ToolCallContent) {
  switch (content.type) {
    case "content":
      return contentBlockToText(content.content);
    case "diff":
      return [
        `Diff: ${content.path}`,
        content.oldText ? `--- old\n${content.oldText}` : "--- old\n(new file)",
        `+++ new\n${content.newText}`,
      ].join("\n");
    case "terminal":
      return `[terminal:${content.terminalId}]`;
    default:
      return "";
  }
}

function toolCallContentToFilePart(content: acp.ToolCallContent) {
  return content.type === "content" ? contentBlockToFilePart(content.content) : null;
}

function buildToolOutput(content: acp.ToolCallContent[] | undefined | null, rawOutput: unknown) {
  const rendered = (content ?? [])
    .map(toolCallContentToText)
    .map((item) => item.trim())
    .filter(Boolean);
  const raw = unknownToText(rawOutput).trim();
  if (rendered.length === 0) return raw;
  if (!raw) return rendered.join("\n\n");
  return `${rendered.join("\n\n")}\n\n${raw}`;
}

function makeToolPart(record: ToolCallRecord): OpencodeToolPart {
  if (record.status === "pending") {
    return {
      id: record.callID,
      type: "tool",
      callID: record.callID,
      tool: record.tool,
      state: {
        status: "pending",
        input: record.input,
      },
    };
  }

  if (record.status === "running") {
    return {
      id: record.callID,
      type: "tool",
      callID: record.callID,
      tool: record.tool,
      state: {
        status: "running",
        input: record.input,
        title: record.title,
        time: { start: record.startedAt },
      },
    };
  }

  if (record.status === "completed") {
    return {
      id: record.callID,
      type: "tool",
      callID: record.callID,
      tool: record.tool,
      state: {
        status: "completed",
        input: record.input,
        output: record.output,
        title: record.title || record.tool,
        metadata: record.metadata,
        time: { start: record.startedAt, end: record.endedAt ?? Date.now() },
        attachments: record.attachments,
      },
    };
  }

  return {
    id: record.callID,
    type: "tool",
    callID: record.callID,
    tool: record.tool,
    state: {
      status: "error",
      input: record.input,
      error: record.error || record.output || "Tool call failed",
      time: { start: record.startedAt, end: record.endedAt ?? Date.now() },
    },
  };
}

async function attachmentToContentBlock(file: FileDropEntry): Promise<acp.ContentBlock | null> {
  if (file.dataUrl) {
    const parsed = parseDataUrl(file.dataUrl);
    if (!parsed) return null;
    if (parsed.mimeType.startsWith("image/")) {
      return {
        type: "image",
        mimeType: parsed.mimeType,
        data: parsed.data,
        uri: file.path && path.isAbsolute(file.path) ? pathToFileURL(file.path).href : undefined,
      };
    }
    return {
      type: "resource_link",
      name: file.name,
      title: file.name,
      mimeType: parsed.mimeType,
      size: file.size,
      uri: file.dataUrl,
    };
  }

  if (typeof file.content === "string") {
    return {
      type: "resource",
      resource: {
        uri: file.path && path.isAbsolute(file.path) ? pathToFileURL(file.path).href : `memory:${file.id}`,
        mimeType: file.mimeType,
        text: file.content,
      },
    };
  }

  if (file.path && path.isAbsolute(file.path)) {
    if (file.mimeType.startsWith("image/")) {
      const buffer = await readFile(file.path);
      return {
        type: "image",
        mimeType: file.mimeType,
        data: buffer.toString("base64"),
        uri: pathToFileURL(file.path).href,
      };
    }

    return {
      type: "resource_link",
      name: file.name,
      title: file.name,
      mimeType: file.mimeType,
      size: file.size,
      uri: pathToFileURL(file.path).href,
    };
  }

  if (file.url) {
    return {
      type: "resource_link",
      name: file.name,
      title: file.name,
      mimeType: file.mimeType,
      size: file.size,
      uri: file.url,
    };
  }

  return null;
}

function createSessionCache(sessionID: string, directory: string, title?: string): SessionCache {
  const now = Date.now();
  return {
    info: {
      id: sessionID,
      title: title?.trim() || "",
      directory,
      time: {
        created: now,
        updated: now,
      },
    },
    messages: [],
    messageIndex: new Map(),
    toolIndex: new Map(),
    status: { type: "idle" },
    loaded: false,
    hydratingHistory: false,
    loadPromise: null,
    availableSkills: [],
    modeState: null,
    configOptions: [],
  };
}

function getDesiredSessionMode(config: AppConfig, modeState: acp.SessionModeState | null) {
  if (!modeState) return null;
  const available = new Set(modeState.availableModes.map((mode) => mode.id));
  if (config.defaultAgentMode === "build") {
    return available.has("build") ? "build" : modeState.currentModeId;
  }
  if (available.has("plan")) return "plan";
  if (available.has("build")) return "build";
  return modeState.currentModeId;
}

function buildDesiredSessionModelValue(config: AppConfig) {
  const activeModel = getActiveModelOption(config.modelProviders, config.activeModelId);
  if (!activeModel) return null;
  return `desktop-${sanitizeId(activeModel.providerId)}/${activeModel.modelId}`;
}

function getModelConfigOption(configOptions: acp.SessionConfigOption[]) {
  const option = configOptions.find((item) => item.id === "model");
  if (!option || option.type !== "select") return null;
  return option;
}

function getDesiredSessionModelValue(config: AppConfig, configOptions: acp.SessionConfigOption[]) {
  const desiredModel = buildDesiredSessionModelValue(config);
  if (!desiredModel) return null;

  const modelOption = getModelConfigOption(configOptions);
  if (!modelOption) return desiredModel;

  const exactOption = modelOption.options.find((item) => item.value === desiredModel);
  if (exactOption) return exactOption.value;

  const variantOption = modelOption.options.find((item) => item.value.startsWith(`${desiredModel}/`));
  return variantOption?.value ?? null;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function killRuntime(handle: RuntimeHandle | null) {
  if (!handle?.process || handle.process.killed) return;

  if (process.platform === "win32" && handle.process.pid) {
    await execFileAsync("taskkill", ["/pid", String(handle.process.pid), "/T", "/F"]).catch(() => undefined);
    return;
  }

  handle.process.kill("SIGTERM");
}

export class OpencodeRuntime {
  private readonly legacyRuntime = new LegacyOpencodeRuntime();
  private handle: RuntimeHandle | null = null;
  private startupPromise: Promise<RuntimeHandle> | null = null;
  private readonly sessions = new Map<string, SessionCache>();
  private readonly pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private availableSkills: RuntimeSkill[] = [];
  private readonly legacyFallbackSignatures = new Set<string>();

  private resetSessionRuntimeState() {
    for (const session of this.sessions.values()) {
      session.status = { type: "idle" };
      session.loaded = false;
      session.hydratingHistory = false;
      session.loadPromise = null;
      session.modeState = null;
      session.configOptions = [];
      session.availableSkills = [];
    }
    this.availableSkills = [];
  }

  private shouldUseLegacyTransport(config: AppConfig) {
    return shouldUseLegacyRuntime(config) || this.legacyFallbackSignatures.has(makeSignature(config));
  }

  private enableLegacyFallback(config: AppConfig) {
    this.legacyFallbackSignatures.add(makeSignature(config));
  }

  private isRecoverableAcpTransportError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    const normalized = text.toLowerCase();
    return [
      "acp connection closed",
      "connection closed",
      "enotconn",
      "socket is not connected",
      "broken pipe",
      "epipe",
      "stream closed",
      "write eof",
      "read eof",
    ].some((token) => normalized.includes(token));
  }

  private async resetAcpRuntime() {
    this.startupPromise = null;
    for (const request of this.pendingPermissionRequests.values()) {
      request.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissionRequests.clear();
    this.resetSessionRuntimeState();
    await killRuntime(this.handle);
    this.handle = null;
  }

  private async withLegacyFallback<T>(
    config: AppConfig,
    action: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    if (this.shouldUseLegacyTransport(config)) {
      return await fallback();
    }

    try {
      return await action();
    } catch (error) {
      if (!this.isRecoverableAcpTransportError(error)) {
        throw error;
      }
      this.enableLegacyFallback(config);
      await this.resetAcpRuntime();
      return await fallback();
    }
  }

  async dispose() {
    await this.legacyRuntime.dispose();
    await this.resetAcpRuntime();
  }

  private ensureSession(sessionID: string, directory = "", title?: string) {
    const existing = this.sessions.get(sessionID);
    if (existing) {
      if (directory) existing.info.directory = directory;
      if (title?.trim()) existing.info.title = title.trim();
      return existing;
    }

    const session = createSessionCache(sessionID, directory, title);
    this.sessions.set(sessionID, session);
    return session;
  }

  private ensureMessage(session: SessionCache, messageID: string, role: OpencodeRole, createdAt = Date.now()) {
    const existing = session.messageIndex.get(messageID);
    if (existing) return existing;

    const message: OpencodeSessionMessage = {
      info: {
        id: messageID,
        role,
        sessionID: session.info.id,
        time: { created: createdAt },
      },
      parts: [],
    };
    session.messageIndex.set(messageID, message);
    session.messages.push(message);
    return message;
  }

  private appendMessageTextPart(
    message: OpencodeSessionMessage,
    type: "text" | "reasoning",
    text: string,
    timestamp: number,
  ) {
    const lastPart = message.parts[message.parts.length - 1];
    if (lastPart && lastPart.type === type) {
      lastPart.text += text;
      lastPart.time.end = timestamp;
      return;
    }

    message.parts.push({
      id: randomUUID(),
      type,
      text,
      time: { start: timestamp, end: timestamp },
    });
  }

  private appendChunk(session: SessionCache, role: OpencodeRole, update: acp.ContentChunk, partType: "text" | "reasoning") {
    const createdAt = Date.now();
    const messageID = update.messageId || `${role}:${createdAt}:${randomUUID()}`;
    const message = this.ensureMessage(session, messageID, role, createdAt);

    const filePart = contentBlockToFilePart(update.content);
    if (filePart) {
      message.parts.push(filePart);
      return;
    }

    const text = contentBlockToText(update.content);
    if (!text) return;

    this.appendMessageTextPart(message, partType, text, createdAt);
  }

  private upsertToolCall(session: SessionCache, update: acp.ToolCall | acp.ToolCallUpdate) {
    const existing = session.toolIndex.get(update.toolCallId);
    const startedAt = existing?.startedAt ?? Date.now();
    const content = update.content === null ? [] : update.content;
    const attachments = content
      ? content.map(toolCallContentToFilePart).filter((item): item is OpencodeFilePart => Boolean(item))
      : existing?.attachments ?? [];
    const status =
      update.status === "failed"
        ? "error"
        : update.status === "completed"
          ? "completed"
          : update.status === "in_progress"
            ? "running"
            : update.status === "pending"
              ? "pending"
              : existing?.status ?? "pending";
    const rawOutput = "rawOutput" in update ? update.rawOutput : undefined;

    const next: ToolCallRecord = {
      callID: update.toolCallId,
      tool: update.kind ?? existing?.tool ?? "other",
      input: "rawInput" in update && update.rawInput !== undefined ? unknownToRecord(update.rawInput) : existing?.input ?? {},
      title: update.title ?? existing?.title ?? "Tool call",
      output:
        content !== undefined || rawOutput !== undefined
          ? buildToolOutput(content, rawOutput)
          : existing?.output ?? "",
      attachments,
      status,
      startedAt,
      endedAt: status === "completed" || status === "error" ? Date.now() : existing?.endedAt,
      error:
        status === "error"
          ? buildToolOutput(content, rawOutput).trim() || existing?.error || "Tool call failed"
          : undefined,
      metadata:
        update.locations && update.locations.length > 0
          ? {
              locations: update.locations.map((location) => ({
                path: location.path,
                line: location.line,
              })),
            }
          : existing?.metadata,
    };

    session.toolIndex.set(update.toolCallId, next);
    const message = this.ensureMessage(session, `tool:${update.toolCallId}`, "assistant", startedAt);
    message.parts = message.parts.filter((part) => part.type !== "tool" || part.callID !== update.toolCallId);
    message.parts.push(makeToolPart(next));
  }

  private finalizeAssistantMessages(session: SessionCache) {
    const now = Date.now();
    for (const message of session.messages) {
      if (message.info.role === "assistant" && message.info.time.completed === undefined && !message.info.error) {
        message.info.time.completed = now;
      }
    }
  }

  private hasRenderableAssistantOutput(message: OpencodeSessionMessage) {
    if (message.info.role !== "assistant") {
      return false;
    }
    if (message.info.error?.data?.message?.trim()) {
      return true;
    }
    return message.parts.some((part) => {
      if (part.type === "text") {
        return part.text.trim().length > 0;
      }
      return part.type !== "reasoning";
    });
  }

  private hasRenderableAssistantOutputSince(session: SessionCache, startIndex: number) {
    return session.messages.slice(startIndex).some((message) => this.hasRenderableAssistantOutput(message));
  }

  private recordEmptyPromptResult(session: SessionCache, stopReason: acp.StopReason) {
    const now = Date.now();
    const message = this.ensureMessage(session, `empty:${now}:${randomUUID()}`, "assistant", now);
    message.info.error = {
      data: {
        message: `Agent 未返回任何内容（${stopReason}）。请重试。`,
      },
    };
    message.info.time.completed = now;
    session.info.time.updated = now;
  }

  private recordPromptError(session: SessionCache, error: unknown) {
    const now = Date.now();
    const message = this.ensureMessage(session, `error:${now}:${randomUUID()}`, "assistant", now);
    message.info.error = {
      data: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
    message.info.time.completed = now;
  }

  private async syncSessionRuntimeOptions(
    handle: RuntimeHandle,
    config: AppConfig,
    sessionID: string,
    session: SessionCache,
  ) {
    const desiredMode = getDesiredSessionMode(config, session.modeState);
    if (desiredMode && desiredMode !== session.modeState?.currentModeId) {
      await handle.connection.setSessionMode({
        sessionId: sessionID,
        modeId: desiredMode,
      });
      if (session.modeState) {
        session.modeState = {
          ...session.modeState,
          currentModeId: desiredMode,
        };
      }
    }

    const desiredModel = getDesiredSessionModelValue(config, session.configOptions);
    const currentModel = getModelConfigOption(session.configOptions)?.currentValue ?? null;
    if (desiredModel && desiredModel !== currentModel) {
      const response = await handle.connection.setSessionConfigOption({
        sessionId: sessionID,
        configId: "model",
        value: desiredModel,
      });
      session.configOptions = response.configOptions;
    }
  }

  private makeClient(): acp.Client {
    return {
      requestPermission: async (params) => {
        const requestID = randomUUID();
        const optionsByLabel = new Map<string, acp.PermissionOption>();
        for (const option of params.options) {
          optionsByLabel.set(option.name.trim().toLowerCase(), option);
        }

        const request: OpencodeQuestionRequest = {
          id: requestID,
          sessionID: params.sessionId,
          questions: [
            {
              header: "Permission",
              question: params.toolCall.title || "Choose how to handle this action.",
              options: params.options.map((option) => ({
                label: option.name,
                description: permissionOptionDescription(option),
              })),
              multiple: false,
              custom: false,
            },
          ],
          tool: {
            messageID: `tool:${params.toolCall.toolCallId}`,
            callID: params.toolCall.toolCallId,
          },
        };

        return await new Promise<acp.RequestPermissionResponse>((resolve) => {
          this.pendingPermissionRequests.set(requestID, {
            request,
            sessionID: params.sessionId,
            optionsByLabel,
            resolve,
          });
        });
      },
      sessionUpdate: async ({ sessionId, update }) => {
        const session = this.ensureSession(sessionId);
        if (!session.hydratingHistory) {
          session.info.time.updated = Date.now();
        }

        switch (update.sessionUpdate) {
          case "user_message_chunk":
            this.appendChunk(session, "user", update, "text");
            break;
          case "agent_message_chunk":
            this.appendChunk(session, "assistant", update, "text");
            break;
          case "agent_thought_chunk":
            this.appendChunk(session, "assistant", update, "reasoning");
            break;
          case "tool_call":
          case "tool_call_update":
            this.upsertToolCall(session, update);
            break;
          case "available_commands_update":
            session.availableSkills = update.availableCommands.map(runtimeSkillFromCommand);
            this.availableSkills = session.availableSkills;
            break;
          case "current_mode_update":
            session.modeState = session.modeState
              ? { ...session.modeState, currentModeId: update.currentModeId }
              : { availableModes: [], currentModeId: update.currentModeId };
            break;
          case "config_option_update":
            session.configOptions = update.configOptions;
            break;
          case "session_info_update":
            if (update.title !== undefined && update.title !== null) {
              session.info.title = update.title.trim() || session.info.title;
            }
            if (update.updatedAt !== undefined) {
              session.info.time.updated = timestampFromIso(update.updatedAt, session.info.time.updated);
            }
            break;
          default:
            break;
        }
      },
    };
  }

  private async ensureStarted(config: AppConfig) {
    if (config.bridgeUrl.trim()) {
      throw new Error("ACP transport is disabled for remote bridge sessions.");
    }

    if (this.startupPromise) {
      return await this.startupPromise;
    }

    const startup = this.startRuntime(config);
    this.startupPromise = startup;

    try {
      return await startup;
    } finally {
      if (this.startupPromise === startup) {
        this.startupPromise = null;
      }
    }
  }

  private async startRuntime(config: AppConfig) {
    const signature = makeSignature(config);
    const runtimeConfig = getAcpRuntimeConfig(config);

    if (this.handle && this.handle.signature === signature && !this.handle.process.killed) {
      return this.handle;
    }

    await this.dispose();

    const configDir = await syncGeneratedCommands(runtimeConfig);
    const resolvedMcpServers = await resolveMcpServers(getRuntimeMcpServers(runtimeConfig), configDir);
    const env = makeSpawnEnv(runtimeConfig, configDir, resolvedMcpServers);
    const command = await resolveOpencodeCommand();

    if (!(await fileExists(command)) && command !== "opencode") {
      throw new Error(`OpenCode executable not found: ${command}`);
    }

    const child = spawn(command, ["acp"], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!child.stdin || !child.stdout) {
      throw new Error("Failed to create ACP stdio streams.");
    }

    const handle: RuntimeHandle = {
      signature,
      process: child,
      connection: new acp.ClientSideConnection(
        () => this.makeClient(),
        acp.ndJsonStream(
          Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
          Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        ),
      ),
      stderr: "",
    };

    child.stderr?.on("data", (chunk) => {
      handle.stderr += chunk.toString();
    });

    child.once("exit", () => {
      if (this.handle?.process === child) {
        this.handle = null;
      }
      for (const request of this.pendingPermissionRequests.values()) {
        request.resolve({ outcome: { outcome: "cancelled" } });
      }
      this.pendingPermissionRequests.clear();
      this.resetSessionRuntimeState();
    });

    try {
      await Promise.race([
        handle.connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientInfo: {
            name: "super-agents",
            version: "0.1.0",
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out initializing ACP runtime.")), 20_000),
        ),
      ]);
      this.handle = handle;
      return handle;
    } catch (error) {
      await killRuntime(handle);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${handle.stderr.trim() ? `\n${handle.stderr.trim()}` : ""}`,
      );
    }
  }

  private async ensureSessionLoaded(config: AppConfig, sessionID: string) {
    const directory = getSessionDirectory(config);
    const session = this.ensureSession(sessionID, directory);
    if (session.loaded) return session;
    if (session.loadPromise) {
      await session.loadPromise;
      return session;
    }

    session.loadPromise = (async () => {
      const handle = await this.ensureStarted(config);
      session.messages = [];
      session.messageIndex.clear();
      session.toolIndex.clear();
      session.hydratingHistory = true;

      try {
        const response = await handle.connection.loadSession({
          sessionId: sessionID,
          cwd: directory,
          mcpServers: [],
        });

        session.modeState = response.modes ?? session.modeState;
        session.configOptions = response.configOptions ?? session.configOptions;
        await this.syncSessionRuntimeOptions(handle, config, sessionID, session);
        session.loaded = true;
        this.finalizeAssistantMessages(session);
      } finally {
        session.hydratingHistory = false;
      }
    })();

    try {
      await session.loadPromise;
    } finally {
      session.loadPromise = null;
    }

    return session;
  }

  async listSessions(config: AppConfig) {
    return await this.withLegacyFallback(
      config,
      async () => {
        const handle = await this.ensureStarted(config);
        const result: OpencodeSessionInfo[] = [];
        let cursor: string | null | undefined;

        do {
          const page = await handle.connection.listSessions({
            cwd: getSessionDirectory(config),
            cursor,
          });
          cursor = page.nextCursor;
          for (const item of page.sessions) {
            const session = this.ensureSession(item.sessionId, item.cwd, item.title ?? undefined);
            session.info.directory = item.cwd;
            session.info.title = item.title?.trim() || session.info.title;
            session.info.time.updated = timestampFromIso(item.updatedAt, session.info.time.updated);
            result.push(session.info);
          }
        } while (cursor);

        return result.sort((left, right) => right.time.updated - left.time.updated);
      },
      async () => await this.legacyRuntime.listSessions(config),
    );
  }

  async getSession(config: AppConfig, sessionID: string) {
    return await this.withLegacyFallback(
      config,
      async () => {
        const listed = await this.listSessions(config);
        const match = listed.find((session) => session.id === sessionID);
        if (match) return match;
        return (await this.ensureSessionLoaded(config, sessionID)).info;
      },
      async () => await this.legacyRuntime.getSession(config, sessionID),
    );
  }

  async listMessages(config: AppConfig, sessionID: string) {
    return await this.withLegacyFallback(
      config,
      async () => (await this.ensureSessionLoaded(config, sessionID)).messages,
      async () => await this.legacyRuntime.listMessages(config, sessionID),
    );
  }

  async listSessionStatuses(_config: AppConfig) {
    if (this.shouldUseLegacyTransport(_config)) {
      return await this.legacyRuntime.listSessionStatuses(_config);
    }
    return Object.fromEntries(
      Array.from(this.sessions.values()).map((session) => [session.info.id, session.status] as const),
    );
  }

  async listQuestions(_config: AppConfig) {
    if (this.shouldUseLegacyTransport(_config)) {
      return await this.legacyRuntime.listQuestions(_config);
    }
    return Array.from(this.pendingPermissionRequests.values()).map((item) => item.request);
  }

  async createSession(config: AppConfig, title?: string) {
    return await this.withLegacyFallback(
      config,
      async () => {
        const handle = await this.ensureStarted(config);
        const directory = getSessionDirectory(config);
        const response = await handle.connection.newSession({
          cwd: directory,
          mcpServers: [],
        });

        const session = this.ensureSession(response.sessionId, directory, title);
        session.loaded = true;
        session.status = { type: "idle" };
        session.modeState = response.modes ?? session.modeState;
        session.configOptions = response.configOptions ?? session.configOptions;
        await this.syncSessionRuntimeOptions(handle, config, response.sessionId, session);
        session.info.title = title?.trim() || session.info.title;
        session.info.time.created = Date.now();
        session.info.time.updated = Date.now();
        return session.info;
      },
      async () => await this.legacyRuntime.createSession(config, title),
    );
  }

  async deleteSession(config: AppConfig, sessionID: string) {
    return await this.withLegacyFallback(
      config,
      async () => {
        const runtimeConfig = getAcpRuntimeConfig(config);
        const configDir = await syncGeneratedCommands(runtimeConfig);
        const resolvedMcpServers = await resolveMcpServers(getRuntimeMcpServers(runtimeConfig), configDir);
        const env = makeSpawnEnv(runtimeConfig, configDir, resolvedMcpServers);
        const command = await resolveOpencodeCommand();

        await execFileAsync(command, ["session", "delete", sessionID], {
          cwd: process.cwd(),
          env,
          windowsHide: true,
        });

        this.sessions.delete(sessionID);
        for (const [requestID, request] of this.pendingPermissionRequests.entries()) {
          if (request.sessionID === sessionID) {
            request.resolve({ outcome: { outcome: "cancelled" } });
            this.pendingPermissionRequests.delete(requestID);
          }
        }

        return true;
      },
      async () => await this.legacyRuntime.deleteSession(config, sessionID),
    );
  }

  async promptAsync(config: AppConfig, sessionID: string, message: string, attachments: FileDropEntry[]) {
    if (this.shouldUseLegacyTransport(config)) {
      return await this.legacyRuntime.promptAsync(config, sessionID, message, attachments);
    }
    if (!hasActiveModel(config)) {
      throw new Error("No available model configured. Configure and enable a model before sending messages.");
    }

    let handle: RuntimeHandle;
    let session: SessionCache;
    try {
      handle = await this.ensureStarted(config);
      session = await this.ensureSessionLoaded(config, sessionID);
      await this.syncSessionRuntimeOptions(handle, config, sessionID, session);
    } catch (error) {
      if (!this.isRecoverableAcpTransportError(error)) {
        throw error;
      }
      this.enableLegacyFallback(config);
      await this.resetAcpRuntime();
      return await this.legacyRuntime.promptAsync(config, sessionID, message, attachments);
    }
    const prompt = [
      {
        type: "text" as const,
        text: message,
      },
      ...(await Promise.all(attachments.map(attachmentToContentBlock))).filter(
        (item): item is acp.ContentBlock => Boolean(item),
      ),
    ];
    const visibleOutputStartIndex = session.messages.length;

    session.status = { type: "busy" };

    void handle.connection
      .prompt({
        sessionId: sessionID,
        messageId: randomUUID(),
        prompt,
      })
      .then((result) => {
        session.status = { type: "idle" };
        if (result.stopReason !== "cancelled") {
          if (!this.hasRenderableAssistantOutputSince(session, visibleOutputStartIndex)) {
            this.recordEmptyPromptResult(session, result.stopReason);
          }
          this.finalizeAssistantMessages(session);
        }
      })
      .catch(async (error) => {
        session.status = { type: "idle" };
        if (this.isRecoverableAcpTransportError(error)) {
          try {
            this.enableLegacyFallback(config);
            await this.resetAcpRuntime();
            await this.legacyRuntime.promptAsync(config, sessionID, message, attachments);
            return;
          } catch (legacyError) {
            this.recordPromptError(
              session,
              `${error instanceof Error ? error.message : String(error)}\n${legacyError instanceof Error ? legacyError.message : String(legacyError)}`,
            );
            return;
          }
        }
        this.recordPromptError(session, error);
      });
  }

  async commandAsync(config: AppConfig, sessionID: string, command: string, argumentsText: string, attachments: FileDropEntry[]) {
    if (this.shouldUseLegacyTransport(config)) {
      return await this.legacyRuntime.commandAsync(config, sessionID, command, argumentsText, attachments);
    }
    const prompt = argumentsText.trim() ? `/${command} ${argumentsText.trim()}` : `/${command}`;
    await this.promptAsync(config, sessionID, prompt, attachments);
  }

  async abortSession(config: AppConfig, sessionID: string) {
    if (this.shouldUseLegacyTransport(config)) {
      return await this.legacyRuntime.abortSession(config, sessionID);
    }
    const handle = await this.ensureStarted(config);
    for (const [requestID, request] of this.pendingPermissionRequests.entries()) {
      if (request.sessionID === sessionID) {
        request.resolve({ outcome: { outcome: "cancelled" } });
        this.pendingPermissionRequests.delete(requestID);
      }
    }
    await handle.connection.cancel({ sessionId: sessionID });
    const session = this.sessions.get(sessionID);
    if (session) {
      session.status = { type: "idle" };
    }
    return true;
  }

  async replyQuestion(_config: AppConfig, requestID: string, answers: string[][]) {
    if (this.shouldUseLegacyTransport(_config)) {
      return await this.legacyRuntime.replyQuestion(_config, requestID, answers);
    }
    const pending = this.pendingPermissionRequests.get(requestID);
    if (!pending) {
      throw new Error("Permission request not found.");
    }

    const answer = answers.flat().map((item) => item.trim()).find(Boolean);
    if (!answer) {
      throw new Error("Missing permission selection.");
    }

    const option = pending.optionsByLabel.get(answer.toLowerCase());
    if (!option) {
      throw new Error(`Unknown permission option: ${answer}`);
    }

    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId: option.optionId,
      },
    });
    this.pendingPermissionRequests.delete(requestID);
    return true;
  }

  async rejectQuestion(_config: AppConfig, requestID: string) {
    if (this.shouldUseLegacyTransport(_config)) {
      return await this.legacyRuntime.rejectQuestion(_config, requestID);
    }
    const pending = this.pendingPermissionRequests.get(requestID);
    if (!pending) {
      throw new Error("Permission request not found.");
    }

    const rejectOption =
      Array.from(pending.optionsByLabel.values()).find((option) => option.kind === "reject_once") ??
      Array.from(pending.optionsByLabel.values()).find((option) => option.kind === "reject_always");

    pending.resolve(
      rejectOption
        ? {
            outcome: {
              outcome: "selected",
              optionId: rejectOption.optionId,
            },
          }
        : { outcome: { outcome: "cancelled" } },
    );
    this.pendingPermissionRequests.delete(requestID);
    return true;
  }

  private async primeAvailableSkills(config: AppConfig) {
    if (this.availableSkills.length > 0) return;
    const sessions = await this.listSessions(config).catch(() => []);
    if (sessions[0]) {
      await this.ensureSessionLoaded(config, sessions[0].id).catch(() => undefined);
    }
  }

  async listSkills(config: AppConfig): Promise<RuntimeSkill[]> {
    if (this.shouldUseLegacyTransport(config)) {
      return await this.legacyRuntime.listSkills(config);
    }
    await this.primeAvailableSkills(config);
    return this.availableSkills;
  }

  async listAgents(_config: AppConfig): Promise<RuntimeAgent[]> {
    if (this.shouldUseLegacyTransport(_config)) {
      return await this.legacyRuntime.listAgents(_config);
    }
    const modes = new Map<string, RuntimeAgent>();
    for (const session of this.sessions.values()) {
      for (const mode of session.modeState?.availableModes ?? []) {
        if (modes.has(mode.id)) continue;
        modes.set(mode.id, {
          name: mode.name,
          description: mode.description ?? undefined,
          mode: "all",
        });
      }
    }
    return Array.from(modes.values());
  }

  async listMcpStatuses(config: AppConfig): Promise<McpServerStatus[]> {
    if (this.shouldUseLegacyTransport(config)) {
      return await this.legacyRuntime.listMcpStatuses(config);
    }
    return config.mcpServers.map((server) => ({
      name: sanitizeId(server.name || server.id),
      status:
        server.enabled === false
          ? "disabled"
          : shouldIncludeMcpServerInRuntime(server)
            ? "connected"
            : "failed",
      error:
        server.enabled !== false && !shouldIncludeMcpServerInRuntime(server)
          ? "ACP runtime skipped this MCP server because its command or URL is incomplete."
          : undefined,
    }));
  }
}

export type {
  OpencodeFilePart,
  OpencodePart,
  OpencodeQuestionRequest,
  OpencodeSessionInfo,
  OpencodeSessionMessage,
  OpencodeSessionStatus,
  OpencodeToolPart,
} from "./opencode-runtime";
