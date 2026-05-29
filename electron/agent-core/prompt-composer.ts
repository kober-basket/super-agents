import type { PromptCompositionInput } from "./types";

const DEFAULT_RUNTIME_PROMPT = [
  "You are running inside the native Super Agents runtime.",
  "Follow the active agent instructions, use only the tools exposed to this agent, and treat permission decisions as authoritative.",
  "Every tool call must include the required input fields from its schema. Never call a tool with an empty object unless its schema has no required fields.",
  "For web information, use web_search for search queries and web_fetch only when you already have a specific HTTP or HTTPS URL.",
  "Do not assume a coding task unless the active agent or user request explicitly calls for software engineering work.",
  "Use the question tool before acting when missing information can materially change the result, especially for creative, product, game, or UI work.",
  "For broad edits or multi-file work, explore first, then state a short plan and wait for confirmation unless the user explicitly asked you to proceed without review.",
].join("\n");

const DEFAULT_BEHAVIOR_PROMPT =
  "You are a capable, neutral AI assistant. Help the user directly, ask concise clarifying questions when the objective is underspecified, and avoid premature implementation.";

export class PromptComposer {
  constructor(
    private readonly runtimePrompt = DEFAULT_RUNTIME_PROMPT,
    private readonly defaultBehaviorPrompt = DEFAULT_BEHAVIOR_PROMPT,
  ) {}

  compose(input: PromptCompositionInput) {
    if (input.overrideSystemPrompt?.trim()) {
      return input.overrideSystemPrompt.trim();
    }

    const primaryPrompt = this.getPrimaryPrompt(input);
    const sections = [
      `# Runtime\n${this.runtimePrompt}`,
      `# Active Instructions\n${primaryPrompt}`,
      input.skills.length > 0
        ? `# Skills\n${input.skills
            .map((skill) => `## ${skill.name}\n${skill.instructions.trim()}`)
            .join("\n\n")}`
        : "",
      input.memoryPrompt?.trim() ? `# Memory\n${input.memoryPrompt.trim()}` : "",
      input.workspacePrompt?.trim() ? `# Workspace\n${input.workspacePrompt.trim()}` : "",
      input.appendSystemPrompt?.trim() ? `# Additional Instructions\n${input.appendSystemPrompt.trim()}` : "",
    ];

    return sections.filter(Boolean).join("\n\n");
  }

  private getPrimaryPrompt(input: PromptCompositionInput) {
    if (input.coordinatorPrompt?.trim()) {
      return input.coordinatorPrompt.trim();
    }

    const agentHeader = `Agent: ${input.agent.name}\nRole: ${input.agent.role}`;
    const agentPrompt = `${agentHeader}\n\n${input.agent.prompt.trim()}`;
    if (input.agent.promptMode === "append-default") {
      return `${this.defaultBehaviorPrompt}\n\n# Agent Profile\n${agentPrompt}`;
    }

    return agentPrompt;
  }
}
