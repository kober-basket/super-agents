import type { McpServerConfig, McpToolInfo } from "../../src/types";
import type { McpInspector } from "../mcp-inspector";
import type { ToolDefinition } from "./types";

function sanitizeToolName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

export function createMcpRuntimeToolName(serverId: string, toolName: string) {
  return `mcp_${sanitizeToolName(serverId)}_${sanitizeToolName(toolName)}`.slice(0, 64);
}

function stringifyJson(value: unknown) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMcpResult(result: Awaited<ReturnType<McpInspector["debugTool"]>>) {
  return [
    result.content,
    result.structuredContentJson ? `Structured content:\n${result.structuredContentJson}` : "",
    result.taskLog ? `Task log:\n${result.taskLog}` : "",
    result.stderr ? `stderr:\n${result.stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function createMcpToolDefinition(input: {
  server: McpServerConfig;
  tool: McpToolInfo;
  workspaceRoot: string;
  inspector: McpInspector;
}): ToolDefinition {
  const runtimeName = createMcpRuntimeToolName(input.server.id, input.tool.name);
  return {
    name: runtimeName,
    description: [
      input.tool.title || input.tool.name,
      input.tool.description,
      `MCP server: ${input.tool.serverName}. Original tool: ${input.tool.name}.`,
    ]
      .filter(Boolean)
      .join("\n"),
    inputSchema: Object.keys(input.tool.inputSchema).length > 0
      ? input.tool.inputSchema
      : { type: "object", properties: {}, additionalProperties: true },
    risk: "network",
    execute: async (toolInput, context) => {
      context.emitOutput?.({
        stream: "info",
        text: `Calling MCP tool ${input.tool.serverName}/${input.tool.name}\n`,
      });
      const result = await input.inspector.debugTool({
        server: input.server,
        workspaceRoot: input.workspaceRoot,
        toolName: input.tool.name,
        argumentsJson: stringifyJson(toolInput || {}),
      });
      if (result.isError) {
        throw new Error(formatMcpResult(result) || "MCP tool returned an error.");
      }
      return {
        content: formatMcpResult(result) || "(MCP tool returned no text content)",
        metadata: {
          serverId: result.serverId,
          serverName: result.serverName,
          toolName: result.toolName,
          transport: result.transport,
          rawJson: result.rawJson,
        },
      };
    },
  };
}
