export const SKILL_TONES = ["violet", "amber", "blue", "green", "ink", "rose"] as const;

export interface RecommendedSkill {
  id: string;
  name: string;
  description: string;
  badge: string;
  tone: string;
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: "skill-creator",
    name: "skill-creator",
    description: "Help design and structure a new skill for repeatable workflows.",
    badge: "内置技能",
    tone: "violet",
  },
];
