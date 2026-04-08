import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveGeneratedConfigDir } from "./app-identity";
import { getActiveModelOption } from "../src/lib/model-config";
import type { AppConfig, FileDropEntry, McpServerConfig, McpServerStatus, RuntimeAgent, RuntimeSkill } from "../src/types";

const execFileAsync = promisify(execFile);

type OpencodeRole = "user" | "assistant";

export interface OpencodeSessionInfo {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
    updated: number;
    archived?: number;
  };
}

export interface OpencodeMessageInfo {
  id: string;
  role: OpencodeRole;
  sessionID: string;
  time: {
    created: number;
    completed?: number;
  };
  error?: {
    data?: {
      message?: string;
    };
  };
}

export interface OpencodeTextPart {
  id: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  time?: {
    start: number;
    end?: number;
  };
}

export interface OpencodeReasoningPart {
  id: string;
  type: "reasoning";
  text: string;
  time: {
    start: number;
    end?: number;
  };
}

export interface OpencodeAgentPart {
  id: string;
  type: "agent";
  name: string;
}

export interface OpencodeSubtaskPart {
  id: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
  command?: string;
}

export interface OpencodeFilePart {
  id: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
  source?: {
    type: "file" | "resource" | "symbol";
    path?: string;
    uri?: string;
  };
}

export interface OpencodeToolPart {
  id: string;
  type: "tool";
  callID: string;
  tool: string;
  state:
    | {
        status: "pending";
        input: Record<string, unknown>;
      }
    | {
        status: "running";
        input: Record<string, unknown>;
        title?: string;
        time: { start: number };
      }
    | {
        status: "completed";
        input: Record<string, unknown>;
        output: string;
        title: string;
        metadata?: Record<string, unknown>;
        time: { start: number; end: number };
        attachments?: OpencodeFilePart[];
      }
    | {
        status: "error";
        input: Record<string, unknown>;
        error: string;
        time: { start: number; end: number };
      };
}

export type OpencodePart =
  | OpencodeTextPart
  | OpencodeReasoningPart
  | OpencodeAgentPart
  | OpencodeSubtaskPart
  | OpencodeFilePart
  | OpencodeToolPart;

export interface OpencodeSessionMessage {
  info: OpencodeMessageInfo;
  parts: OpencodePart[];
}

interface RuntimeHandle {
  baseUrl: string;
  signature: string;
  process: ReturnType<typeof spawn> | null;
  external: boolean;
}

type JsonObject = Record<string, unknown>;
const BUNDLED_OPENCODE_WINDOWS_RELATIVE_PATH = path.join(
  "vendor",
  "opencode",
  "windows-x64",
  "opencode.exe",
);
const SYSTEM_OPENCODE_COMMAND_CANDIDATES =
  process.platform === "win32" ? ["opencode.exe", "opencode"] : ["opencode"];

function sanitizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function isNodeExecutablePath(command: string) {
  const basename = path.basename(command.trim()).toLowerCase();
  return basename === "node" || basename === "node.exe";
}

function getNodeCommand() {
  return isNodeExecutablePath(process.execPath) ? process.execPath : "node";
}

function getBundledOpencodeCandidates() {
  const candidates: string[] = [];

  if (process.platform === "win32") {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, BUNDLED_OPENCODE_WINDOWS_RELATIVE_PATH));
    }
    candidates.push(path.resolve(__dirname, "..", BUNDLED_OPENCODE_WINDOWS_RELATIVE_PATH));
    candidates.push(path.resolve(process.cwd(), BUNDLED_OPENCODE_WINDOWS_RELATIVE_PATH));
  }

  return Array.from(new Set(candidates));
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeUrl(value: string) {
  return trimTrailingSlash(value.trim());
}

function withDefault<T>(value: T | undefined, fallback: T) {
  return value === undefined ? fallback : value;
}

function pickActiveModel(config: AppConfig) {
  const activeOption = getActiveModelOption(config.modelProviders, config.activeModelId);
  if (!activeOption) return null;

  const provider = config.modelProviders.find((item) => item.id === activeOption.providerId);
  const model = provider?.models.find((item) => item.id === activeOption.modelId);
  if (!provider || !model) return null;

  return {
    provider,
    model,
  };
}

function buildProviderId(providerId: string) {
  return `desktop-${sanitizeId(providerId)}`;
}

function buildModelRef(config: AppConfig) {
  const active = pickActiveModel(config);
  if (!active) return null;
  return {
    providerID: buildProviderId(active.provider.id),
    modelID: active.model.id,
  };
}

function isPlaywrightMcpPackage(value: string) {
  return /^@playwright\/mcp(?:@.+)?$/i.test(value.trim());
}

function isLegacyPlaywrightDraft(server: McpServerConfig) {
  const normalizedName = sanitizeId(server.name || server.id);
  return (
    server.transport === "local" &&
    ["playwright", "browser-automation"].includes(normalizedName) &&
    !server.url.trim() &&
    server.args.length === 0 &&
    ["", "node", "node.exe", process.execPath].includes(server.command.trim())
  );
}

function getPlaywrightMcpExtraArgs(server: McpServerConfig) {
  if (server.transport !== "local") return null;

  const args = server.args.filter(Boolean);
  const packageIndex = args.findIndex(isPlaywrightMcpPackage);
  if (packageIndex >= 0 && /^npx(?:\.cmd)?$/i.test(server.command.trim())) {
    return args.filter((arg, index) => {
      if (index === packageIndex) return false;
      return arg !== "-y" && arg !== "--yes";
    });
  }

  if (isLegacyPlaywrightDraft(server)) {
    return [];
  }

  return null;
}

function getCommandBasename(command: string) {
  return path.basename(command.trim()).toLowerCase();
}

function isInterpreterLikeCommand(command: string) {
  const normalized = command.trim();
  if (!normalized) return false;

  if (normalized === process.execPath) {
    return true;
  }

  return [
    "node",
    "node.exe",
    "npx",
    "npx.cmd",
    "npm",
    "npm.cmd",
    "pnpm",
    "pnpm.cmd",
    "yarn",
    "yarn.cmd",
    "python",
    "python.exe",
    "py",
    "py.exe",
    "bun",
    "bun.exe",
  ].includes(getCommandBasename(normalized));
}

function hasUsableRemoteUrl(server: McpServerConfig) {
  const rawUrl = server.url.trim();
  if (!rawUrl) return false;

  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasUsableLocalCommand(server: McpServerConfig) {
  const command = server.command.trim();
  if (!command) return false;

  const args = server.args.filter(Boolean);
  if (args.length > 0) {
    return true;
  }

  return !isInterpreterLikeCommand(command);
}

function shouldIncludeMcpServerInRuntime(server: McpServerConfig) {
  if (!server.enabled) {
    return false;
  }

  if (server.transport === "remote") {
    return hasUsableRemoteUrl(server);
  }

  return hasUsableLocalCommand(server) || Boolean(getPlaywrightMcpExtraArgs(server));
}

function getRuntimeMcpServers(config: AppConfig) {
  return config.mcpServers.filter(shouldIncludeMcpServerInRuntime);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string) {
  try {
    await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function resolveOpencodeCommand() {
  const configuredPath = process.env.OPENCODE_PATH?.trim();
  if (configuredPath) {
    if (await fileExists(configuredPath)) {
      return configuredPath;
    }
    throw new Error(`OPENCODE_PATH points to a missing executable: ${configuredPath}`);
  }

  for (const candidate of getBundledOpencodeCandidates()) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  for (const candidate of SYSTEM_OPENCODE_COMMAND_CANDIDATES) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "OpenCode executable not found.",
      `Checked bundled paths: ${getBundledOpencodeCandidates().join(", ") || "(none)"}`,
      "Install OpenCode so `opencode` is available on PATH, or set OPENCODE_PATH to the executable.",
    ].join("\n"),
  );
}

async function runInstaller(command: string, args: string[], cwd: string) {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Failed to install Playwright MCP (exit ${code}).\n${output}`));
    });
  });
}

async function ensurePlaywrightMcpCli(configDir: string) {
  const installDir = path.join(configDir, "vendor", "playwright-mcp");
  const cliPath = path.join(installDir, "node_modules", "@playwright", "mcp", "cli.js");
  if (await fileExists(cliPath)) {
    return cliPath;
  }

  await mkdir(installDir, { recursive: true });

  if (process.platform === "win32") {
    await runInstaller(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd", "install", "--prefix", installDir, "@playwright/mcp@latest"], process.cwd());
  } else {
    await runInstaller("npm", ["install", "--prefix", installDir, "@playwright/mcp@latest"], process.cwd());
  }

  if (!(await fileExists(cliPath))) {
    throw new Error("Playwright MCP installation finished, but cli.js was not found.");
  }

  return cliPath;
}

async function resolveMcpServers(servers: McpServerConfig[], configDir: string) {
  const resolvedServers: McpServerConfig[] = [];

  for (const server of servers) {
    const playwrightArgs = getPlaywrightMcpExtraArgs(server);
    if (playwrightArgs) {
      const cliPath = await ensurePlaywrightMcpCli(configDir);
      resolvedServers.push({
        ...server,
        command: getNodeCommand(),
        args: [cliPath, ...playwrightArgs],
      });
      continue;
    }

    resolvedServers.push(server);
  }

  return resolvedServers;
}

function buildRuntimeConfig(
  config: AppConfig,
  resolvedMcpServers: McpServerConfig[] = getRuntimeMcpServers(config),
): JsonObject {
  const active = pickActiveModel(config);
  const activeModelRef = buildModelRef(config);
  const provider: Record<string, JsonObject> = {};

  for (const item of config.modelProviders) {
    const providerID = buildProviderId(item.id);
    provider[providerID] = {
      name: item.name || item.id,
      npm: "@ai-sdk/openai-compatible",
      options: {
        apiKey: item.apiKey || undefined,
        baseURL: item.baseUrl || undefined,
      },
      models: Object.fromEntries(
        item.models.map((model) => [
          model.id,
          {
            id: model.id,
            name: model.label || model.id,
            attachment: true,
            reasoning: true,
            temperature: true,
            tool_call: true,
            limit: {
              context: 200_000,
              output: withDefault(item.maxTokens, 4096),
            },
            modalities: {
              input: ["text", "image", "pdf"],
              output: ["text"],
            },
            status: "beta",
            release_date: "",
          },
        ]),
      ),
    };
  }

  const mcp: Record<string, JsonObject> = {};
  for (const server of resolvedMcpServers) {
    const key = sanitizeId(server.name || server.id);
    if ((server.transport ?? "local") === "remote") {
      mcp[key] = {
        type: "remote",
        url: server.url || "",
        enabled: server.enabled,
        timeout: server.timeoutMs || undefined,
        headers: parseJsonRecord(server.headersJson),
      };
      continue;
    }

    const command = [server.command, ...server.args].filter(Boolean);
    if (command.length === 0) continue;
    mcp[key] = {
      type: "local",
      command,
      enabled: server.enabled,
      timeout: server.timeoutMs || undefined,
      environment: parseJsonRecord(server.envJson),
    };
  }

  return {
    model: activeModelRef ? `${activeModelRef.providerID}/${activeModelRef.modelID}` : undefined,
    small_model: activeModelRef ? `${activeModelRef.providerID}/${activeModelRef.modelID}` : undefined,
    default_agent: "build",
    permission: {
      "*": "allow",
    },
    provider,
    mcp,
    agent: active
      ? {
          build: {
            model: `${activeModelRef!.providerID}/${activeModelRef!.modelID}`,
            temperature: active.provider.temperature,
          },
          plan: {
            model: `${activeModelRef!.providerID}/${activeModelRef!.modelID}`,
            temperature: active.provider.temperature,
          },
          general: {
            model: `${activeModelRef!.providerID}/${activeModelRef!.modelID}`,
            temperature: active.provider.temperature,
          },
          summary: {
            model: `${activeModelRef!.providerID}/${activeModelRef!.modelID}`,
            temperature: Math.min(active.provider.temperature, 0.2),
          },
          title: {
            model: `${activeModelRef!.providerID}/${activeModelRef!.modelID}`,
            temperature: 0.1,
          },
          compaction: {
            model: `${activeModelRef!.providerID}/${activeModelRef!.modelID}`,
            temperature: active.provider.temperature,
          },
        }
      : undefined,
  };
}

function parseJsonRecord(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function makeSpawnEnv(config: AppConfig, configDir: string, resolvedMcpServers: McpServerConfig[]) {
  return {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildRuntimeConfig(config, resolvedMcpServers)),
    OPENCODE_CONFIG_DIR: configDir,
    HTTP_PROXY: config.proxy.http || process.env.HTTP_PROXY,
    HTTPS_PROXY: config.proxy.https || process.env.HTTPS_PROXY,
    NO_PROXY: config.proxy.bypass || process.env.NO_PROXY,
    http_proxy: config.proxy.http || process.env.http_proxy,
    https_proxy: config.proxy.https || process.env.https_proxy,
    no_proxy: config.proxy.bypass || process.env.no_proxy,
  };
}

function getGeneratedConfigDir() {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), ".config");
  return resolveGeneratedConfigDir(appDataRoot);
}

function buildGeneratedCommand(skill: AppConfig["skills"][number]) {
  return `---\ndescription: ${skill.description}\nagent: build\n---\n\n${skill.command.trim()}\n`;
}

async function syncGeneratedCommands(config: AppConfig) {
  const configDir = getGeneratedConfigDir();
  const commandsDir = path.join(configDir, "commands");
  await mkdir(commandsDir, { recursive: true });

  const existing = await readdir(commandsDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    existing
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => rm(path.join(commandsDir, entry.name), { force: true })),
  );

  const enabledSkills = config.skills.filter(
    (skill) => skill.kind === "command" && skill.enabled !== false && skill.command.trim(),
  );
  await Promise.all(
    enabledSkills.map((skill) =>
      writeFile(
        path.join(commandsDir, `${sanitizeId(skill.name || skill.id)}.md`),
        buildGeneratedCommand(skill),
        "utf8",
      ),
    ),
  );

  return configDir;
}

function makeSignature(config: AppConfig) {
  return JSON.stringify({
    bridgeUrl: config.bridgeUrl,
    proxy: config.proxy,
    runtime: buildRuntimeConfig(config, getRuntimeMcpServers(config)),
    skills: config.skills,
    mcp: getRuntimeMcpServers(config),
  });
}

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate a local port for opencode."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function killProcessTree(handle: RuntimeHandle | null) {
  if (!handle?.process || handle.process.killed) return;

  if (process.platform === "win32" && handle.process.pid) {
    await execFileAsync("taskkill", ["/pid", String(handle.process.pid), "/T", "/F"]).catch(() => undefined);
    return;
  }

  handle.process.kill("SIGTERM");
}

function extractErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text) as {
      data?: { message?: string };
      error?: { message?: string };
      errors?: Array<{ message?: string }>;
      message?: string;
    };
    return (
      parsed.data?.message ??
      parsed.error?.message ??
      parsed.errors?.[0]?.message ??
      parsed.message ??
      text
    );
  } catch {
    return text;
  }
}

function shouldRetryAfterFetchFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const cause = (error as Error & { cause?: { code?: string } }).cause;
  const code = typeof cause?.code === "string" ? cause.code : "";
  return ["ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"].includes(code) || error.name === "TypeError";
}

function makeFilePart(file: FileDropEntry) {
  if (file.url) {
    return {
      type: "file" as const,
      mime: file.mimeType,
      filename: file.name,
      url: file.url,
    };
  }

  if (file.dataUrl) {
    return {
      type: "file" as const,
      mime: file.mimeType,
      filename: file.name,
      url: file.dataUrl,
    };
  }

  if (file.path && path.isAbsolute(file.path)) {
    return {
      type: "file" as const,
      mime: file.mimeType,
      filename: file.name,
      url: pathToFileURL(file.path).href,
    };
  }

  if (file.content) {
    const encoded = Buffer.from(file.content, "utf8").toString("base64");
    return {
      type: "file" as const,
      mime: file.mimeType,
      filename: file.name,
      url: `data:${file.mimeType};base64,${encoded}`,
    };
  }

  return null;
}

export class OpencodeRuntime {
  private handle: RuntimeHandle | null = null;

  async dispose() {
    await killProcessTree(this.handle);
    this.handle = null;
  }

  private async ensureStarted(config: AppConfig) {
    const bridgeUrl = config.bridgeUrl.trim();
    const signature = makeSignature(config);

    if (bridgeUrl) {
      if (this.handle?.external && this.handle.baseUrl === normalizeUrl(bridgeUrl)) {
        return this.handle.baseUrl;
      }
      await this.dispose();
      this.handle = {
        baseUrl: normalizeUrl(bridgeUrl),
        signature,
        process: null,
        external: true,
      };
      return this.handle.baseUrl;
    }

    if (this.handle && !this.handle.external && this.handle.signature === signature && this.handle.process && !this.handle.process.killed) {
      return this.handle.baseUrl;
    }

    await this.dispose();

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const configDir = await syncGeneratedCommands(config);
    const runtimeMcpServers = getRuntimeMcpServers(config);
    const resolvedMcpServers = await resolveMcpServers(runtimeMcpServers, configDir);
    const env = makeSpawnEnv(config, configDir, resolvedMcpServers);
    const args = ["serve", `--hostname=127.0.0.1`, `--port=${port}`];
    const command = await resolveOpencodeCommand();
    const commandArgs = args;

    const child = spawn(command, commandArgs, {
      env,
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.handle = {
      baseUrl,
      signature,
      process: child,
      external: false,
    };

    child.once("exit", () => {
      if (this.handle?.process === child) {
        this.handle = null;
      }
    });

    let output = "";
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out starting opencode server.\n${output}`));
      }, 20_000);

      const check = () => {
        if (output.includes("opencode server listening")) {
          clearTimeout(timer);
          resolve();
        }
      };

      child.stdout?.on("data", check);
      child.stderr?.on("data", check);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`opencode server exited early with code ${code}.\n${output}`));
      });
      check();
    });

    return baseUrl;
  }

  private buildUrl(
    baseUrl: string,
    input: AppConfig,
    route: string,
    query?: Record<string, string | number | undefined>,
    directoryOverride?: string | null,
  ) {
    const url = new URL(route, `${baseUrl}/`);
    const directory = directoryOverride === undefined ? input.opencodeRoot.trim() : directoryOverride?.trim() || "";
    if (directory) {
      url.searchParams.set("directory", directory);
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async request<T>(
    input: AppConfig,
    route: string,
    init?: RequestInit,
    query?: Record<string, string | number | undefined>,
    directoryOverride?: string | null,
    attempt = 0,
  ) {
    const baseUrl = await this.ensureStarted(input);
    const url = this.buildUrl(baseUrl, input, route, query, directoryOverride);
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt === 0 && shouldRetryAfterFetchFailure(error)) {
        await this.dispose();
        return await this.request(input, route, init, query, directoryOverride, attempt + 1);
      }
      throw error;
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(extractErrorMessage(text) || `opencode request failed: ${response.status}`);
    }

    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  listSessions(config: AppConfig) {
    return this.request<OpencodeSessionInfo[]>(config, "/session", undefined, undefined, null);
  }

  getSession(config: AppConfig, sessionID: string) {
    return this.request<OpencodeSessionInfo>(config, `/session/${sessionID}`, undefined, undefined, null);
  }

  listMessages(config: AppConfig, sessionID: string) {
    return this.request<OpencodeSessionMessage[]>(config, `/session/${sessionID}/message`, undefined, undefined, null);
  }

  createSession(config: AppConfig, title?: string) {
    return this.request<OpencodeSessionInfo>(
      config,
      "/session",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title?.trim() || undefined,
          permission: [
            {
              permission: "*",
              pattern: "*",
              action: "allow",
            },
          ],
        }),
      },
    );
  }

  deleteSession(config: AppConfig, sessionID: string) {
    return this.request<boolean>(config, `/session/${sessionID}`, {
      method: "DELETE",
    }, undefined, null);
  }

  async prompt(config: AppConfig, sessionID: string, message: string, attachments: FileDropEntry[]) {
    const model = buildModelRef(config);
    const parts = [
      {
        type: "text" as const,
        text: message,
      },
      ...attachments.map(makeFilePart).filter(Boolean),
    ];

    return await this.request<OpencodeSessionMessage>(config, `/session/${sessionID}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent: "build",
        model,
        parts,
      }),
    });
  }

  async command(config: AppConfig, sessionID: string, command: string, argumentsText: string, attachments: FileDropEntry[]) {
    const active = buildModelRef(config);
    return await this.request<OpencodeSessionMessage>(config, `/session/${sessionID}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command,
        arguments: argumentsText,
        model: active ? `${active.providerID}/${active.modelID}` : undefined,
        parts: attachments.map(makeFilePart).filter(Boolean),
      }),
    });
  }

  async listSkills(config: AppConfig): Promise<RuntimeSkill[]> {
    const skills = await this.request<Array<{ name: string; description: string; location: string; content: string }>>(config, "/skill");
    return skills.map((item) => ({
      id: item.name,
      name: item.name,
      description: item.description,
      location: item.location,
      content: item.content,
    }));
  }

  async listAgents(config: AppConfig): Promise<RuntimeAgent[]> {
    const agents = await this.request<Array<{ name: string; description?: string; mode: RuntimeAgent["mode"]; model?: { providerID: string; modelID: string } }>>(config, "/agent");
    return agents.map((item) => ({
      name: item.name,
      description: item.description,
      mode: item.mode,
      modelLabel: item.model ? `${item.model.providerID}/${item.model.modelID}` : undefined,
    }));
  }

  async listMcpStatuses(config: AppConfig): Promise<McpServerStatus[]> {
    const statuses = await this.request<Record<string, { status: McpServerStatus["status"]; error?: string }>>(config, "/mcp");
    return Object.entries(statuses).map(([name, status]) => ({
      name,
      status: status.status,
      error: status.error,
    }));
  }
}

export type { OpencodeFilePart, OpencodeToolPart };
