import type {
  AppConfig,
  BootstrapPayload,
  FileDropEntry,
  KnowledgeCatalogPayload,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeBaseCreateInput,
  KnowledgeSearchPayload,
  FilePreviewPayload,
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
} from "./types";

declare global {
  interface Window {
    desktopAgent: {
      bootstrap: () => Promise<BootstrapPayload>;
      listThreads: () => Promise<ThreadSummary[]>;
      getThread: (threadId: string) => Promise<ThreadRecord>;
      createThread: (title?: string) => Promise<BootstrapPayload>;
      setActiveThread: (threadId: string) => Promise<ThreadRecord>;
      resetThread: (threadId: string) => Promise<ThreadRecord>;
      archiveThread: (threadId: string, archived: boolean) => Promise<BootstrapPayload>;
      deleteThread: (threadId: string) => Promise<BootstrapPayload>;
      sendMessage: (payload: SendMessageInput) => Promise<SendMessageResult>;
      listKnowledgeBases: () => Promise<KnowledgeCatalogPayload>;
      createKnowledgeBase: (payload: KnowledgeBaseCreateInput) => Promise<KnowledgeCatalogPayload>;
      deleteKnowledgeBase: (baseId: string) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeFiles: (payload: KnowledgeAddFilesInput) => Promise<KnowledgeCatalogPayload>;
      addKnowledgeNote: (payload: KnowledgeAddNoteInput) => Promise<KnowledgeCatalogPayload>;
      searchKnowledgeBases: (payload: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }) => Promise<KnowledgeSearchPayload>;
      runSkill: (payload: SkillRunInput) => Promise<SkillRunResult>;
      uninstallSkill: (skillId: string) => Promise<BootstrapPayload>;
      updateConfig: (patch: Partial<AppConfig>) => Promise<BootstrapPayload>;
      fetchProviderModels: (payload: ModelProviderFetchInput) => Promise<ModelProviderFetchResult>;
      inspectMcpServer: (payload: McpInspectInput) => Promise<McpServerToolsResult>;
      debugMcpTool: (payload: McpToolDebugInput) => Promise<McpToolDebugResult>;
      listTools: () => Promise<WorkspaceToolCatalog>;
      selectFiles: () => Promise<FileDropEntry[]>;
      selectWorkspaceFolder: () => Promise<string>;
      setThreadWorkspace: (threadId: string, workspaceRoot: string) => Promise<BootstrapPayload>;
      readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => Promise<FilePreviewPayload>;
      openWorkspaceFolder: (threadId?: string) => Promise<void>;
      onWorkspaceChanged: (listener: (payload: BootstrapPayload) => void) => () => void;
      onGatewayEvent: (listener: (payload: BootstrapPayload) => void) => () => void;
    };
  }
}

export {};
