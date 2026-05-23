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

test("tools page keeps tool descriptions compact and visually grouped", () => {
  const css = readSource("src/styles.css");
  const html = renderToolsView([
    {
      id: "builtin:grep",
      name: "grep",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description:
        "Search text. Uses ripgrep when available and falls back to built-in search. Use a project-relative path for project searches or an absolute path when the user explicitly names a local folder.",
    },
  ]);

  assert.match(html, /class="skills-page tools-page"/);
  assert.doesNotMatch(html, /tools-overview-strip/);
  assert.doesNotMatch(html, /tool-overview-pill/);
  assert.match(html, /class="tool-list-row skill-list-row skill-tile"/);
  assert.match(html, /class="skill-icon-shell/);
  assert.match(html, /class="skill-tile-copy"/);
  assert.match(html, /class="skill-tile-status"/);
  assert.doesNotMatch(html, /class="tool-card-icon/);
  assert.doesNotMatch(html, /class="tool-row-status/);
  assert.match(html, /class="tool-description"/);
  assert.doesNotMatch(css, /\.tools-page\s+\.tool-card-icon/);
  assert.doesNotMatch(css, /\.tools-page\s+\.tool-row-status/);
  assert.match(css, /\.skill-list-row\.skill-tile\s*{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/s);
  assert.doesNotMatch(css, /\.tools-page\s+\.tool-list-row\s+\.skill-tile-copy p\s*{[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(css, /\.skill-list-row\s+\.skill-icon-shell\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(css, /\.skill-list-row\s+\.skill-tile-copy\s*{[^}]*gap:\s*4px;/s);
  assert.doesNotMatch(css, /\.skill-list-row\s+\.skill-tile-copy\s*{[^}]*min-height:\s*36px/s);
  assert.doesNotMatch(css, /\.skill-list-row\s+\.skill-tile-copy p\s*{[^}]*line-height:\s*17px/s);
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

test("tools page prioritizes mcp services and keeps actions quiet", () => {
  const html = renderToolsView(
    [
      {
        id: "builtin:bash",
        name: "bash",
        source: "builtin",
        origin: "内置工具",
        observed: false,
        description: "Run a shell command in the current project.",
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
  );

  assert.ok(html.indexOf("MCP 服务") < html.indexOf("内置工具"));
  assert.doesNotMatch(html, /刷新工具/);
  assert.doesNotMatch(html, /管理 MCP/);
  assert.doesNotMatch(html, /class="primary-button"[^>]*>\s*<svg[^>]*>\s*<path[^>]*>\s*<\/path>\s*<\/svg>\s*添加 MCP/);
  assert.match(html, /class="mcp-add-button"/);
});

test("tools mcp refresh avoids success-only toast", () => {
  const appSource = readSource("src/App.tsx");

  assert.doesNotMatch(appSource, /refreshWorkspaceSnapshot\("MCP 状态已刷新"\)/);
});
