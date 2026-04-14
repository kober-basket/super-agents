import type {
  AppConfig,
  BootstrapPayload,
  DesktopWindowState,
  FileDropEntry,
  KnowledgeCatalogPayload,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeDeleteItemInput,
  KnowledgeSearchPayload,
  FilePreviewPayload,
  McpInspectInput,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  RemoteControlStatus,
  SendMessageInput,
  SendMessageResult,
  WechatLoginStartResult,
  WechatLoginWaitResult,
  WorkspaceToolCatalog,
} from "./types";

declare global {
  interface Window {
    desktopAgent: {
      bootstrap: () => Promise<BootstrapPayload>;
      sendMessage: (payload: SendMessageInput) => Promise<SendMessageResult>;
      selectCurrentChatSession: (sessionId: string) => Promise<BootstrapPayload>;
      resetCurrentChat: () => Promise<BootstrapPayload>;
      archiveChatSession: (sessionId: string) => Promise<BootstrapPayload>;
      unarchiveChatSession: (sessionId: string) => Promise<BootstrapPayload>;
      deleteChatSession: (sessionId: string) => Promise<BootstrapPayload>;
      abortCurrentChat: () => Promise<BootstrapPayload>;
      listKnowledgeBases: () => Promise<KnowledgeCatalogPayload>;
      createKnowledgeBase: (payload: KnowledgeBaseCreateInput) => Promise<KnowledgeCatalogPayload>;
      deleteKnowledgeBase: (baseId: string) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeFiles: (payload: KnowledgeAddFilesInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeDirectory: (payload: KnowledgeAddDirectoryInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeNote: (payload: KnowledgeAddNoteInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeUrl: (payload: KnowledgeAddUrlInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeWebsite: (payload: KnowledgeAddUrlInput) => Promise<KnowledgeCatalogPayload>;
      deleteKnowledgeItem: (payload: KnowledgeDeleteItemInput) => Promise<KnowledgeCatalogPayload>;
      searchKnowledgeBases: (payload: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }) => Promise<KnowledgeSearchPayload>;
      uninstallSkill: (skillId: string) => Promise<BootstrapPayload>;
      updateConfig: (patch: Partial<AppConfig>) => Promise<BootstrapPayload>;
      getRemoteControlStatus: () => Promise<RemoteControlStatus>;
      startWechatLogin: () => Promise<WechatLoginStartResult>;
      waitWechatLogin: (payload: { sessionKey: string; timeoutMs?: number }) => Promise<WechatLoginWaitResult>;
      disconnectWechat: () => Promise<RemoteControlStatus>;
      fetchProviderModels: (payload: ModelProviderFetchInput) => Promise<ModelProviderFetchResult>;
      inspectMcpServer: (payload: McpInspectInput) => Promise<McpServerToolsResult>;
      debugMcpTool: (payload: McpToolDebugInput) => Promise<McpToolDebugResult>;
      listTools: () => Promise<WorkspaceToolCatalog>;
      selectFiles: () => Promise<FileDropEntry[]>;
      prepareAttachments: (filePaths: string[]) => Promise<FileDropEntry[]>;
      selectWorkspaceFolder: () => Promise<string>;
      readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => Promise<FilePreviewPayload>;
      openPreviewTarget: (payload: { path?: string; url?: string }) => Promise<void>;
      openWorkspaceFolder: () => Promise<void>;
      openFolder: (targetPath: string) => Promise<void>;
      getWindowState: () => Promise<DesktopWindowState>;
      minimizeWindow: () => Promise<DesktopWindowState>;
      toggleMaximizeWindow: () => Promise<DesktopWindowState>;
      closeWindow: () => Promise<void>;
      onWorkspaceChanged: (listener: (payload: BootstrapPayload) => void) => () => void;
      onWindowStateChanged: (listener: (payload: DesktopWindowState) => void) => () => void;
    };
  }
}

export {};
