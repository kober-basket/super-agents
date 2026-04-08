import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import { APP_DATA_DIR, APP_NAME, APP_WINDOW_TITLE, migrateLegacyAppData } from "./app-identity";
import { McpInspector } from "./mcp-inspector";
import { WorkspaceService } from "./workspace-service";
import type { AppConfig, WorkspaceTool } from "../src/types";

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let service: WorkspaceService | null = null;
const mcpInspector = new McpInspector();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#f5f2ed",
    title: APP_WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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

async function broadcastState() {
  if (!service || !mainWindow) return;
  const payload = await service.bootstrap();
  mainWindow.webContents.send("desktop:workspace-changed", payload);
}

function startProgressBroadcast(intervalMs = 250) {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = broadcastState()
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  return async () => {
    stopped = true;
    clearInterval(timer);
    if (inFlight) {
      await inFlight;
    }
    await broadcastState().catch(() => undefined);
  };
}

app.whenReady().then(async () => {
  await migrateLegacyAppData(app.getPath("appData"));
  const statePath = path.join(app.getPath("userData"), "workspace.json");
  service = new WorkspaceService(statePath);

  createWindow();

  ipcMain.handle("desktop:bootstrap", async () => {
    return await service!.bootstrap();
  });

  ipcMain.handle("desktop:list-threads", async () => {
    return await service!.listThreads();
  });

  ipcMain.handle("desktop:get-thread", async (_event, threadId: string) => {
    return await service!.getCurrentThread(threadId);
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
    const thread = await service!.resetThread(threadId);
    await broadcastState();
    return thread;
  });

  ipcMain.handle("desktop:archive-thread", async (_event, payload: { threadId: string; archived: boolean }) => {
    const next = await service!.archiveThread(payload.threadId, payload.archived);
    await broadcastState();
    return next;
  });

  ipcMain.handle("desktop:delete-thread", async (_event, threadId: string) => {
    const next = await service!.deleteThread(threadId);
    await broadcastState();
    return next;
  });

  ipcMain.handle("desktop:send-message", async (_event, payload: { threadId: string; message: string; attachments: unknown[] }) => {
    const stopBroadcast = startProgressBroadcast();
    try {
      return await service!.sendMessage({
        threadId: payload.threadId,
        message: payload.message,
        attachments: Array.isArray(payload.attachments) ? (payload.attachments as any[]) : [],
      });
    } finally {
      await stopBroadcast();
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

  ipcMain.handle("desktop:add-knowledge-note", async (_event, payload: { baseId: string; title: string; content: string }) => {
    return await service!.addKnowledgeNote(payload);
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

  ipcMain.handle("desktop:run-skill", async (_event, payload: { threadId: string; skillId: string; prompt: string }) => {
    const stopBroadcast = startProgressBroadcast();
    try {
      return await service!.runSkill(payload);
    } finally {
      await stopBroadcast();
    }
  });

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

  ipcMain.handle("desktop:set-thread-workspace", async (_event, payload: { threadId: string; workspaceRoot: string }) => {
    const next = await service!.setThreadWorkspace(payload.threadId, payload.workspaceRoot);
    await broadcastState();
    return next;
  });

  ipcMain.handle("desktop:read-preview", async (_event, payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => {
    return await service!.readPreview(payload);
  });

  ipcMain.handle("desktop:open-workspace-folder", async (_event, threadId?: string) => {
    const payload = await service!.bootstrap();
    const threadRoot =
      threadId && payload.threads.find((thread) => thread.id === threadId)?.workspaceRoot;
    const target = threadRoot || payload.config.opencodeRoot;
    if (target) {
      await shell.openPath(target);
    }
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
