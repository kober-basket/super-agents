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

function extractCssBlock(source: string, selectorPattern: RegExp) {
  const match = selectorPattern.exec(source);
  assert.ok(match?.groups?.body, "Expected CSS block to exist.");
  return match.groups.body;
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

test("tools list icons reuse the skills premium icon implementation", () => {
  const html = renderToolsView([
    {
      id: "builtin:grep",
      name: "grep",
      source: "builtin",
      origin: "鍐呯疆宸ュ叿",
      observed: false,
      description: "Search text.",
    },
  ]);

  assert.match(html, /class="skill-icon-shell skill-icon-premium skill-accent-sky"/);
  assert.doesNotMatch(html, /class="skill-icon-orbit"/);
  assert.doesNotMatch(html, /tool-icon-shell/);
  assert.doesNotMatch(html, /tool-icon-spark/);
});

test("tools list icons use the saturated app-icon treatment from skills", () => {
  const css = readSource("src/styles.css");
  const block = extractCssBlock(
    css,
    /\.tools-page\s+\.tool-list\s+\.skill-icon-shell\.skill-icon-premium\s*{(?<body>[^}]*)}/s,
  );
  const hoverBlock = extractCssBlock(
    css,
    /\.tools-page\s+\.tool-list\s+\.skill-tile:hover\s+\.skill-icon-shell\.skill-icon-premium,\s*\.tools-page\s+\.tool-list\s+\.skill-tile:focus-visible\s+\.skill-icon-shell\.skill-icon-premium\s*{(?<body>[^}]*)}/s,
  );

  assert.match(block, /border-radius:\s*12px;/);
  assert.match(block, /linear-gradient\(/);
  assert.match(block, /color-mix\(in srgb,\s*var\(--icon-start\)\s+76%,\s*#ffffff\)\s+0%/);
  assert.match(block, /color-mix\(in srgb,\s*var\(--icon-end\)\s+86%,\s*#0f172a\)\s+100%/);
  assert.match(block, /border-color:\s*color-mix\(in srgb,\s*var\(--icon-end\)\s+42%,\s*#ffffff\);/);
  assert.match(block, /color:\s*#ffffff;/);
  assert.match(block, /box-shadow:\s*0\s+8px\s+18px\s+color-mix\(in srgb,\s*var\(--icon-shadow\)\s+16%,\s*transparent\);/);
  assert.doesNotMatch(block, /background:\s*color-mix\(in srgb,\s*var\(--icon-start\)\s+26%/);
  assert.doesNotMatch(block, /inset/);
  assert.match(hoverBlock, /linear-gradient\(/);
  assert.doesNotMatch(hoverBlock, /inset/);
  assert.match(hoverBlock, /border-color:\s*color-mix\(in srgb,\s*var\(--icon-end\)\s+52%,\s*#ffffff\);/);
  assert.match(hoverBlock, /box-shadow:\s*0\s+10px\s+20px\s+color-mix\(in srgb,\s*var\(--icon-shadow\)\s+18%,\s*transparent\);/);
  assert.match(css, /\.tools-page\s+\.tool-list\s+\.skill-icon-shell\.skill-icon-premium::before/s);
  assert.match(css, /\.tools-page\s+\.tool-list\s+\.skill-icon-shell\.skill-icon-premium::before\s*{[^}]*display:\s*none;/s);
  assert.doesNotMatch(block, /#1f2937/);
});

test("built-in tool icons use purpose-specific browser and mail symbols", () => {
  const browserHtml = renderToolsView([
    {
      id: "builtin:browser_snapshot",
      name: "browser_snapshot",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Snapshot the browser.",
      category: "browser",
      categoryLabel: "浏览器",
    },
    {
      id: "builtin:browser_click",
      name: "browser_click",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Click an element.",
      category: "browser",
      categoryLabel: "浏览器",
    },
  ]);
  const mailHtml = renderToolsView([
    {
      id: "builtin:mail_auth",
      name: "mail_auth",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Authorize mail.",
      category: "mail",
      categoryLabel: "邮件",
    },
    {
      id: "builtin:mail_send",
      name: "mail_send",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Send mail.",
      category: "mail",
      categoryLabel: "邮件",
    },
  ]);

  assert.match(browserHtml, /lucide-camera/);
  assert.match(browserHtml, /lucide-mouse-pointer-click/);
  assert.match(mailHtml, /lucide-mail-check/);
  assert.match(mailHtml, /lucide-send/);
});

test("built-in tool icons fall back by catalog category before generic wrench", () => {
  const contextHtml = renderToolsView([
    {
      id: "builtin:memory",
      name: "memory",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Maintain long-term memory.",
      category: "context",
      categoryLabel: "上下文",
    },
  ]);
  const browserHtml = renderToolsView([
    {
      id: "builtin:custom_browser_probe",
      name: "custom_browser_probe",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Inspect a browser page.",
      category: "browser",
      categoryLabel: "浏览器",
    },
  ]);

  assert.match(contextHtml, /lucide-database/);
  assert.match(browserHtml, /lucide-panel-top/);
  assert.doesNotMatch(contextHtml, /lucide-wrench/);
  assert.doesNotMatch(browserHtml, /lucide-wrench/);
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

test("tools page switches built-in categories through tabs instead of rendering every group", () => {
  const html = renderToolsView([
    {
      id: "builtin:read",
      name: "read",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Read a file.",
      category: "workspace",
      categoryLabel: "工作区",
      categoryOrder: 10,
    },
    {
      id: "builtin:browser_snapshot",
      name: "browser_snapshot",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Snapshot the browser.",
      category: "browser",
      categoryLabel: "浏览器",
      categoryOrder: 30,
    },
    {
      id: "builtin:mail",
      name: "mail",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Read mail.",
      category: "mail",
      categoryLabel: "邮件",
      categoryOrder: 60,
    },
  ]);

  assert.match(html, /class="tool-category-tabs"/);
  assert.match(html, /role="tablist"[^>]*aria-label="内置工具分类"/);
  assert.match(html, /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="true")[^>]*>\s*<span>工作区<\/span>\s*<em>1<\/em>/s);
  assert.match(
    html,
    /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="false")[^>]*>\s*<span>浏览器<\/span>\s*<em>1<\/em>/s,
  );
  assert.match(
    html,
    /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="false")[^>]*>\s*<span>邮件<\/span>\s*<em>1<\/em>/s,
  );
  assert.match(html, /class="[^"]*\btool-category-panel\b[^"]*"/);
  assert.match(html, /id="tool-category-panel-workspace"/);
  assert.match(html, /aria-labelledby="tool-category-tab-workspace"/);
  assert.ok(html.indexOf("工作区") < html.indexOf("read"));
  assert.doesNotMatch(html, /class="tool-category-head"/);
  assert.doesNotMatch(html, /<h4>工作区<\/h4>/);
  assert.doesNotMatch(html, /<span>1 个<\/span>/);
  assert.doesNotMatch(html, /<strong title="browser_snapshot">browser_snapshot<\/strong>/);
  assert.doesNotMatch(html, /<strong title="mail">mail<\/strong>/);
});

test("tool category tabs stay borderless and compact", () => {
  const css = readSource("src/styles.css");
  const tabsBlock = extractCssBlock(css, /\.tool-category-tabs\s*{(?<body>[^}]*)}/s);
  const tabBlock = extractCssBlock(css, /\.tool-category-tab\s*{(?<body>[^}]*)}/s);
  const activeTabBlock = extractCssBlock(css, /\.tool-category-tab\.active\s*{(?<body>[^}]*)}/s);

  assert.match(tabsBlock, /display:\s*flex;/);
  assert.match(tabsBlock, /overflow-x:\s*auto;/);
  assert.match(tabsBlock, /border:\s*0;/);
  assert.match(tabsBlock, /background:\s*transparent;/);
  assert.match(tabBlock, /border:\s*0;/);
  assert.doesNotMatch(tabBlock, /border-color:/);
  assert.doesNotMatch(activeTabBlock, /border|box-shadow/);
  assert.match(activeTabBlock, /background:/);
});

test("tools page does not show an empty mcp service prompt", () => {
  const html = renderToolsView([
    {
      id: "builtin:bash",
      name: "bash",
      source: "builtin",
      origin: "内置工具",
      observed: false,
      description: "Run a shell command in the current project.",
    },
  ]);

  assert.match(html, /MCP 服务/);
  assert.match(html, /添加 MCP/);
  assert.doesNotMatch(html, /还没有 MCP 服务/);
  assert.doesNotMatch(html, /添加一个 MCP 服务后/);
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
