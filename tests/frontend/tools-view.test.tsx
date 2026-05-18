import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ToolsView } from "../../src/features/tools/ToolsView";
import type { WorkspaceTool } from "../../src/types";

function renderToolsView(tools: WorkspaceTool[]) {
  return renderToStaticMarkup(
    <ToolsView
      mcpAdvancedOpen={false}
      mcpRefreshing={false}
      mcpServers={[]}
      mcpStatusMap={{}}
      tools={tools}
      toolsRefreshing={false}
      onAddMcpServer={() => undefined}
      onDebugTool={async () => ({
        serverId: "server-1",
        serverName: "Server",
        toolName: "tool",
        invokedAt: 0,
        transport: "stdio",
        isError: false,
        content: "",
        structuredContentJson: "",
        rawJson: "",
      })}
      onInspectServer={async () => ({
        serverId: "server-1",
        serverName: "Server",
        fetchedAt: 0,
        transport: "stdio",
        tools: [],
      })}
      onRefresh={() => undefined}
      onRefreshMcp={() => undefined}
      onRemoveMcpServer={() => undefined}
      onToggleAdvanced={() => undefined}
      onUpdateMcp={() => undefined}
    />,
  );
}

test("tools page omits low-value helper copy while keeping source chips", () => {
  const html = renderToolsView([
    {
      id: "builtin:bash",
      name: "bash",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Run a shell command in the current project.",
    },
    {
      id: "mcp:server-1:search",
      name: "search",
      title: "Search",
      source: "mcp",
      origin: "Search MCP",
      observed: true,
      serverId: "server-1",
      serverName: "Search",
      description: "Search project docs.",
      parameters: [],
    },
  ]);

  assert.doesNotMatch(html, /查看模型可调用的内置工具和 MCP 工具。/);
  assert.doesNotMatch(html, /<span>内置工具<\/span>/);
  assert.match(html, /<span class="tool-chip">内置<\/span>/);
  assert.match(html, /<span class="tool-chip">MCP<\/span>/);
});
