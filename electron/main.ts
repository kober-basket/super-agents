import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import path from "node:path";

import {
  APP_DATA_DIR,
  APP_NAME,
  APP_WINDOW_TITLE,
  migrateLegacyAppData,
} from "./app-identity";
import { AcpRuntimeManager } from "./acp-runtime-manager";
import { ChatOrchestrator } from "./chat-orchestrator";
import { ConversationService } from "./conversation-service";
import { McpInspector } from "./mcp-inspector";
import { summarizeMapToolResult } from "./project-report";
import { RemoteControlService } from "./remote-control-service";
import { WorkspaceService } from "./workspace-service";
import type {
  AppConfig,
  ChatEvent,
  DesktopWindowState,
  EmergencyPlanInput,
  McpServerConfig,
  McpToolInfo,
  ProjectReportInput,
  WorkspaceTool,
} from "../src/types";

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let service: WorkspaceService | null = null;
let conversationService: ConversationService | null = null;
let remoteControlService: RemoteControlService | null = null;
let acpRuntimeManager: AcpRuntimeManager | null = null;
let chatOrchestrator: ChatOrchestrator | null = null;
const mcpInspector = new McpInspector();

function isTrustedDesktopOrigin(origin: string) {
  return (
    origin.startsWith("file://") ||
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin) ||
    /^https?:\/\/localhost(?::\d+)?$/i.test(origin)
  );
}

function isLikelyMapTool(tool: Pick<WorkspaceTool, "name" | "title" | "description">) {
  const text = [tool.name, tool.title, tool.description].filter(Boolean).join(" ").toLowerCase();
  return /(map|geo|geocode|coordinate|location|amap|gaode|baidu|tencent|place|poi|reverse)/i.test(text);
}

function inferMapArguments(tool: McpToolInfo, input: ProjectReportInput) {
  const params = tool.parameters.map((item) => item.name);
  const lowerMap = new Map(params.map((name) => [name.toLowerCase(), name]));
  const args: Record<string, unknown> = {};
  const query = [input.projectName, input.projectLocation, input.projectType].filter(Boolean).join(" ").trim();
  const lng = input.longitude?.trim();
  const lat = input.latitude?.trim();
  const location = lng && lat ? `${lng},${lat}` : "";

  const assign = (candidates: string[], value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    for (const key of candidates) {
      const matched = lowerMap.get(key);
      if (matched && args[matched] === undefined) {
        args[matched] = value;
        return;
      }
    }
  };

  assign(["query", "q", "keyword", "keywords", "address", "input", "text"], query);
  assign(["projectname", "project_name", "name"], input.projectName.trim());
  assign(["location", "coordinates", "coord", "center", "lnglat"], location || input.projectLocation?.trim());
  assign(["longitude", "lng", "lon"], lng);
  assign(["latitude", "lat"], lat);
  assign(["addressdetail", "formatted_address", "region", "city"], input.projectLocation?.trim());

  if (Object.keys(args).length === 0 && params.length > 0) {
    args[params[0]] = location || query || input.projectName.trim();
  }

  return args;
}

async function resolveMapSummary(input: ProjectReportInput, config: AppConfig) {
  const selectedServerId = input.preferredMapServerId?.trim();
  const selectedToolName = input.preferredMapToolName?.trim();
  const servers = config.mcpServers.filter((server) => server.enabled !== false);

  const candidates: Array<{ server: McpServerConfig; toolName?: string }> = selectedServerId
    ? servers
        .filter((server) => server.id === selectedServerId)
        .map((server) => ({ server, toolName: selectedToolName }))
    : servers.map((server) => ({ server }));

  for (const candidate of candidates) {
    try {
      const inspected = await mcpInspector.inspectServer({
        server: candidate.server,
        workspaceRoot: input.workspaceRoot || config.workspaceRoot,
      });
      const tool =
        (candidate.toolName
          ? inspected.tools.find((item) => item.name === candidate.toolName)
          : inspected.tools.find((item) =>
              isLikelyMapTool({
                name: item.name,
                title: item.title,
                description: item.description,
              }),
            )) ?? null;
      if (!tool) continue;

      const argumentsJson = JSON.stringify(inferMapArguments(tool, input));
      const result = await mcpInspector.debugTool({
        server: candidate.server,
        workspaceRoot: input.workspaceRoot || config.workspaceRoot,
        toolName: tool.name,
        argumentsJson,
      });
      if (result.isError) continue;

      return {
        mapSummary: summarizeMapToolResult(result),
        mapToolUsed: `${candidate.server.name} / ${tool.name}`,
      };
    } catch {
      continue;
    }
  }

  return {
    mapSummary: [
      input.projectLocation?.trim(),
      input.longitude && input.latitude ? `Coordinates: ${input.longitude}, ${input.latitude}` : "",
    ]
      .filter(Boolean)
      .join("; "),
    mapToolUsed: undefined,
  };
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
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

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

app.whenReady().then(async () => {
  await migrateLegacyAppData(app.getPath("appData"));
  const statePath = path.join(app.getPath("userData"), "workspace.json");
  const conversationDatabasePath = path.join(app.getPath("userData"), "data", "app.db");
  service = new WorkspaceService(statePath);
  conversationService = new ConversationService(conversationDatabasePath);
  await conversationService.initialize();
  acpRuntimeManager = new AcpRuntimeManager(app.getPath("appData"));
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
    acpRuntimeManager,
    emitChatEvent,
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

  ipcMain.handle("desktop:send-chat-message", async (_event, payload) => {
    return await conversationService!.sendMessage(payload);
  });

  ipcMain.handle("desktop:delete-conversation", async (_event, conversationId: string) => {
    return await conversationService!.deleteConversation(conversationId);
  });

  ipcMain.handle("desktop:list-knowledge-bases", async () => {
    return await service!.listKnowledgeBases();
  });

  ipcMain.handle("desktop:create-knowledge-base", async (_event, payload: { name: string; description?: string }) => {
    return await service!.createKnowledgeBase(payload);
  });

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

  ipcMain.handle("desktop:generate-project-report", async (_event, payload: ProjectReportInput) => {
    const bootstrap = await service!.bootstrap();
    const mapPayload = await resolveMapSummary(payload, bootstrap.config);
    return await service!.generateProjectReport({
      ...payload,
      workspaceRoot: payload.workspaceRoot || bootstrap.config.workspaceRoot,
      ...mapPayload,
    });
  });

  ipcMain.handle("desktop:generate-emergency-plan", async (_event, payload: EmergencyPlanInput) => {
    const bootstrap = await service!.bootstrap();
    return await service!.generateEmergencyPlan({
      ...payload,
      workspaceRoot: payload.workspaceRoot || bootstrap.config.workspaceRoot,
    });
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

  ipcMain.handle("desktop:list-tools", async () => {
    const observed = await service!.listObservedTools();
    const config = await service!.getConfigSnapshot();
    const mcpTools: WorkspaceTool[] = [];
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

    for (const result of inspectedServers) {
      if (!result) continue;

      for (const tool of result.tools) {
        mcpTools.push({
          id: `mcp:${tool.serverId}:${tool.name}`,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          source: "mcp",
          origin: `${tool.serverName} MCP`,
          serverId: tool.serverId,
          serverName: tool.serverName,
          parameters: tool.parameters,
          taskSupport: tool.taskSupport,
          observed: true,
        });
      }
    }

    const toolMap = new Map<string, WorkspaceTool>();
    for (const tool of [...observed.tools, ...mcpTools]) {
      toolMap.set(tool.id, tool);
    }

    return {
      fetchedAt: Date.now(),
      tools: Array.from(toolMap.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    };
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
  await remoteControlService?.shutdown();
  await conversationService?.shutdown();
  await service?.shutdown();
});
