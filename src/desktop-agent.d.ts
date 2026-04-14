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
  EmergencyPlanInput,
  EmergencyPlanResult,
  ProjectReportInput,
  ProjectReportResult,
  QuestionRejectInput,
  QuestionReplyInput,
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
      abortThread: (threadId: string) => Promise<BootstrapPayload>;
      replyQuestion: (payload: QuestionReplyInput) => Promise<BootstrapPayload>;
      rejectQuestion: (payload: QuestionRejectInput) => Promise<BootstrapPayload>;
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
      runSkill: (payload: SkillRunInput) => Promise<SkillRunResult>;
      uninstallSkill: (skillId: string) => Promise<BootstrapPayload>;
      updateConfig: (patch: Partial<AppConfig>) => Promise<BootstrapPayload>;
      fetchProviderModels: (payload: ModelProviderFetchInput) => Promise<ModelProviderFetchResult>;
      inspectMcpServer: (payload: McpInspectInput) => Promise<McpServerToolsResult>;
      debugMcpTool: (payload: McpToolDebugInput) => Promise<McpToolDebugResult>;
      listTools: () => Promise<WorkspaceToolCatalog>;
      generateEmergencyPlan: (payload: EmergencyPlanInput) => Promise<EmergencyPlanResult>;
      generateProjectReport: (payload: ProjectReportInput) => Promise<ProjectReportResult>;
      selectFiles: () => Promise<FileDropEntry[]>;
      selectWorkspaceFolder: () => Promise<string>;
      setThreadWorkspace: (threadId: string, workspaceRoot: string) => Promise<BootstrapPayload>;
      readPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => Promise<FilePreviewPayload>;
      openWorkspaceFolder: (threadId?: string) => Promise<void>;
      getWindowState: () => Promise<DesktopWindowState>;
      minimizeWindow: () => Promise<DesktopWindowState>;
      toggleMaximizeWindow: () => Promise<DesktopWindowState>;
      closeWindow: () => Promise<void>;
      onWorkspaceChanged: (listener: (payload: BootstrapPayload) => void) => () => void;
      onWindowStateChanged: (listener: (payload: DesktopWindowState) => void) => () => void;
      onGatewayEvent: (listener: (payload: BootstrapPayload) => void) => () => void;
    };
  }
}

export {};
