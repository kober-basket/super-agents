import type { AgentDefinition, PermissionDecision, ToolCall, ToolDefinition, ToolRisk } from "./types";

const DEFAULT_ALLOWED_RISKS: ToolRisk[] = ["read"];

function listedToolMatches(tool: ToolDefinition, toolCall: ToolCall, names: string[] | undefined) {
  if (!names) return false;
  const toolNames = new Set([tool.name, toolCall.name, ...(tool.aliases ?? [])]);
  return names.some((name) => toolNames.has(name));
}

export class PermissionManager {
  check(input: {
    agent: AgentDefinition;
    tool: ToolDefinition | undefined;
    toolCall: ToolCall;
    toolCallsThisTurn: number;
    fullFileSystemAccess?: boolean;
  }): PermissionDecision {
    const { agent, fullFileSystemAccess, tool, toolCall, toolCallsThisTurn } = input;
    const policy = agent.permissionPolicy ?? {};
    const permissionMode = agent.permissionMode ?? "default";

    if (!tool) {
      return { type: "deny", reason: `Tool "${toolCall.name}" is not registered.` };
    }

    if (permissionMode === "deny") {
      return { type: "deny", reason: `Agent "${agent.id}" is not allowed to use tools.` };
    }

    if (policy.maxToolCallsPerTurn !== undefined && toolCallsThisTurn >= policy.maxToolCallsPerTurn) {
      return { type: "deny", reason: "Tool call limit reached for this turn." };
    }

    if (listedToolMatches(tool, toolCall, policy.deniedTools)) {
      return { type: "deny", reason: `Tool "${tool.name}" is denied for agent "${agent.id}".` };
    }

    if (policy.allowedTools && !listedToolMatches(tool, toolCall, policy.allowedTools)) {
      return { type: "deny", reason: `Tool "${tool.name}" is not allowed for agent "${agent.id}".` };
    }

    if (fullFileSystemAccess) {
      return { type: "allow" };
    }

    if (listedToolMatches(tool, toolCall, policy.requireApprovalFor)) {
      return { type: "ask", reason: `Tool "${tool.name}" requires approval.` };
    }

    if (permissionMode === "ask") {
      return { type: "ask", reason: `Agent "${agent.id}" requires approval before using tools.` };
    }

    const allowedRisks = policy.allowRisk ?? DEFAULT_ALLOWED_RISKS;
    if (!allowedRisks.includes(tool.risk)) {
      return { type: "deny", reason: `Tool risk "${tool.risk}" is not allowed for agent "${agent.id}".` };
    }

    return { type: "allow" };
  }
}
