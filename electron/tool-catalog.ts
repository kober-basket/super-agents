import { createBuiltinToolDefinitions } from "./agent-core";
import type {
  McpServerToolsResult,
  WorkspaceTool,
  WorkspaceToolCatalog,
  WorkspaceToolCategory,
} from "../src/types";

interface WorkspaceToolCategoryMetadata {
  id: WorkspaceToolCategory;
  label: string;
  order: number;
}

const BUILTIN_TOOL_CATEGORIES: Record<WorkspaceToolCategory, WorkspaceToolCategoryMetadata> = {
  workspace: { id: "workspace", label: "工作区", order: 10 },
  runtime: { id: "runtime", label: "运行环境", order: 20 },
  context: { id: "context", label: "上下文", order: 30 },
  web: { id: "web", label: "网页检索", order: 40 },
  browser: { id: "browser", label: "浏览器", order: 50 },
  mail: { id: "mail", label: "邮件", order: 60 },
  other: { id: "other", label: "其他", order: 90 },
};

const BUILTIN_TOOL_CATEGORY_BY_NAME: Record<string, WorkspaceToolCategory> = {
  read: "workspace",
  list: "workspace",
  grep: "workspace",
  glob: "workspace",
  write: "workspace",
  edit: "workspace",
  multi_edit: "workspace",
  apply_patch: "workspace",
  bash: "runtime",
  question: "context",
  memory: "context",
  todo_read: "context",
  todo_write: "context",
  skill: "context",
  web_search: "web",
  web_fetch: "web",
  mail_auth: "mail",
  mail: "mail",
  mail_draft: "mail",
  mail_send: "mail",
};

function resolveBuiltinToolCategory(toolName: string) {
  if (toolName.startsWith("browser_")) {
    return BUILTIN_TOOL_CATEGORIES.browser;
  }
  return BUILTIN_TOOL_CATEGORIES[BUILTIN_TOOL_CATEGORY_BY_NAME[toolName] ?? "other"];
}

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
  if (left.source === "builtin" && right.source === "builtin") {
    const leftCategoryOrder = left.categoryOrder ?? BUILTIN_TOOL_CATEGORIES.other.order;
    const rightCategoryOrder = right.categoryOrder ?? BUILTIN_TOOL_CATEGORIES.other.order;
    const categoryOrder = leftCategoryOrder - rightCategoryOrder;
    if (categoryOrder !== 0) {
      return categoryOrder;
    }
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

export function createBuiltinWorkspaceTools(): WorkspaceTool[] {
  return createBuiltinToolDefinitions().map((tool) => {
    const category = resolveBuiltinToolCategory(tool.name);
    return {
      id: createBuiltinToolId(tool.name),
      name: tool.name,
      description: tool.description,
      category: category.id,
      categoryLabel: category.label,
      categoryOrder: category.order,
      source: "builtin",
      origin: "内置工具",
      observed: false,
    };
  });
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
