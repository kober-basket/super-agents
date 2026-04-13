import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type {
  McpInspectInput,
  McpInspectorTransport,
  McpServerConfig,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  McpToolInfo,
  McpToolParameter,
} from "../src/types";
import { resolveOpencodeConfigDir } from "./app-identity";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDERR_LENGTH = 20_000;
const CLIENT_INFO = {
  name: "super-agents-mcp-inspector",
  version: "0.1.0",
};

type JsonRecord = Record<string, unknown>;
type ChunkDecoder = (chunk: Buffer | string) => string;

type ConnectionHandle = {
  client: Client;
  transport: { close: () => Promise<void> };
  transportType: McpInspectorTransport;
  readStderr: () => string;
};

function normalizeServerName(server: Pick<McpServerConfig, "id" | "name">) {
  return server.name.trim() || server.id;
}

function normalizeTimeout(timeoutMs?: number) {
  return Math.max(1_000, timeoutMs || DEFAULT_TIMEOUT_MS);
}

function createChunkDecoder(): ChunkDecoder {
  if (process.platform !== "win32") {
    return (chunk) => (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  const decoder = new TextDecoder("gbk", { fatal: false });
  return (chunk) => {
    if (typeof chunk === "string") return chunk;
    try {
      return decoder.decode(chunk, { stream: true });
    } catch {
      return chunk.toString("utf8");
    }
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(input: string, label: string) {
  const trimmed = input.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} 必须是合法的 JSON 对象`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  ) as Record<string, string>;
}

function parseArgumentsJson(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("调试参数必须是合法的 JSON 对象");
  }

  if (!isRecord(parsed)) {
    throw new Error("调试参数必须是 JSON 对象");
  }

  return parsed;
}

function describeSchema(schema: unknown): string {
  if (!isRecord(schema)) return "unknown";

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `enum(${schema.enum.map((value) => JSON.stringify(value)).join(", ")})`;
  }

  const type = schema.type;
  if (Array.isArray(type) && type.length > 0) {
    return type.join(" | ");
  }

  if (typeof type === "string") {
    if (type === "array" && schema.items) {
      return `array<${describeSchema(schema.items)}>`;
    }
    return type;
  }

  const unions = [schema.anyOf, schema.oneOf]
    .filter(Array.isArray)
    .flat()
    .map((item) => describeSchema(item))
    .filter(Boolean);

  if (unions.length > 0) {
    return Array.from(new Set(unions)).join(" | ");
  }

  if (schema.properties && isRecord(schema.properties)) return "object";
  if (schema.items) return "array";
  return "unknown";
}

function extractParameters(schema: unknown): McpToolParameter[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );

  return Object.entries(schema.properties)
    .map(([name, value]) => {
      const property = isRecord(value) ? value : {};
      return {
        name,
        type: describeSchema(property),
        required: required.has(name),
        description:
          typeof property.description === "string" && property.description.trim()
            ? property.description.trim()
            : undefined,
        schema: property,
      } satisfies McpToolParameter;
    })
    .sort((left, right) => {
      if (left.required !== right.required) {
        return Number(right.required) - Number(left.required);
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
}

function mapToolInfo(server: McpServerConfig, tool: Record<string, unknown>): McpToolInfo {
  const inputSchema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
  const execution = isRecord(tool.execution) ? tool.execution : {};

  return {
    serverId: server.id,
    serverName: normalizeServerName(server),
    name: String(tool.name ?? ""),
    title: typeof tool.title === "string" ? tool.title : undefined,
    description: typeof tool.description === "string" ? tool.description : undefined,
    taskSupport:
      execution.taskSupport === "optional" ||
      execution.taskSupport === "required" ||
      execution.taskSupport === "forbidden"
        ? execution.taskSupport
        : undefined,
    inputSchema,
    parameters: extractParameters(inputSchema),
  };
}

function stringifyJson(value: unknown) {
  if (value === undefined) return "";

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeContent(content: unknown) {
  if (!Array.isArray(content) || content.length === 0) {
    return "";
  }

  return content
    .map((item) => {
      if (!isRecord(item)) {
        return stringifyJson(item);
      }

      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }

      if (item.type === "resource" && isRecord(item.resource) && typeof item.resource.text === "string") {
        return item.resource.text;
      }

      return stringifyJson(item);
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function appendStderr(buffer: { value: string }, chunk: string) {
  buffer.value = `${buffer.value}${chunk}`;
  if (buffer.value.length > MAX_STDERR_LENGTH) {
    buffer.value = buffer.value.slice(-MAX_STDERR_LENGTH);
  }
}

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

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runInstaller(command: string, args: string[], cwd: string) {
  return await new Promise<void>((resolve, reject) => {
    const decode = createChunkDecoder();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += decode(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += decode(chunk);
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Playwright MCP 安装失败（exit ${code}）。\n${output}`));
    });
  });
}

function getGeneratedConfigDir() {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), ".config");
  return resolveOpencodeConfigDir(appDataRoot);
}

async function ensurePlaywrightMcpCli() {
  const configDir = getGeneratedConfigDir();
  const installDir = path.join(configDir, "vendor", "playwright-mcp");
  const cliPath = path.join(installDir, "node_modules", "@playwright", "mcp", "cli.js");
  if (await fileExists(cliPath)) {
    return cliPath;
  }

  await mkdir(installDir, { recursive: true });

  if (process.platform === "win32") {
    await runInstaller(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "npm.cmd", "install", "--prefix", installDir, "@playwright/mcp@latest"],
      process.cwd(),
    );
  } else {
    await runInstaller("npm", ["install", "--prefix", installDir, "@playwright/mcp@latest"], process.cwd());
  }

  if (!(await fileExists(cliPath))) {
    throw new Error("Playwright MCP 安装完成，但没有找到 cli.js。");
  }

  return cliPath;
}

async function resolveLocalServer(server: McpServerConfig) {
  const playwrightArgs = getPlaywrightMcpExtraArgs(server);
  if (!playwrightArgs) {
    return server;
  }

  const cliPath = await ensurePlaywrightMcpCli();
  return {
    ...server,
    command: getNodeCommand(),
    args: [cliPath, ...playwrightArgs],
  } satisfies McpServerConfig;
}

function getCommandBasename(command: string) {
  return path.basename(command.trim()).toLowerCase();
}

function normalizeLocalCommand(command: string) {
  const trimmed = command.trim();
  if (process.platform !== "win32") return trimmed;

  const basename = getCommandBasename(trimmed);
  if (["npm", "npx", "pnpm", "yarn"].includes(basename)) {
    return `${trimmed}.cmd`;
  }

  return trimmed;
}

function isInterpreterLikeCommand(command: string) {
  const normalized = command.trim();
  if (!normalized) return false;

  if (isNodeExecutablePath(normalized)) {
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

function formatCommandPreview(command: string, args: string[]) {
  return [command.trim(), ...args.filter(Boolean)].join(" ").trim();
}

function buildLocalServerError(server: McpServerConfig, stderr: string, fallback: string) {
  const commandPreview = formatCommandPreview(server.command, server.args);
  const details = (stderr || fallback).trim();
  const lowerDetails = details.toLowerCase();

  if (
    lowerDetails.includes("enoent") ||
    lowerDetails.includes("not recognized") ||
    lowerDetails.includes("不是内部或外部命令")
  ) {
    return new Error(
      [
        "未找到本地 MCP 启动命令，请检查 Node.js/npm 是否已安装，并确认命令在 PATH 中可用。",
        commandPreview ? `命令: ${commandPreview}` : "",
        details,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return new Error(
    [
      "stdio MCP 启动失败，请检查命令和参数。",
      commandPreview ? `命令: ${commandPreview}` : "",
      details,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function connectWithServer(input: McpInspectInput): Promise<ConnectionHandle> {
  const { server, workspaceRoot } = input;
  if (!server.enabled) {
    throw new Error("请先启用 MCP 服务，再获取工具列表。");
  }

  const client = new Client(CLIENT_INFO);
  const stderrBuffer = { value: "" };

  if (server.transport === "local") {
    const resolvedServer = await resolveLocalServer(server);

    if (!resolvedServer.command.trim()) {
      throw new Error("stdio 模式需要填写启动命令。");
    }

    if (resolvedServer.args.filter(Boolean).length === 0 && isInterpreterLikeCommand(resolvedServer.command)) {
      throw new Error("stdio 模式缺少参数。当前命令像解释器或包管理器，请补充脚本路径、包名或启动参数。");
    }

    const decodeStderr = createChunkDecoder();
    const transport = new StdioClientTransport({
      command: normalizeLocalCommand(resolvedServer.command),
      args: resolvedServer.args.filter(Boolean),
      env: parseJsonRecord(resolvedServer.envJson, "环境变量"),
      stderr: "pipe",
      cwd: workspaceRoot?.trim() || undefined,
    });

    transport.stderr?.on("data", (chunk) => appendStderr(stderrBuffer, decodeStderr(chunk)));

    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close().catch(() => undefined);
      const fallback = error instanceof Error ? error.message : String(error);
      throw buildLocalServerError(resolvedServer, stderrBuffer.value.trim(), fallback);
    }

    return {
      client,
      transport,
      transportType: "stdio",
      readStderr: () => stderrBuffer.value.trim(),
    };
  }

  if (!server.url.trim()) {
    throw new Error("远程模式需要填写 MCP 地址。");
  }

  const url = new URL(server.url.trim());
  const headers = parseJsonRecord(server.headersJson, "请求头");
  const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;

  const streamableTransport = new StreamableHTTPClientTransport(url, {
    requestInit,
  });

  try {
    await client.connect(streamableTransport);
    return {
      client,
      transport: streamableTransport,
      transportType: "streamable-http",
      readStderr: () => "",
    };
  } catch (error) {
    await streamableTransport.close().catch(() => undefined);

    const fallbackClient = new Client(CLIENT_INFO);
    const sseTransport = new SSEClientTransport(url, {
      requestInit,
      eventSourceInit: requestInit ? { headers } : undefined,
    });

    await fallbackClient.connect(sseTransport).catch((sseError) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      const fallbackMessage = sseError instanceof Error && sseError.message ? sseError.message : String(sseError);

      throw new Error(`远程 MCP 连接失败。Streamable HTTP: ${message}；SSE: ${fallbackMessage}`);
    });

    return {
      client: fallbackClient,
      transport: sseTransport,
      transportType: "sse",
      readStderr: () => "",
    };
  }
}

async function withConnection<T>(
  input: McpInspectInput,
  run: (connection: ConnectionHandle) => Promise<T>,
) {
  const connection = await connectWithServer(input);
  try {
    return await run(connection);
  } finally {
    await connection.transport.close().catch(() => undefined);
  }
}

async function listAllTools(client: Client, timeout: number) {
  const tools: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;

  for (let page = 0; page < 100; page += 1) {
    const result = await client.listTools(cursor ? { cursor } : undefined, { timeout });
    tools.push(...(result.tools as Array<Record<string, unknown>>));
    if (!result.nextCursor) {
      break;
    }
    cursor = result.nextCursor;
  }

  return tools;
}

async function callToolWithTaskFallback(
  client: Client,
  toolName: string,
  args: JsonRecord,
  timeout: number,
) {
  try {
    return {
      result: await client.callTool(
        {
          name: toolName,
          arguments: args,
        },
        undefined,
        {
          timeout,
          maxTotalTimeout: timeout,
        },
      ),
      taskLog: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("task-based execution")) {
      throw error;
    }

    let finalResult: Record<string, unknown> | null = null;
    const taskLog: string[] = [];
    const stream = client.experimental.tasks.callToolStream(
      {
        name: toolName,
        arguments: args,
      },
      undefined,
      {
        timeout,
        maxTotalTimeout: timeout,
        task: {
          ttl: timeout,
          pollInterval: 1_000,
        },
      },
    );

    for await (const messagePart of stream) {
      if (messagePart.type === "taskCreated") {
        taskLog.push(`taskCreated: ${messagePart.task.taskId}`);
        continue;
      }

      if (messagePart.type === "taskStatus") {
        taskLog.push(`taskStatus: ${messagePart.task.status}`);
        continue;
      }

      if (messagePart.type === "result") {
        finalResult = messagePart.result as Record<string, unknown>;
        continue;
      }

      if (messagePart.type === "error") {
        throw new Error(String(messagePart.error));
      }
    }

    if (!finalResult) {
      throw new Error("任务型 MCP 工具没有返回结果");
    }

    return {
      result: finalResult,
      taskLog: taskLog.join("\n"),
    };
  }
}

export class McpInspector {
  async inspectServer(input: McpInspectInput): Promise<McpServerToolsResult> {
    return await withConnection(input, async (connection) => {
      const timeout = normalizeTimeout(input.server.timeoutMs);
      const tools = await listAllTools(connection.client, timeout);

      return {
        serverId: input.server.id,
        serverName: normalizeServerName(input.server),
        fetchedAt: Date.now(),
        transport: connection.transportType,
        tools: tools.map((tool) => mapToolInfo(input.server, tool)),
        stderr: connection.readStderr() || undefined,
      };
    });
  }

  async debugTool(input: McpToolDebugInput): Promise<McpToolDebugResult> {
    return await withConnection(input, async (connection) => {
      const timeout = normalizeTimeout(input.server.timeoutMs);
      const args = parseArgumentsJson(input.argumentsJson);
      const { result, taskLog } = await callToolWithTaskFallback(connection.client, input.toolName, args, timeout);

      return {
        serverId: input.server.id,
        serverName: normalizeServerName(input.server),
        toolName: input.toolName,
        invokedAt: Date.now(),
        transport: connection.transportType,
        isError: result.isError === true,
        content: summarizeContent(result.content),
        structuredContentJson: stringifyJson(result.structuredContent),
        rawJson: stringifyJson(result),
        stderr: connection.readStderr() || undefined,
        taskLog: taskLog || undefined,
      };
    });
  }
}
