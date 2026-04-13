export type AppSection = "chat" | "skills" | "tools" | "knowledge" | "settings";
export type AppearanceThemeId =
  | "linen"
  | "ocean"
  | "forest"
  | "sunset"
  | "graphite"
  | "mist"
  | "citrus"
  | "aubergine";
export type ContextTier = "low" | "medium" | "high";
export type EnvironmentMode = "local" | "cloud";
export type MessageRole = "user" | "assistant" | "tool";
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

export interface RemoteControlPlaceholderConfig {
  enabled: boolean;
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

export interface RemoteControlConfig {
  dingtalk: RemoteControlPlaceholderConfig;
  feishu: RemoteControlPlaceholderConfig;
  wechat: WechatRemoteControlConfig;
  wecom: RemoteControlPlaceholderConfig;
}

export interface AppConfig {
  opencodeRoot: string;
  bridgeUrl: string;
  environment: EnvironmentMode;
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

export interface WechatRemoteRuntimeStatus {
  enabled: boolean;
  connected: boolean;
  running: boolean;
  pendingLogin: boolean;
  pendingLoginQrCodeUrl?: string;
  accountId: string;
  userId: string;
  lastError?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  activePeerCount: number;
}

export interface RemoteControlStatus {
  wechat: WechatRemoteRuntimeStatus;
}

export interface DesktopWindowState {
  platform: "darwin" | "win32" | "linux";
  maximized: boolean;
}

export interface MessageAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  kind: PreviewKind;
  url?: string;
  content?: string;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  displayText?: string;
  createdAt: number;
  status?: "loading" | "paused" | "done" | "error";
  attachments?: MessageAttachment[];
  toolName?: string;
  skillName?: string;
  knowledge?: KnowledgeInjectionMeta;
}

export interface PendingQuestionOption {
  label: string;
  description: string;
}

export interface PendingQuestionItem {
  header: string;
  question: string;
  options: PendingQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface PendingQuestion {
  id: string;
  sessionID: string;
  questions: PendingQuestionItem[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  lastMessage: string;
  messageCount: number;
  archived: boolean;
  workspaceRoot?: string;
}

export interface ThreadRecord extends ThreadSummary {
  messages: ChatMessage[];
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

export interface BootstrapPayload {
  config: AppConfig;
  threads: ThreadSummary[];
  activeThreadId: string;
  currentThread: ThreadRecord | null;
  availableSkills: RuntimeSkill[];
  availableAgents: RuntimeAgent[];
  mcpStatuses: McpServerStatus[];
  pendingQuestions: PendingQuestion[];
}

export interface SendMessageInput {
  threadId?: string;
  workspaceRoot?: string;
  message: string;
  attachments: FileDropEntry[];
}

export interface SendMessageResult {
  thread: ThreadRecord;
  knowledge?: KnowledgeInjectionMeta;
}

export interface QuestionReplyInput {
  requestId: string;
  sessionId: string;
  answers: string[][];
}

export interface QuestionRejectInput {
  requestId: string;
  sessionId: string;
}

export interface SkillRunInput {
  threadId?: string;
  workspaceRoot?: string;
  skillId: string;
  prompt: string;
}

export interface SkillRunResult {
  thread: ThreadRecord;
}

export interface SkillDeleteResult {
  config: AppConfig;
  threads: ThreadSummary[];
  activeThreadId: string;
  currentThread: ThreadRecord;
  availableSkills: RuntimeSkill[];
  availableAgents: RuntimeAgent[];
  mcpStatuses: McpServerStatus[];
}
