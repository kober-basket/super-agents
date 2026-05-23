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
  FilePreviewPayload,
  TerminalCommandResult,
  WorkspaceDirectoryListing,
  McpInspectInput,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  RemoteControlStatus,
  SkillImportResult,
  TerminalSessionCreateInput,
  TerminalSessionEvent,
  TerminalSessionInput,
  TerminalSessionResizeInput,
  TerminalSessionSnapshot,
  WechatLoginStartResult,
  WechatLoginWaitResult,
  WebviewWindowOpenPayload,
  WorkspaceToolCatalog,
} from "./types";

declare global {
  interface Window {
    desktopAgent: {
      bootstrap: () => Promise<BootstrapPayload>;
      listConversations: () => Promise<ChatConversationListPayload>;
      getConversation: (conversationId: string) => Promise<ChatConversation>;
      startChatTurn: (payload: ChatSendInput) => Promise<ChatTurnStartResult>;
      cancelChatTurn: (conversationId: string) => Promise<void>;
      sendChatMessage: (payload: ChatSendInput) => Promise<ChatSendResult>;
      deleteConversation: (conversationId: string) => Promise<ChatConversationListPayload>;
      exportConversation: (payload: ChatConversationExportInput) => Promise<ChatConversationExportResult>;
      writeClipboardText: (text: string) => Promise<void>;
      listKnowledgeBases: () => Promise<KnowledgeCatalogPayload>;
      createKnowledgeBase: (payload: KnowledgeBaseCreateInput) => Promise<KnowledgeCatalogPayload>;
      updateKnowledgeBase: (payload: KnowledgeBaseUpdateInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeFiles: (payload: KnowledgeAddFilesInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeDirectory: (payload: KnowledgeAddDirectoryInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeNote: (payload: KnowledgeAddNoteInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeUrl: (payload: KnowledgeAddUrlInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeWebsite: (payload: KnowledgeAddUrlInput) => Promise<KnowledgeCatalogPayload>;
      deleteKnowledgeBase: (baseId: string) => Promise<KnowledgeCatalogPayload>;
      deleteKnowledgeItem: (payload: KnowledgeDeleteItemInput) => Promise<KnowledgeCatalogPayload>;
      searchKnowledgeBases: (payload: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }) => Promise<KnowledgeSearchPayload>;
      listMemories: () => Promise<MemoryCatalogPayload>;
      createMemory: (payload: MemoryCreateInput) => Promise<MemoryCatalogPayload>;
      updateMemory: (payload: MemoryUpdateInput) => Promise<MemoryCatalogPayload>;
      deleteMemory: (memoryId: string) => Promise<MemoryCatalogPayload>;
      searchMemories: (payload: MemorySearchInput) => Promise<MemorySearchPayload>;
      inferMailSetup: (email: string) => Promise<MailProviderSetup>;
      listMailAccounts: () => Promise<MailAccountSummary[]>;
      createMailAccount: (payload: MailAccountCreateInput) => Promise<MailAccountSummary>;
      saveMailPasswordCredentials: (payload: MailPasswordCredentialsInput) => Promise<MailAccountSummary>;
      saveMailOAuthCredentials: (payload: MailOAuthCredentialsInput) => Promise<MailAccountSummary>;
      createMailOAuthAuthorization: (payload: MailOAuthAuthorizationInput) => Promise<MailOAuthAuthorization>;
      exchangeMailOAuthCode: (payload: MailOAuthCodeExchangeInput) => Promise<MailAccountSummary>;
      disconnectMailAccount: (accountId: string) => Promise<MailAccountSummary[]>;
      removeMailAccount: (accountId: string) => Promise<MailAccountSummary[]>;
      selectSkillFolder: () => Promise<string>;
      importLocalSkill: (sourcePath: string) => Promise<SkillImportResult>;
      uninstallSkill: (skillId: string) => Promise<BootstrapPayload>;
      updateConfig: (patch: Partial<AppConfig>) => Promise<BootstrapPayload>;
      getRemoteControlStatus: () => Promise<RemoteControlStatus>;
      startWechatLogin: () => Promise<WechatLoginStartResult>;
      waitWechatLogin: (payload: { sessionKey: string; timeoutMs?: number }) => Promise<WechatLoginWaitResult>;
      disconnectWechat: () => Promise<RemoteControlStatus>;
      fetchProviderModels: (payload: ModelProviderFetchInput) => Promise<ModelProviderFetchResult>;
      transcribeAudio: (payload: AudioTranscriptionInput) => Promise<AudioTranscriptionResult>;
      inspectMcpServer: (payload: McpInspectInput) => Promise<McpServerToolsResult>;
      debugMcpTool: (payload: McpToolDebugInput) => Promise<McpToolDebugResult>;
      markBrowserPageActive: (webContentsId: number) => Promise<void>;
      listTools: () => Promise<WorkspaceToolCatalog>;
      selectFiles: () => Promise<FileDropEntry[]>;
      prepareAttachments: (filePaths: string[]) => Promise<FileDropEntry[]>;
      selectWorkspaceFolder: () => Promise<string>;
      listWorkspaceDirectory: (payload?: { path?: string; workspaceRoot?: string }) => Promise<WorkspaceDirectoryListing>;
      readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => Promise<FilePreviewPayload>;
      runTerminalCommand: (payload: { command: string; cwd?: string; workspaceRoot?: string }) => Promise<TerminalCommandResult>;
      createTerminalSession: (payload: TerminalSessionCreateInput) => Promise<TerminalSessionSnapshot>;
      writeTerminalInput: (payload: TerminalSessionInput) => Promise<TerminalSessionSnapshot>;
      resizeTerminalSession: (payload: TerminalSessionResizeInput) => Promise<TerminalSessionSnapshot>;
      clearTerminalSession: (terminalId: string) => Promise<TerminalSessionSnapshot>;
      stopTerminalSession: (terminalId: string) => Promise<TerminalSessionSnapshot>;
      restartTerminalSession: (terminalId: string) => Promise<TerminalSessionSnapshot>;
      releaseTerminalSession: (terminalId: string) => Promise<void>;
      openPreviewTarget: (payload: { path?: string; url?: string }) => Promise<void>;
      openWorkspaceFolder: () => Promise<void>;
      openFolder: (targetPath: string) => Promise<void>;
      getWindowState: () => Promise<DesktopWindowState>;
      minimizeWindow: () => Promise<DesktopWindowState>;
      toggleMaximizeWindow: () => Promise<DesktopWindowState>;
      closeWindow: () => Promise<void>;
      respondToApproval: (payload: DesktopApprovalResponse) => Promise<boolean>;
      onWorkspaceChanged: (listener: (payload: BootstrapPayload) => void) => () => void;
      onWindowStateChanged: (listener: (payload: DesktopWindowState) => void) => () => void;
      onChatEvent: (listener: (event: ChatEvent) => void) => () => void;
      onApprovalRequest: (listener: (request: DesktopApprovalRequest) => void) => () => void;
      onBrowserWindowOpen: (listener: (payload: WebviewWindowOpenPayload) => void) => () => void;
      onTerminalEvent: (listener: (event: TerminalSessionEvent) => void) => () => void;
    };
  }
}

export {};
