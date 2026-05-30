import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import path from "node:path";

import {
  APP_DATA_DIR,
  APP_NAME,
  APP_WINDOW_TITLE,
  migrateLegacyAppData,
  resolveGeneratedSupportDir,
} from "./app-identity";
import { ChatOrchestrator } from "./chat-orchestrator";
import { BrowserAutomationService } from "./browser-automation-service";
import { installCliShims } from "./cli-shims";
import { exportConversationToFile } from "./conversation-export";
import type { ToolApprovalDecision, ToolApprovalRequest } from "./agent-core";
import { InteractiveTerminalManager } from "./interactive-terminal-manager";
import { ConversationService } from "./conversation-service";
import {
  sanitizeExternalDirectoryApprovalRequestMetadata,
  sanitizeDesktopApprovalDecision,
  sanitizeMailAuthRequestMetadata,
  sanitizeQuestionApprovalRequestMetadata,
} from "./desktop-approval";
import { isTrustedDesktopOrigin } from "./media-permissions";
import { McpInspector } from "./mcp-inspector";
import { RemoteControlService } from "./remote-control-service";
import { buildWorkspaceToolCatalog } from "./tool-catalog";
import { createWebviewWindowOpenPayload } from "./webview-window-open";
import { WorkspaceService } from "./workspace-service";
import type {
  AppConfig,
  ChatConversationExportFormat,
  ChatEvent,
  DesktopApprovalRequest,
  DesktopApprovalResponse,
  DesktopWindowState,
  MailAccountCreateInput,
  MailOAuthAuthorizationInput,
  MailOAuthCodeExchangeInput,
  MailOAuthCredentialsInput,
  MailPasswordCredentialsInput,
  MemoryCreateInput,
  MemorySearchInput,
  MemoryUpdateInput,
  TerminalSessionCreateInput,
  TerminalSessionInput,
  TerminalSessionResizeInput,
} from "../src/types";

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let service: WorkspaceService | null = null;
let conversationService: ConversationService | null = null;
let remoteControlService: RemoteControlService | null = null;
let chatOrchestrator: ChatOrchestrator | null = null;
let browserAutomationService: BrowserAutomationService | null = null;
let terminalManager: InteractiveTerminalManager | null = null;
const mcpInspector = new McpInspector();
const approvedExternalDirectories = new Set<string>();
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const pendingRendererApprovals = new Map<
  string,
  {
    kind: DesktopApprovalRequest["kind"];
    directory?: string;
    resolve: (decision: ToolApprovalDecision) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function isInsideDirectory(candidatePath: string, directoryPath: string) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveTerminalCreateInput(payload: TerminalSessionCreateInput = {}) {
  const config = await service!.getConfigSnapshot();
  const workspaceRoot = path.resolve(
    payload.workspaceRoot?.trim() || config.workspaceRoot.trim() || process.cwd(),
  );
  const cwd = path.resolve(payload.cwd?.trim() || workspaceRoot);

  if (!isInsideDirectory(cwd, workspaceRoot)) {
    throw new Error("Terminal cwd is outside the current workspace.");
  }

  return {
    ...payload,
    cwd,
    workspaceRoot,
  };
}

function getApprovalWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

function externalDirectoryFromRequest(request: ToolApprovalRequest) {
  const directory = request.metadata?.directory;
  if (typeof directory === "string" && directory.trim()) {
    return path.resolve(directory);
  }
  if (typeof request.targetPath === "string" && request.targetPath.trim()) {
    return path.resolve(request.targetPath);
  }
  return "";
}

async function showApprovalMessageBox(options: Electron.MessageBoxOptions) {
  const approvalWindow = getApprovalWindow();
  return approvalWindow
    ? await dialog.showMessageBox(approvalWindow, options)
    : await dialog.showMessageBox(options);
}

function denyPendingRendererApprovals(reason: string) {
  for (const [approvalId, pending] of pendingRendererApprovals) {
    clearTimeout(pending.timeout);
    pending.resolve({ type: "deny", reason });
    pendingRendererApprovals.delete(approvalId);
  }
}

async function requestRendererApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
  const approvalWindow = getApprovalWindow();
  if (
    !approvalWindow ||
    (request.kind !== "mail_auth" && request.kind !== "question" && request.kind !== "external_directory")
  ) {
    return { type: "deny", reason: "Interactive approval is not available." };
  }

  const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const basePayload = {
    approvalId,
    sessionId: request.sessionId,
    agentId: request.agentId,
    toolCallId: request.toolCall.id,
    toolName: request.toolCall.name,
    reason: request.reason,
    createdAt: Date.now(),
  };
  const payload: DesktopApprovalRequest =
    request.kind === "question"
      ? {
          ...basePayload,
          kind: "question",
          metadata: sanitizeQuestionApprovalRequestMetadata(request.metadata),
        }
      : request.kind === "external_directory"
        ? {
            ...basePayload,
            kind: "external_directory",
            metadata: sanitizeExternalDirectoryApprovalRequestMetadata({
              ...request.metadata,
              directory: externalDirectoryFromRequest(request),
              targetPath: request.targetPath,
            }),
          }
        : {
            ...basePayload,
            kind: "mail_auth",
            metadata: sanitizeMailAuthRequestMetadata(request.metadata),
          };

  return await new Promise<ToolApprovalDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRendererApprovals.delete(approvalId);
      resolve({ type: "deny", reason: "Interactive approval timed out." });
    }, APPROVAL_TIMEOUT_MS);

    pendingRendererApprovals.set(approvalId, {
      kind: payload.kind,
      directory: payload.kind === "external_directory" ? payload.metadata.directory : undefined,
      resolve,
      timeout,
    });
    approvalWindow.webContents.send("desktop:approval-request", payload);
  });
}

async function requestToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
  if (request.kind === "external_directory") {
    const directory = externalDirectoryFromRequest(request);
    if (!directory) {
      return { type: "deny", reason: "External directory approval request did not include a directory." };
    }
    for (const approvedDirectory of approvedExternalDirectories) {
      if (isInsideDirectory(directory, approvedDirectory)) {
        return { type: "allow" };
      }
    }
  }

  if (request.kind === "mail_auth" || request.kind === "question" || request.kind === "external_directory") {
    return await requestRendererApproval(request);
  }

  const result = await showApprovalMessageBox({
    type: "question",
    title: "授权执行工具",
    message: "允许 agent 执行这个工具吗？",
    detail: [`工具：${request.toolCall.name}`, request.reason].filter(Boolean).join("\n"),
    buttons: ["允许", "拒绝"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  return result.response === 0
    ? { type: "allow" }
    : { type: "deny", reason: "User denied tool execution." };
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      if (permission !== "media") {
        return false;
      }

      const requestDetails = details as { mediaType?: string; mediaTypes?: string[] };
      const requestsAudio =
        requestDetails.mediaType === "audio" ||
        requestDetails.mediaTypes?.includes("audio") === true;

      return requestsAudio && isTrustedDesktopOrigin(requestingOrigin);
    },
  );

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission !== "media") {
        callback(false);
        return;
      }

      const requestDetails = details as {
        requestingUrl?: string;
        securityOrigin?: string;
        mediaType?: string;
        mediaTypes?: string[];
      };
      const origin = requestDetails.securityOrigin || requestDetails.requestingUrl || "";
      const requestsAudio =
        requestDetails.mediaType === "audio" ||
        requestDetails.mediaTypes?.includes("audio") === true;

      callback(requestsAudio && isTrustedDesktopOrigin(origin));
    },
  );
}

function createWindow() {
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#ece7dd",
    title: APP_WINDOW_TITLE,
    autoHideMenuBar: true,
    frame: isMac,
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.on("closed", () => {
    denyPendingRendererApprovals("Desktop window closed before approval completed.");
    mainWindow = null;
  });

  const emitWindowState = () => {
    if (!mainWindow) return;
    mainWindow.webContents.send("desktop:window-state", getWindowState());
  };

  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
  mainWindow.webContents.on("did-finish-load", emitWindowState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-attach-webview", (_event, webContents) => {
    browserAutomationService?.registerWebContents(webContents);
    webContents.setWindowOpenHandler((details) => {
      const payload = createWebviewWindowOpenPayload(webContents.id, details);
      if (payload && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("desktop:browser-window-open", payload);
      }
      return { action: "deny" };
    });
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const key = input.key.toLowerCase();
    const toggleDevTools =
      key === "f12" ||
      (input.control && input.shift && key === "i") ||
      (input.meta && input.alt && key === "i");

    if (!toggleDevTools) return;

    event.preventDefault();
    mainWindow?.webContents.toggleDevTools();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

function getWindowState(): DesktopWindowState {
  const platform =
    process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";

  return {
    platform,
    maximized: Boolean(mainWindow?.isMaximized() || mainWindow?.isFullScreen()),
  };
}

function normalizeConversationExportFormat(value: unknown): ChatConversationExportFormat {
  if (value === "markdown" || value === "pdf" || value === "word") {
    return value;
  }

  throw new Error("不支持的导出格式");
}

async function renderPdfFromHtml(html: string) {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "default",
      },
    });
  } finally {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

app.whenReady().then(async () => {
  await migrateLegacyAppData(app.getPath("appData"));
  const generatedRuntimeRoot = resolveGeneratedSupportDir(app.getPath("appData"));
  process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT = generatedRuntimeRoot;
  process.env.SUPER_AGENTS_USER_DATA = app.getPath("userData");
  try {
    await installCliShims({
      appPath: app.getAppPath(),
      runtimeRoot: generatedRuntimeRoot,
    });
  } catch (error) {
    console.warn("Failed to install Super Agents CLI shims.", error);
  }

  const statePath = path.join(app.getPath("userData"), "workspace.json");
  const conversationDatabasePath = path.join(app.getPath("userData"), "data", "app.db");
  service = new WorkspaceService(statePath);
  browserAutomationService = new BrowserAutomationService();
  terminalManager = new InteractiveTerminalManager((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("desktop:terminal-event", event);
  });
  conversationService = new ConversationService(conversationDatabasePath, {
    userDataPath: app.getPath("userData"),
  });
  await conversationService.initialize();
  configureMediaPermissions();
  const emitChatEvent = (event: ChatEvent) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("desktop:chat-event", event);
  };

  chatOrchestrator = new ChatOrchestrator(
    conversationService,
    service,
    emitChatEvent,
    requestToolApproval,
    browserAutomationService,
  );
  remoteControlService = new RemoteControlService(statePath, service, chatOrchestrator, {
    onWorkspaceChanged: async () => {
      await broadcastState();
    },
  });
  await remoteControlService.initialize(await service.getConfigSnapshot());

  createWindow();

  async function broadcastState() {
    if (!mainWindow || mainWindow.isDestroyed() || !service) return;
    const payload = await service.bootstrap();
    mainWindow.webContents.send("desktop:workspace-changed", payload);
  }

  ipcMain.handle("desktop:bootstrap", async () => {
    return await service!.bootstrap();
  });

  ipcMain.handle("desktop:list-conversations", async () => {
    return await conversationService!.listConversations();
  });

  ipcMain.handle("desktop:get-conversation", async (_event, conversationId: string) => {
    return await conversationService!.getConversation(conversationId);
  });

  ipcMain.handle("desktop:start-chat-turn", async (_event, payload) => {
    return await chatOrchestrator!.startTurn(payload);
  });

  ipcMain.handle("desktop:cancel-chat-turn", async (_event, conversationId: string) => {
    await chatOrchestrator!.cancelTurn(conversationId);
  });

  ipcMain.handle("desktop:resolve-approval", async (event, payload: DesktopApprovalResponse) => {
    if (mainWindow && event.sender !== mainWindow.webContents) {
      throw new Error("Approval response came from an unexpected renderer.");
    }
    const approvalId = String(payload?.approvalId ?? "");
    const pending = pendingRendererApprovals.get(approvalId);
    if (!pending) {
      return false;
    }

    pendingRendererApprovals.delete(approvalId);
    clearTimeout(pending.timeout);
    const decision = sanitizeDesktopApprovalDecision(pending.kind, payload.decision);
    if (
      pending.kind === "external_directory" &&
      decision.type === "allow" &&
      decision.metadata?.rememberDirectory === true &&
      pending.directory
    ) {
      approvedExternalDirectories.add(pending.directory);
    }
    pending.resolve(decision);
    return true;
  });

  ipcMain.handle("desktop:send-chat-message", async (_event, payload) => {
    return await conversationService!.sendMessage(payload);
  });

  ipcMain.handle("desktop:delete-conversation", async (_event, conversationId: string) => {
    return await conversationService!.deleteConversation(conversationId);
  });

  ipcMain.handle(
    "desktop:update-conversation-workspace-root",
    async (_event, payload: { conversationId?: string; workspaceRoot?: string }) => {
      const conversationId = String(payload?.conversationId ?? "").trim();
      const workspaceRoot = String(payload?.workspaceRoot ?? "").trim();
      if (!conversationId) {
        throw new Error("缺少会话 ID");
      }
      if (!workspaceRoot) {
        throw new Error("请选择工作区");
      }

      return await conversationService!.updateConversationWorkspaceRoot(conversationId, workspaceRoot);
    },
  );

  ipcMain.handle("desktop:export-conversation", async (_event, payload: { conversationId?: string; format?: unknown }) => {
    const conversationId = String(payload?.conversationId ?? "").trim();
    if (!conversationId) {
      throw new Error("缺少会话 ID");
    }

    const format = normalizeConversationExportFormat(payload?.format);
    const config = await service!.getConfigSnapshot();
    const conversation = await conversationService!.getConversation(conversationId);
    const workspaceRoot = conversation.workspaceRoot || config.workspaceRoot.trim();
    if (!workspaceRoot) {
      throw new Error("请先选择工作区后再导出会话");
    }

    return await exportConversationToFile({
      workspaceRoot,
      conversation,
      format,
      renderPdf: format === "pdf" ? renderPdfFromHtml : undefined,
    });
  });

  ipcMain.handle("desktop:list-knowledge-bases", async () => {
    return await service!.listKnowledgeBases();
  });

  ipcMain.handle("desktop:create-knowledge-base", async (_event, payload: { name: string; description?: string }) => {
    return await service!.createKnowledgeBase(payload);
  });

  ipcMain.handle(
    "desktop:update-knowledge-base",
    async (_event, payload: { id: string; name: string; description?: string }) => {
      return await service!.updateKnowledgeBase(payload);
    },
  );

  ipcMain.handle("desktop:delete-knowledge-base", async (_event, baseId: string) => {
    return await service!.deleteKnowledgeBase(baseId);
  });

  ipcMain.handle("desktop:add-knowledge-files", async (_event, payload: { baseId: string; files: unknown[] }) => {
    return await service!.addKnowledgeFiles({
      baseId: payload.baseId,
      files: Array.isArray(payload.files) ? (payload.files as any[]) : [],
    });
  });

  ipcMain.handle("desktop:add-knowledge-directory", async (_event, payload: { baseId: string; directoryPath: string }) => {
    return await service!.addKnowledgeDirectory(payload);
  });

  ipcMain.handle("desktop:add-knowledge-note", async (_event, payload: { baseId: string; title: string; content: string }) => {
    return await service!.addKnowledgeNote(payload);
  });

  ipcMain.handle("desktop:add-knowledge-url", async (_event, payload: { baseId: string; url: string }) => {
    return await service!.addKnowledgeUrl(payload);
  });

  ipcMain.handle("desktop:add-knowledge-website", async (_event, payload: { baseId: string; url: string }) => {
    return await service!.addKnowledgeWebsite(payload);
  });

  ipcMain.handle("desktop:delete-knowledge-item", async (_event, payload: { baseId: string; itemId: string }) => {
    return await service!.deleteKnowledgeItem(payload);
  });

  ipcMain.handle(
    "desktop:search-knowledge-bases",
    async (
      _event,
      payload: { query: string; knowledgeBaseIds?: string[]; documentCount?: number },
    ) => {
      return await service!.searchKnowledgeBases(payload);
    },
  );

  ipcMain.handle("desktop:list-memories", async () => {
    return await service!.listMemories();
  });

  ipcMain.handle("desktop:create-memory", async (_event, payload: MemoryCreateInput) => {
    return await service!.createMemory(payload);
  });

  ipcMain.handle("desktop:update-memory", async (_event, payload: MemoryUpdateInput) => {
    return await service!.updateMemory(payload);
  });

  ipcMain.handle("desktop:delete-memory", async (_event, memoryId: string) => {
    return await service!.deleteMemory(memoryId);
  });

  ipcMain.handle("desktop:search-memories", async (_event, payload: MemorySearchInput) => {
    return await service!.searchMemories(payload);
  });

  ipcMain.handle("desktop:infer-mail-setup", async (_event, email: string) => {
    return service!.inferSetup(String(email ?? ""));
  });

  ipcMain.handle("desktop:list-mail-accounts", async () => {
    return await service!.listAccounts();
  });

  ipcMain.handle("desktop:create-mail-account", async (_event, payload: MailAccountCreateInput) => {
    return await service!.createMailAccount(payload);
  });

  ipcMain.handle("desktop:save-mail-password-credentials", async (_event, payload: MailPasswordCredentialsInput) => {
    return await service!.saveMailPasswordCredentials(payload);
  });

  ipcMain.handle("desktop:save-mail-oauth-credentials", async (_event, payload: MailOAuthCredentialsInput) => {
    return await service!.saveMailOAuthCredentials(payload);
  });

  ipcMain.handle("desktop:create-mail-oauth-authorization", async (_event, payload: MailOAuthAuthorizationInput) => {
    return await service!.createMailOAuthAuthorization(payload);
  });

  ipcMain.handle("desktop:exchange-mail-oauth-code", async (_event, payload: MailOAuthCodeExchangeInput) => {
    return await service!.exchangeMailOAuthCode(payload);
  });

  ipcMain.handle("desktop:disconnect-mail-account", async (_event, accountId: string) => {
    return await service!.disconnectMailAccount(String(accountId ?? ""));
  });

  ipcMain.handle("desktop:remove-mail-account", async (_event, accountId: string) => {
    return await service!.removeMailAccount(String(accountId ?? ""));
  });

  ipcMain.handle("desktop:select-skill-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }

    return result.filePaths[0] ?? "";
  });

  ipcMain.handle("desktop:import-local-skill", async (_event, sourcePath: string) => {
    const result = await service!.importLocalSkill(sourcePath);
    await broadcastState();
    return result;
  });

  ipcMain.handle("desktop:uninstall-skill", async (_event, skillId: string) => {
    const payload = await service!.uninstallSkill(skillId);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:update-config", async (_event, patch: Partial<AppConfig>) => {
    const payload = await service!.updateConfig(patch);
    await remoteControlService?.syncWithConfig(payload.config);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:get-remote-control-status", async () => {
    const config = await service!.getConfigSnapshot();
    return await remoteControlService!.getStatus(config);
  });

  ipcMain.handle("desktop:start-wechat-login", async () => {
    return await remoteControlService!.startWechatLogin();
  });

  ipcMain.handle(
    "desktop:wait-wechat-login",
    async (_event, payload: { sessionKey: string; timeoutMs?: number }) => {
      const result = await remoteControlService!.waitWechatLogin(payload.sessionKey, payload.timeoutMs);
      if (result.connected && result.profile) {
        const config = await service!.getConfigSnapshot();
        const nextRemoteControl = {
          ...config.remoteControl,
          wechat: {
            ...config.remoteControl.wechat,
            enabled: true,
            baseUrl: result.profile.baseUrl,
            cdnBaseUrl: result.profile.cdnBaseUrl,
            botToken: result.profile.botToken,
            accountId: result.profile.accountId,
            userId: result.profile.userId,
            connectedAt: Date.now(),
          },
        };
        const bootstrap = await service!.updateConfig({
          remoteControl: nextRemoteControl,
        });
        await remoteControlService!.syncWithConfig(bootstrap.config);
        await broadcastState();
      }
      return {
        connected: result.connected,
        message: result.message,
        accountId: result.accountId,
        userId: result.userId,
      };
    },
  );

  ipcMain.handle("desktop:disconnect-wechat", async () => {
    remoteControlService!.cancelWechatLogin();
    const config = await service!.getConfigSnapshot();
    const bootstrap = await service!.updateConfig({
      remoteControl: {
        ...config.remoteControl,
        wechat: {
          ...config.remoteControl.wechat,
          enabled: false,
          botToken: "",
          accountId: "",
          userId: "",
          connectedAt: null,
        },
      },
    });
    await remoteControlService!.syncWithConfig(bootstrap.config);
    await broadcastState();
    return await remoteControlService!.getStatus(bootstrap.config);
  });

  ipcMain.handle("desktop:fetch-provider-models", async (_event, payload) => {
    return await service!.fetchProviderModels(payload);
  });

  ipcMain.handle("desktop:transcribe-audio", async (_event, payload) => {
    return await service!.transcribeAudio(payload);
  });

  ipcMain.handle("desktop:inspect-mcp-server", async (_event, payload) => {
    return await mcpInspector.inspectServer(payload);
  });

  ipcMain.handle("desktop:debug-mcp-tool", async (_event, payload) => {
    return await mcpInspector.debugTool(payload);
  });

  ipcMain.handle("desktop:mark-browser-page-active", async (_event, webContentsId: number) => {
    browserAutomationService?.markActivePage(Number(webContentsId));
  });

  ipcMain.handle("desktop:list-tools", async () => {
    const config = await service!.getConfigSnapshot();
    const inspectedServers = await Promise.all(
      config.mcpServers
        .filter((server) => server.enabled)
        .map(async (server) => {
          try {
            return await mcpInspector.inspectServer({
              server,
              workspaceRoot: config.workspaceRoot,
            });
          } catch {
            return null;
          }
        }),
    );

    return buildWorkspaceToolCatalog(inspectedServers);
  });

  ipcMain.handle("desktop:select-files", async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      properties: ["openFile", "multiSelections"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return await service!.selectFiles(result.filePaths);
  });

  ipcMain.handle("desktop:prepare-attachments", async (_event, filePaths: string[]) => {
    return await service!.prepareAttachments(Array.isArray(filePaths) ? filePaths : []);
  });

  ipcMain.handle("desktop:select-workspace-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }

    return result.filePaths[0] ?? "";
  });

  ipcMain.handle("desktop:read-preview", async (_event, payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => {
    return await service!.readPreview(payload);
  });

  ipcMain.handle("desktop:list-workspace-directory", async (_event, payload: { path?: string; workspaceRoot?: string }) => {
    return await service!.listWorkspaceDirectory(payload);
  });

  ipcMain.handle("desktop:run-terminal-command", async (_event, payload: { command: string; cwd?: string; workspaceRoot?: string }) => {
    return await service!.runTerminalCommand(payload);
  });

  ipcMain.handle("desktop:create-terminal-session", async (_event, payload: TerminalSessionCreateInput) => {
    return await terminalManager!.createTerminalSession(await resolveTerminalCreateInput(payload));
  });

  ipcMain.handle("desktop:write-terminal-input", async (_event, payload: TerminalSessionInput) => {
    return await terminalManager!.writeTerminalInput(payload);
  });

  ipcMain.handle("desktop:resize-terminal-session", async (_event, payload: TerminalSessionResizeInput) => {
    return await terminalManager!.resizeTerminalSession(payload);
  });

  ipcMain.handle("desktop:clear-terminal-session", async (_event, terminalId: string) => {
    return await terminalManager!.clearTerminalSession({ terminalId });
  });

  ipcMain.handle("desktop:stop-terminal-session", async (_event, terminalId: string) => {
    return await terminalManager!.stopTerminalSession({ terminalId });
  });

  ipcMain.handle("desktop:restart-terminal-session", async (_event, terminalId: string) => {
    return await terminalManager!.restartTerminalSession({ terminalId });
  });

  ipcMain.handle("desktop:release-terminal-session", async (_event, terminalId: string) => {
    await terminalManager!.releaseTerminalSession({ terminalId });
  });

  ipcMain.handle("desktop:open-preview-target", async (_event, payload: { path?: string; url?: string }) => {
    const externalUrl = payload.url?.trim();
    if (externalUrl?.startsWith("http://") || externalUrl?.startsWith("https://")) {
      await shell.openExternal(externalUrl);
      return;
    }

    const targetPath = payload.path?.trim();
    if (!targetPath) {
      throw new Error("Missing preview target");
    }

    const error = await shell.openPath(targetPath);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("desktop:open-workspace-folder", async () => {
    const payload = await service!.bootstrap();
    const target = payload.config.workspaceRoot;
    if (target) {
      await shell.openPath(target);
    }
  });

  ipcMain.handle("desktop:open-folder", async (_event, targetPath: string) => {
    const target = String(targetPath || "").trim();
    if (!target) {
      throw new Error("Missing folder path");
    }

    const error = await shell.openPath(target);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("desktop:get-window-state", async () => getWindowState());

  ipcMain.handle("desktop:minimize-window", async () => {
    mainWindow?.minimize();
    return getWindowState();
  });

  ipcMain.handle("desktop:toggle-maximize-window", async () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }

    return getWindowState();
  });

  ipcMain.handle("desktop:close-window", async () => {
    mainWindow?.close();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await terminalManager?.shutdown();
  await remoteControlService?.shutdown();
  await conversationService?.shutdown();
  await service?.shutdown();
});
