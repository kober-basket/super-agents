import { createBuiltinToolDefinitions } from "./agent-core";
import type { McpServerToolsResult, WorkspaceTool, WorkspaceToolCatalog } from "../src/types";

function createBuiltinToolId(name: string) {
  return `builtin:${name}`;
}

function createMcpToolId(serverId: string, toolName: string) {
  return `mcp:${serverId}:${toolName}`;
}

function sortWorkspaceTools(left: WorkspaceTool, right: WorkspaceTool) {
  if (left.source !== right.source) {
    return left.source === "builtin" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

export function createBuiltinWorkspaceTools(): WorkspaceTool[] {
  return createBuiltinToolDefinitions().map((tool) => ({
    id: createBuiltinToolId(tool.name),
    name: tool.name,
    description: tool.description,
    source: "builtin",
    origin: "内置工具",
    observed: false,
  }));
}

export function createMcpWorkspaceTools(results: Array<McpServerToolsResult | null | undefined>): WorkspaceTool[] {
  const tools: WorkspaceTool[] = [];

  for (const result of results) {
    if (!result) continue;

    for (const tool of result.tools) {
      tools.push({
        id: createMcpToolId(tool.serverId, tool.name),
        name: tool.name,
        title: tool.title,
        description: tool.description,
        source: "mcp",
        origin: `${tool.serverName} MCP`,
        serverId: tool.serverId,
        serverName: tool.serverName,
        parameters: tool.parameters,
        taskSupport: tool.taskSupport,
        observed: true,
      });
    }
  }

  return tools;
}

export function buildWorkspaceToolCatalog(
  mcpResults: Array<McpServerToolsResult | null | undefined>,
  fetchedAt = Date.now(),
): WorkspaceToolCatalog {
  const toolMap = new Map<string, WorkspaceTool>();
  for (const tool of [...createBuiltinWorkspaceTools(), ...createMcpWorkspaceTools(mcpResults)]) {
    toolMap.set(tool.id, tool);
  }

  return {
    fetchedAt,
    tools: Array.from(toolMap.values()).sort(sortWorkspaceTools),
  };
}
