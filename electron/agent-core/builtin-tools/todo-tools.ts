import type { ToolDefinition } from "../types";
import { arrayInput, isRecord, sanitizeIdentifier } from "./input";

type TodoStatus = "pending" | "in_progress" | "completed";

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const TODO_STATUSES = new Set<TodoStatus>(["pending", "in_progress", "completed"]);
const sessionTodos = new Map<string, TodoItem[]>();

function normalizeTodoItems(input: unknown): TodoItem[] {
  const rawItems = arrayInput(input, "items");
  if (rawItems.length === 0) {
    throw new Error("items must contain at least one todo.");
  }

  return rawItems.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`items[${index}] must be an object.`);
    }
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) {
      throw new Error(`items[${index}].content is required.`);
    }
    const status = typeof item.status === "string" ? item.status : "pending";
    if (!TODO_STATUSES.has(status as TodoStatus)) {
      throw new Error(`items[${index}].status must be pending, in_progress, or completed.`);
    }
    return {
      id: sanitizeIdentifier(typeof item.id === "string" ? item.id : "", `todo-${index + 1}`),
      content,
      status: status as TodoStatus,
    };
  });
}

export function createTodoToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "todo_read",
      description: "读取当前会话的任务清单。",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (_input, context) => {
        context.emitOutput?.({ stream: "info", text: "Reading todo list\n" });
        const items = sessionTodos.get(context.sessionId) ?? [];
        context.emitOutput?.({ stream: "info", text: `Loaded ${items.length} todo item${items.length === 1 ? "" : "s"}\n` });
        return {
          content: items.length > 0
            ? items.map((item) => `${item.status}\t${item.id}\t${item.content}`).join("\n")
            : "(todo list is empty)",
          metadata: { items },
        };
      },
    },
    {
      name: "todo_write",
      description: "用结构化任务项替换当前会话的任务清单。",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["content", "status"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        context.emitOutput?.({ stream: "info", text: "Updating todo list\n" });
        const items = normalizeTodoItems(input);
        context.emitOutput?.({ stream: "info", text: `Saving ${items.length} todo item${items.length === 1 ? "" : "s"}\n` });
        sessionTodos.set(context.sessionId, items);
        context.emitOutput?.({ stream: "info", text: "Todo list saved\n" });
        return {
          content: `Todo list updated:\n${items.map((item) => `${item.status}\t${item.id}\t${item.content}`).join("\n")}`,
          metadata: { items },
        };
      },
    },
  ];
}
