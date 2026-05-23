import type { SkillConfig } from "../types";

export interface ComposerSlashCommandTrigger {
  query: string;
  start: number;
  end: number;
}

export type ComposerSlashCommandAction = "open-model-picker" | "open-skill-picker";

export interface ComposerSlashCommandItem {
  id: string;
  kind: "command";
  label: string;
  description: string;
  section: "快捷";
  action: ComposerSlashCommandAction;
  aliases: string[];
}

export interface ComposerSlashSkillItem {
  id: string;
  kind: "skill";
  label: string;
  description: string;
  section: "技能";
  sourceLabel: string;
  skill: SkillConfig;
}

export type ComposerSlashSuggestion = ComposerSlashCommandItem | ComposerSlashSkillItem;

export const composerSlashCommandItems: ComposerSlashCommandItem[] = [
  {
    id: "model",
    kind: "command",
    label: "模型",
    description: "打开模型选择器",
    section: "快捷",
    action: "open-model-picker",
    aliases: ["model", "gpt", "llm"],
  },
  {
    id: "skills",
    kind: "command",
    label: "技能",
    description: "切换到技能选择输入",
    section: "快捷",
    action: "open-skill-picker",
    aliases: ["skill", "skills"],
  },
];

export function getComposerSlashCommandTrigger(value: string): ComposerSlashCommandTrigger | null {
  const match = value.match(/(^|[\s\n])\/([^\s/]*)$/);
  if (!match) {
    return null;
  }

  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const start = (match.index ?? 0) + prefix.length;
  return {
    query,
    start,
    end: value.length,
  };
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function matchesQuery(values: string[], query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => normalizeSearchValue(value).includes(normalizedQuery));
}

function formatSkillSourceLabel(skill: SkillConfig) {
  if (skill.system) {
    return "内置";
  }

  if (skill.sourcePath?.includes(".agents")) {
    return "super-agents";
  }

  return "个人";
}

function toSkillSuggestion(skill: SkillConfig): ComposerSlashSkillItem {
  return {
    id: skill.id,
    kind: "skill",
    label: skill.displayName || skill.name,
    description: skill.shortDescription || skill.description || "工作区技能",
    section: "技能",
    sourceLabel: formatSkillSourceLabel(skill),
    skill,
  };
}

export function buildComposerSlashCommandSuggestions({
  skills,
  trigger,
}: {
  skills: SkillConfig[];
  trigger: ComposerSlashCommandTrigger;
}) {
  const query = trigger.query;
  const commandSuggestions = composerSlashCommandItems.filter((item) =>
    matchesQuery([item.id, item.label, item.description, ...item.aliases], query),
  );
  const skillSuggestions = skills
    .filter((skill) => skill.enabled)
    .filter((skill) =>
      matchesQuery(
        [
          skill.id,
          skill.name,
          skill.displayName ?? "",
          skill.description,
          skill.shortDescription ?? "",
        ],
        query,
      ),
    )
    .slice(0, 12)
    .map(toSkillSuggestion);

  return [...commandSuggestions, ...skillSuggestions];
}

export function removeComposerSlashCommandTrigger(value: string, trigger: ComposerSlashCommandTrigger) {
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end).replace(/^\s+/, "");

  return `${before}${after}`;
}
