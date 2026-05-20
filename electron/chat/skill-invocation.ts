import type { AppConfig, SkillConfig } from "../../src/types";

export interface ParsedSkillInvocation {
  name: string;
  args: string;
}

function normalizeSkillKey(value: string) {
  return value.trim().replace(/^\$/, "").toLowerCase();
}

export function parseSkillInvocation(content: string): ParsedSkillInvocation | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const markdownMention = trimmed.match(/^\[\$([^\]]+)\]\([^)]+\)\s*([\s\S]*)$/);
  if (markdownMention?.[1]) {
    return {
      name: markdownMention[1].trim(),
      args: markdownMention[2]?.trim() ?? "",
    };
  }

  const plainMention = trimmed.match(/^\$([^\s]+)\s*([\s\S]*)$/);
  if (plainMention?.[1]) {
    return {
      name: plainMention[1].trim(),
      args: plainMention[2]?.trim() ?? "",
    };
  }

  return null;
}

export function findEnabledSkill(config: AppConfig, name: string) {
  const target = normalizeSkillKey(name);
  return config.skills.find((skill) => {
    if (!skill.enabled || skill.kind !== "command") {
      return false;
    }
    return normalizeSkillKey(skill.id) === target || normalizeSkillKey(skill.name) === target;
  }) ?? null;
}

export function buildLoadedSkillContent(
  skill: SkillConfig,
  args: string,
  options: { explicit?: boolean } = {},
) {
  const substitutedCommand = skill.command.replace(/\$ARGUMENTS/g, args);
  const sections = [
    options.explicit
      ? `Explicit skill invocation: the user requested $${skill.name}. Follow this skill before answering.`
      : `Loaded skill: ${skill.name}`,
    `# Skill: ${skill.name}`,
    skill.description ? `Description: ${skill.description}` : "",
    skill.sourcePath?.trim() ? `Base directory for this skill: ${skill.sourcePath.trim()}` : "",
    skill.sourcePath?.trim()
      ? "Relative paths in this skill are resolved from the base directory above."
      : "",
    args ? `Skill arguments:\n${args}` : "",
    "<skill_content>",
    substitutedCommand.trim(),
    "</skill_content>",
  ];

  return sections.filter(Boolean).join("\n\n");
}

export function buildSkillIndexPrompt(config: AppConfig) {
  const enabledSkills = config.skills.filter((skill) => skill.enabled && skill.kind === "command");
  if (enabledSkills.length === 0) {
    return "";
  }

  const lines = enabledSkills.map((skill) => {
    const suffix = skill.sourcePath?.trim() ? `\n  Skill directory: ${skill.sourcePath.trim()}` : "";
    return `- ${skill.name}: ${skill.description || "No description"}${suffix}`;
  });

  return [
    "Available workspace skills for this turn:",
    "When a skill clearly matches the user's request, this is a blocking requirement: call the `skill` tool with the skill name and optional args before answering.",
    "If the user begins their message with `$skill-name`, that is an explicit request to use that skill.",
    "The list below is an index only; the full skill content is loaded on demand.",
    "",
    ...lines,
  ].join("\n");
}
