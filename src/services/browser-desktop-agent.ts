import type {
  AppConfig,
  AudioTranscriptionInput,
  AudioTranscriptionResult,
  BootstrapPayload,
  ChatConversation,
  ChatConversationListPayload,
  ChatEvent,
  ChatMessage,
  ChatSendInput,
  ChatSendResult,
  ChatTurnStartResult,
  DesktopWindowState,
  EmergencyPlanInput,
  EmergencyPlanResult,
  FileDropEntry,
  FilePreviewPayload,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeCatalogPayload,
  KnowledgeDeleteItemInput,
  KnowledgeSearchPayload,
  McpInspectInput,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugInput,
  McpToolDebugResult,
  ModelProviderFetchInput,
  ModelProviderFetchResult,
  ProjectReportInput,
  ProjectReportResult,
  RemoteControlStatus,
  RuntimeSkill,
  SkillImportResult,
  WechatLoginStartResult,
  WechatLoginWaitResult,
  WorkspaceToolCatalog,
} from "../types";

type DesktopAgentApi = Window["desktopAgent"];

const now = () => Date.now();

const EMPTY_CONFIG: AppConfig = {
  workspaceRoot: "",
  bridgeUrl: "",
  environment: "local",
  defaultAgentMode: "general",
  activeModelId: "",
  contextTier: "high",
  appearance: {
    theme: "linen",
  },
  proxy: {
    http: "",
    https: "",
    bypass: "localhost,127.0.0.1",
  },
  modelProviders: [],
  mcpServers: [],
  skills: [],
  hiddenCodexSkillIds: [],
  knowledgeBase: {
    enabled: false,
    embeddingProviderId: "",
    embeddingModel: "",
    selectedBaseIds: [],
    documentCount: 5,
    chunkSize: 1200,
    chunkOverlap: 160,
  },
  remoteControl: {
    dingtalk: {
      enabled: false,
      clientId: "",
      clientSecret: "",
    },
    feishu: {
      enabled: false,
      appId: "",
      appSecret: "",
      domain: "feishu",
    },
    wechat: {
      enabled: false,
      baseUrl: "",
      cdnBaseUrl: "",
      botToken: "",
      accountId: "",
      userId: "",
      connectedAt: null,
    },
    wecom: {
      enabled: false,
      botId: "",
      secret: "",
      websocketUrl: "",
    },
  },
};

const EMPTY_REMOTE_STATUS: RemoteControlStatus = {
  dingtalk: {
    enabled: false,
    configured: false,
    connected: false,
    running: false,
    activePeerCount: 0,
  },
  feishu: {
    enabled: false,
    configured: false,
    connected: false,
    running: false,
    activePeerCount: 0,
  },
  wechat: {
    enabled: false,
    configured: false,
    connected: false,
    running: false,
    activePeerCount: 0,
    pendingLogin: false,
    accountId: "",
    userId: "",
  },
  wecom: {
    enabled: false,
    configured: false,
    connected: false,
    running: false,
    activePeerCount: 0,
  },
};

function cloneConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function unsupported(feature: string): never {
  throw new Error(`${feature} 需要在 Electron 桌面环境中使用，浏览器预览里暂不可用。`);
}

function createMessage(role: ChatMessage["role"], content: string, attachments?: FileDropEntry[]): ChatMessage {
  const timestamp = now();
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    attachments,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toConversationSummary(conversation: ChatConversation): ChatConversationListPayload["conversations"][number] {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    preview: conversation.preview,
    messageCount: conversation.messageCount,
    selectedKnowledgeBaseIds: conversation.selectedKnowledgeBaseIds,
    agentCore: conversation.agentCore,
    agentSessionId: conversation.agentSessionId,
  };
}

function createMockConversation(): ChatConversation {
  const intro = createMessage(
    "assistant",
    "当前是浏览器预览模式。界面可以正常查看，但文件选择、MCP 调试、远程控制和真实桌面桥接能力需要通过 Electron 启动。",
  );
  const timestamp = intro.createdAt;
  return {
    id: "browser-preview",
    title: "浏览器预览",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    preview: intro.content,
    messageCount: 1,
    selectedKnowledgeBaseIds: [],
    messages: [intro],
  };
}

export function createBrowserDesktopAgent(): DesktopAgentApi {
  let config = cloneConfig(EMPTY_CONFIG);
  let availableSkills: RuntimeSkill[] = [];
  let mcpStatuses: McpServerStatus[] = [];
  let conversations: ChatConversation[] = [createMockConversation()];
  const workspaceListeners = new Set<(payload: BootstrapPayload) => void>();
  const windowStateListeners = new Set<(payload: DesktopWindowState) => void>();
  const chatListeners = new Set<(event: ChatEvent) => void>();

  const getBootstrapPayload = (): BootstrapPayload => ({
    snapshotAt: now(),
    config: cloneConfig(config),
    availableSkills,
    mcpStatuses,
  });

  const emitWorkspaceChanged = () => {
    const payload = getBootstrapPayload();
    workspaceListeners.forEach((listener) => listener(payload));
  };

  const emitChatEvent = (event: ChatEvent) => {
    chatListeners.forEach((listener) => listener(event));
  };

  const getConversationOrThrow = (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      throw new Error("未找到会话");
    }
    return conversation;
  };

  const api: DesktopAgentApi = {
    bootstrap: async () => getBootstrapPayload(),
    listConversations: async () => ({
      fetchedAt: now(),
      conversations: conversations.map(toConversationSummary).sort((left, right) => right.updatedAt - left.updatedAt),
    }),
    getConversation: async (conversationId: string) => getConversationOrThrow(conversationId),
    startChatTurn: async (payload: ChatSendInput) => {
      const content = payload.content.trim();
      const selectedKnowledgeBaseIds = payload.selectedKnowledgeBaseIds ?? [];
      const userMessage = createMessage("user", content, payload.attachments);
      const assistantMessage = createMessage(
        "assistant",
        [
          "这是浏览器 mock 回复，用来验证 5173 页面本身能正常渲染。",
          "如果你要调试真实桌面功能，请继续使用 Electron 并通过 9001 连接 CDP。",
        ].join("\n\n"),
      );

      const existingConversation = payload.conversationId
        ? conversations.find((item) => item.id === payload.conversationId) ?? null
        : null;
      const createdConversation = !existingConversation;
      const title = content || payload.attachments?.[0]?.name || "新对话";
      const baseConversation = existingConversation ?? {
        id: `conv_${Math.random().toString(36).slice(2, 10)}`,
        title,
        createdAt: userMessage.createdAt,
        updatedAt: userMessage.createdAt,
        lastMessageAt: userMessage.createdAt,
        preview: "",
        messageCount: 0,
        selectedKnowledgeBaseIds,
        messages: [],
      };

      const conversation: ChatConversation = {
        ...baseConversation,
        title: baseConversation.title || title,
        updatedAt: assistantMessage.updatedAt,
        lastMessageAt: assistantMessage.updatedAt,
        preview: content || assistantMessage.content,
        messageCount: baseConversation.messages.length + 2,
        selectedKnowledgeBaseIds,
        messages: [...baseConversation.messages, userMessage, assistantMessage],
      };

      conversations = createdConversation
        ? [conversation, ...conversations]
        : conversations.map((item) => (item.id === conversation.id ? conversation : item));

      const turnId = `turn_${Math.random().toString(36).slice(2, 10)}`;
      window.setTimeout(() => {
        emitChatEvent({
          type: "message_updated",
          conversationId: conversation.id,
          turnId,
          messageId: assistantMessage.id,
          content: assistantMessage.content,
          visuals: [],
        });
        emitChatEvent({
          type: "turn_finished",
          conversationId: conversation.id,
          turnId,
          stopReason: "completed",
        });
      }, 0);

      return {
        createdConversation,
        turnId,
        conversation,
      };
    },
    cancelChatTurn: async () => undefined,
    sendChatMessage: async (payload: ChatSendInput): Promise<ChatSendResult> => {
      const result = await api.startChatTurn(payload);
      return {
        createdConversation: result.createdConversation,
        conversation: result.conversation,
      };
    },
    deleteConversation: async (conversationId: string) => {
      conversations = conversations.filter((item) => item.id !== conversationId);
      if (conversations.length === 0) {
        conversations = [createMockConversation()];
      }
      return api.listConversations();
    },
    listKnowledgeBases: async (): Promise<KnowledgeCatalogPayload> => ({
      fetchedAt: now(),
      knowledgeBases: [],
    }),
    createKnowledgeBase: async (_payload: KnowledgeBaseCreateInput) => unsupported("知识库创建"),
    addKnowledgeFiles: async (_payload: KnowledgeAddFilesInput) => unsupported("知识库文件导入"),
    addKnowledgeDirectory: async (_payload: KnowledgeAddDirectoryInput) => unsupported("知识库目录导入"),
    addKnowledgeNote: async (_payload: KnowledgeAddNoteInput) => unsupported("知识库笔记写入"),
    addKnowledgeUrl: async (_payload: KnowledgeAddUrlInput) => unsupported("知识库链接导入"),
    addKnowledgeWebsite: async (_payload: KnowledgeAddUrlInput) => unsupported("知识库网站导入"),
    deleteKnowledgeBase: async (_baseId: string) => unsupported("知识库删除"),
    deleteKnowledgeItem: async (_payload: KnowledgeDeleteItemInput) => unsupported("知识项删除"),
    searchKnowledgeBases: async (_payload): Promise<KnowledgeSearchPayload> => ({
      query: "",
      total: 0,
      results: [],
      searchedBases: [],
      warnings: ["浏览器预览模式下未启用知识库搜索。"],
    }),
    generateProjectReport: async (_payload: ProjectReportInput): Promise<ProjectReportResult> => unsupported("项目报告生成"),
    selectSkillFolder: async () => unsupported("技能目录选择"),
    importLocalSkill: async (_sourcePath: string): Promise<SkillImportResult> => unsupported("本地技能导入"),
    generateEmergencyPlan: async (_payload: EmergencyPlanInput): Promise<EmergencyPlanResult> => unsupported("应急预案生成"),
    uninstallSkill: async (_skillId: string) => unsupported("技能卸载"),
    updateConfig: async (patch: Partial<AppConfig>) => {
      config = {
        ...config,
        ...patch,
      };
      emitWorkspaceChanged();
      return getBootstrapPayload();
    },
    getRemoteControlStatus: async () => EMPTY_REMOTE_STATUS,
    startWechatLogin: async (): Promise<WechatLoginStartResult> => unsupported("微信登录"),
    waitWechatLogin: async (_payload): Promise<WechatLoginWaitResult> => unsupported("微信登录"),
    disconnectWechat: async () => EMPTY_REMOTE_STATUS,
    fetchProviderModels: async (_payload: ModelProviderFetchInput): Promise<ModelProviderFetchResult> =>
      unsupported("模型列表拉取"),
    transcribeAudio: async (_payload: AudioTranscriptionInput): Promise<AudioTranscriptionResult> =>
      unsupported("语音转写"),
    inspectMcpServer: async (_payload: McpInspectInput): Promise<McpServerToolsResult> => unsupported("MCP 服务检查"),
    debugMcpTool: async (_payload: McpToolDebugInput): Promise<McpToolDebugResult> => unsupported("MCP 工具调试"),
    listTools: async (): Promise<WorkspaceToolCatalog> => ({
      fetchedAt: now(),
      tools: [],
    }),
    selectFiles: async () => unsupported("文件选择"),
    prepareAttachments: async (filePaths: string[]) =>
      filePaths.map((filePath, index) => ({
        id: `mock_file_${index}`,
        name: filePath.split(/[\\/]/).pop() || filePath,
        path: filePath,
        size: 0,
        mimeType: "application/octet-stream",
      })),
    selectWorkspaceFolder: async () => unsupported("目录选择"),
    readPreview: async (payload): Promise<FilePreviewPayload> => ({
      title: payload.title?.trim() || payload.path?.split(/[\\/]/).pop() || payload.url || "浏览器预览",
      path: payload.path ?? null,
      kind: payload.kind === "web" ? "web" : "markdown",
      mimeType: payload.kind === "web" ? "text/html" : "text/markdown",
      content:
        payload.content?.trim() ||
        payload.url?.trim() ||
        "浏览器预览模式下无法读取本地文件内容，请通过 Electron 打开应用后再试。",
      url: payload.url,
    }),
    openPreviewTarget: async (payload) => {
      if (payload.url) {
        window.open(payload.url, "_blank", "noopener,noreferrer");
        return;
      }
      unsupported("外部预览打开");
    },
    openWorkspaceFolder: async () => unsupported("工作区打开"),
    openFolder: async (_targetPath: string) => unsupported("目录打开"),
    getWindowState: async (): Promise<DesktopWindowState> => ({
      platform: "win32",
      maximized: false,
    }),
    minimizeWindow: async () => ({
      platform: "win32",
      maximized: false,
    }),
    toggleMaximizeWindow: async () => {
      const state: DesktopWindowState = {
        platform: "win32",
        maximized: false,
      };
      windowStateListeners.forEach((listener) => listener(state));
      return state;
    },
    closeWindow: async () => unsupported("窗口关闭"),
    onWorkspaceChanged: (listener) => {
      workspaceListeners.add(listener);
      return () => workspaceListeners.delete(listener);
    },
    onWindowStateChanged: (listener) => {
      windowStateListeners.add(listener);
      return () => windowStateListeners.delete(listener);
    },
    onChatEvent: (listener) => {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
  };

  return api;
}
