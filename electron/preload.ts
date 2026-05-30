import { clipboard, contextBridge, ipcRenderer } from "electron";

import type {
  AppConfig,
  AudioTranscriptionInput,
  AudioTranscriptionResult,
  ChatEvent,
  ChatConversation,
  ChatConversationExportInput,
  ChatConversationExportResult,
  ChatConversationListPayload,
  ChatSendInput,
  ChatSendResult,
  ChatTurnStartResult,
  BootstrapPayload,
  DesktopApprovalRequest,
  DesktopApprovalResponse,
  DesktopWindowState,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeCatalogPayload,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeDeleteItemInput,
  KnowledgeSearchPayload,
  MailAccountCreateInput,
  MailAccountSummary,
  MailOAuthAuthorization,
  MailOAuthAuthorizationInput,
  MailOAuthCodeExchangeInput,
  MailOAuthCredentialsInput,
  MailPasswordCredentialsInput,
  MailProviderSetup,
  MemoryCatalogPayload,
  MemoryCreateInput,
  MemorySearchInput,
  MemorySearchPayload,
  MemoryUpdateInput,
  McpInspectInput,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  RemoteControlStatus,
  SkillImportResult,
  TerminalCommandResult,
  TerminalSessionCreateInput,
  TerminalSessionEvent,
  TerminalSessionInput,
  TerminalSessionResizeInput,
  TerminalSessionSnapshot,
  WebviewWindowOpenPayload,
  WechatLoginStartResult,
  WechatLoginWaitResult,
  WorkspaceDirectoryListing,
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
  updateConversationWorkspaceRoot: (payload: { conversationId: string; workspaceRoot: string; }) =>
    ipcRenderer.invoke("desktop:update-conversation-workspace-root", payload) as Promise<ChatConversation>,
  exportConversation: (payload: ChatConversationExportInput) =>
    ipcRenderer.invoke("desktop:export-conversation", payload) as Promise<ChatConversationExportResult>,
  writeClipboardText: (text: string) => {
    clipboard.writeText(text);
    return Promise.resolve();
  },
  listKnowledgeBases: () =>
    ipcRenderer.invoke("desktop:list-knowledge-bases") as Promise<KnowledgeCatalogPayload>,
  createKnowledgeBase: (payload: KnowledgeBaseCreateInput) =>
    ipcRenderer.invoke("desktop:create-knowledge-base", payload) as Promise<KnowledgeCatalogPayload>,
  updateKnowledgeBase: (payload: KnowledgeBaseUpdateInput) =>
    ipcRenderer.invoke("desktop:update-knowledge-base", payload) as Promise<KnowledgeCatalogPayload>,
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
  listMemories: () =>
    ipcRenderer.invoke("desktop:list-memories") as Promise<MemoryCatalogPayload>,
  createMemory: (payload: MemoryCreateInput) =>
    ipcRenderer.invoke("desktop:create-memory", payload) as Promise<MemoryCatalogPayload>,
  updateMemory: (payload: MemoryUpdateInput) =>
    ipcRenderer.invoke("desktop:update-memory", payload) as Promise<MemoryCatalogPayload>,
  deleteMemory: (memoryId: string) =>
    ipcRenderer.invoke("desktop:delete-memory", memoryId) as Promise<MemoryCatalogPayload>,
  searchMemories: (payload: MemorySearchInput) =>
    ipcRenderer.invoke("desktop:search-memories", payload) as Promise<MemorySearchPayload>,
  inferMailSetup: (email: string) =>
    ipcRenderer.invoke("desktop:infer-mail-setup", email) as Promise<MailProviderSetup>,
  listMailAccounts: () =>
    ipcRenderer.invoke("desktop:list-mail-accounts") as Promise<MailAccountSummary[]>,
  createMailAccount: (payload: MailAccountCreateInput) =>
    ipcRenderer.invoke("desktop:create-mail-account", payload) as Promise<MailAccountSummary>,
  saveMailPasswordCredentials: (payload: MailPasswordCredentialsInput) =>
    ipcRenderer.invoke("desktop:save-mail-password-credentials", payload) as Promise<MailAccountSummary>,
  saveMailOAuthCredentials: (payload: MailOAuthCredentialsInput) =>
    ipcRenderer.invoke("desktop:save-mail-oauth-credentials", payload) as Promise<MailAccountSummary>,
  createMailOAuthAuthorization: (payload: MailOAuthAuthorizationInput) =>
    ipcRenderer.invoke("desktop:create-mail-oauth-authorization", payload) as Promise<MailOAuthAuthorization>,
  exchangeMailOAuthCode: (payload: MailOAuthCodeExchangeInput) =>
    ipcRenderer.invoke("desktop:exchange-mail-oauth-code", payload) as Promise<MailAccountSummary>,
  disconnectMailAccount: (accountId: string) =>
    ipcRenderer.invoke("desktop:disconnect-mail-account", accountId) as Promise<MailAccountSummary[]>,
  removeMailAccount: (accountId: string) =>
    ipcRenderer.invoke("desktop:remove-mail-account", accountId) as Promise<MailAccountSummary[]>,
  selectSkillFolder: () => ipcRenderer.invoke("desktop:select-skill-folder") as Promise<string>,
  importLocalSkill: (sourcePath: string) =>
    ipcRenderer.invoke("desktop:import-local-skill", sourcePath) as Promise<SkillImportResult>,
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
  transcribeAudio: (payload: AudioTranscriptionInput) =>
    ipcRenderer.invoke("desktop:transcribe-audio", payload) as Promise<AudioTranscriptionResult>,
  inspectMcpServer: (payload: McpInspectInput) =>
    ipcRenderer.invoke("desktop:inspect-mcp-server", payload) as Promise<McpServerToolsResult>,
  debugMcpTool: (payload: McpToolDebugInput) =>
    ipcRenderer.invoke("desktop:debug-mcp-tool", payload) as Promise<McpToolDebugResult>,
  markBrowserPageActive: (webContentsId: number) =>
    ipcRenderer.invoke("desktop:mark-browser-page-active", webContentsId) as Promise<void>,
  listTools: () =>
    ipcRenderer.invoke("desktop:list-tools") as Promise<WorkspaceToolCatalog>,
  selectFiles: () => ipcRenderer.invoke("desktop:select-files") as Promise<FileDropEntry[]>,
  prepareAttachments: (filePaths: string[]) =>
    ipcRenderer.invoke("desktop:prepare-attachments", filePaths) as Promise<FileDropEntry[]>,
  selectWorkspaceFolder: () => ipcRenderer.invoke("desktop:select-workspace-folder") as Promise<string>,
  listWorkspaceDirectory: (payload?: { path?: string; workspaceRoot?: string }) =>
    ipcRenderer.invoke("desktop:list-workspace-directory", payload ?? {}) as Promise<WorkspaceDirectoryListing>,
  readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) =>
    ipcRenderer.invoke("desktop:read-preview", payload) as Promise<FilePreviewPayload>,
  runTerminalCommand: (payload: { command: string; cwd?: string; workspaceRoot?: string }) =>
    ipcRenderer.invoke("desktop:run-terminal-command", payload) as Promise<TerminalCommandResult>,
  createTerminalSession: (payload: TerminalSessionCreateInput) =>
    ipcRenderer.invoke("desktop:create-terminal-session", payload) as Promise<TerminalSessionSnapshot>,
  writeTerminalInput: (payload: TerminalSessionInput) =>
    ipcRenderer.invoke("desktop:write-terminal-input", payload) as Promise<TerminalSessionSnapshot>,
  resizeTerminalSession: (payload: TerminalSessionResizeInput) =>
    ipcRenderer.invoke("desktop:resize-terminal-session", payload) as Promise<TerminalSessionSnapshot>,
  clearTerminalSession: (terminalId: string) =>
    ipcRenderer.invoke("desktop:clear-terminal-session", terminalId) as Promise<TerminalSessionSnapshot>,
  stopTerminalSession: (terminalId: string) =>
    ipcRenderer.invoke("desktop:stop-terminal-session", terminalId) as Promise<TerminalSessionSnapshot>,
  restartTerminalSession: (terminalId: string) =>
    ipcRenderer.invoke("desktop:restart-terminal-session", terminalId) as Promise<TerminalSessionSnapshot>,
  releaseTerminalSession: (terminalId: string) =>
    ipcRenderer.invoke("desktop:release-terminal-session", terminalId) as Promise<void>,
  openPreviewTarget: (payload: { path?: string; url?: string }) =>
    ipcRenderer.invoke("desktop:open-preview-target", payload) as Promise<void>,
  openWorkspaceFolder: () => ipcRenderer.invoke("desktop:open-workspace-folder") as Promise<void>,
  openFolder: (targetPath: string) => ipcRenderer.invoke("desktop:open-folder", targetPath) as Promise<void>,
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state") as Promise<DesktopWindowState>,
  minimizeWindow: () => ipcRenderer.invoke("desktop:minimize-window") as Promise<DesktopWindowState>,
  toggleMaximizeWindow: () => ipcRenderer.invoke("desktop:toggle-maximize-window") as Promise<DesktopWindowState>,
  closeWindow: () => ipcRenderer.invoke("desktop:close-window") as Promise<void>,
  respondToApproval: (payload: DesktopApprovalResponse) =>
    ipcRenderer.invoke("desktop:resolve-approval", payload) as Promise<boolean>,
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
  onApprovalRequest: (listener: (request: DesktopApprovalRequest) => void) => {
    const wrapped = (_event: unknown, request: DesktopApprovalRequest) => listener(request);
    ipcRenderer.on("desktop:approval-request", wrapped);
    return () => ipcRenderer.removeListener("desktop:approval-request", wrapped);
  },
  onBrowserWindowOpen: (listener: (payload: WebviewWindowOpenPayload) => void) => {
    const wrapped = (_event: unknown, payload: WebviewWindowOpenPayload) => listener(payload);
    ipcRenderer.on("desktop:browser-window-open", wrapped);
    return () => ipcRenderer.removeListener("desktop:browser-window-open", wrapped);
  },
  onTerminalEvent: (listener: (event: TerminalSessionEvent) => void) => {
    const wrapped = (_event: unknown, event: TerminalSessionEvent) => listener(event);
    ipcRenderer.on("desktop:terminal-event", wrapped);
    return () => ipcRenderer.removeListener("desktop:terminal-event", wrapped);
  },
};

contextBridge.exposeInMainWorld("desktopAgent", desktopAgent);
