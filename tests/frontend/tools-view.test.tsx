import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ToolsView } from "../../src/features/tools/ToolsView";
import type { McpServerConfig, McpServerStatus, WorkspaceTool } from "../../src/types";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

function renderToolsView(
  tools: WorkspaceTool[],
  mcpServers: McpServerConfig[] = [],
  mcpStatusMap: Record<string, McpServerStatus> = {},
) {
  return renderToStaticMarkup(
    <ToolsView
      mcpAdvancedOpen={false}
      mcpRefreshing={false}
      mcpServers={mcpServers}
      mcpStatusMap={mcpStatusMap}
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

test("tools page keeps tool rows simple without source chips", () => {
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
  assert.match(html, /class="tool-list"/);
  assert.match(html, /class="tool-list-row/);
  assert.doesNotMatch(html, /<span class="tool-chip">内置<\/span>/);
});

test("tools page shows mcp servers instead of every mcp tool", () => {
  const html = renderToolsView(
    [
      {
        id: "mcp:server-1:search",
        name: "search",
        title: "Search Docs",
        source: "mcp",
        origin: "Docs MCP",
        observed: true,
        serverId: "server-1",
        serverName: "Docs MCP",
        description: "Search project docs.",
        parameters: [],
      },
      {
        id: "mcp:server-1:fetch",
        name: "fetch",
        title: "Fetch Page",
        source: "mcp",
        origin: "Docs MCP",
        observed: true,
        serverId: "server-1",
        serverName: "Docs MCP",
        description: "Fetch a doc page.",
        parameters: [],
      },
    ],
    [
      {
        id: "server-1",
        name: "Docs MCP",
        transport: "local",
        command: "npx",
        args: [],
        url: "",
        headersJson: "{}",
        envJson: "{}",
        enabled: true,
        timeoutMs: 30000,
      },
    ],
    {
      "docs-mcp": {
        name: "Docs MCP",
        status: "connected",
      },
    },
  );

  assert.match(html, /MCP 服务/);
  assert.match(html, /Docs MCP/);
  assert.match(html, /本地/);
  assert.match(html, /已连接/);
  assert.doesNotMatch(html, /Search Docs/);
  assert.doesNotMatch(html, /Fetch Page/);
});

test("tools mcp refresh avoids success-only toast", () => {
  const appSource = readSource("src/App.tsx");

  assert.doesNotMatch(appSource, /refreshWorkspaceSnapshot\("MCP 状态已刷新"\)/);
});
