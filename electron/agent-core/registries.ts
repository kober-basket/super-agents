import type { AgentDefinition, SkillDefinition, ToolDefinition } from "./types";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition) {
    this.agents.set(agent.id, agent);
  }

  get(agentId: string) {
    return this.agents.get(agentId);
  }

  update(agentId: string, patch: Partial<AgentDefinition>) {
    const current = this.agents.get(agentId);
    if (!current) {
      throw new Error(`Agent "${agentId}" is not registered.`);
    }
    const next = { ...current, ...patch };
    this.agents.set(agentId, next);
    return next;
  }

  list() {
    return Array.from(this.agents.values());
  }
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition) {
    this.skills.set(skill.id, skill);
  }

  getMany(skillIds: string[] | undefined) {
    return (skillIds ?? []).flatMap((skillId) => {
      const skill = this.skills.get(skillId);
      return skill ? [skill] : [];
    });
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly canonicalToolNames = new Set<string>();

  register(tool: ToolDefinition) {
    this.canonicalToolNames.add(tool.name);
    this.tools.set(tool.name, tool);
    for (const alias of tool.aliases ?? []) {
      this.tools.set(alias, tool);
    }
  }

  unregister(toolName: string) {
    const tool = this.tools.get(toolName);
    if (!tool) return;
    this.canonicalToolNames.delete(tool.name);
    this.tools.delete(tool.name);
    for (const alias of tool.aliases ?? []) {
      if (this.tools.get(alias) === tool) {
        this.tools.delete(alias);
      }
    }
  }

  get(toolName: string) {
    return this.tools.get(toolName);
  }

  list() {
    return Array.from(this.canonicalToolNames).flatMap((toolName) => {
      const tool = this.tools.get(toolName);
      return tool ? [tool] : [];
    });
  }

  getMany(toolNames: string[] | undefined) {
    const seen = new Set<string>();
    return (toolNames ?? []).flatMap((toolName) => {
      const tool = this.tools.get(toolName);
      if (!tool || seen.has(tool.name)) {
        return [];
      }
      seen.add(tool.name);
      return tool ? [tool] : [];
    });
  }
}
