import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceToolCatalog, createBuiltinWorkspaceTools } from "../../electron/tool-catalog";
import type { McpServerToolsResult } from "../../src/types";

test("built-in tool catalog exposes native model tools without workspace aliases", () => {
  const tools = createBuiltinWorkspaceTools();
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "apply_patch",
    "bash",
    "edit",
    "glob",
    "grep",
    "list",
    "multi_edit",
    "question",
    "read",
    "todo_read",
    "todo_write",
    "web_fetch",
    "web_search",
    "write",
  ]);
  assert.equal(tools.every((tool) => tool.source === "builtin"), true);
  assert.equal(names.some((name) => name.startsWith("workspace_")), false);
});

test("workspace tool catalog combines built-in tools and concrete MCP tools only", () => {
  const mcpResult: McpServerToolsResult = {
    serverId: "server-1",
    serverName: "Filesystem",
    fetchedAt: 1,
    transport: "stdio",
    tools: [
      {
        serverId: "server-1",
        serverName: "Filesystem",
        name: "read_file",
        description: "Read a file through MCP",
        inputSchema: {},
        parameters: [],
      },
    ],
  };

  const catalog = buildWorkspaceToolCatalog([mcpResult], 123);

  assert.equal(catalog.fetchedAt, 123);
  assert.equal(catalog.tools.some((tool) => tool.source === "builtin" && tool.name === "read"), true);
  assert.equal(catalog.tools.some((tool) => tool.source === "mcp" && tool.name === "read_file"), true);
  assert.equal(catalog.tools.some((tool) => String(tool.source) === "runtime"), false);
});
