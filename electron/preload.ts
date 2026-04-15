import { contextBridge, ipcRenderer } from "electron";

import type {
  AppConfig,
  ChatEvent,
  ChatConversation,
  ChatConversationListPayload,
  ChatSendInput,
  ChatSendResult,
  ChatTurnStartResult,
  BootstrapPayload,
  DesktopWindowState,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeCatalogPayload,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeDeleteItemInput,
  KnowledgeSearchPayload,
  McpInspectInput,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  RemoteControlStatus,
  WechatLoginStartResult,
  WechatLoginWaitResult,
  WorkspaceToolCatalog,
} from "../src/types";

const desktopAgent = {
  bootstrap: () => ipcRenderer.invoke("desktop:bootstrap") as Promise<BootstrapPayload>,
  listConversations: () =>
    ipcRenderer.invoke("desktop:list-conversations") as Promise<ChatConversationListPayload>,
  getConversation: (conversationId: string) =>
    ipcRenderer.invoke("desktop:get-conversation", conversationId) as Promise<ChatConversation>,
  startChatTurn: (payload: ChatSendInput) =>
    ipcRenderer.invoke("desktop:start-chat-turn", payload) as Promise<ChatTurnStartResult>,
  cancelChatTurn: (conversationId: string) =>
    ipcRenderer.invoke("desktop:cancel-chat-turn", conversationId) as Promise<void>,
  sendChatMessage: (payload: ChatSendInput) =>
    ipcRenderer.invoke("desktop:send-chat-message", payload) as Promise<ChatSendResult>,
  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke("desktop:delete-conversation", conversationId) as Promise<ChatConversationListPayload>,
  listKnowledgeBases: () =>
    ipcRenderer.invoke("desktop:list-knowledge-bases") as Promise<KnowledgeCatalogPayload>,
  createKnowledgeBase: (payload: KnowledgeBaseCreateInput) =>
    ipcRenderer.invoke("desktop:create-knowledge-base", payload) as Promise<KnowledgeCatalogPayload>,
  deleteKnowledgeBase: (baseId: string) =>
    ipcRenderer.invoke("desktop:delete-knowledge-base", baseId) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeFiles: (payload: KnowledgeAddFilesInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-files", payload) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeDirectory: (payload: KnowledgeAddDirectoryInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-directory", payload) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeNote: (payload: KnowledgeAddNoteInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-note", payload) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeUrl: (payload: KnowledgeAddUrlInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-url", payload) as Promise<KnowledgeCatalogPayload>,
  addKnowledgeWebsite: (payload: KnowledgeAddUrlInput) =>
    ipcRenderer.invoke("desktop:add-knowledge-website", payload) as Promise<KnowledgeCatalogPayload>,
  deleteKnowledgeItem: (payload: KnowledgeDeleteItemInput) =>
    ipcRenderer.invoke("desktop:delete-knowledge-item", payload) as Promise<KnowledgeCatalogPayload>,
  searchKnowledgeBases: (payload: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }) =>
    ipcRenderer.invoke("desktop:search-knowledge-bases", payload) as Promise<KnowledgeSearchPayload>,
  uninstallSkill: (skillId: string) =>
    ipcRenderer.invoke("desktop:uninstall-skill", skillId) as Promise<BootstrapPayload>,
  updateConfig: (patch: Partial<AppConfig>) =>
    ipcRenderer.invoke("desktop:update-config", patch) as Promise<BootstrapPayload>,
  getRemoteControlStatus: () =>
    ipcRenderer.invoke("desktop:get-remote-control-status") as Promise<RemoteControlStatus>,
  startWechatLogin: () =>
    ipcRenderer.invoke("desktop:start-wechat-login") as Promise<WechatLoginStartResult>,
  waitWechatLogin: (payload: { sessionKey: string; timeoutMs?: number }) =>
    ipcRenderer.invoke("desktop:wait-wechat-login", payload) as Promise<WechatLoginWaitResult>,
  disconnectWechat: () =>
    ipcRenderer.invoke("desktop:disconnect-wechat") as Promise<RemoteControlStatus>,
  fetchProviderModels: (payload: ModelProviderFetchInput) =>
    ipcRenderer.invoke("desktop:fetch-provider-models", payload) as Promise<ModelProviderFetchResult>,
  inspectMcpServer: (payload: McpInspectInput) =>
    ipcRenderer.invoke("desktop:inspect-mcp-server", payload) as Promise<McpServerToolsResult>,
  debugMcpTool: (payload: McpToolDebugInput) =>
    ipcRenderer.invoke("desktop:debug-mcp-tool", payload) as Promise<McpToolDebugResult>,
  listTools: () =>
    ipcRenderer.invoke("desktop:list-tools") as Promise<WorkspaceToolCatalog>,
  selectFiles: () => ipcRenderer.invoke("desktop:select-files") as Promise<FileDropEntry[]>,
  prepareAttachments: (filePaths: string[]) =>
    ipcRenderer.invoke("desktop:prepare-attachments", filePaths) as Promise<FileDropEntry[]>,
  selectWorkspaceFolder: () => ipcRenderer.invoke("desktop:select-workspace-folder") as Promise<string>,
  readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) =>
    ipcRenderer.invoke("desktop:read-preview", payload) as Promise<FilePreviewPayload>,
  openPreviewTarget: (payload: { path?: string; url?: string }) =>
    ipcRenderer.invoke("desktop:open-preview-target", payload) as Promise<void>,
  openWorkspaceFolder: () => ipcRenderer.invoke("desktop:open-workspace-folder") as Promise<void>,
  openFolder: (targetPath: string) => ipcRenderer.invoke("desktop:open-folder", targetPath) as Promise<void>,
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state") as Promise<DesktopWindowState>,
  minimizeWindow: () => ipcRenderer.invoke("desktop:minimize-window") as Promise<DesktopWindowState>,
  toggleMaximizeWindow: () => ipcRenderer.invoke("desktop:toggle-maximize-window") as Promise<DesktopWindowState>,
  closeWindow: () => ipcRenderer.invoke("desktop:close-window") as Promise<void>,
  onWorkspaceChanged: (listener: (payload: BootstrapPayload) => void) => {
    const wrapped = (_event: unknown, payload: BootstrapPayload) => listener(payload);
    ipcRenderer.on("desktop:workspace-changed", wrapped);
    return () => ipcRenderer.removeListener("desktop:workspace-changed", wrapped);
  },
  onWindowStateChanged: (listener: (payload: DesktopWindowState) => void) => {
    const wrapped = (_event: unknown, payload: DesktopWindowState) => listener(payload);
    ipcRenderer.on("desktop:window-state", wrapped);
    return () => ipcRenderer.removeListener("desktop:window-state", wrapped);
  },
  onChatEvent: (listener: (event: ChatEvent) => void) => {
    const wrapped = (_event: unknown, event: ChatEvent) => listener(event);
    ipcRenderer.on("desktop:chat-event", wrapped);
    return () => ipcRenderer.removeListener("desktop:chat-event", wrapped);
  },
};

contextBridge.exposeInMainWorld("desktopAgent", desktopAgent);
