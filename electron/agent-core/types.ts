export type AgentRole = "assistant" | "coordinator" | "worker" | "specialist";
export type AgentPromptMode = "replace-default" | "append-default";
export type PermissionMode = "default" | "allow" | "ask" | "deny";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCall[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  role: AgentRole;
  prompt: string;
  promptMode?: AgentPromptMode;
  model: string;
  tools?: string[];
  skills?: string[];
  permissionMode?: PermissionMode;
  permissionPolicy?: PermissionPolicy;
  maxTurns?: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  allowedTools?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ToolRisk = "read" | "write" | "network" | "shell" | "destructive";

export interface ToolDefinition {
  name: string;
  aliases?: string[];
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  sessionId: string;
  agentId: string;
  workspaceRoot: string;
  fullFileSystemAccess?: boolean;
  toolCall?: ToolCall;
  requestApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
}

export interface ToolResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionPolicy {
  allowedTools?: string[];
  deniedTools?: string[];
  requireApprovalFor?: string[];
  allowRisk?: ToolRisk[];
  maxToolCallsPerTurn?: number;
}

export interface PromptCompositionInput {
  agent: AgentDefinition;
  skills: SkillDefinition[];
  overrideSystemPrompt?: string;
  coordinatorPrompt?: string;
  memoryPrompt?: string;
  workspacePrompt?: string;
  appendSystemPrompt?: string;
}

export type PermissionDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string }
  | { type: "ask"; reason: string };

export interface ModelToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ModelToolSchema[];
}

export type ModelEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "status_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "done"; stopReason: string };

export interface ModelGateway {
  stream(input: ModelRequest): AsyncIterable<ModelEvent>;
}

export interface ToolApprovalRequest {
  sessionId: string;
  agentId: string;
  toolCall: ToolCall;
  reason: string;
  kind?: "tool" | "external_directory" | "question";
  targetPath?: string;
  metadata?: Record<string, unknown>;
}

export type ToolApprovalDecision =
  | { type: "allow"; metadata?: Record<string, unknown> }
  | { type: "deny"; reason: string };

export class ToolPermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolPermissionDeniedError";
  }
}

export type AgentEvent =
  | { type: "thought_delta"; sessionId: string; agentId: string; text: string }
  | { type: "status_delta"; sessionId: string; agentId: string; text: string }
  | { type: "message_delta"; sessionId: string; agentId: string; text: string }
  | { type: "message_replace"; sessionId: string; agentId: string; text: string }
  | { type: "tool_call_started"; sessionId: string; agentId: string; toolCall: ToolCall }
  | { type: "tool_call_finished"; sessionId: string; agentId: string; toolCall: ToolCall; result: ToolResult }
  | { type: "permission_denied"; sessionId: string; agentId: string; toolCall: ToolCall; reason: string }
  | { type: "permission_requested"; sessionId: string; agentId: string; toolCall: ToolCall; reason: string }
  | { type: "turn_finished"; sessionId: string; agentId: string; stopReason: string };

export interface AgentSession {
  id: string;
  agentId: string;
  messages: AgentMessage[];
}

export type TaskGraphNodeStatus = "pending" | "running" | "blocked" | "completed" | "failed";

export interface TaskGraphNode {
  id: string;
  title: string;
  description?: string;
  assigneeAgentId?: string;
  dependsOn?: string[];
  status: TaskGraphNodeStatus;
}

export interface TaskGraph {
  id: string;
  title: string;
  nodes: TaskGraphNode[];
}
