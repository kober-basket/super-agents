import type { ToolDefinition } from "../agent-core";
import type { WorkspaceService } from "../workspace-service";
import { buildLoadedSkillContent, findEnabledSkill } from "./skill-invocation";

function readString(input: unknown, key: string) {
  if (!input || typeof input !== "object" || !(key in input)) {
    return "";
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function createSkillToolDefinition(workspaceService: WorkspaceService): ToolDefinition {
  return {
    name: "skill",
    aliases: ["load_skill", "use_skill"],
    description:
      "按名称加载工作区技能后再回答。用户请求匹配某个可用技能，或明确以 $skill-name 开头时使用。",
    risk: "read",
    isConcurrencySafe: false,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Enabled skill name or id to load.",
        },
        args: {
          type: "string",
          description: "Optional user request or arguments to pass into the skill.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(input) {
      const name = readString(input, "name");
      if (!name) {
        throw new Error("name is required.");
      }

      const config = await workspaceService.getConfigSnapshot();
      const skill = findEnabledSkill(config, name);
      if (!skill) {
        throw new Error(`Skill "${name}" is not enabled or does not exist.`);
      }

      const args = readString(input, "args");
      return {
        content: buildLoadedSkillContent(skill, args),
        metadata: {
          skillId: skill.id,
          skillName: skill.name,
          sourcePath: skill.sourcePath,
        },
      };
    },
  };
}
