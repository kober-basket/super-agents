import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceToolCatalog, createBuiltinWorkspaceTools } from "../../electron/tool-catalog";
import type { McpServerToolsResult } from "../../src/types";

test("built-in tool catalog exposes native model tools without workspace aliases", () => {
  const tools = createBuiltinWorkspaceTools();
  const names = tools.map((tool) => tool.name).sort();
  const findTool = (name: string) => tools.find((tool) => tool.name === name);

  assert.deepEqual(names, [
    "apply_patch",
    "bash",
    "browser_click",
    "browser_drag",
    "browser_evaluate",
    "browser_fill",
    "browser_fill_form",
    "browser_get_console_message",
    "browser_get_network_request",
    "browser_hover",
    "browser_list_console_messages",
    "browser_list_network_requests",
    "browser_list_pages",
    "browser_navigate",
    "browser_press_key",
    "browser_screenshot",
    "browser_select_page",
    "browser_snapshot",
    "browser_type_text",
    "browser_upload_file",
    "browser_wait_for",
    "edit",
    "glob",
    "grep",
    "list",
    "mail",
    "mail_auth",
    "mail_draft",
    "mail_send",
    "memory",
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
  assert.equal(tools.every((tool) => Boolean(tool.category)), true);
  assert.equal(tools.every((tool) => Boolean(tool.categoryLabel)), true);
  assert.equal(findTool("read")?.category, "workspace");
  assert.equal(findTool("write")?.category, "workspace");
  assert.equal(findTool("bash")?.category, "runtime");
  assert.equal(findTool("memory")?.category, "context");
  assert.equal(findTool("web_search")?.category, "web");
  assert.equal(findTool("browser_snapshot")?.category, "browser");
  assert.equal(findTool("mail")?.category, "mail");
  assert.equal(names.some((name) => name.startsWith("workspace_")), false);
  for (const tool of tools) {
    assert.doesNotMatch(tool.description ?? "", /\bCodex\b/i, `${tool.name} should use product-neutral wording`);
  }
});

test("built-in tool catalog exposes Chinese descriptions", () => {
  const tools = createBuiltinWorkspaceTools();

  for (const tool of tools) {
    assert.match(tool.description ?? "", /[\u4e00-\u9fff]/, `${tool.name} should have a Chinese description`);
  }
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
