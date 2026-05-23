import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { ToolPermissionDeniedError } from "./types";
import type { ToolContext, ToolDefinition } from "./types";
import { createInteractionToolDefinitions } from "./builtin-tools/interaction-tools";
import { createMemoryToolDefinition, type MemoryToolStore } from "./builtin-tools/memory-tool";
import { createTodoToolDefinitions } from "./builtin-tools/todo-tools";
import { createRuntimeProcessEnv } from "../runtime-support";

const MAX_READ_BYTES = 220_000;
const MAX_WRITE_BYTES = 500_000;
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 80;
const MAX_GLOB_RESULTS = 100;
const MAX_SHELL_OUTPUT_BYTES = 60_000;
const DEFAULT_SHELL_TIMEOUT_MS = 20_000;
const MAX_WEB_FETCH_BYTES = 220_000;
const DEFAULT_WEB_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_WEB_SEARCH_LIMIT = 5;
const MAX_WEB_SEARCH_LIMIT = 10;
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 15_000;
const MAX_WEB_SEARCH_BYTES = 220_000;
const MAX_NODE_SEARCH_FILES = 20_000;
const MAX_NODE_SEARCH_FILE_BYTES = 1_000_000;
const NODE_SEARCH_SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules",
  "release",
]);

let cachedWindowsShellEncoding: string | undefined;

interface TextEdit {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

interface PatchOperation {
  type: "add" | "delete" | "update";
  filePath: string;
  moveTo?: string;
  lines: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringInput(input: unknown, key: string, fallback = "") {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "string" ? value : fallback;
}

function numberInput(input: unknown, key: string, fallback: number) {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanInput(input: unknown, key: string, fallback = false) {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function arrayInput(input: unknown, key: string): unknown[] {
  if (!isRecord(input)) return [];
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

function isRelativeWorkspacePathInput(input: unknown, key = "path") {
  if (!isRecord(input)) return true;
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) return true;
  return !path.isAbsolute(value);
}

function normalizeTextEdits(input: unknown): TextEdit[] {
  const edits = arrayInput(input, "edits");
  if (edits.length === 0) {
    throw new Error("edits must contain at least one edit.");
  }

  return edits.map((edit, index) => {
    if (!isRecord(edit)) {
      throw new Error(`edits[${index}] must be an object.`);
    }
    const oldString = typeof edit.oldString === "string" ? edit.oldString : "";
    const newString = typeof edit.newString === "string" ? edit.newString : "";
    if (!oldString) {
      throw new Error(`edits[${index}].oldString is required.`);
    }
    if (oldString === newString) {
      throw new Error(`edits[${index}].oldString and newString must be different.`);
    }
    return {
      oldString,
      newString,
      replaceAll: edit.replaceAll === true,
    };
  });
}

function applyTextEdit(content: string, edit: TextEdit) {
  const occurrences = content.split(edit.oldString).length - 1;
  if (occurrences === 0) {
    throw new Error("oldString was not found in the file.");
  }
  return {
    content: edit.replaceAll ? content.split(edit.oldString).join(edit.newString) : content.replace(edit.oldString, edit.newString),
    replacements: edit.replaceAll ? occurrences : 1,
  };
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "*** Begin Patch") {
    throw new Error("Patch must start with *** Begin Patch.");
  }
  if (lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  if (lines.at(-1)?.trim() !== "*** End Patch") {
    throw new Error("Patch must end with *** End Patch.");
  }

  const operations: PatchOperation[] = [];
  let current: PatchOperation | null = null;
  const headerPattern = /^\*\*\* (Add|Delete|Update) File: (.+)$/;

  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index];
    const header = line.match(headerPattern);
    if (header) {
      current = {
        type: header[1].toLowerCase() as PatchOperation["type"],
        filePath: header[2].trim(),
        lines: [],
      };
      if (!current.filePath) {
        throw new Error("Patch file path is required.");
      }
      operations.push(current);
      continue;
    }

    if (!current) {
      throw new Error(`Unexpected patch line before file header: ${line}`);
    }

    if (current.type === "update" && line.startsWith("*** Move to: ")) {
      current.moveTo = line.slice("*** Move to: ".length).trim();
      if (!current.moveTo) {
        throw new Error("Move target is required.");
      }
      continue;
    }

    current.lines.push(line);
  }

  if (operations.length === 0) {
    throw new Error("Patch must contain at least one file operation.");
  }
  return operations;
}

function applyPatchUpdate(currentContent: string, hunkLines: string[]) {
  const source = currentContent.split("\n");
  const output: string[] = [];
  let cursor = 0;
  let sawChange = false;

  for (const line of hunkLines) {
    if (line.startsWith("@@")) {
      continue;
    }
    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "+") {
      output.push(value);
      sawChange = true;
      continue;
    }
    if (prefix !== " " && prefix !== "-") {
      throw new Error(`Unsupported update patch line: ${line}`);
    }
    const index = source.indexOf(value, cursor);
    if (index < 0) {
      throw new Error(`Patch context was not found: ${value}`);
    }
    output.push(...source.slice(cursor, index));
    if (prefix === " ") {
      output.push(source[index]);
    } else {
      sawChange = true;
    }
    cursor = index + 1;
  }

  if (!sawChange) {
    throw new Error("Update patch did not contain any changes.");
  }
  output.push(...source.slice(cursor));
  return output.join("\n");
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

function extractHtmlAttribute(tag: string, attribute: string) {
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function normalizeSearchResultUrl(value: string) {
  if (!value.trim()) {
    return "";
  }

  const absoluteValue = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(absoluteValue, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    if (redirected) {
      return redirected;
    }
    return url.toString();
  } catch {
    return decodeHtmlEntities(value);
  }
}

function isDuckDuckGoAdUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith("duckduckgo.com") && (
      url.pathname === "/y.js" ||
      url.searchParams.has("ad_domain") ||
      url.searchParams.has("ad_provider") ||
      url.searchParams.has("ad_type")
    );
  } catch {
    return false;
  }
}

function parseDuckDuckGoSearchResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seenUrls = new Set<string>();
  const linkPattern = /<a\b[^>]*class=(?:"[^"]*\bresult__a\b[^"]*"|'[^']*\bresult__a\b[^']*')[^>]*>[\s\S]*?<\/a>/gi;
  const matches = Array.from(html.matchAll(linkPattern));

  for (let index = 0; index < matches.length && results.length < limit; index += 1) {
    const rawLink = matches[index][0];
    const nextIndex = matches[index + 1]?.index ?? html.length;
    const windowHtml = html.slice((matches[index].index ?? 0) + rawLink.length, nextIndex);
    const url = normalizeSearchResultUrl(extractHtmlAttribute(rawLink, "href"));
    const title = decodeHtmlEntities(stripHtml(rawLink));
    const snippetMatch = windowHtml.match(
      /<(?:a|div)\b[^>]*class=(?:"[^"]*\bresult__snippet\b[^"]*"|'[^']*\bresult__snippet\b[^']*')[^>]*>[\s\S]*?<\/(?:a|div)>/i,
    );
    const snippet = snippetMatch ? decodeHtmlEntities(stripHtml(snippetMatch[0])) : "";

    if (!title || !url || seenUrls.has(url) || isDuckDuckGoAdUrl(url)) {
      continue;
    }

    seenUrls.add(url);
    results.push({ title, url, snippet });
  }

  return results;
}

async function resolveWorkspacePath(
  context: ToolContext,
  value: string,
  options: { targetKind?: "file" | "directory" } = {},
) {
  const root = path.resolve(context.workspaceRoot);
  const resolved = path.resolve(root, value || ".");
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    if (context.fullFileSystemAccess === true) {
      return { root, resolved, relative: resolved, external: true };
    }

    if (!context.requestApproval || !context.toolCall) {
      throw new Error("Path is outside the workspace root.");
    }

    const targetKind = options.targetKind ?? "directory";
    const directory = targetKind === "file" ? path.dirname(resolved) : resolved;
    const approval = await context.requestApproval({
      sessionId: context.sessionId,
      agentId: context.agentId,
      toolCall: context.toolCall,
      kind: "external_directory",
      targetPath: resolved,
      metadata: {
        directory,
        workspaceRoot: root,
      },
      reason: [
        `Tool "${context.toolCall.name}" requested access outside the project root.`,
        `Path: ${resolved}`,
        `Project root: ${root}`,
      ].join("\n"),
    });

    if (approval.type === "deny") {
      throw new ToolPermissionDeniedError(approval.reason);
    }

    return { root, resolved, relative: resolved, external: true };
  }
  return { root, resolved, relative: relative ? toPosixPath(relative) : ".", external: false };
}

function trimOutput(value: string, maxLength = 30_000) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[truncated ${value.length - maxLength} chars]`;
}

function trimOutputBytes(value: string, maxBytes: number) {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { content: value, truncated: false };
  }
  return {
    content: `${buffer.subarray(0, maxBytes).toString("utf8")}\n\n[truncated ${buffer.byteLength - maxBytes} bytes]`,
    truncated: true,
  };
}

function isPotentiallyDestructiveCommand(command: string) {
  return /\brm\s+-[^\n;|&]*[rf][^\n;|&]*[rf]/i.test(command) || /\brmdir\s+\/[^\s]*/i.test(command);
}

async function runRg(args: string[], cwd: string) {
  const env = await createRuntimeProcessEnv();
  return await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn("rg", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ stdout, stderr, code }));
  });
}

function isMissingExecutableError(error: unknown) {
  return isRecord(error) && error.code === "ENOENT";
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walkFiles(root: string, limit: number) {
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!NODE_SEARCH_SKIPPED_DIRECTORIES.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
        if (files.length >= limit) {
          break;
        }
      }
    }
  }

  return files;
}

function globPatternToRegExp(pattern: string) {
  const normalized = toPosixPath(pattern.trim()).replace(/^\.\//, "");
  let regex = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      const after = normalized[index + 2];
      if (after === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegExp(char);
  }

  return new RegExp(`^${regex}$`);
}

async function runNodeGlob(input: {
  root: string;
  searchRoot: string;
  external: boolean;
  pattern: string;
  maxResults: number;
}) {
  const matcher = globPatternToRegExp(input.pattern);
  const files = await walkFiles(input.searchRoot, MAX_NODE_SEARCH_FILES);
  const matches: string[] = [];

  for (const filePath of files) {
    const relativeToSearchRoot = toPosixPath(path.relative(input.searchRoot, filePath));
    if (!matcher.test(relativeToSearchRoot)) {
      continue;
    }
    matches.push(input.external ? filePath : toPosixPath(path.relative(input.root, filePath)));
    if (matches.length > input.maxResults) {
      break;
    }
  }

  return {
    matches: matches.slice(0, input.maxResults),
    truncated: matches.length > input.maxResults,
  };
}

function createSearchRegExp(query: string) {
  try {
    return new RegExp(query);
  } catch {
    return new RegExp(escapeRegExp(query));
  }
}

async function runNodeGrep(input: {
  root: string;
  searchRoot: string;
  external: boolean;
  query: string;
  maxResults: number;
}) {
  const matcher = createSearchRegExp(input.query);
  const files = await walkFiles(input.searchRoot, MAX_NODE_SEARCH_FILES);
  const lines: string[] = [];

  for (const filePath of files) {
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }
    if (fileStat.size > MAX_NODE_SEARCH_FILE_BYTES) {
      continue;
    }

    let text: string;
    try {
      const buffer = await readFile(filePath);
      if (buffer.includes(0)) {
        continue;
      }
      text = buffer.toString("utf8");
    } catch {
      continue;
    }

    const displayPath = input.external ? filePath : toPosixPath(path.relative(input.root, filePath));
    const fileLines = text.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < fileLines.length; lineIndex += 1) {
      const line = fileLines[lineIndex];
      const columnIndex = line.search(matcher);
      if (columnIndex < 0) {
        continue;
      }
      lines.push(`${displayPath}:${lineIndex + 1}:${columnIndex + 1}:${line}`);
      if (lines.length >= input.maxResults) {
        return { lines, truncated: true };
      }
    }
  }

  return { lines, truncated: false };
}

function supportedTextEncoding(label: string) {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

function windowsCodePageToEncoding(codePage: string) {
  switch (codePage) {
    case "65001":
      return "utf-8";
    case "936":
      return "gbk";
    case "54936":
      return "gb18030";
    case "950":
      return "big5";
    case "932":
      return "shift_jis";
    case "949":
      return "euc-kr";
    case "866":
      return "ibm866";
    case "1250":
    case "1251":
    case "1252":
    case "1253":
    case "1254":
    case "1255":
    case "1256":
    case "1257":
    case "1258":
      return `windows-${codePage}`;
    default:
      return "gbk";
  }
}

function getWindowsShellEncoding() {
  if (cachedWindowsShellEncoding) {
    return cachedWindowsShellEncoding;
  }

  let encoding = "gbk";
  try {
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "chcp"], {
      windowsHide: true,
      encoding: "buffer",
    });
    const output = Buffer.concat([
      Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from([]),
      Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from([]),
    ]).toString("ascii");
    const codePage = output.match(/(\d+)/)?.[1];
    if (codePage) {
      encoding = windowsCodePageToEncoding(codePage);
    }
  } catch {
    encoding = "gbk";
  }

  cachedWindowsShellEncoding = supportedTextEncoding(encoding) ? encoding : "utf-8";
  return cachedWindowsShellEncoding;
}

function decodeShellOutputBytes(buffer: Buffer) {
  if (buffer.length === 0) {
    return "";
  }
  if (process.platform !== "win32") {
    return buffer.toString("utf8");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder(getWindowsShellEncoding()).decode(buffer);
  }
}

async function runShellCommand(command: string, cwd: string, timeoutMs: number, maxOutputBytes: number) {
  const env = await createRuntimeProcessEnv();
  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    truncated: boolean;
  }>((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;

    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (truncated) return;
      const remainingBytes = maxOutputBytes - outputBytes;
      if (remainingBytes <= 0) {
        truncated = true;
        return;
      }
      const target = stream === "stdout" ? stdoutChunks : stderrChunks;
      if (chunk.byteLength <= remainingBytes) {
        target.push(chunk);
        outputBytes += chunk.byteLength;
        return;
      }

      target.push(chunk.subarray(0, remainingBytes));
      outputBytes += remainingBytes;
      truncated = true;
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      append("stdout", chunk);
    });
    child.stderr?.on("data", (chunk) => {
      append("stderr", chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timeout);
      const stdout = decodeShellOutputBytes(Buffer.concat(stdoutChunks));
      const stderr = decodeShellOutputBytes(Buffer.concat(stderrChunks));
      resolve({ stdout, stderr, exitCode, signal, timedOut, truncated });
    });
  });
}

export interface BuiltinToolDefinitionOptions {
  memoryStore?: MemoryToolStore | null;
}

export function createBuiltinToolDefinitions(options: BuiltinToolDefinitionOptions = {}): ToolDefinition[] {
  return [
    {
      name: "read",
      aliases: ["workspace_read_file"],
      description: "Read a UTF-8 text file. Use a project-relative path for project files or an absolute path when the user explicitly names a local file or folder.",
      risk: "read",
      isConcurrencySafe: (input) => isRelativeWorkspacePathInput(input),
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative or absolute file path." },
          maxBytes: { type: "number", description: "Maximum bytes to read. Defaults to 220000." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const target = await resolveWorkspacePath(context, stringInput(input, "path"), { targetKind: "file" });
        const maxBytes = Math.min(Math.max(1_000, numberInput(input, "maxBytes", MAX_READ_BYTES)), MAX_READ_BYTES);
        const fileStat = await stat(target.resolved);
        if (!fileStat.isFile()) {
          throw new Error("Target path is not a file.");
        }
        const buffer = await readFile(target.resolved);
        const truncated = buffer.byteLength > maxBytes;
        return {
          content: trimOutput(buffer.subarray(0, maxBytes).toString("utf8")),
          metadata: {
            path: target.relative,
            bytes: buffer.byteLength,
            truncated,
          },
        };
      },
    },
    {
      name: "list",
      aliases: ["workspace_list_directory"],
      description: "List files and folders. Use a project-relative path for project directories or an absolute path when the user explicitly names a local folder.",
      risk: "read",
      isConcurrencySafe: (input) => isRelativeWorkspacePathInput(input),
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative or absolute directory path. Defaults to the project root only when no target is specified." },
          limit: { type: "number", description: "Maximum entries to return. Defaults to 200." },
        },
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const target = await resolveWorkspacePath(context, stringInput(input, "path", "."), { targetKind: "directory" });
        const limit = Math.min(Math.max(1, numberInput(input, "limit", MAX_LIST_ENTRIES)), MAX_LIST_ENTRIES);
        const entries = await readdir(target.resolved, { withFileTypes: true });
        const lines = entries
          .slice(0, limit)
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"}\t${entry.name}`)
          .join("\n");
        return {
          content: lines || "(empty directory)",
          metadata: {
            path: target.relative,
            total: entries.length,
            returned: Math.min(entries.length, limit),
            truncated: entries.length > limit,
          },
        };
      },
    },
    {
      name: "grep",
      aliases: ["workspace_search_text"],
      description: "Search text. Uses ripgrep when available and falls back to built-in search. Use a project-relative path for project searches or an absolute path when the user explicitly names a local folder.",
      risk: "read",
      isConcurrencySafe: (input) => isRelativeWorkspacePathInput(input),
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regular expression to search for." },
          path: { type: "string", description: "Optional project-relative or absolute path to search within." },
          maxResults: { type: "number", description: "Maximum matches. Defaults to 80." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const query = stringInput(input, "query").trim();
        if (!query) {
          throw new Error("query is required.");
        }
        const target = await resolveWorkspacePath(context, stringInput(input, "path", "."), { targetKind: "directory" });
        const maxResults = Math.min(Math.max(1, numberInput(input, "maxResults", MAX_SEARCH_RESULTS)), MAX_SEARCH_RESULTS);
        let result;
        try {
          result = await runRg(
            ["--line-number", "--column", "--no-heading", "--color", "never", "--max-count", String(maxResults), query, target.relative],
            target.root,
          );
        } catch (error) {
          if (!isMissingExecutableError(error)) {
            throw error;
          }
          const fallback = await runNodeGrep({
            root: target.root,
            searchRoot: target.resolved,
            external: target.external,
            query,
            maxResults,
          });
          return {
            content: fallback.lines.length > 0 ? fallback.lines.join("\n") : "No matches.",
            metadata: {
              path: target.relative,
              maxResults,
              fallback: "node",
              truncated: fallback.truncated,
            },
          };
        }
        if (result.code !== 0 && result.code !== 1) {
          throw new Error(result.stderr.trim() || "Text search failed.");
        }
        return {
          content: trimOutput(result.stdout.trim() || "No matches."),
          metadata: {
            path: target.relative,
            maxResults,
            exitCode: result.code,
          },
        };
      },
    },
    {
      name: "glob",
      description: "Find files by glob pattern. Use a project-relative path for project searches or an absolute path when the user explicitly names a local folder.",
      risk: "read",
      isConcurrencySafe: (input) => isRelativeWorkspacePathInput(input),
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern to match, such as **/*.ts." },
          path: { type: "string", description: "Optional project-relative or absolute directory to search within. Defaults to the project root only when no target is specified." },
          maxResults: { type: "number", description: "Maximum matching files. Defaults to 100." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const pattern = stringInput(input, "pattern").trim();
        if (!pattern) {
          throw new Error("pattern is required.");
        }
        const target = await resolveWorkspacePath(context, stringInput(input, "path", "."), { targetKind: "directory" });
        const maxResults = Math.min(Math.max(1, numberInput(input, "maxResults", MAX_GLOB_RESULTS)), MAX_GLOB_RESULTS);
        let result;
        try {
          result = await runRg(
            ["--files", "--color", "never", "--glob", pattern, target.relative],
            target.root,
          );
        } catch (error) {
          if (!isMissingExecutableError(error)) {
            throw error;
          }
          const fallback = await runNodeGlob({
            root: target.root,
            searchRoot: target.resolved,
            external: target.external,
            pattern,
            maxResults,
          });
          return {
            content: fallback.matches.length > 0 ? fallback.matches.join("\n") : "No files found.",
            metadata: {
              path: target.relative,
              pattern,
              returned: fallback.matches.length,
              truncated: fallback.truncated,
              fallback: "node",
            },
          };
        }
        if (result.code !== 0 && result.code !== 1) {
          throw new Error(result.stderr.trim() || "File glob failed.");
        }
        const matches = result.stdout.trim().split(/\r?\n/).filter(Boolean);
        const returned = matches.slice(0, maxResults);
        return {
          content: returned.length > 0 ? returned.join("\n") : "No files found.",
          metadata: {
            path: target.relative,
            pattern,
            returned: returned.length,
            truncated: matches.length > returned.length,
          },
        };
      },
    },
    {
      name: "write",
      aliases: ["workspace_write_file"],
      description: "Write UTF-8 text to a file inside the current project. Creates parent directories as needed.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path." },
          content: { type: "string", description: "UTF-8 text content to write." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const target = await resolveWorkspacePath(context, stringInput(input, "path"), { targetKind: "file" });
        const content = stringInput(input, "content");
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > MAX_WRITE_BYTES) {
          throw new Error(`Content is too large to write (${bytes} bytes, max ${MAX_WRITE_BYTES}).`);
        }
        await mkdir(path.dirname(target.resolved), { recursive: true });
        await writeFile(target.resolved, content, "utf8");
        return {
          content: `Wrote ${target.relative} (${bytes} bytes).`,
          metadata: {
            path: target.relative,
            bytes,
          },
        };
      },
    },
    {
      name: "edit",
      description: "Replace text in a UTF-8 file inside the current project.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path." },
          oldString: { type: "string", description: "Exact text to replace." },
          newString: { type: "string", description: "Replacement text." },
          replaceAll: { type: "boolean", description: "Replace every occurrence. Defaults to false." },
        },
        required: ["path", "oldString", "newString"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const target = await resolveWorkspacePath(context, stringInput(input, "path"), { targetKind: "file" });
        const oldString = stringInput(input, "oldString");
        const newString = stringInput(input, "newString");
        if (!oldString) {
          throw new Error("oldString is required.");
        }
        if (oldString === newString) {
          throw new Error("oldString and newString must be different.");
        }
        const fileStat = await stat(target.resolved);
        if (!fileStat.isFile()) {
          throw new Error("Target path is not a file.");
        }
        const current = await readFile(target.resolved, "utf8");
        const occurrences = current.split(oldString).length - 1;
        if (occurrences === 0) {
          throw new Error("oldString was not found in the file.");
        }
        const replaceAll = booleanInput(input, "replaceAll");
        const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
        const bytes = Buffer.byteLength(next, "utf8");
        if (bytes > MAX_WRITE_BYTES) {
          throw new Error(`Edited content is too large to write (${bytes} bytes, max ${MAX_WRITE_BYTES}).`);
        }
        await writeFile(target.resolved, next, "utf8");
        const replacements = replaceAll ? occurrences : 1;
        return {
          content: `Edit applied to ${target.relative} (${replacements} replacement${replacements === 1 ? "" : "s"}).`,
          metadata: {
            path: target.relative,
            replacements,
            bytes,
          },
        };
      },
    },
    {
      name: "multi_edit",
      description: "Apply multiple exact string replacements to one UTF-8 file atomically.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path." },
          edits: {
            type: "array",
            description: "Ordered exact string replacements to apply to the file.",
            items: {
              type: "object",
              properties: {
                oldString: { type: "string", description: "Exact text to replace." },
                newString: { type: "string", description: "Replacement text." },
                replaceAll: { type: "boolean", description: "Replace every occurrence. Defaults to false." },
              },
              required: ["oldString", "newString"],
              additionalProperties: false,
            },
          },
        },
        required: ["path", "edits"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const target = await resolveWorkspacePath(context, stringInput(input, "path"), { targetKind: "file" });
        const edits = normalizeTextEdits(input);
        const fileStat = await stat(target.resolved);
        if (!fileStat.isFile()) {
          throw new Error("Target path is not a file.");
        }

        const original = await readFile(target.resolved, "utf8");
        let next = original;
        let replacements = 0;
        for (const edit of edits) {
          const result = applyTextEdit(next, edit);
          next = result.content;
          replacements += result.replacements;
        }

        const bytes = Buffer.byteLength(next, "utf8");
        if (bytes > MAX_WRITE_BYTES) {
          throw new Error(`Edited content is too large to write (${bytes} bytes, max ${MAX_WRITE_BYTES}).`);
        }
        await writeFile(target.resolved, next, "utf8");
        return {
          content: `Multi edit applied to ${target.relative} (${replacements} replacements).`,
          metadata: {
            path: target.relative,
            edits: edits.length,
            replacements,
            bytes,
          },
        };
      },
    },
    {
      name: "apply_patch",
      description: "Apply a Codex-style patch with add, update, delete, and optional move file operations.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description: "Patch text starting with *** Begin Patch and ending with *** End Patch.",
          },
        },
        required: ["patch"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const patch = stringInput(input, "patch");
        const operations = parsePatch(patch);
        const changedPaths: string[] = [];

        for (const operation of operations) {
          if (operation.type === "add") {
            const target = await resolveWorkspacePath(context, operation.filePath, { targetKind: "file" });
            const body = operation.lines.map((line) => {
              if (!line.startsWith("+")) {
                throw new Error(`Add file lines must start with '+': ${line}`);
              }
              return line.slice(1);
            }).join("\n");
            const content = operation.lines.length > 0 ? `${body}\n` : "";
            const bytes = Buffer.byteLength(content, "utf8");
            if (bytes > MAX_WRITE_BYTES) {
              throw new Error(`Patch content is too large to write (${bytes} bytes, max ${MAX_WRITE_BYTES}).`);
            }
            await mkdir(path.dirname(target.resolved), { recursive: true });
            await writeFile(target.resolved, content, { encoding: "utf8", flag: "wx" });
            changedPaths.push(target.relative);
            continue;
          }

          if (operation.type === "delete") {
            const target = await resolveWorkspacePath(context, operation.filePath, { targetKind: "file" });
            await rm(target.resolved);
            changedPaths.push(target.relative);
            continue;
          }

          const target = await resolveWorkspacePath(context, operation.filePath, { targetKind: "file" });
          const current = await readFile(target.resolved, "utf8");
          const next = applyPatchUpdate(current, operation.lines);
          const bytes = Buffer.byteLength(next, "utf8");
          if (bytes > MAX_WRITE_BYTES) {
            throw new Error(`Patched content is too large to write (${bytes} bytes, max ${MAX_WRITE_BYTES}).`);
          }

          if (operation.moveTo) {
            const moveTarget = await resolveWorkspacePath(context, operation.moveTo, { targetKind: "file" });
            await mkdir(path.dirname(moveTarget.resolved), { recursive: true });
            await writeFile(moveTarget.resolved, next, "utf8");
            if (moveTarget.resolved !== target.resolved) {
              await rm(target.resolved);
            }
            changedPaths.push(`${target.relative} -> ${moveTarget.relative}`);
          } else {
            await writeFile(target.resolved, next, "utf8");
            changedPaths.push(target.relative);
          }
        }

        return {
          content: `Patch applied:\n${changedPaths.join("\n")}`,
          metadata: {
            files: changedPaths,
            operations: operations.length,
          },
        };
      },
    },
    ...createInteractionToolDefinitions(),
    createMemoryToolDefinition(options.memoryStore),
    ...createTodoToolDefinitions(),
    {
      name: "web_search",
      description:
        "Search the web with a query and return result titles, URLs, and snippets. Use this for current or recent information. Use web_fetch only after you already have a specific URL.",
      risk: "network",
      isConcurrencySafe: true,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query. Required. Do not call this tool with an empty object.",
          },
          limit: {
            type: "number",
            description: `Maximum number of results to return. Defaults to ${DEFAULT_WEB_SEARCH_LIMIT}; max ${MAX_WEB_SEARCH_LIMIT}.`,
          },
          timeoutMs: {
            type: "number",
            description: `Timeout in milliseconds. Defaults to ${DEFAULT_WEB_SEARCH_TIMEOUT_MS}.`,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = stringInput(input, "query").trim();
        if (!query) {
          throw new Error('query is required. Call web_search with {"query":"search terms"}.');
        }

        const limit = Math.min(
          Math.max(1, Math.floor(numberInput(input, "limit", DEFAULT_WEB_SEARCH_LIMIT))),
          MAX_WEB_SEARCH_LIMIT,
        );
        const timeoutMs = Math.min(Math.max(1_000, numberInput(input, "timeoutMs", DEFAULT_WEB_SEARCH_TIMEOUT_MS)), 60_000);
        const searchUrl = new URL("https://duckduckgo.com/html/");
        searchUrl.searchParams.set("q", query);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(searchUrl, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
              accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "accept-language": "en-US,en;q=0.9",
              "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            },
          });
          if (!response.ok) {
            throw new Error(`Search failed with HTTP ${response.status}.`);
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const raw = buffer.subarray(0, MAX_WEB_SEARCH_BYTES).toString("utf8");
          const results = parseDuckDuckGoSearchResults(raw, limit);
          const resultText = results
            .map((result, index) =>
              [
                `${index + 1}. ${result.title}`,
                `URL: ${result.url}`,
                result.snippet ? `Snippet: ${result.snippet}` : "",
              ].filter(Boolean).join("\n"),
            )
            .join("\n\n");
          return {
            content:
              results.length > 0
                ? [
                    "Search snippets are unverified discovery leads, not confirmed facts. Fetch and verify reliable sources before using material claims.",
                    "",
                    resultText,
                  ].join("\n")
                : `No search results found for: ${query}`,
            metadata: {
              query,
              resultsCount: results.length,
              results,
              truncated: buffer.byteLength > MAX_WEB_SEARCH_BYTES,
            },
          };
        } finally {
          clearTimeout(timeout);
        }
      },
    },
    {
      name: "web_fetch",
      description:
        "Fetch a specific HTTP or HTTPS URL and return text, simplified markdown text, or HTML content. This is not a search tool; use web_search when you have a query instead of a URL.",
      risk: "network",
      isConcurrencySafe: true,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "HTTP or HTTPS URL to fetch. Required. Do not call this tool with an empty object.",
          },
          format: { type: "string", enum: ["text", "markdown", "html"], description: "Return format. Defaults to text." },
          timeoutMs: { type: "number", description: "Timeout in milliseconds. Defaults to 15000." },
          maxBytes: { type: "number", description: "Maximum bytes to return. Defaults to 220000." },
        },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const rawUrl = stringInput(input, "url").trim();
        if (!rawUrl) {
          throw new Error('url is required. Call web_fetch with {"url":"https://example.com"} or use web_search for queries.');
        }
        const url = new URL(rawUrl);
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("url must use http or https.");
        }
        const format = stringInput(input, "format", "text").toLowerCase();
        if (!["text", "markdown", "html"].includes(format)) {
          throw new Error("format must be text, markdown, or html.");
        }

        const timeoutMs = Math.min(Math.max(1_000, numberInput(input, "timeoutMs", DEFAULT_WEB_FETCH_TIMEOUT_MS)), 60_000);
        const maxBytes = Math.min(Math.max(1_000, numberInput(input, "maxBytes", MAX_WEB_FETCH_BYTES)), MAX_WEB_FETCH_BYTES);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "user-agent": "super-agents/0.1" },
          });
          const contentType = response.headers.get("content-type") ?? "";
          const buffer = Buffer.from(await response.arrayBuffer());
          if (!response.ok) {
            throw new Error(`Fetch failed with HTTP ${response.status}.`);
          }
          const truncated = buffer.byteLength > maxBytes;
          const raw = buffer.subarray(0, maxBytes).toString("utf8");
          const content = format === "html" ? raw : format === "markdown" ? stripHtml(raw) : raw;
          return {
            content: truncated ? `${content}\n\n[truncated ${buffer.byteLength - maxBytes} bytes]` : content,
            metadata: {
              url: url.toString(),
              status: response.status,
              contentType,
              bytes: buffer.byteLength,
              truncated,
            },
          };
        } finally {
          clearTimeout(timeout);
        }
      },
    },
    {
      name: "bash",
      aliases: ["workspace_shell"],
      description:
        "Run a concrete shell command in the current project. The command field is required; never call this tool with an empty object.",
      risk: "shell",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to run. Required. Do not call this tool with an empty object.",
          },
          description: {
            type: "string",
            description: "Brief human-readable description of what the command does.",
          },
          cwd: { type: "string", description: "Optional project-relative working directory. Defaults to project root." },
          timeoutMs: { type: "number", description: "Timeout in milliseconds. Defaults to 20000." },
          maxOutputBytes: { type: "number", description: "Maximum stdout+stderr bytes to return. Defaults to 60000." },
        },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const command = stringInput(input, "command").trim();
        if (!command) {
          throw new Error('command is required. Call bash with {"command":"pwd"} or another concrete command.');
        }
        if (isPotentiallyDestructiveCommand(command)) {
          throw new Error("Refusing to run potentially destructive command.");
        }

        const target = await resolveWorkspacePath(context, stringInput(input, "cwd", "."), { targetKind: "directory" });
        const cwdStat = await stat(target.resolved);
        if (!cwdStat.isDirectory()) {
          throw new Error("cwd is not a directory.");
        }
        const timeoutMs = Math.min(Math.max(1_000, numberInput(input, "timeoutMs", DEFAULT_SHELL_TIMEOUT_MS)), 120_000);
        const maxOutputBytes = Math.min(Math.max(1, numberInput(input, "maxOutputBytes", MAX_SHELL_OUTPUT_BYTES)), MAX_SHELL_OUTPUT_BYTES);
        const result = await runShellCommand(command, target.resolved, timeoutMs, maxOutputBytes);
        const output = [
          result.stdout,
          result.stderr ? `stderr:\n${result.stderr}` : "",
          result.truncated ? `[truncated output at ${maxOutputBytes} bytes]` : "",
          result.timedOut ? `[timed out after ${timeoutMs}ms]` : "",
        ].filter(Boolean).join("\n");
        const trimmed = trimOutputBytes(output || "(command produced no output)", maxOutputBytes);
        return {
          content: trimmed.content,
          metadata: {
            cwd: target.relative,
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            truncated: result.truncated || trimmed.truncated,
          },
        };
      },
    },
  ];
}
