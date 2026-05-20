import type { AppConfig, SkillConfig } from "../../src/types";

export interface ParsedSkillInvocation {
  name: string;
  args: string;
}

export interface ParsedSkillInvocations {
  invocations: ParsedSkillInvocation[];
  args: string;
}

const markdownSkillMentionPattern = /\[\$([^\]\r\n]+)\]\(([^)\r\n]+)\)/g;

function normalizeSkillKey(value: string) {
  return value.trim().replace(/^\$/, "").toLowerCase();
}

function stripMarkdownSkillMentions(content: string) {
  return content
    .replace(markdownSkillMentionPattern, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

export function parseSkillInvocations(content: string): ParsedSkillInvocations | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const seen = new Set<string>();
  const mentions = [...trimmed.matchAll(markdownSkillMentionPattern)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .filter((name) => {
      const key = normalizeSkillKey(name);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  if (mentions.length > 0) {
    const args = stripMarkdownSkillMentions(trimmed);
    return {
      invocations: mentions.map((name) => ({ name, args })),
      args,
    };
  }

  const plainMention = trimmed.match(/^\$([^\s]+)\s*([\s\S]*)$/);
  if (plainMention?.[1]) {
    const args = plainMention[2]?.trim() ?? "";
    return {
      invocations: [{ name: plainMention[1].trim(), args }],
      args,
    };
  }

  return null;
}

export function parseSkillInvocation(content: string): ParsedSkillInvocation | null {
  return parseSkillInvocations(content)?.invocations[0] ?? null;
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
    "If the user mentions one or more skills with `$skill-name` or inline skill chips, that is an explicit request to use those skills.",
    "The list below is an index only; the full skill content is loaded on demand.",
    "",
    ...lines,
  ].join("\n");
}
