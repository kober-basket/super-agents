export type AppSection =
  | "chat"
  | "skills"
  | "tools"
  | "knowledge"
  | "reports"
  | "emergency"
  | "settings";
export type AppearanceThemeId =
  | "porcelain"
  | "linen"
  | "ocean"
  | "sage"
  | "forest"
  | "sunset"
  | "mist"
  | "citrus"
  | "aubergine"
  | "harbor"
  | "olive"
  | "slate"
  | "dusk"
  | "graphite"
  | "midnight"
  | "ember";
export type ContextTier = "low" | "medium" | "high";
export type EnvironmentMode = "local" | "cloud";
export type DefaultAgentMode = "general" | "build";
export type PreviewKind = "text" | "code" | "markdown" | "image" | "pdf" | "html" | "web" | "binary";
export type McpTransport = "local" | "remote";
export type McpConnectionStatus = "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration";
export type McpInspectorTransport = "stdio" | "streamable-http" | "sse";
export type McpToolTaskSupport = "optional" | "required" | "forbidden";
export type ModelProviderKind = "openai-compatible";
export type SkillKind = "command" | "codex";

export interface ProviderModelConfig {
  id: string;
  label: string;
  enabled: boolean;
  vendor?: string;
  group?: string;
  description?: string;
  capabilities?: {
    vision?: boolean;
    tools?: boolean;
    reasoning?: boolean;
    webSearch?: boolean;
    embedding?: boolean;
    rerank?: boolean;
    free?: boolean;
  };
}

export interface ModelProviderConfig {
  id: string;
  name: string;
  kind: ModelProviderKind;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  system?: boolean;
  models: ProviderModelConfig[];
}

export interface RuntimeModelOption {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
  providerKind: ModelProviderKind;
  providerEnabled: boolean;
  modelId: string;
  modelLabel: string;
  enabled: boolean;
}

export interface ModelProviderFetchInput {
  providerId: string;
  name: string;
  kind: ModelProviderKind;
  baseUrl: string;
  apiKey: string;
}

export interface ModelProviderFetchResult {
  providerId: string;
  models: ProviderModelConfig[];
}

export interface AudioTranscriptionInput {
  providerId?: string;
  fileName: string;
  mimeType: string;
  audioBase64: string;
  language?: string;
}

export interface AudioTranscriptionResult {
  text: string;
  providerId: string;
  modelId: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  url: string;
  headersJson: string;
  envJson: string;
  enabled: boolean;
  timeoutMs: number;
}

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  command: string;
  enabled: boolean;
  sourcePath?: string;
  system?: boolean;
}

export interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  location: string;
  content: string;
}

export interface SkillImportResult {
  bootstrap: BootstrapPayload;
  importedSkillName: string;
  importedTo: string;
}

export interface RuntimeAgent {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  modelLabel?: string;
}

export interface McpServerStatus {
  name: string;
  status: McpConnectionStatus;
  error?: string;
}

export interface McpToolParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  schema: Record<string, unknown>;
}

export interface McpToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  title?: string;
  description?: string;
  taskSupport?: McpToolTaskSupport;
  inputSchema: Record<string, unknown>;
  parameters: McpToolParameter[];
}

export interface McpServerToolsResult {
  serverId: string;
  serverName: string;
  fetchedAt: number;
  transport: McpInspectorTransport;
  tools: McpToolInfo[];
  stderr?: string;
}

export interface McpInspectInput {
  server: McpServerConfig;
  workspaceRoot?: string;
}

export interface McpToolDebugInput extends McpInspectInput {
  toolName: string;
  argumentsJson: string;
}

export interface McpToolDebugResult {
  serverId: string;
  serverName: string;
  toolName: string;
  invokedAt: number;
  transport: McpInspectorTransport;
  isError: boolean;
  content: string;
  structuredContentJson: string;
  rawJson: string;
  stderr?: string;
  taskLog?: string;
}

export interface WorkspaceTool {
  id: string;
  name: string;
  title?: string;
  description?: string;
  source: "runtime" | "mcp";
  origin: string;
  serverId?: string;
  serverName?: string;
  parameters?: McpToolParameter[];
  taskSupport?: McpToolTaskSupport;
  observed: boolean;
}

export interface WorkspaceToolCatalog {
  fetchedAt: number;
  tools: WorkspaceTool[];
}

export interface KnowledgeBaseConnectionConfig {
  enabled: boolean;
  embeddingProviderId: string;
  embeddingModel: string;
  selectedBaseIds: string[];
  documentCount: number;
  chunkSize: number;
  chunkOverlap: number;
}

export type KnowledgeItemType = "file" | "note" | "directory" | "url" | "website";

export interface KnowledgeItemSummary {
  id: string;
  type: KnowledgeItemType;
  title: string;
  source: string;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  description?: string;
  itemCount: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
  items: KnowledgeItemSummary[];
}

export interface KnowledgeSearchResultItem {
  pageContent: string;
  score: number;
  metadata: Record<string, unknown>;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
}

export interface KnowledgeCatalogPayload {
  fetchedAt: number;
  knowledgeBases: KnowledgeBaseSummary[];
}

export interface KnowledgeSearchPayload {
  query: string;
  total: number;
  results: KnowledgeSearchResultItem[];
  searchedBases: Array<{ id: string; name: string }>;
  warnings: string[];
}

export interface ProjectReportInput {
  knowledgeBaseId: string;
  projectName: string;
  projectType?: string;
  projectLocation?: string;
  longitude?: string;
  latitude?: string;
  projectOverview?: string;
  policyFocus?: string;
  outputDirectory?: string;
  outputFileName?: string;
  workspaceRoot?: string;
  preferredMapServerId?: string;
  preferredMapToolName?: string;
}

export interface ProjectReportResult {
  outputPath: string;
  fileName: string;
  generatedAt: number;
  locationSummary?: string;
  mapToolUsed?: string;
  references: KnowledgeSearchResultItem[];
  content: string;
}

export interface EmergencyPlanInput {
  projectName: string;
  projectType?: string;
  projectLocation?: string;
  companyName?: string;
  industryCategory?: string;
  riskSources?: string;
  emergencyResources?: string;
  projectOverview?: string;
  specialRequirements?: string;
  templateFiles: FileDropEntry[];
  outputDirectory?: string;
  outputFileName?: string;
  workspaceRoot?: string;
}

export interface EmergencyPlanResult {
  outputPath: string;
  fileName: string;
  generatedAt: number;
  templateCount: number;
  recognizedTemplates: Array<{
    name: string;
    path: string;
    kind: string;
    excerpt: string;
  }>;
  content: string;
}

export interface KnowledgeInjectionMeta {
  injected: boolean;
  query: string;
  resultCount: number;
  searchedBaseIds: string[];
  warnings: string[];
  results?: KnowledgeSearchResultItem[];
}

export interface KnowledgeBaseCreateInput {
  name: string;
  description?: string;
}

export interface KnowledgeAddNoteInput {
  baseId: string;
  title: string;
  content: string;
}

export interface KnowledgeAddFilesInput {
  baseId: string;
  files: FileDropEntry[];
}

export interface KnowledgeAddDirectoryInput {
  baseId: string;
  directoryPath: string;
}

export interface KnowledgeAddUrlInput {
  baseId: string;
  url: string;
}

export interface KnowledgeDeleteItemInput {
  baseId: string;
  itemId: string;
}

export interface ProxyConfig {
  http: string;
  https: string;
  bypass: string;
}

export interface AppearanceConfig {
  theme: AppearanceThemeId;
}

export type RemoteChannelId = "dingtalk" | "feishu" | "wechat" | "wecom";
export type FeishuDomain = "feishu" | "lark";

export interface DingtalkRemoteControlConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

export interface FeishuRemoteControlConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
}

export interface WechatRemoteControlConfig {
  enabled: boolean;
  baseUrl: string;
  cdnBaseUrl: string;
  botToken: string;
  accountId: string;
  userId: string;
  connectedAt: number | null;
}

export interface WecomRemoteControlConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  websocketUrl: string;
}

export interface RemoteControlConfig {
  dingtalk: DingtalkRemoteControlConfig;
  feishu: FeishuRemoteControlConfig;
  wechat: WechatRemoteControlConfig;
  wecom: WecomRemoteControlConfig;
}

export interface AppConfig {
  workspaceRoot: string;
  bridgeUrl: string;
  environment: EnvironmentMode;
  defaultAgentMode: DefaultAgentMode;
  activeModelId: string;
  contextTier: ContextTier;
  appearance: AppearanceConfig;
  proxy: ProxyConfig;
  modelProviders: ModelProviderConfig[];
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
  hiddenCodexSkillIds: string[];
  knowledgeBase: KnowledgeBaseConnectionConfig;
  remoteControl: RemoteControlConfig;
}

export interface WechatLoginStartResult {
  sessionKey: string;
  qrCodeUrl?: string;
  message: string;
}

export interface WechatLoginWaitResult {
  connected: boolean;
  message: string;
  accountId?: string;
  userId?: string;
}

export interface RemoteChannelRuntimeStatus {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  running: boolean;
  lastError?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  activePeerCount: number;
}

export interface DingtalkRemoteRuntimeStatus extends RemoteChannelRuntimeStatus {}

export interface FeishuRemoteRuntimeStatus extends RemoteChannelRuntimeStatus {}

export interface WechatRemoteRuntimeStatus extends RemoteChannelRuntimeStatus {
  pendingLogin: boolean;
  pendingLoginQrCodeUrl?: string;
  accountId: string;
  userId: string;
}

export interface WecomRemoteRuntimeStatus extends RemoteChannelRuntimeStatus {}

export interface RemoteControlStatus {
  dingtalk: DingtalkRemoteRuntimeStatus;
  feishu: FeishuRemoteRuntimeStatus;
  wechat: WechatRemoteRuntimeStatus;
  wecom: WecomRemoteRuntimeStatus;
}

export interface DesktopWindowState {
  platform: "darwin" | "win32" | "linux";
  maximized: boolean;
}

export interface FilePreviewPayload {
  title: string;
  path: string | null;
  kind: PreviewKind;
  mimeType: string;
  content: string;
  url?: string;
  loading?: boolean;
}

export interface FileDropEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  kind?: PreviewKind;
  url?: string;
  content?: string;
  dataUrl?: string;
}

export type ChatMessageRole = "user" | "assistant";
export type ChatToolCallStatus = "pending" | "in_progress" | "completed" | "failed";
export type ChatToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";
export type ChatPlanEntryPriority = "high" | "medium" | "low";
export type ChatPlanEntryStatus = "pending" | "in_progress" | "completed";
export type ChatTurnStatus = "idle" | "running" | "cancelling" | "failed";

export interface ChatVisualBase {
  id: string;
  title?: string;
  description?: string;
}

export interface ChatChartVisual extends ChatVisualBase {
  type: "chart";
  library: "vega-lite";
  spec: Record<string, unknown>;
}

export interface ChatDiagramVisual extends ChatVisualBase {
  type: "diagram";
  style: "mermaid";
  code: string;
}

export type ChatVisual = ChatChartVisual | ChatDiagramVisual;

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  visuals?: ChatVisual[];
  runtimeTrace?: ChatMessageRuntimeTrace;
  attachments?: FileDropEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatToolCallLocation {
  path: string;
  line?: number | null;
}

export type ChatToolCallContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "diff";
      path: string;
      oldText?: string | null;
      newText: string;
    }
  | {
      type: "terminal";
      terminalId: string;
    };

export interface ChatToolCall {
  toolCallId: string;
  title: string;
  status?: ChatToolCallStatus;
  kind?: ChatToolKind;
  content: ChatToolCallContent[];
  locations?: ChatToolCallLocation[];
  rawInputJson?: string;
  rawOutputJson?: string;
}

export interface ChatPlanEntry {
  content: string;
  priority: ChatPlanEntryPriority;
  status: ChatPlanEntryStatus;
}

export interface ChatTerminalOutput {
  terminalId: string;
  output: string;
  truncated: boolean;
  exitCode?: number | null;
  signal?: string | null;
}

export interface ChatMessageRuntimeTrace {
  planEntries: ChatPlanEntry[];
  toolCalls: ChatToolCall[];
  terminalOutputs: Record<string, ChatTerminalOutput>;
  thoughtText: string;
  stopReason?: string;
  error?: string;
}

export interface ChatConversationRuntimeState {
  status: ChatTurnStatus;
  planEntries: ChatPlanEntry[];
  toolCalls: ChatToolCall[];
  terminalOutputs: Record<string, ChatTerminalOutput>;
  thoughtText: string;
  stopReason?: string;
  error?: string;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  preview: string;
  messageCount: number;
  selectedKnowledgeBaseIds: string[];
  agentCore?: string;
  agentSessionId?: string;
}

export interface ChatConversation extends ChatConversationSummary {
  messages: ChatMessage[];
}

export interface ChatConversationListPayload {
  fetchedAt: number;
  conversations: ChatConversationSummary[];
}

export interface ChatSendInput {
  conversationId?: string | null;
  content: string;
  attachments?: FileDropEntry[];
  selectedKnowledgeBaseIds?: string[];
}

export interface ChatSendResult {
  createdConversation: boolean;
  conversation: ChatConversation;
}

export interface ChatTurnStartResult {
  createdConversation: boolean;
  turnId: string;
  conversation: ChatConversation;
}

export type ChatEvent =
    | {
        type: "message_updated";
        conversationId: string;
        turnId: string;
        messageId: string;
        content: string;
        visuals: ChatVisual[];
      }
    | {
        type: "message_runtime_trace_updated";
        conversationId: string;
        turnId: string;
        messageId: string;
        runtimeTrace: ChatMessageRuntimeTrace;
      }
    | {
        type: "message_delta";
        conversationId: string;
        turnId: string;
        messageId: string;
      textDelta: string;
    }
  | {
      type: "thought_delta";
      conversationId: string;
      turnId: string;
      textDelta: string;
    }
  | {
      type: "plan_updated";
      conversationId: string;
      turnId: string;
      entries: ChatPlanEntry[];
    }
  | {
      type: "tool_call_started";
      conversationId: string;
      turnId: string;
      toolCall: ChatToolCall;
    }
  | {
      type: "tool_call_updated";
      conversationId: string;
      turnId: string;
      toolCallId: string;
      patch: Partial<Omit<ChatToolCall, "toolCallId">>;
    }
  | {
      type: "terminal_output";
      conversationId: string;
      turnId: string;
      terminal: ChatTerminalOutput;
    }
  | {
      type: "turn_finished";
      conversationId: string;
      turnId: string;
      stopReason: string;
    }
  | {
      type: "turn_failed";
      conversationId: string;
      turnId: string;
      error: string;
    };

export interface BootstrapPayload {
  snapshotAt: number;
  config: AppConfig;
  availableSkills: RuntimeSkill[];
  mcpStatuses: McpServerStatus[];
}
