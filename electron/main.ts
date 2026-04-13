import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import { APP_DATA_DIR, APP_NAME, APP_WINDOW_TITLE, migrateLegacyAppData, migrateLegacyOpencodeConfig } from "./app-identity";
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
const threadMonitors = new Map<string, ReturnType<typeof setTimeout>>();
const abortingThreads = new Map<string, number>();
const threadActivityVersions = new Map<string, number>();

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
  await migrateLegacyOpencodeConfig(app.getPath("appData"));
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
    const payload = await service!.bootstrap();
    mainWindow.webContents.send("desktop:workspace-changed", payload);
  }

  function stopThreadMonitor(threadId: string) {
    const timer = threadMonitors.get(threadId);
    if (!timer) return;
    clearTimeout(timer);
    threadMonitors.delete(threadId);
  }

  function getThreadActivityVersion(threadId?: string) {
    if (!threadId) return 0;
    return threadActivityVersions.get(threadId) ?? 0;
  }

  function bumpThreadActivityVersion(threadId?: string) {
    if (!threadId) return 0;
    const nextVersion = getThreadActivityVersion(threadId) + 1;
    threadActivityVersions.set(threadId, nextVersion);
    return nextVersion;
  }

  function markThreadAborting(threadId?: string) {
    if (!threadId) return;
    abortingThreads.set(threadId, Date.now());
  }

  function clearThreadAborting(threadId?: string) {
    if (!threadId) return;
    abortingThreads.delete(threadId);
  }

  function isThreadAborting(threadId?: string) {
    if (!threadId) return false;
    const startedAt = abortingThreads.get(threadId);
    if (!startedAt) return false;
    if (Date.now() - startedAt > 5_000) {
      abortingThreads.delete(threadId);
      return false;
    }
    return true;
  }

  async function monitorThreadProgress(
    threadId: string,
    intervalMs = 400,
    finalPass = false,
    activityVersion = getThreadActivityVersion(threadId),
  ) {
    if (!service || !threadId) return;
    if (isThreadAborting(threadId) || activityVersion !== getThreadActivityVersion(threadId)) {
      stopThreadMonitor(threadId);
      return;
    }

    stopThreadMonitor(threadId);

    try {
      const progress = await service.getThreadProgress(threadId);

      if (isThreadAborting(threadId) || activityVersion !== getThreadActivityVersion(threadId)) {
        stopThreadMonitor(threadId);
        return;
      }

      if (!progress.busy && !progress.blockedOnQuestion && !finalPass) {
        const timer = setTimeout(() => {
          void monitorThreadProgress(threadId, intervalMs, true, activityVersion);
        }, intervalMs);
        threadMonitors.set(threadId, timer);
        return;
      }

      await broadcastState();

      if (progress.blockedOnQuestion) {
        stopThreadMonitor(threadId);
        return;
      }

      if (!progress.busy) {
        if (finalPass) {
          stopThreadMonitor(threadId);
          return;
        }

        const timer = setTimeout(() => {
          void monitorThreadProgress(threadId, intervalMs, true, activityVersion);
        }, intervalMs);
        threadMonitors.set(threadId, timer);
        return;
      }

      const timer = setTimeout(() => {
        void monitorThreadProgress(threadId, intervalMs, false, activityVersion);
      }, intervalMs);
      threadMonitors.set(threadId, timer);
    } catch {
      stopThreadMonitor(threadId);
    }
  }

  async function continueMonitoringIfNeeded(
    threadId?: string,
    activityVersion = getThreadActivityVersion(threadId),
  ) {
    if (!service || !threadId) return;
    if (isThreadAborting(threadId) || activityVersion !== getThreadActivityVersion(threadId)) {
      stopThreadMonitor(threadId);
      return;
    }
    try {
      const progress = await service.getThreadProgress(threadId);
      if (isThreadAborting(threadId) || activityVersion !== getThreadActivityVersion(threadId)) {
        stopThreadMonitor(threadId);
        return;
      }
      if (progress.busy || progress.blockedOnQuestion) {
        void monitorThreadProgress(threadId, 400, false, activityVersion);
      } else {
        stopThreadMonitor(threadId);
      }
    } catch {
      stopThreadMonitor(threadId);
    }
  }

  ipcMain.handle("desktop:bootstrap", async () => {
    return await service!.bootstrap();
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

  ipcMain.handle(
    "desktop:run-skill",
    async (_event, payload: { threadId?: string; workspaceRoot?: string; skillId: string; prompt: string }) => {
      const requestedThreadId = payload.threadId?.trim() || undefined;
      const requestedActivityVersion = getThreadActivityVersion(requestedThreadId);
      const result = await service!.runSkill(payload);
      const threadId = result.thread?.id || requestedThreadId;
      const currentActivityVersion = getThreadActivityVersion(threadId);
      if (
        threadId &&
        (isThreadAborting(threadId) || currentActivityVersion !== requestedActivityVersion)
      ) {
        return result;
      }
      await continueMonitoringIfNeeded(threadId, currentActivityVersion);
      await broadcastState();
      return result;
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
              workspaceRoot: config.opencodeRoot,
            });
          } catch {
            // Keep the tools view responsive even if one MCP server is unavailable.
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
    const target = payload.config.opencodeRoot;
    if (target) {
      await shell.openPath(target);
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

  ipcMain.handle("desktop:list-threads", async () => {
    return await service!.listThreads();
  });

  ipcMain.handle("desktop:get-thread", async (_event, threadId: string) => {
    return await service!.getThread(threadId);
  });

  ipcMain.handle("desktop:create-thread", async (_event, title?: string) => {
    const payload = await service!.createThread(title);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:set-active-thread", async (_event, threadId: string) => {
    const thread = await service!.setActiveThread(threadId);
    await broadcastState();
    return thread;
  });

  ipcMain.handle("desktop:reset-thread", async (_event, threadId: string) => {
    bumpThreadActivityVersion(threadId);
    stopThreadMonitor(threadId);
    const thread = await service!.resetThread(threadId);
    await broadcastState();
    return thread;
  });

  ipcMain.handle("desktop:archive-thread", async (_event, payload: { threadId: string; archived: boolean }) => {
    const result = await service!.archiveThread(payload.threadId, payload.archived);
    await broadcastState();
    return result;
  });

  ipcMain.handle("desktop:delete-thread", async (_event, threadId: string) => {
    bumpThreadActivityVersion(threadId);
    stopThreadMonitor(threadId);
    const payload = await service!.deleteThread(threadId);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:send-message", async (_event, payload: any) => {
    const requestedThreadId = typeof payload?.threadId === "string" ? payload.threadId.trim() : "";
    const requestedActivityVersion = getThreadActivityVersion(requestedThreadId || undefined);
    const result = await service!.sendMessage(payload);
    const threadId = result.thread?.id || requestedThreadId || undefined;
    const currentActivityVersion = getThreadActivityVersion(threadId);
    if (
      threadId &&
      (isThreadAborting(threadId) || currentActivityVersion !== requestedActivityVersion)
    ) {
      return result;
    }
    if (!isThreadAborting(threadId)) {
      await continueMonitoringIfNeeded(threadId, currentActivityVersion);
      await broadcastState();
    }
    return result;
  });

  ipcMain.handle("desktop:abort-thread", async (_event, threadId?: string) => {
    bumpThreadActivityVersion(threadId);
    markThreadAborting(threadId);
    if (threadId) {
      stopThreadMonitor(threadId);
    }
    try {
      const payload = await service!.abortThread(threadId);
      await broadcastState();
      return payload;
    } finally {
      clearThreadAborting(threadId);
    }
  });

  ipcMain.handle("desktop:reply-question", async (_event, payload: { requestId: string; sessionId: string; answers: string[][] }) => {
    const result = await service!.replyQuestion(payload.requestId, payload.sessionId, payload.answers);
    void monitorThreadProgress(payload.sessionId);
    await broadcastState();
    return result;
  });

  ipcMain.handle("desktop:reject-question", async (_event, payload: { requestId: string; sessionId: string }) => {
    const result = await service!.rejectQuestion(payload.requestId, payload.sessionId);
    void monitorThreadProgress(payload.sessionId);
    await broadcastState();
    return result;
  });

  ipcMain.handle("desktop:set-thread-workspace", async (_event, payload: { threadId: string; workspaceRoot: string }) => {
    const result = await service!.setThreadWorkspace(payload.threadId, payload.workspaceRoot);
    await broadcastState();
    return result;
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
  for (const timer of threadMonitors.values()) {
    clearTimeout(timer);
  }
  threadMonitors.clear();
  await remoteControlService?.shutdown();
  await service?.shutdown();
});
