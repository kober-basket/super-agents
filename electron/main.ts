import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import { APP_DATA_DIR, APP_NAME, APP_WINDOW_TITLE, migrateLegacyAppData, migrateLegacyOpencodeConfig } from "./app-identity";
import { McpInspector } from "./mcp-inspector";
import { WorkspaceService } from "./workspace-service";
import type { AppConfig, DesktopWindowState, WorkspaceTool } from "../src/types";

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let service: WorkspaceService | null = null;
const mcpInspector = new McpInspector();

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

  createWindow();

  async function broadcastState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const payload = await service!.bootstrap();
    mainWindow.webContents.send("desktop:workspace-changed", payload);
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
      return await service!.runSkill(payload);
    },
  );

  ipcMain.handle("desktop:uninstall-skill", async (_event, skillId: string) => {
    const payload = await service!.uninstallSkill(skillId);
    await broadcastState();
    return payload;
  });

  ipcMain.handle("desktop:update-config", async (_event, patch: Partial<AppConfig>) => {
    const payload = await service!.updateConfig(patch);
    await broadcastState();
    return payload;
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
    const payload = await service!.bootstrap();
    const mcpTools: WorkspaceTool[] = [];

    for (const server of payload.config.mcpServers) {
      if (!server.enabled) continue;

      try {
        const result = await mcpInspector.inspectServer({
          server,
          workspaceRoot: payload.config.opencodeRoot,
        });

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
      } catch {
        // Keep the tools view responsive even if one MCP server is unavailable.
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
    return await service!.createThread(title);
  });

  ipcMain.handle("desktop:set-active-thread", async (_event, threadId: string) => {
    return await service!.setActiveThread(threadId);
  });

  ipcMain.handle("desktop:reset-thread", async (_event, threadId: string) => {
    return await service!.resetThread(threadId);
  });

  ipcMain.handle("desktop:archive-thread", async (_event, payload: { threadId: string; archived: boolean }) => {
    return await service!.archiveThread(payload.threadId, payload.archived);
  });

  ipcMain.handle("desktop:delete-thread", async (_event, threadId: string) => {
    return await service!.deleteThread(threadId);
  });

  ipcMain.handle("desktop:send-message", async (_event, payload: any) => {
    return await service!.sendMessage(payload);
  });

  ipcMain.handle("desktop:abort-thread", async (_event, threadId?: string) => {
    return await service!.abortThread(threadId);
  });

  ipcMain.handle("desktop:reply-question", async (_event, payload: { requestId: string; sessionId: string; answers: string[][] }) => {
    return await service!.replyQuestion(payload.requestId, payload.sessionId, payload.answers);
  });

  ipcMain.handle("desktop:reject-question", async (_event, payload: { requestId: string; sessionId: string }) => {
    return await service!.rejectQuestion(payload.requestId, payload.sessionId);
  });

  ipcMain.handle("desktop:set-thread-workspace", async (_event, payload: { threadId: string; workspaceRoot: string }) => {
    return await service!.setThreadWorkspace(payload.threadId, payload.workspaceRoot);
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
  await service?.shutdown();
});
