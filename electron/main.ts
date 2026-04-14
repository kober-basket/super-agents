import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import {
  APP_DATA_DIR,
  APP_NAME,
  APP_WINDOW_TITLE,
  migrateLegacyAppData,
} from "./app-identity";
import { McpInspector } from "./mcp-inspector";
import { RemoteControlService } from "./remote-control-service";
import { WorkspaceService } from "./workspace-service";
import type { AppConfig, DesktopWindowState, WorkspaceTool } from "../src/types";

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let service: WorkspaceService | null = null;
let remoteControlService: RemoteControlService | null = null;
const mcpInspector = new McpInspector();
let currentChatMonitor: ReturnType<typeof setTimeout> | null = null;
let currentChatActivityVersion = 0;
let currentChatAbortingStartedAt = 0;

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
  service = new WorkspaceService(statePath);
  remoteControlService = new RemoteControlService(statePath, service, {
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

  function stopCurrentChatMonitor() {
    if (!currentChatMonitor) return;
    clearTimeout(currentChatMonitor);
    currentChatMonitor = null;
  }

  function bumpCurrentChatActivityVersion() {
    currentChatActivityVersion += 1;
    return currentChatActivityVersion;
  }

  function markCurrentChatAborting() {
    currentChatAbortingStartedAt = Date.now();
  }

  function clearCurrentChatAborting() {
    currentChatAbortingStartedAt = 0;
  }

  function isCurrentChatAborting() {
    if (!currentChatAbortingStartedAt) return false;
    if (Date.now() - currentChatAbortingStartedAt > 5_000) {
      currentChatAbortingStartedAt = 0;
      return false;
    }
    return true;
  }

  async function monitorCurrentChatProgress(
    intervalMs = 400,
    finalPass = false,
    activityVersion = currentChatActivityVersion,
  ) {
    if (!service) return;
    if (isCurrentChatAborting() || activityVersion !== currentChatActivityVersion) {
      stopCurrentChatMonitor();
      return;
    }

    stopCurrentChatMonitor();

    try {
      const progress = await service.getCurrentChatProgress();
      if (isCurrentChatAborting() || activityVersion !== currentChatActivityVersion) {
        stopCurrentChatMonitor();
        return;
      }

      if (!progress.busy && !progress.blockedOnQuestion && !finalPass) {
        currentChatMonitor = setTimeout(() => {
          void monitorCurrentChatProgress(intervalMs, true, activityVersion);
        }, intervalMs);
        return;
      }

      await broadcastState();

      if (progress.blockedOnQuestion) {
        stopCurrentChatMonitor();
        return;
      }

      if (!progress.busy) {
        if (finalPass) {
          stopCurrentChatMonitor();
          return;
        }

        currentChatMonitor = setTimeout(() => {
          void monitorCurrentChatProgress(intervalMs, true, activityVersion);
        }, intervalMs);
        return;
      }

      currentChatMonitor = setTimeout(() => {
        void monitorCurrentChatProgress(intervalMs, false, activityVersion);
      }, intervalMs);
    } catch {
      stopCurrentChatMonitor();
    }
  }

  async function continueMonitoringCurrentChatIfNeeded(activityVersion = currentChatActivityVersion) {
    if (!service) return;
    if (isCurrentChatAborting() || activityVersion !== currentChatActivityVersion) {
      stopCurrentChatMonitor();
      return;
    }

    try {
      const progress = await service.getCurrentChatProgress();
      if (isCurrentChatAborting() || activityVersion !== currentChatActivityVersion) {
        stopCurrentChatMonitor();
        return;
      }

      if (progress.busy || progress.blockedOnQuestion) {
        void monitorCurrentChatProgress(400, false, activityVersion);
      } else {
        stopCurrentChatMonitor();
      }
    } catch {
      stopCurrentChatMonitor();
    }
  }

  ipcMain.handle("desktop:bootstrap", async () => {
    return await service!.bootstrap();
  });

  ipcMain.handle("desktop:send-message", async (_event, payload) => {
    const requestedActivityVersion = bumpCurrentChatActivityVersion();
    const result = await service!.sendMessage(payload);
    await continueMonitoringCurrentChatIfNeeded(requestedActivityVersion);
    await broadcastState();
    return result;
  });

  ipcMain.handle("desktop:select-current-chat-session", async (_event, sessionId: string) => {
    bumpCurrentChatActivityVersion();
    stopCurrentChatMonitor();
    const payload = await service!.selectCurrentChatSession(sessionId);
    await continueMonitoringCurrentChatIfNeeded();
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:reset-current-chat", async () => {
    bumpCurrentChatActivityVersion();
    stopCurrentChatMonitor();
    const payload = await service!.resetCurrentChat();
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:archive-chat-session", async (_event, sessionId: string) => {
    bumpCurrentChatActivityVersion();
    stopCurrentChatMonitor();
    const payload = await service!.archiveChatSession(sessionId);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:unarchive-chat-session", async (_event, sessionId: string) => {
    const payload = await service!.unarchiveChatSession(sessionId);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:delete-chat-session", async (_event, sessionId: string) => {
    bumpCurrentChatActivityVersion();
    stopCurrentChatMonitor();
    const payload = await service!.deleteChatSession(sessionId);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:abort-current-chat", async () => {
    bumpCurrentChatActivityVersion();
    stopCurrentChatMonitor();
    markCurrentChatAborting();
    try {
      const payload = await service!.abortCurrentChat();
      await broadcastState();
      return payload;
    } finally {
      clearCurrentChatAborting();
    }
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
  stopCurrentChatMonitor();
  await remoteControlService?.shutdown();
  await service?.shutdown();
});
