import type {
  MemoryCatalogPayload,
  MemoryCreateInput,
  MemoryEntry,
  MemoryEntryType,
  MemoryScope,
  MemorySearchPayload,
  MemoryUpdateInput,
} from "../../../src/types";
import { ToolPermissionDeniedError } from "../types";
import type { ToolContext, ToolDefinition } from "../types";

export interface MemoryToolStore {
  listMemories(): Promise<MemoryCatalogPayload>;
  createMemory(input: MemoryCreateInput): Promise<MemoryCatalogPayload>;
  updateMemory(input: MemoryUpdateInput): Promise<MemoryCatalogPayload>;
  deleteMemory(id: string): Promise<MemoryCatalogPayload>;
  searchMemories(input: {
    query?: string;
    type?: MemoryEntryType;
    scope?: MemoryScope;
    workspaceRoot?: string;
    limit?: number;
    includeDisabled?: boolean;
  }): Promise<MemorySearchPayload>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringInput(input: unknown, key: string, fallback = "") {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "string" ? value : fallback;
}

function booleanInput(input: unknown, key: string, fallback: boolean | undefined = undefined) {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberInput(input: unknown, key: string, fallback: number) {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function tagsInput(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.tags)) {
    return undefined;
  }
  return input.tags.map((item) => (typeof item === "string" ? item : String(item)));
}

function memoryTypeInput(input: unknown) {
  const value = stringInput(input, "type");
  if (
    value === "user_preference" ||
    value === "feedback_rule" ||
    value === "project_context" ||
    value === "external_reference"
  ) {
    return value;
  }
  return undefined;
}

function memoryScopeInput(input: unknown) {
  const value = stringInput(input, "scope");
  if (value === "global" || value === "workspace") {
    return value;
  }
  return undefined;
}

function requireStore(store: MemoryToolStore | null | undefined) {
  if (!store) {
    throw new Error("Memory store is not configured.");
  }
  return store;
}

async function requireMemoryApproval(action: string, input: unknown, context: ToolContext) {
  if (!context.requestApproval || !context.toolCall) {
    throw new ToolPermissionDeniedError("Memory writes require approval.");
  }

  const title = stringInput(input, "title");
  const id = stringInput(input, "id");
  const approval = await context.requestApproval({
    sessionId: context.sessionId,
    agentId: context.agentId,
    toolCall: context.toolCall,
    reason: [
      `Tool "memory" wants to ${action} long-term memory.`,
      title ? `Title: ${title}` : "",
      id ? `Memory ID: ${id}` : "",
    ].filter(Boolean).join("\n"),
    kind: "tool",
  });

  if (approval.type === "deny") {
    throw new ToolPermissionDeniedError(approval.reason);
  }
}

function formatMemoryEntries(entries: MemoryEntry[]) {
  if (entries.length === 0) {
    return "No memories found.";
  }

  return entries
    .map((entry, index) => {
      const tags = entry.tags.length > 0 ? `\nTags: ${entry.tags.join(", ")}` : "";
      const status = entry.enabled ? "enabled" : "disabled";
      return `${index + 1}. ${entry.title} (${entry.type}, ${entry.scope}, ${status})\nID: ${entry.id}${tags}\n${entry.content}`;
    })
    .join("\n\n");
}

function findNewestEntry(catalog: MemoryCatalogPayload, fallbackTitle: string) {
  return (
    catalog.entries.find((entry) => entry.title === fallbackTitle) ??
    catalog.entries[0] ??
    null
  );
}

export function createMemoryToolDefinition(store?: MemoryToolStore | null): ToolDefinition {
  return {
    name: "memory",
    description:
      "List or maintain long-term user/workspace memory. Use list before changing memory when possible. Writes require approval.",
    risk: "read",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "replace", "remove"],
          description: "Memory action to perform.",
        },
        id: { type: "string", description: "Memory id for replace/remove." },
        query: { type: "string", description: "Keyword query for list." },
        type: {
          type: "string",
          enum: ["user_preference", "feedback_rule", "project_context", "external_reference"],
          description: "Memory type for add/list/replace.",
        },
        scope: {
          type: "string",
          enum: ["global", "workspace"],
          description: "Memory scope. Defaults to workspace for new tool-created memories.",
        },
        title: { type: "string", description: "Short memory title for add/replace." },
        content: { type: "string", description: "Memory content for add/replace." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Short tags for add/replace.",
        },
        enabled: { type: "boolean", description: "Whether the memory is active." },
        limit: { type: "number", description: "Maximum entries to return for list." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const memoryStore = requireStore(store);
      const action = stringInput(input, "action");

      if (action === "list") {
        const payload = await memoryStore.searchMemories({
          query: stringInput(input, "query"),
          type: memoryTypeInput(input),
          scope: memoryScopeInput(input),
          workspaceRoot: context.workspaceRoot,
          limit: numberInput(input, "limit", 20),
        });
        return {
          content: formatMemoryEntries(payload.entries),
          metadata: {
            action,
            entries: payload.entries,
            total: payload.total,
          },
        };
      }

      if (action === "add") {
        await requireMemoryApproval("add", input, context);
        const title = stringInput(input, "title").trim();
        const catalog = await memoryStore.createMemory({
          type: memoryTypeInput(input) ?? "project_context",
          scope: memoryScopeInput(input) ?? "workspace",
          workspaceRoot: context.workspaceRoot,
          title,
          content: stringInput(input, "content"),
          tags: tagsInput(input),
          enabled: booleanInput(input, "enabled", true),
        });
        const created = findNewestEntry(catalog, title);
        return {
          content: `Saved memory: ${created?.title ?? title}`,
          metadata: {
            action,
            id: created?.id,
            entry: created,
          },
        };
      }

      if (action === "replace") {
        await requireMemoryApproval("replace", input, context);
        const id = stringInput(input, "id").trim();
        if (!id) {
          throw new Error("id is required for replace.");
        }
        const catalog = await memoryStore.updateMemory({
          id,
          type: memoryTypeInput(input),
          scope: memoryScopeInput(input),
          workspaceRoot: context.workspaceRoot,
          title: stringInput(input, "title") || undefined,
          content: stringInput(input, "content") || undefined,
          tags: tagsInput(input),
          enabled: booleanInput(input, "enabled"),
        });
        const updated = catalog.entries.find((entry) => entry.id === id) ?? null;
        return {
          content: `Updated memory: ${updated?.title ?? id}`,
          metadata: {
            action,
            id,
            entry: updated,
          },
        };
      }

      if (action === "remove") {
        await requireMemoryApproval("remove", input, context);
        const id = stringInput(input, "id").trim();
        if (!id) {
          throw new Error("id is required for remove.");
        }
        await memoryStore.deleteMemory(id);
        return {
          content: `Removed memory: ${id}`,
          metadata: {
            action,
            id,
          },
        };
      }

      throw new Error('action must be one of "list", "add", "replace", or "remove".');
    },
  };
}
