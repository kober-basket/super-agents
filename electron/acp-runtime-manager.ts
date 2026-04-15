import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import * as acp from "@agentclientprotocol/sdk";

import type { FileDropEntry } from "../src/types";
import { resolveOpencodeConfigDir } from "./app-identity";
import { TerminalManager } from "./terminal-manager";

interface SessionHandlers {
  onUpdate: (update: acp.SessionUpdate) => void | Promise<void>;
  onTerminalOutput?: (terminal: {
    terminalId: string;
    output: string;
    truncated: boolean;
    exitCode?: number | null;
    signal?: string | null;
  }) => void | Promise<void>;
}

interface EnsureSessionOptions {
  cwd: string;
  additionalDirectories?: string[];
  mcpServers: acp.McpServer[];
}

function parseJsonRecord(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) =>
      value === undefined || value === null ? [] : [[key, String(value)]],
    ),
  ) as Record<string, string>;
}

function normalizeRoot(targetPath: string) {
  return path.resolve(targetPath).replace(/\\/g, "/").toLowerCase();
}

function isPathWithinRoots(targetPath: string, roots: string[]) {
  const resolvedTarget = path.resolve(targetPath);
  return roots.some((root) => {
    const relativePath = path.relative(root, resolvedTarget);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  });
}

function createPlaceholderText(content: acp.ContentBlock) {
  if (content.type === "text") {
    return content.text;
  }
  if (content.type === "image") {
    return "[image]";
  }
  if (content.type === "resource_link") {
    return `[resource: ${content.name}]`;
  }
  if (content.type === "resource") {
    const resource = content.resource;
    if ("text" in resource) {
      return resource.text;
    }
    return `[resource: ${resource.uri}]`;
  }
  return `[${content.type}]`;
}

export function toPromptBlocks(
  content: string,
  attachments: FileDropEntry[],
  promptCapabilities: acp.PromptCapabilities | undefined,
  injectedContext?: string,
): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  const textParts: string[] = [];

  if (content.trim()) {
    textParts.push(content.trim());
  }

  if (injectedContext?.trim()) {
    textParts.push(injectedContext.trim());
  }

  if (textParts.length > 0) {
    blocks.push({
      type: "text",
      text: textParts.join("\n\n"),
    });
  } else if (attachments.length > 0) {
    blocks.push({
      type: "text",
      text: "Please inspect the attached files and help with the request.",
    });
  }

  for (const attachment of attachments) {
    if (
      attachment.dataUrl &&
      attachment.mimeType.startsWith("image/") &&
      promptCapabilities?.image
    ) {
      const [, encoded = ""] = attachment.dataUrl.split(",", 2);
      blocks.push({
        type: "image",
        data: encoded,
        mimeType: attachment.mimeType,
        uri: pathToFileURL(attachment.path).href,
      });
      continue;
    }

    if (attachment.content && promptCapabilities?.embeddedContext) {
      blocks.push({
        type: "resource",
        resource: {
          uri: pathToFileURL(attachment.path).href,
          mimeType: attachment.mimeType,
          text: attachment.content,
        },
      });
      continue;
    }

    blocks.push({
      type: "resource_link",
      name: attachment.name,
      uri: pathToFileURL(attachment.path).href,
      mimeType: attachment.mimeType,
      size: attachment.size,
      description: `Attached file: ${attachment.name}`,
      title: attachment.name,
    });
  }

  return blocks;
}

export class AcpRuntimeManager implements acp.Client {
  private agentProcess: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private initializePromise: Promise<acp.InitializeResponse> | null = null;
  private initializeResult: acp.InitializeResponse | null = null;
  private readonly sessionRoots = new Map<string, string[]>();
  private readonly sessionHandlers = new Map<string, Set<SessionHandlers>>();
  private readonly terminalManager: TerminalManager;

  constructor(private readonly appDataRoot: string) {
    this.terminalManager = new TerminalManager(({ sessionId, terminal }) => {
      const handlers = this.sessionHandlers.get(sessionId);
      if (!handlers) return;
      for (const handler of handlers) {
        void handler.onTerminalOutput?.(terminal);
      }
    });
  }

  async ensureInitialized() {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeInternal();
    }
    return await this.initializePromise;
  }

  get promptCapabilities() {
    return this.initializeResult?.agentCapabilities.promptCapabilities;
  }

  async createSession(options: EnsureSessionOptions) {
    await this.ensureInitialized();
    const response = await this.requireConnection().newSession({
      cwd: path.resolve(options.cwd),
      additionalDirectories: options.additionalDirectories?.map((value) => path.resolve(value)),
      mcpServers: options.mcpServers,
    });
    this.sessionRoots.set(response.sessionId, [
      path.resolve(options.cwd),
      ...(options.additionalDirectories?.map((value) => path.resolve(value)) ?? []),
    ]);
    return response;
  }

  async ensureSession(sessionId: string, options: EnsureSessionOptions) {
    await this.ensureInitialized();
    const connection = this.requireConnection();
    const roots = [
      path.resolve(options.cwd),
      ...(options.additionalDirectories?.map((value) => path.resolve(value)) ?? []),
    ];

    try {
      if (this.initializeResult?.agentCapabilities.sessionCapabilities?.resume && connection.unstable_resumeSession) {
        await connection.unstable_resumeSession({
          sessionId,
          cwd: path.resolve(options.cwd),
          additionalDirectories: options.additionalDirectories?.map((value) => path.resolve(value)),
          mcpServers: options.mcpServers,
        });
        this.sessionRoots.set(sessionId, roots);
        return sessionId;
      }

      if (this.initializeResult?.agentCapabilities.loadSession) {
        await connection.loadSession({
          sessionId,
          cwd: path.resolve(options.cwd),
          additionalDirectories: options.additionalDirectories?.map((value) => path.resolve(value)),
          mcpServers: options.mcpServers,
        });
        this.sessionRoots.set(sessionId, roots);
        return sessionId;
      }
    } catch {
      // Fall back to creating a new session below.
    }

    const created = await this.createSession(options);
    return created.sessionId;
  }

  registerSessionHandlers(sessionId: string, handlers: SessionHandlers) {
    const current = this.sessionHandlers.get(sessionId) ?? new Set<SessionHandlers>();
    current.add(handlers);
    this.sessionHandlers.set(sessionId, current);

    return () => {
      const existing = this.sessionHandlers.get(sessionId);
      if (!existing) return;
      existing.delete(handlers);
      if (existing.size === 0) {
        this.sessionHandlers.delete(sessionId);
      }
    };
  }

  async prompt(params: acp.PromptRequest) {
    await this.ensureInitialized();
    return await this.requireConnection().prompt(params);
  }

  async cancel(sessionId: string) {
    await this.ensureInitialized();
    await this.requireConnection().cancel({ sessionId });
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const allowedRoots = this.sessionRoots.get(params.sessionId) ?? [];
    const hasOutsideLocation =
      params.toolCall.locations?.some((location) => !isPathWithinRoots(location.path, allowedRoots)) ?? false;

    if (hasOutsideLocation) {
      const rejectOption =
        params.options.find((option) => option.kind === "reject_once") ??
        params.options.find((option) => option.kind === "reject_always");
      if (rejectOption) {
        return {
          outcome: {
            outcome: "selected",
            optionId: rejectOption.optionId,
          },
        };
      }

      return {
        outcome: {
          outcome: "cancelled",
        },
      };
    }

    const allowOption =
      params.options.find((option) => option.kind === "allow_once") ??
      params.options.find((option) => option.kind === "allow_always") ??
      params.options[0];

    return {
      outcome: allowOption
        ? {
            outcome: "selected",
            optionId: allowOption.optionId,
          }
        : {
            outcome: "cancelled",
          },
    };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const handlers = this.sessionHandlers.get(params.sessionId);
    if (!handlers) return;
    for (const handler of handlers) {
      await handler.onUpdate(params.update);
    }
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    this.assertPathAllowed(params.sessionId, params.path);
    await mkdir(path.dirname(params.path), { recursive: true });
    await writeFile(params.path, params.content, "utf8");
    return {};
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    this.assertPathAllowed(params.sessionId, params.path);
    return {
      content: await readFile(params.path, "utf8"),
    };
  }

  async createTerminal(
    params: acp.CreateTerminalRequest,
  ): Promise<acp.CreateTerminalResponse> {
    const cwd = params.cwd ? path.resolve(params.cwd) : this.sessionRoots.get(params.sessionId)?.[0] ?? process.cwd();
    this.assertPathAllowed(params.sessionId, cwd);
    return await this.terminalManager.createTerminal({
      ...params,
      cwd,
    });
  }

  async terminalOutput(
    params: acp.TerminalOutputRequest,
  ): Promise<acp.TerminalOutputResponse> {
    return await this.terminalManager.terminalOutput(params);
  }

  async releaseTerminal(
    params: acp.ReleaseTerminalRequest,
  ): Promise<acp.ReleaseTerminalResponse> {
    return await this.terminalManager.releaseTerminal(params);
  }

  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest,
  ): Promise<acp.WaitForTerminalExitResponse> {
    return await this.terminalManager.waitForTerminalExit(params);
  }

  async killTerminal(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> {
    return await this.terminalManager.killTerminal(params);
  }

  private async initializeInternal() {
    await mkdir(resolveOpencodeConfigDir(this.appDataRoot), { recursive: true });

    const binaryPath = this.resolveOpencodeBinaryPath();
    const cwd = process.cwd();
    const agentProcess = spawn(binaryPath, ["acp", "--cwd", cwd], {
      cwd,
      env: {
        ...process.env,
        OPENCODE_CLIENT: "super-agents",
        OPENCODE_CONFIG_DIR: resolveOpencodeConfigDir(this.appDataRoot),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    agentProcess.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        console.error("[acp]", message);
      }
    });

    this.agentProcess = agentProcess;
    const stream = acp.ndJsonStream(
      Writable.toWeb(agentProcess.stdin),
      Readable.toWeb(agentProcess.stdout),
    );
    this.connection = new acp.ClientSideConnection(() => this, stream);
    const initResult = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: {
        name: "super-agents",
        version: "0.1.0",
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    });
    this.initializeResult = initResult;

    agentProcess.on("close", () => {
      this.connection = null;
      this.agentProcess = null;
      this.initializePromise = null;
      this.initializeResult = null;
      this.sessionRoots.clear();
      this.sessionHandlers.clear();
    });

    return initResult;
  }

  private requireConnection() {
    if (!this.connection) {
      throw new Error("ACP runtime is not connected");
    }
    return this.connection;
  }

  private assertPathAllowed(sessionId: string, targetPath: string) {
    const roots = this.sessionRoots.get(sessionId);
    if (!roots || roots.length === 0) {
      return;
    }

    if (!isPathWithinRoots(targetPath, roots)) {
      throw new Error(`Access denied outside workspace: ${targetPath}`);
    }
  }

  private resolveOpencodeBinaryPath() {
    if (process.platform !== "win32") {
      throw new Error("The bundled ACP runtime is currently available only on Windows.");
    }

    const candidates = [
      path.join(process.cwd(), "vendor", "opencode", "windows-x64", "opencode.exe"),
      path.join(process.resourcesPath, "vendor", "opencode", "windows-x64", "opencode.exe"),
    ];

    const resolved = candidates.find((candidate) => existsSync(candidate));
    if (!resolved) {
      throw new Error("Unable to find the bundled opencode ACP runtime.");
    }

    return resolved;
  }
}

export function mapConfigToAcpMcpServers(
  servers: Array<{
    name: string;
    transport: "local" | "remote";
    command: string;
    args: string[];
    url: string;
    headersJson: string;
    envJson: string;
    enabled: boolean;
  }>,
): acp.McpServer[] {
  return servers
    .filter((server) => server.enabled)
    .flatMap((server) => {
      if (server.transport === "local") {
        if (!server.command.trim()) {
          return [];
        }

        return [
          {
            name: server.name.trim() || "workspace-mcp",
            command: server.command.trim(),
            args: server.args.filter(Boolean),
            env: Object.entries(parseJsonRecord(server.envJson)).map(([name, value]) => ({
              name,
              value,
            })),
          } satisfies acp.McpServer,
        ];
      }

      if (!server.url.trim()) {
        return [];
      }

      const headers = Object.entries(parseJsonRecord(server.headersJson)).map(([name, value]) => ({
        name,
        value,
      }));
      const name = server.name.trim() || "remote-mcp";
      const normalizedUrl = server.url.trim();

      if (normalizedUrl.toLowerCase().includes("/sse")) {
        return [
          {
            type: "sse",
            name,
            url: normalizedUrl,
            headers,
          } satisfies acp.McpServer,
        ];
      }

      return [
        {
          type: "http",
          name,
          url: normalizedUrl,
          headers,
        } satisfies acp.McpServer,
      ];
    });
}

export function contentBlockToText(content: acp.ContentBlock) {
  return createPlaceholderText(content);
}
