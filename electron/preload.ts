import { contextBridge, ipcRenderer } from "electron";

import type {
  AppConfig,
  BootstrapPayload,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeCatalogPayload,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeBaseCreateInput,
  KnowledgeSearchPayload,
  McpInspectInput,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  SendMessageInput,
  SendMessageResult,
  SkillRunInput,
  SkillRunResult,
  ThreadRecord,
  ThreadSummary,
  WorkspaceToolCatalog,
} from "../src/types";

const desktopAgent = {
  bootstrap: () => ipcRenderer.invoke("desktop:bootstrap") as Promise<BootstrapPayload>,
  listThreads: () => ipcRenderer.invoke("desktop:list-threads") as Promise<ThreadSummary[]>,
  getThread: (threadId: string) => ipcRenderer.invoke("desktop:get-thread", threadId) as Promise<ThreadRecord>,
  createThread: (title?: string) =>
    ipcRenderer.invoke("desktop:create-thread", title) as Promise<BootstrapPayload>,
  setActiveThread: (threadId: string) =>
    ipcRenderer.invoke("desktop:set-active-thread", threadId) as Promise<ThreadRecord>,
  resetThread: (threadId: string) =>
    ipcRenderer.invoke("desktop:reset-thread", threadId) as Promise<ThreadRecord>,
  archiveThread: (threadId: string, archived: boolean) =>
    ipcRenderer.invoke("desktop:archive-thread", { threadId, archived }) as Promise<BootstrapPayload>,
  deleteThread: (threadId: string) =>
    ipcRenderer.invoke("desktop:delete-thread", threadId) as Promise<BootstrapPayload>,
  sendMessage: (payload: SendMessageInput) =>
    ipcRenderer.invoke("desktop:send-message", payload) as Promise<SendMessageResult>,
  listKnowledgeBases: () =>
    ipcRenderer.invoke("desktop:list-knowledge-bases") as Promise<KnowledgeCatalogPayload>,
  createKnowledgeBase: (payload: KnowledgeBaseCreateInput) =>
    ipcRenderer.invoke("desktop:create-knowledge-base", payload) as Promise<KnowledgeCatalogPayload>,
  deleteKnowledgeBase: (baseId: string) =>
    ipcRenderer.invoke("desktop:delete-knowledge-base", baseId) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeFiles: (payload: KnowledgeAddFilesInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-files", payload) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeNote: (payload: KnowledgeAddNoteInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-note", payload) as Promise<KnowledgeCatalogPayload>,
  searchKnowledgeBases: (payload: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }) =>
    ipcRenderer.invoke("desktop:search-knowledge-bases", payload) as Promise<KnowledgeSearchPayload>,
  runSkill: (payload: SkillRunInput) =>
    ipcRenderer.invoke("desktop:run-skill", payload) as Promise<SkillRunResult>,
  uninstallSkill: (skillId: string) =>
    ipcRenderer.invoke("desktop:uninstall-skill", skillId) as Promise<BootstrapPayload>,
  updateConfig: (patch: Partial<AppConfig>) =>
    ipcRenderer.invoke("desktop:update-config", patch) as Promise<BootstrapPayload>,
  fetchProviderModels: (payload: ModelProviderFetchInput) =>
    ipcRenderer.invoke("desktop:fetch-provider-models", payload) as Promise<ModelProviderFetchResult>,
  inspectMcpServer: (payload: McpInspectInput) =>
    ipcRenderer.invoke("desktop:inspect-mcp-server", payload) as Promise<McpServerToolsResult>,
  debugMcpTool: (payload: McpToolDebugInput) =>
    ipcRenderer.invoke("desktop:debug-mcp-tool", payload) as Promise<McpToolDebugResult>,
  listTools: () =>
    ipcRenderer.invoke("desktop:list-tools") as Promise<WorkspaceToolCatalog>,
  selectFiles: () => ipcRenderer.invoke("desktop:select-files") as Promise<FileDropEntry[]>,
  selectWorkspaceFolder: () => ipcRenderer.invoke("desktop:select-workspace-folder") as Promise<string>,
  setThreadWorkspace: (threadId: string, workspaceRoot: string) =>
    ipcRenderer.invoke("desktop:set-thread-workspace", { threadId, workspaceRoot }) as Promise<BootstrapPayload>,
  readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) =>
    ipcRenderer.invoke("desktop:read-preview", payload) as Promise<FilePreviewPayload>,
  openWorkspaceFolder: (threadId?: string) => ipcRenderer.invoke("desktop:open-workspace-folder", threadId) as Promise<void>,
  onWorkspaceChanged: (listener: (payload: BootstrapPayload) => void) => {
    const wrapped = (_event: unknown, payload: BootstrapPayload) => listener(payload);
    ipcRenderer.on("desktop:workspace-changed", wrapped);
    return () => ipcRenderer.removeListener("desktop:workspace-changed", wrapped);
  },
  onGatewayEvent: (listener: (payload: BootstrapPayload) => void) => {
    const wrapped = (_event: unknown, payload: BootstrapPayload) => listener(payload);
    ipcRenderer.on("desktop:workspace-changed", wrapped);
    return () => ipcRenderer.removeListener("desktop:workspace-changed", wrapped);
  },
};

contextBridge.exposeInMainWorld("desktopAgent", desktopAgent);
