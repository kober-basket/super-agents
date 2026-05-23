#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DATA_DIR = "super-agents";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUILTIN_SKILLS_DIR = path.join(REPOSITORY_ROOT, "electron", "builtin-skills");
const SESSION_HISTORY_LIMIT = 100;
const SESSION_UNDO_LIMIT = 30;

const BUILTIN_TOOLS = [
  { name: "apply_patch", risk: "write", source: "builtin" },
  { name: "bash", risk: "high", source: "builtin" },
  { name: "edit", risk: "write", source: "builtin" },
  { name: "glob", risk: "read", source: "builtin" },
  { name: "grep", risk: "read", source: "builtin" },
  { name: "list", risk: "read", source: "builtin" },
  { name: "mail", risk: "read", source: "builtin" },
  { name: "mail_auth", risk: "high", source: "builtin" },
  { name: "mail_draft", risk: "write", source: "builtin" },
  { name: "mail_send", risk: "high", source: "builtin" },
  { name: "memory", risk: "write", source: "builtin" },
  { name: "multi_edit", risk: "write", source: "builtin" },
  { name: "question", risk: "low", source: "builtin" },
  { name: "read", risk: "read", source: "builtin" },
  { name: "todo_read", risk: "read", source: "builtin" },
  { name: "todo_write", risk: "write", source: "builtin" },
  { name: "web_fetch", risk: "network", source: "builtin" },
  { name: "web_search", risk: "network", source: "builtin" },
  { name: "write", risk: "write", source: "builtin" },
];

function usage(executableName = "super-agents") {
  return [
    `Usage: ${executableName} [global options] <command> [options]`,
    `       ${executableName} [global options]              # interactive REPL`,
    "",
    "Global options:",
    "  --user-data <path>       App userData directory.",
    "  --state-path <path>      workspace.json path. Overrides --user-data.",
    "  --db-path <path>         app.db path. Overrides --user-data.",
    "  --session <name|id>      CLI session used for history and undo/redo.",
    "  --json                   Print machine-readable JSON.",
    "  --yes                    Confirm destructive commands.",
    "  --include-secrets        Do not mask secrets in read output.",
    "",
    "Commands:",
    "  status",
    "  session new|list|status|use|history|undo|redo",
    "  config show|patch|backup|restore",
    "  model provider list|add|remove|enable|disable",
    "  model list|add|set-active|enable|disable",
    "  provider list|add|set-active             # compatibility alias",
    "  permission full-access <on|off>",
    "  conversation list|show|rename|export|delete",
    "  memory list|add|search|update|delete",
    "  knowledge base list|create|delete",
    "  mcp list|add|show|enable|disable|remove",
    "  skill list|show|enable|disable",
    "  tools list",
  ].join("\n");
}

function fail(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function defaultUserDataPath() {
  const override = process.env.SUPER_AGENTS_USER_DATA?.trim();
  if (override) return path.resolve(override);

  if (process.platform === "win32") {
    const root = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(root, APP_DATA_DIR);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DATA_DIR);
  }
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, APP_DATA_DIR);
}

function parseGlobalOptions(argv, executableName = "super-agents") {
  const options = {
    executableName,
    json: false,
    includeSecrets: false,
    yes: false,
    userData: "",
    statePath: "",
    dbPath: "",
    sessionSelector: "",
    rest: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-secrets") {
      options.includeSecrets = true;
      continue;
    }
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }
    if (arg === "--user-data" || arg === "--state-path" || arg === "--db-path" || arg === "--session") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value.`);
      index += 1;
      if (arg === "--user-data") options.userData = path.resolve(value);
      if (arg === "--state-path") options.statePath = path.resolve(value);
      if (arg === "--db-path") options.dbPath = path.resolve(value);
      if (arg === "--session") options.sessionSelector = value.trim();
      continue;
    }

    const inline = arg.match(/^(--user-data|--state-path|--db-path|--session)=(.*)$/);
    if (inline) {
      const [, name, value] = inline;
      if (!value) fail(`${name} requires a value.`);
      if (name === "--user-data") options.userData = path.resolve(value);
      if (name === "--state-path") options.statePath = path.resolve(value);
      if (name === "--db-path") options.dbPath = path.resolve(value);
      if (name === "--session") options.sessionSelector = value.trim();
      continue;
    }

    options.rest.push(arg);
  }

  const userData = options.userData || defaultUserDataPath();
  return {
    ...options,
    userData,
    statePath: options.statePath || path.join(userData, "workspace.json"),
    dbPath: options.dbPath || path.join(userData, "data", "app.db"),
    sessionRoot: path.join(userData, "cli", "sessions"),
    currentSessionPath: path.join(userData, "cli", "current-session.json"),
    memoryRoot: path.join(userData, "memory"),
    knowledgeRoot: path.join(userData, "knowledge"),
  };
}

function contextPaths(context) {
  return {
    userData: context.userData,
    statePath: context.statePath,
    dbPath: context.dbPath,
    sessionRoot: context.sessionRoot,
    memoryRoot: context.memoryRoot,
    knowledgeRoot: context.knowledgeRoot,
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}-${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function createDefaultConfig() {
  return {
    workspaceRoot: "",
    bridgeUrl: "",
    environment: "local",
    defaultAgentMode: "general",
    activeModelId: "",
    contextTier: "high",
    appearance: { theme: "linen" },
    proxy: { http: "", https: "", bypass: "localhost,127.0.0.1" },
    modelProviders: [],
    mcpServers: [],
    skills: [],
    knowledgeBase: {
      enabled: false,
      embeddingProviderId: "",
      embeddingModel: "",
      selectedBaseIds: [],
      documentCount: 5,
      chunkSize: 1200,
      chunkOverlap: 160,
    },
    remoteControl: {
      dingtalk: { enabled: false, clientId: "", clientSecret: "" },
      feishu: { enabled: false, appId: "", appSecret: "", domain: "feishu" },
      wechat: {
        enabled: false,
        baseUrl: "https://ilinkai.weixin.qq.com",
        cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        botToken: "",
        accountId: "",
        userId: "",
        connectedAt: null,
      },
      wecom: { enabled: false, botId: "", secret: "", websocketUrl: "wss://openws.work.weixin.qq.com" },
    },
    security: { fullFileSystemAccess: true },
  };
}

function normalizeState(raw) {
  const defaults = createDefaultConfig();
  const rawConfig = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.config : null;
  const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? rawConfig : {};

  return {
    config: {
      ...defaults,
      ...config,
      appearance: { ...defaults.appearance, ...(config.appearance ?? {}) },
      proxy: { ...defaults.proxy, ...(config.proxy ?? {}) },
      modelProviders: Array.isArray(config.modelProviders) ? config.modelProviders : [],
      mcpServers: Array.isArray(config.mcpServers) ? config.mcpServers : [],
      skills: Array.isArray(config.skills) ? config.skills : [],
      knowledgeBase: { ...defaults.knowledgeBase, ...(config.knowledgeBase ?? {}) },
      remoteControl: { ...defaults.remoteControl, ...(config.remoteControl ?? {}) },
      security: {
        ...defaults.security,
        ...(config.security ?? {}),
        fullFileSystemAccess: config.security?.fullFileSystemAccess === false
          ? false
          : defaults.security.fullFileSystemAccess,
      },
    },
  };
}

async function readState(statePath) {
  return normalizeState(await readJsonFile(statePath, null));
}

async function writeState(statePath, state) {
  await writeJsonAtomic(statePath, normalizeState(state));
}

function safeSegment(value, fallback = "default") {
  const safe = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function summarizeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    name: session.name,
    path: session.path,
    activeConversationId: session.activeConversationId || "",
    activeWorkspaceRoot: session.activeWorkspaceRoot || "",
    historyLength: session.history.length,
    undoDepth: session.undoStack.length,
    redoDepth: session.redoStack.length,
  };
}

function normalizeSession(raw, sessionPath, fallbackName) {
  const now = Date.now();
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const name = String(value.name ?? fallbackName ?? "default").trim() || "default";
  const id = String(value.id ?? safeSegment(name)).trim() || safeSegment(name);
  return {
    version: 1,
    id,
    name,
    path: sessionPath,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
    activeConversationId: typeof value.activeConversationId === "string" ? value.activeConversationId : "",
    activeWorkspaceRoot: typeof value.activeWorkspaceRoot === "string" ? value.activeWorkspaceRoot : "",
    activeModelId: typeof value.activeModelId === "string" ? value.activeModelId : "",
    history: Array.isArray(value.history) ? value.history : [],
    undoStack: Array.isArray(value.undoStack) ? value.undoStack : [],
    redoStack: Array.isArray(value.redoStack) ? value.redoStack : [],
  };
}

async function listSessionFiles(context) {
  try {
    const entries = await readdir(context.sessionRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(context.sessionRoot, entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readCurrentSessionSelector(context) {
  const current = await readJsonFile(context.currentSessionPath, null);
  if (current && typeof current === "object" && typeof current.session === "string" && current.session.trim()) {
    return current.session.trim();
  }
  return "default";
}

async function findSessionPath(context, selector) {
  const safe = safeSegment(selector);
  const direct = path.join(context.sessionRoot, `${safe}.json`);
  if (existsSync(direct)) return direct;

  for (const filePath of await listSessionFiles(context)) {
    const session = normalizeSession(await readJsonFile(filePath, null), filePath, selector);
    if (session.id === selector || session.name === selector || safeSegment(session.name) === safe) {
      return filePath;
    }
  }
  return direct;
}

async function saveSession(session) {
  const next = {
    ...session,
    path: undefined,
    updatedAt: Date.now(),
    history: session.history.slice(-SESSION_HISTORY_LIMIT),
    undoStack: session.undoStack.slice(-SESSION_UNDO_LIMIT),
    redoStack: session.redoStack.slice(-SESSION_UNDO_LIMIT),
  };
  delete next.path;
  await writeJsonAtomic(session.path, next);
}

async function loadOrCreateSession(context, selector) {
  const resolvedSelector = selector || context.sessionSelector || await readCurrentSessionSelector(context);
  const sessionPath = await findSessionPath(context, resolvedSelector);
  const exists = existsSync(sessionPath);
  const session = normalizeSession(await readJsonFile(sessionPath, null), sessionPath, resolvedSelector);
  if (!exists) await saveSession(session);
  return session;
}

async function createSession(context, name) {
  const sessionName = String(name ?? "").trim();
  if (!sessionName) fail("session new requires --name.");
  const sessionPath = path.join(context.sessionRoot, `${safeSegment(sessionName)}.json`);
  if (existsSync(sessionPath)) fail(`Session already exists: ${sessionName}`);
  const now = Date.now();
  const session = normalizeSession({
    id: safeSegment(sessionName),
    name: sessionName,
    createdAt: now,
    updatedAt: now,
  }, sessionPath, sessionName);
  await saveSession(session);
  return session;
}

async function recordStateMutation(context, command, beforeState, afterState, changedPaths) {
  if (JSON.stringify(beforeState) === JSON.stringify(afterState)) return null;
  const session = await loadOrCreateSession(context);
  const entry = {
    id: randomUUID(),
    type: "state",
    command,
    changedPaths,
    createdAt: Date.now(),
    statePath: context.statePath,
    beforeState,
    afterState,
  };
  session.history.push({
    id: entry.id,
    type: entry.type,
    command,
    changedPaths,
    createdAt: entry.createdAt,
  });
  session.undoStack.push(entry);
  session.redoStack = [];
  await saveSession(session);
  return session;
}

function optionValue(args, name, fallback = "") {
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) return arg.slice(inlinePrefix.length);
    if (arg !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${name} requires a value.`);
    return value;
  }
  return fallback;
}

function optionValues(args, name) {
  const values = [];
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) {
      values.push(arg.slice(inlinePrefix.length));
      continue;
    }
    if (arg !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${name} requires a value.`);
    values.push(value);
    index += 1;
  }
  return values;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function numberOption(args, name, fallback) {
  const raw = optionValue(args, name, "");
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`${name} must be a number.`);
  return value;
}

function parseScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function setDottedPath(target, dottedPath, value) {
  const parts = dottedPath.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) fail("Patch path cannot be empty.");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function sanitizeModelProviderId(value) {
  return safeSegment(value, "provider");
}

function createRuntimeModelId(providerId, modelId) {
  return `${sanitizeModelProviderId(providerId)}::${String(modelId ?? "").trim()}`;
}

function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function parseModel(value) {
  const [idPart, ...labelParts] = String(value ?? "").split(":");
  const id = idPart.trim();
  if (!id) fail("--model must include a model id.");
  const label = labelParts.join(":").trim() || id;
  return { id, label, enabled: true };
}

function mergeModels(existingModels, incomingModels) {
  const byId = new Map();
  for (const model of Array.isArray(existingModels) ? existingModels : []) {
    const id = String(model?.id ?? "").trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      ...model,
      id,
      label: String(model?.label ?? "").trim() || id,
      enabled: model?.enabled !== false,
    });
  }
  for (const model of incomingModels) byId.set(model.id, model);
  return Array.from(byId.values());
}

function maskSecrets(value) {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (!value || typeof value !== "object") return value;

  const masked = {};
  for (const [key, item] of Object.entries(value)) {
    if ((key === "envJson" || key === "headersJson") && typeof item === "string" && item.trim()) {
      try {
        masked[key] = JSON.stringify(maskSecrets(JSON.parse(item)));
      } catch {
        masked[key] = item;
      }
      continue;
    }
    if (/api[_-]?key|apiKey|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|token|password|secret|client[_-]?secret|clientSecret|authorization/i.test(key)) {
      masked[key] = typeof item === "string" && item ? "***" : item;
      continue;
    }
    masked[key] = maskSecrets(item);
  }
  return masked;
}

function ensureYes(context, args, description) {
  if (context.yes || hasFlag(args, "--yes")) return;
  fail(`${description} requires --yes.`);
}

async function statusCommand(context) {
  const session = await loadOrCreateSession(context);
  const stateExists = existsSync(context.statePath);
  const dbExists = existsSync(context.dbPath);
  return {
    result: {
      stateExists,
      databaseExists: dbExists,
      repositoryRoot: REPOSITORY_ROOT,
      executable: context.executableName,
    },
    session,
    extras: {
      capabilities: [
        "status",
        "sessions",
        "undo",
        "config",
        "model-providers",
        "permissions",
        "conversations",
        "memory",
        "knowledge",
        "mcp",
        "skills",
        "tools",
        "repl",
        "json",
      ],
    },
  };
}

async function sessionCommand(context, action, args) {
  if (action === "new") {
    const session = await createSession(context, optionValue(args, "--name"));
    return { result: { session: summarizeSession(session) }, session };
  }
  if (action === "list") {
    const sessions = [];
    for (const filePath of await listSessionFiles(context)) {
      sessions.push(summarizeSession(normalizeSession(await readJsonFile(filePath, null), filePath, "default")));
    }
    return { result: { sessions: sessions.sort((left, right) => left.name.localeCompare(right.name)) } };
  }
  if (action === "use") {
    const selector = optionValue(args, "--name", optionValue(args, "--id", args[0] ?? ""));
    if (!selector) fail("session use requires --name or --id.");
    const session = await loadOrCreateSession(context, selector);
    await writeJsonAtomic(context.currentSessionPath, { session: session.name, updatedAt: Date.now() });
    return { result: { session: summarizeSession(session) }, session };
  }
  if (action === "status") {
    const session = await loadOrCreateSession(context);
    return { result: { session: summarizeSession(session) }, session };
  }
  if (action === "history") {
    const session = await loadOrCreateSession(context);
    return { result: { history: session.history }, session };
  }
  if (action === "undo") {
    const session = await loadOrCreateSession(context);
    const entry = session.undoStack.pop();
    if (!entry) fail("Nothing to undo.");
    if (entry.type !== "state") fail(`Unsupported undo entry type: ${entry.type}`);
    await writeState(entry.statePath || context.statePath, entry.beforeState);
    session.redoStack.push(entry);
    await saveSession(session);
    return { result: { undone: { command: entry.command, changedPaths: entry.changedPaths } }, session };
  }
  if (action === "redo") {
    const session = await loadOrCreateSession(context);
    const entry = session.redoStack.pop();
    if (!entry) fail("Nothing to redo.");
    if (entry.type !== "state") fail(`Unsupported redo entry type: ${entry.type}`);
    await writeState(entry.statePath || context.statePath, entry.afterState);
    session.undoStack.push(entry);
    await saveSession(session);
    return { result: { redone: { command: entry.command, changedPaths: entry.changedPaths } }, session };
  }
  fail(`Unknown session command: ${action || ""}`);
}

async function configCommand(context, action, args) {
  if (action === "show") {
    const state = await readState(context.statePath);
    return { result: { config: context.includeSecrets ? state.config : maskSecrets(state.config) } };
  }
  if (action === "patch") {
    const assignments = optionValues(args, "--set");
    if (assignments.length === 0) fail("config patch requires at least one --set path=value.");
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const changedPaths = [];
    for (const assignment of assignments) {
      const equalsAt = assignment.indexOf("=");
      if (equalsAt <= 0) fail("--set values must use path=value.");
      const key = assignment.slice(0, equalsAt).trim();
      const value = parseScalar(assignment.slice(equalsAt + 1));
      setDottedPath(afterState.config, key, value);
      changedPaths.push(key);
    }
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, "config patch", beforeState, afterState, changedPaths);
    return { result: { changedPaths, config: context.includeSecrets ? afterState.config : maskSecrets(afterState.config) }, session };
  }
  if (action === "backup") {
    const state = await readState(context.statePath);
    const outPath = path.resolve(optionValue(args, "--out", path.join(context.userData, "cli", `workspace-${Date.now()}.backup.json`)));
    await writeJsonAtomic(outPath, state);
    return { result: { path: outPath } };
  }
  if (action === "restore") {
    const fromPath = path.resolve(optionValue(args, "--from"));
    if (!existsSync(fromPath)) fail(`Backup not found: ${fromPath}`);
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(await readJsonFile(fromPath, null));
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, "config restore", beforeState, afterState, ["*"]);
    return { result: { restoredFrom: fromPath }, session };
  }
  fail(`Unknown config command: ${action || ""}`);
}

async function providerAddCommand(context, args) {
  const idInput = optionValue(args, "--id", optionValue(args, "--name", ""));
  if (!idInput.trim()) fail("provider add requires --id or --name.");
  const providerId = sanitizeModelProviderId(idInput);
  const name = optionValue(args, "--name", idInput).trim() || providerId;
  const baseUrl = normalizeBaseUrl(optionValue(args, "--base-url"));
  if (!baseUrl) fail("provider add requires --base-url.");

  const beforeState = await readState(context.statePath);
  const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
  const existingProviders = afterState.config.modelProviders;
  const existing = existingProviders.find((provider) => sanitizeModelProviderId(provider?.id) === providerId);
  const incomingModels = optionValues(args, "--model").map(parseModel);
  const provider = {
    ...(existing ?? {}),
    id: providerId,
    name,
    kind: "openai-compatible",
    baseUrl,
    apiKey: optionValue(args, "--api-key", existing?.apiKey ?? ""),
    temperature: numberOption(args, "--temperature", existing?.temperature ?? 0.2),
    maxTokens: numberOption(args, "--max-tokens", existing?.maxTokens ?? 8192),
    enabled: !hasFlag(args, "--disabled"),
    models: mergeModels(existing?.models, incomingModels),
  };

  afterState.config.modelProviders = [
    ...existingProviders.filter((item) => sanitizeModelProviderId(item?.id) !== providerId),
    provider,
  ];
  if (hasFlag(args, "--set-active")) {
    const activeModel = provider.models[0];
    if (!activeModel) fail("--set-active requires at least one --model.");
    afterState.config.activeModelId = createRuntimeModelId(provider.id, activeModel.id);
  }

  await writeState(context.statePath, afterState);
  const session = await recordStateMutation(context, "model provider add", beforeState, afterState, ["modelProviders", "activeModelId"]);
  return {
    result: {
      provider: context.includeSecrets ? provider : maskSecrets(provider),
      activeModelId: afterState.config.activeModelId,
    },
    session,
  };
}

async function providerListCommand(context) {
  const state = await readState(context.statePath);
  return {
    result: {
      providers: context.includeSecrets ? state.config.modelProviders : maskSecrets(state.config.modelProviders),
      activeModelId: state.config.activeModelId,
    },
  };
}

async function providerToggleCommand(context, args, enabled) {
  const providerId = sanitizeModelProviderId(optionValue(args, "--provider", optionValue(args, "--id")));
  const beforeState = await readState(context.statePath);
  const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
  const provider = afterState.config.modelProviders.find((item) => sanitizeModelProviderId(item?.id) === providerId);
  if (!provider) fail(`Provider not found: ${providerId}`);
  provider.enabled = enabled;
  await writeState(context.statePath, afterState);
  const session = await recordStateMutation(context, `model provider ${enabled ? "enable" : "disable"}`, beforeState, afterState, ["modelProviders"]);
  return { result: { provider: context.includeSecrets ? provider : maskSecrets(provider) }, session };
}

async function providerRemoveCommand(context, args) {
  const providerId = sanitizeModelProviderId(optionValue(args, "--provider", optionValue(args, "--id")));
  ensureYes(context, args, "model provider remove");
  const beforeState = await readState(context.statePath);
  const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
  const beforeCount = afterState.config.modelProviders.length;
  afterState.config.modelProviders = afterState.config.modelProviders.filter((item) => sanitizeModelProviderId(item?.id) !== providerId);
  if (beforeCount === afterState.config.modelProviders.length) fail(`Provider not found: ${providerId}`);
  if (String(afterState.config.activeModelId).startsWith(`${providerId}::`)) afterState.config.activeModelId = "";
  await writeState(context.statePath, afterState);
  const session = await recordStateMutation(context, "model provider remove", beforeState, afterState, ["modelProviders", "activeModelId"]);
  return { result: { removed: true, providerId }, session };
}

async function modelCommand(context, action, args) {
  if (action === "provider") {
    const [providerAction, ...providerArgs] = args;
    if (providerAction === "list") return await providerListCommand(context);
    if (providerAction === "add") return await providerAddCommand(context, providerArgs);
    if (providerAction === "remove") return await providerRemoveCommand(context, providerArgs);
    if (providerAction === "enable") return await providerToggleCommand(context, providerArgs, true);
    if (providerAction === "disable") return await providerToggleCommand(context, providerArgs, false);
    fail(`Unknown model provider command: ${providerAction || ""}`);
  }
  if (action === "list") {
    const state = await readState(context.statePath);
    const models = state.config.modelProviders.flatMap((provider) =>
      (Array.isArray(provider.models) ? provider.models : []).map((model) => ({
        ...model,
        providerId: provider.id,
        runtimeId: createRuntimeModelId(provider.id, model.id),
      })),
    );
    return { result: { models, activeModelId: state.config.activeModelId } };
  }
  if (action === "add") {
    const providerId = sanitizeModelProviderId(optionValue(args, "--provider"));
    const modelId = optionValue(args, "--id").trim();
    if (!modelId) fail("model add requires --id.");
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const provider = afterState.config.modelProviders.find((item) => sanitizeModelProviderId(item?.id) === providerId);
    if (!provider) fail(`Provider not found: ${providerId}`);
    const model = {
      id: modelId,
      label: optionValue(args, "--label", modelId).trim() || modelId,
      enabled: !hasFlag(args, "--disabled"),
    };
    provider.models = mergeModels(provider.models, [model]);
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, "model add", beforeState, afterState, ["modelProviders"]);
    return { result: { model, providerId, runtimeId: createRuntimeModelId(providerId, model.id) }, session };
  }
  if (action === "set-active") {
    const providerId = sanitizeModelProviderId(optionValue(args, "--provider"));
    const modelId = optionValue(args, "--model").trim();
    if (!modelId) fail("model set-active requires --model.");
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const provider = afterState.config.modelProviders.find((item) => sanitizeModelProviderId(item?.id) === providerId);
    if (!provider) fail(`Provider not found: ${providerId}`);
    const model = (Array.isArray(provider.models) ? provider.models : []).find((item) => String(item?.id ?? "").trim() === modelId);
    if (!model) fail(`Model not found in provider ${providerId}: ${modelId}`);
    afterState.config.activeModelId = createRuntimeModelId(providerId, modelId);
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, "model set-active", beforeState, afterState, ["activeModelId"]);
    return { result: { activeModelId: afterState.config.activeModelId }, session };
  }
  if (action === "enable" || action === "disable") {
    const providerId = sanitizeModelProviderId(optionValue(args, "--provider"));
    const modelId = optionValue(args, "--model", optionValue(args, "--id")).trim();
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const provider = afterState.config.modelProviders.find((item) => sanitizeModelProviderId(item?.id) === providerId);
    if (!provider) fail(`Provider not found: ${providerId}`);
    const model = (Array.isArray(provider.models) ? provider.models : []).find((item) => String(item?.id ?? "").trim() === modelId);
    if (!model) fail(`Model not found in provider ${providerId}: ${modelId}`);
    model.enabled = action === "enable";
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, `model ${action}`, beforeState, afterState, ["modelProviders"]);
    return { result: { model, providerId }, session };
  }
  fail(`Unknown model command: ${action || ""}`);
}

async function providerAliasCommand(context, action, args) {
  if (action === "list") return await providerListCommand(context);
  if (action === "add") return await providerAddCommand(context, args);
  if (action === "set-active") return await modelCommand(context, "set-active", args);
  fail(`Unknown provider command: ${action || ""}`);
}

async function permissionCommand(context, action, args) {
  if (action !== "full-access") fail(`Unknown permission command: ${action || ""}`);
  const value = args[0];
  if (value !== "on" && value !== "off") fail("permission full-access requires on or off.");
  const beforeState = await readState(context.statePath);
  const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
  afterState.config.security.fullFileSystemAccess = value === "on";
  await writeState(context.statePath, afterState);
  const session = await recordStateMutation(context, "permission full-access", beforeState, afterState, ["security.fullFileSystemAccess"]);
  return { result: { fullFileSystemAccess: afterState.config.security.fullFileSystemAccess }, session };
}

async function openDatabase(dbPath) {
  if (!existsSync(dbPath)) fail(`Database not found: ${dbPath}`);
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON;");
  return database;
}

function parseJsonText(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapConversationRow(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    preview: row.preview,
    workspaceRoot: row.workspace_root || "",
    selectedKnowledgeBaseIds: parseJsonText(row.selected_knowledge_base_ids_json, []),
    agentCore: row.agent_core || "",
    agentSessionId: row.agent_session_id || "",
    messageCount: Number(row.message_count ?? 0),
  };
}

function mapMessageRow(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments: parseJsonText(row.attachments_json, []),
    visuals: parseJsonText(row.visuals_json, []),
    runtimeTrace: parseJsonText(row.runtime_trace_json, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadConversation(database, conversationId) {
  const row = database.prepare(`
    SELECT
      conversations.id,
      conversations.title,
      conversations.created_at,
      conversations.updated_at,
      conversations.last_message_at,
      conversations.preview,
      conversations.workspace_root,
      conversations.selected_knowledge_base_ids_json,
      conversations.agent_core,
      conversations.agent_session_id,
      COUNT(messages.id) AS message_count
    FROM conversations
    LEFT JOIN messages ON messages.conversation_id = conversations.id
    WHERE conversations.id = ?
    GROUP BY conversations.id
  `).get(conversationId);
  if (!row) fail(`Conversation not found: ${conversationId}`);
  const messages = database.prepare(`
    SELECT id, role, content, attachments_json, visuals_json, runtime_trace_json, created_at, updated_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId).map(mapMessageRow);
  return { ...mapConversationRow(row), messages };
}

function buildConversationMarkdown(conversation) {
  const lines = [
    `# ${conversation.title || conversation.id}`,
    "",
    `- Conversation ID: ${conversation.id}`,
    `- Messages: ${conversation.messages.length}`,
    "",
  ];
  for (const message of conversation.messages) {
    lines.push(`## ${message.role}`);
    lines.push("");
    if (message.attachments?.length) {
      lines.push("Attachments:");
      for (const attachment of message.attachments) {
        lines.push(`- ${attachment.name || attachment.path || attachment.id || "attachment"}`);
      }
      lines.push("");
    }
    lines.push(message.content || "");
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function conversationCommand(context, action, args) {
  if (action === "list") {
    const database = await openDatabase(context.dbPath);
    try {
      const conversations = database.prepare(`
        SELECT
          conversations.id,
          conversations.title,
          conversations.created_at,
          conversations.updated_at,
          conversations.last_message_at,
          conversations.preview,
          conversations.workspace_root,
          conversations.selected_knowledge_base_ids_json,
          conversations.agent_core,
          conversations.agent_session_id,
          COUNT(messages.id) AS message_count
        FROM conversations
        LEFT JOIN messages ON messages.conversation_id = conversations.id
        GROUP BY conversations.id
        ORDER BY conversations.last_message_at DESC, conversations.created_at DESC
      `).all().map(mapConversationRow);
      return { result: { conversations } };
    } finally {
      database.close();
    }
  }
  if (action === "show") {
    const conversationId = optionValue(args, "--id");
    const database = await openDatabase(context.dbPath);
    try {
      return { result: { conversation: await loadConversation(database, conversationId) } };
    } finally {
      database.close();
    }
  }
  if (action === "rename") {
    const conversationId = optionValue(args, "--id");
    const title = optionValue(args, "--title").replace(/\s+/g, " ").trim();
    if (!title) fail("conversation rename requires --title.");
    const database = await openDatabase(context.dbPath);
    try {
      const result = database.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, conversationId);
      if (result.changes === 0) fail(`Conversation not found: ${conversationId}`);
      return { result: { conversation: await loadConversation(database, conversationId) } };
    } finally {
      database.close();
    }
  }
  if (action === "export") {
    const conversationId = optionValue(args, "--id");
    const format = optionValue(args, "--format", "markdown");
    if (format !== "markdown") fail("CLI conversation export currently supports --format markdown.");
    const outPath = path.resolve(optionValue(args, "--out", path.join(context.userData, "exports", `${conversationId}.md`)));
    const database = await openDatabase(context.dbPath);
    try {
      const conversation = await loadConversation(database, conversationId);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, buildConversationMarkdown(conversation), "utf8");
      return { result: { path: outPath, format, conversationId } };
    } finally {
      database.close();
    }
  }
  if (action === "delete") {
    ensureYes(context, args, "conversation delete");
    const conversationId = optionValue(args, "--id");
    const database = await openDatabase(context.dbPath);
    try {
      const result = database.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
      return { result: { deleted: result.changes > 0, conversationId } };
    } finally {
      database.close();
    }
  }
  fail(`Unknown conversation command: ${action || ""}`);
}

const MEMORY_TYPES = new Set(["user_preference", "feedback_rule", "project_context", "external_reference"]);
const MEMORY_SCOPES = new Set(["global", "workspace"]);

function memoryIndexPath(context) {
  return path.join(context.memoryRoot, "index.json");
}

async function readMemoryState(context) {
  const raw = await readJsonFile(memoryIndexPath(context), { entries: [] });
  return { entries: Array.isArray(raw.entries) ? raw.entries : [] };
}

async function writeMemoryState(context, state) {
  await writeJsonAtomic(memoryIndexPath(context), { entries: state.entries });
}

function normalizeMemoryEntry(entry) {
  const now = Date.now();
  return {
    id: String(entry.id || randomUUID()),
    type: MEMORY_TYPES.has(entry.type) ? entry.type : "project_context",
    scope: MEMORY_SCOPES.has(entry.scope) ? entry.scope : "global",
    title: String(entry.title || "").trim(),
    content: String(entry.content || "").trim(),
    tags: Array.isArray(entry.tags) ? Array.from(new Set(entry.tags.map((tag) => String(tag).trim()).filter(Boolean))).slice(0, 8) : [],
    enabled: entry.enabled !== false,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : now,
    workspaceRoot: entry.workspaceRoot ? path.resolve(String(entry.workspaceRoot)) : undefined,
  };
}

function searchableMemory(entry) {
  return [entry.title, entry.content, ...(entry.tags ?? []), entry.type, entry.scope].join(" ").toLowerCase();
}

function assertSafeMemory(title, content, tags) {
  const combined = [title, content, ...tags].join("\n");
  if (/\b(?:api[_-]?key|secret|token|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i.test(combined)) {
    fail("Refusing to store secret-like memory content.");
  }
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(combined)) {
    fail("Refusing to store secret-like memory content.");
  }
}

async function memoryCommand(context, action, args) {
  if (action === "list") {
    const state = await readMemoryState(context);
    return { result: { entries: state.entries.map(normalizeMemoryEntry).sort((a, b) => b.updatedAt - a.updatedAt) } };
  }
  if (action === "add") {
    const title = optionValue(args, "--title").trim();
    const content = optionValue(args, "--content").trim();
    if (!title) fail("memory add requires --title.");
    if (!content) fail("memory add requires --content.");
    const tags = optionValues(args, "--tag");
    assertSafeMemory(title, content, tags);
    const state = await readMemoryState(context);
    const entry = normalizeMemoryEntry({
      id: randomUUID(),
      type: optionValue(args, "--type", "project_context"),
      scope: optionValue(args, "--scope", "global"),
      title,
      content,
      tags,
      enabled: !hasFlag(args, "--disabled"),
      workspaceRoot: optionValue(args, "--workspace-root", ""),
    });
    state.entries.push(entry);
    await writeMemoryState(context, state);
    return { result: { entry } };
  }
  if (action === "search") {
    const query = optionValue(args, "--query", "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, numberOption(args, "--limit", 50)));
    const state = await readMemoryState(context);
    const entries = state.entries
      .map(normalizeMemoryEntry)
      .filter((entry) => entry.enabled && (!query || searchableMemory(entry).includes(query)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { result: { query, total: entries.length, entries: entries.slice(0, limit) } };
  }
  if (action === "update") {
    const id = optionValue(args, "--id").trim();
    const state = await readMemoryState(context);
    const index = state.entries.findIndex((entry) => entry.id === id);
    if (index < 0) fail(`Memory not found: ${id}`);
    const current = normalizeMemoryEntry(state.entries[index]);
    const next = normalizeMemoryEntry({
      ...current,
      type: optionValue(args, "--type", current.type),
      scope: optionValue(args, "--scope", current.scope),
      title: optionValue(args, "--title", current.title),
      content: optionValue(args, "--content", current.content),
      tags: optionValues(args, "--tag").length ? optionValues(args, "--tag") : current.tags,
      enabled: hasFlag(args, "--enable") ? true : hasFlag(args, "--disable") ? false : current.enabled,
      updatedAt: Date.now(),
    });
    assertSafeMemory(next.title, next.content, next.tags);
    state.entries[index] = next;
    await writeMemoryState(context, state);
    return { result: { entry: next } };
  }
  if (action === "delete") {
    ensureYes(context, args, "memory delete");
    const id = optionValue(args, "--id").trim();
    const state = await readMemoryState(context);
    const nextEntries = state.entries.filter((entry) => entry.id !== id);
    if (nextEntries.length === state.entries.length) fail(`Memory not found: ${id}`);
    state.entries = nextEntries;
    await writeMemoryState(context, state);
    return { result: { deleted: true, id } };
  }
  fail(`Unknown memory command: ${action || ""}`);
}

function knowledgeIndexPath(context) {
  return path.join(context.knowledgeRoot, "index.json");
}

async function readKnowledgeIndex(context) {
  const raw = await readJsonFile(knowledgeIndexPath(context), { bases: [] });
  return { bases: Array.isArray(raw.bases) ? raw.bases : [] };
}

async function writeKnowledgeIndex(context, index) {
  await writeJsonAtomic(knowledgeIndexPath(context), { bases: index.bases });
}

async function loadKnowledgeChunks(context, baseId) {
  return await readJsonFile(path.join(context.knowledgeRoot, "bases", baseId, "chunks.json"), []);
}

function summarizeKnowledgeBase(base, chunks) {
  return {
    id: base.id,
    name: base.name,
    description: base.description || "",
    itemCount: Array.isArray(base.items) ? base.items.length : 0,
    chunkCount: Array.isArray(chunks) ? chunks.length : 0,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    items: Array.isArray(base.items) ? base.items : [],
  };
}

async function knowledgeCommand(context, action, args) {
  if (action !== "base") fail(`Unknown knowledge command: ${action || ""}`);
  const [baseAction, ...baseArgs] = args;
  if (baseAction === "list") {
    const index = await readKnowledgeIndex(context);
    const bases = [];
    for (const base of index.bases) bases.push(summarizeKnowledgeBase(base, await loadKnowledgeChunks(context, base.id)));
    return { result: { knowledgeBases: bases.sort((a, b) => b.updatedAt - a.updatedAt) } };
  }
  if (baseAction === "create") {
    const name = optionValue(baseArgs, "--name").trim();
    if (!name) fail("knowledge base create requires --name.");
    const id = safeSegment(optionValue(baseArgs, "--id", name), "knowledge-base");
    const index = await readKnowledgeIndex(context);
    if (index.bases.some((base) => base.id === id)) fail(`Knowledge base already exists: ${id}`);
    const now = Date.now();
    const base = {
      id,
      name,
      description: optionValue(baseArgs, "--description", "").trim(),
      createdAt: now,
      updatedAt: now,
      items: [],
    };
    index.bases.unshift(base);
    await writeKnowledgeIndex(context, index);
    await mkdir(path.join(context.knowledgeRoot, "bases", id), { recursive: true });
    return { result: { base: summarizeKnowledgeBase(base, []) } };
  }
  if (baseAction === "delete") {
    ensureYes(context, baseArgs, "knowledge base delete");
    const id = optionValue(baseArgs, "--id").trim();
    const index = await readKnowledgeIndex(context);
    const beforeCount = index.bases.length;
    index.bases = index.bases.filter((base) => base.id !== id);
    if (beforeCount === index.bases.length) fail(`Knowledge base not found: ${id}`);
    await writeKnowledgeIndex(context, index);
    await rm(path.join(context.knowledgeRoot, "bases", id), { recursive: true, force: true });
    return { result: { deleted: true, id } };
  }
  fail(`Unknown knowledge base command: ${baseAction || ""}`);
}

function parseKeyValueList(values, optionName) {
  const result = {};
  for (const value of values) {
    const equalsAt = value.indexOf("=");
    if (equalsAt <= 0) fail(`${optionName} values must use KEY=value.`);
    result[value.slice(0, equalsAt)] = value.slice(equalsAt + 1);
  }
  return result;
}

async function mcpCommand(context, action, args) {
  if (action === "list") {
    const state = await readState(context.statePath);
    return { result: { servers: context.includeSecrets ? state.config.mcpServers : maskSecrets(state.config.mcpServers) } };
  }
  if (action === "show") {
    const id = optionValue(args, "--id").trim();
    const state = await readState(context.statePath);
    const server = state.config.mcpServers.find((item) => item.id === id);
    if (!server) fail(`MCP server not found: ${id}`);
    return { result: { server: context.includeSecrets ? server : maskSecrets(server) } };
  }
  if (action === "add") {
    const id = safeSegment(optionValue(args, "--id", optionValue(args, "--name", "")), "mcp-server");
    const name = optionValue(args, "--name", id).trim() || id;
    const command = optionValue(args, "--command", "");
    const url = optionValue(args, "--url", "");
    if (!command && !url) fail("mcp add requires --command for local servers or --url for remote servers.");
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const server = {
      id,
      name,
      transport: url ? "remote" : "local",
      command,
      args: optionValues(args, "--arg"),
      url,
      headersJson: JSON.stringify(parseKeyValueList(optionValues(args, "--header"), "--header")),
      envJson: JSON.stringify(parseKeyValueList(optionValues(args, "--env"), "--env")),
      enabled: !hasFlag(args, "--disabled"),
      timeoutMs: numberOption(args, "--timeout-ms", 20_000),
    };
    afterState.config.mcpServers = [
      ...afterState.config.mcpServers.filter((item) => item.id !== id),
      server,
    ];
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, "mcp add", beforeState, afterState, ["mcpServers"]);
    return { result: { server: context.includeSecrets ? server : maskSecrets(server) }, session };
  }
  if (action === "enable" || action === "disable") {
    const id = optionValue(args, "--id").trim();
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const server = afterState.config.mcpServers.find((item) => item.id === id);
    if (!server) fail(`MCP server not found: ${id}`);
    server.enabled = action === "enable";
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, `mcp ${action}`, beforeState, afterState, ["mcpServers"]);
    return { result: { server: context.includeSecrets ? server : maskSecrets(server) }, session };
  }
  if (action === "remove") {
    ensureYes(context, args, "mcp remove");
    const id = optionValue(args, "--id").trim();
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    const beforeCount = afterState.config.mcpServers.length;
    afterState.config.mcpServers = afterState.config.mcpServers.filter((item) => item.id !== id);
    if (beforeCount === afterState.config.mcpServers.length) fail(`MCP server not found: ${id}`);
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, "mcp remove", beforeState, afterState, ["mcpServers"]);
    return { result: { removed: true, id }, session };
  }
  fail(`Unknown mcp command: ${action || ""}`);
}

function parseSkillMetadata(content, id) {
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim() || id;
  const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
  return { name, description };
}

async function listBuiltinSkills() {
  try {
    const entries = await readdir(BUILTIN_SKILLS_DIR, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const skillPath = path.join(BUILTIN_SKILLS_DIR, id, "SKILL.md");
      const content = await readFile(skillPath, "utf8").catch(() => "");
      const metadata = parseSkillMetadata(content, id);
      skills.push({
        id,
        name: metadata.name,
        description: metadata.description,
        source: "builtin",
        path: path.dirname(skillPath),
        enabled: true,
      });
    }
    return skills;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function skillCommand(context, action, args) {
  if (action === "list") {
    const state = await readState(context.statePath);
    const builtin = await listBuiltinSkills();
    const configured = state.config.skills.map((skill) => ({ ...skill, source: skill.sourcePath ? "configured" : "config" }));
    const byId = new Map();
    for (const skill of builtin) byId.set(skill.id, skill);
    for (const skill of configured) byId.set(skill.id, { ...(byId.get(skill.id) ?? {}), ...skill });
    return { result: { skills: Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id)) } };
  }
  if (action === "show") {
    const id = optionValue(args, "--id").trim();
    const builtin = (await listBuiltinSkills()).find((skill) => skill.id === id);
    const state = await readState(context.statePath);
    const configured = state.config.skills.find((skill) => skill.id === id);
    if (!builtin && !configured) fail(`Skill not found: ${id}`);
    let content = "";
    if (builtin?.path) {
      content = await readFile(path.join(builtin.path, "SKILL.md"), "utf8").catch(() => "");
    }
    return { result: { skill: configured ? { ...builtin, ...configured } : builtin, content } };
  }
  if (action === "enable" || action === "disable") {
    const id = optionValue(args, "--id").trim();
    const beforeState = await readState(context.statePath);
    const afterState = normalizeState(JSON.parse(JSON.stringify(beforeState)));
    let skill = afterState.config.skills.find((item) => item.id === id);
    if (!skill) {
      const builtin = (await listBuiltinSkills()).find((item) => item.id === id);
      if (!builtin) fail(`Skill not found: ${id}`);
      skill = {
        id: builtin.id,
        name: builtin.name,
        description: builtin.description,
        kind: "builtin",
        command: "",
        enabled: true,
        system: true,
      };
      afterState.config.skills.push(skill);
    }
    skill.enabled = action === "enable";
    await writeState(context.statePath, afterState);
    const session = await recordStateMutation(context, `skill ${action}`, beforeState, afterState, ["skills"]);
    return { result: { skill }, session };
  }
  fail(`Unknown skill command: ${action || ""}`);
}

async function toolsCommand(context, action) {
  if (action !== "list") fail(`Unknown tools command: ${action || ""}`);
  const state = await readState(context.statePath);
  const mcpTools = state.config.mcpServers.map((server) => ({
    name: `mcp:${server.id}`,
    source: "mcp",
    enabled: server.enabled !== false,
    serverId: server.id,
  }));
  return { result: { tools: [...BUILTIN_TOOLS, ...mcpTools] } };
}

async function dispatch(context) {
  const [group, action, ...args] = context.rest;
  if (!group || group === "help" || group === "--help" || group === "-h") {
    return { help: usage(context.executableName), command: "help" };
  }
  if (group === "status") return { command: "status", ...(await statusCommand(context)) };
  if (group === "session") return { command: `session ${action || ""}`.trim(), ...(await sessionCommand(context, action, args)) };
  if (group === "config") return { command: `config ${action || ""}`.trim(), ...(await configCommand(context, action, args)) };
  if (group === "model") return { command: `model ${action || ""}`.trim(), ...(await modelCommand(context, action, args)) };
  if (group === "provider") return { command: `provider ${action || ""}`.trim(), ...(await providerAliasCommand(context, action, args)) };
  if (group === "permission") return { command: `permission ${action || ""}`.trim(), ...(await permissionCommand(context, action, args)) };
  if (group === "conversation") return { command: `conversation ${action || ""}`.trim(), ...(await conversationCommand(context, action, args)) };
  if (group === "memory") return { command: `memory ${action || ""}`.trim(), ...(await memoryCommand(context, action, args)) };
  if (group === "knowledge") return { command: `knowledge ${action || ""}`.trim(), ...(await knowledgeCommand(context, action, args)) };
  if (group === "mcp") return { command: `mcp ${action || ""}`.trim(), ...(await mcpCommand(context, action, args)) };
  if (group === "skill") return { command: `skill ${action || ""}`.trim(), ...(await skillCommand(context, action, args)) };
  if (group === "tools") return { command: `tools ${action || ""}`.trim(), ...(await toolsCommand(context, action, args)) };
  fail(`Unknown command: ${[group, action].filter(Boolean).join(" ")}\n\n${usage(context.executableName)}`);
}

function buildEnvelope(context, dispatched) {
  if (dispatched.help) return { help: dispatched.help };
  return {
    ok: true,
    command: dispatched.command,
    paths: contextPaths(context),
    session: summarizeSession(dispatched.session ?? null),
    warnings: dispatched.warnings ?? [],
    ...(dispatched.extras ?? {}),
    result: dispatched.result ?? {},
  };
}

function printResult(result, context) {
  if (context.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.help) {
    process.stdout.write(`${result.help}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printError(error, wantsJson) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = error?.exitCode ?? 1;
}

function splitCommandLine(line) {
  const args = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += "\\";
  if (quote) fail("Unclosed quote in command line.");
  if (current) args.push(current);
  return args;
}

function baseGlobalArgs(context) {
  const args = ["--user-data", context.userData, "--state-path", context.statePath, "--db-path", context.dbPath];
  if (context.sessionSelector) args.push("--session", context.sessionSelector);
  if (context.includeSecrets) args.push("--include-secrets");
  if (context.yes) args.push("--yes");
  return args;
}

async function executeContext(context) {
  const dispatched = await dispatch(context);
  return buildEnvelope(context, dispatched);
}

async function runRepl(baseContext) {
  process.stdout.write(`Super Agents CLI\nType "help" for commands, "exit" to quit.\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: "super-agents> ",
  });
  if (process.stdin.isTTY) rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (process.stdin.isTTY) rl.prompt();
      continue;
    }
    if (trimmed === "exit" || trimmed === "quit") break;

    try {
      const lineArgs = splitCommandLine(trimmed);
      const context = parseGlobalOptions([...baseGlobalArgs(baseContext), ...lineArgs], baseContext.executableName);
      const result = await executeContext(context);
      printResult(result, context);
    } catch (error) {
      printError(error, trimmed.includes("--json"));
    }
    if (process.stdin.isTTY) rl.prompt();
  }
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const executableName = options.executableName || "super-agents";
  const context = parseGlobalOptions(argv, executableName);
  if (context.rest.length === 0) {
    await runRepl(context);
    return;
  }
  const result = await executeContext(context);
  printResult(result, context);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    printError(error, process.argv.includes("--json"));
  });
}
