import { AgentRegistry } from "./registries";
import type { AgentDefinition } from "./types";

export const DEFAULT_AGENT_ID = "neutral-assistant";
export const COORDINATOR_AGENT_ID = "coordinator";
export const WORKER_AGENT_ID = "worker";
export const DEFAULT_AGENTIC_MAX_TURNS = 90;
export const DEFAULT_READ_TOOL_IDS = ["read", "list", "grep", "glob"];
export const DEFAULT_BUILTIN_TOOL_IDS = [
  "read",
  "list",
  "grep",
  "glob",
  "question",
  "memory",
  "todo_read",
  "todo_write",
  "skill",
  "mail_auth",
  "mail",
  "mail_draft",
  "mail_send",
  "browser_list_pages",
  "browser_select_page",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_fill",
  "browser_fill_form",
  "browser_hover",
  "browser_drag",
  "browser_type_text",
  "browser_upload_file",
  "browser_press_key",
  "browser_wait_for",
  "browser_evaluate",
  "browser_list_console_messages",
  "browser_get_console_message",
  "browser_list_network_requests",
  "browser_get_network_request",
  "browser_screenshot",
  "web_search",
  "web_fetch",
  "write",
  "edit",
  "multi_edit",
  "apply_patch",
  "bash",
];
const DEFAULT_APPROVAL_TOOL_IDS = [
  "write",
  "edit",
  "multi_edit",
  "apply_patch",
  "bash",
  "mail_draft",
  "mail_send",
  "browser_upload_file",
  "browser_get_network_request",
  "browser_screenshot",
];

export function createDefaultAgentDefinitions(): AgentDefinition[] {
  return [
    {
      id: DEFAULT_AGENT_ID,
      name: "Super Agents",
      description: "Native neutral desktop assistant",
      role: "assistant",
      promptMode: "replace-default",
      prompt: [
        "You are the default Super Agents desktop assistant.",
        "Help with the user's current task without assuming a programming context.",
        "Use provided workspace, skill, memory, knowledge, and attachment context when relevant.",
        "When a request could lead to very different outcomes based on taste, rules, platform, scope, or success criteria, ask 1-3 targeted questions with the question tool before making changes.",
        "For complex implementation tasks, inspect the local context first, then share a concise plan and wait for user confirmation before editing unless the user clearly asked you to start immediately.",
        "Be direct, useful, and transparent about missing model or tool configuration.",
      ].join("\n"),
      model: "active-model",
      tools: DEFAULT_BUILTIN_TOOL_IDS,
      skills: [],
      permissionMode: "default",
      permissionPolicy: {
        allowedTools: DEFAULT_BUILTIN_TOOL_IDS,
        allowRisk: ["read", "network"],
        requireApprovalFor: DEFAULT_APPROVAL_TOOL_IDS,
      },
      maxTurns: DEFAULT_AGENTIC_MAX_TURNS,
    },
    {
      id: COORDINATOR_AGENT_ID,
      name: "Coordinator",
      description: "Plans work, delegates to workers, tracks progress, and synthesizes results",
      role: "coordinator",
      promptMode: "replace-default",
      prompt: [
        "You are a coordinator agent.",
        "Break complex work into small tasks with clear owners, dependencies, and verification criteria.",
        "Prefer doing simple answers directly. Delegate only when parallel or specialist work materially helps.",
        "Summarize worker results for the user; do not treat worker messages as user conversation.",
      ].join("\n"),
      model: "active-model",
      tools: [],
      skills: [],
      permissionMode: "deny",
      maxTurns: DEFAULT_AGENTIC_MAX_TURNS,
    },
    {
      id: WORKER_AGENT_ID,
      name: "Worker",
      description: "Executes one bounded task and returns evidence-backed results",
      role: "worker",
      promptMode: "replace-default",
      prompt: [
        "You are a worker agent spawned for one bounded task.",
        "Stay inside the assigned scope, report blockers early, and include concrete evidence for claims.",
        "Do not spawn other agents unless the coordinator explicitly grants that capability.",
      ].join("\n"),
      model: "active-model",
      tools: DEFAULT_BUILTIN_TOOL_IDS,
      skills: [],
      permissionMode: "default",
      permissionPolicy: {
        allowedTools: DEFAULT_BUILTIN_TOOL_IDS,
        allowRisk: ["read", "network"],
        requireApprovalFor: DEFAULT_APPROVAL_TOOL_IDS,
      },
      maxTurns: DEFAULT_AGENTIC_MAX_TURNS,
    },
  ];
}

export function createDefaultAgentRegistry() {
  const registry = new AgentRegistry();
  for (const agent of createDefaultAgentDefinitions()) {
    registry.register(agent);
  }
  return registry;
}
