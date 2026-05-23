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
    name: "技能创建器",
    description: "帮助设计和组织可复用工作流的新技能。",
    badge: "内置技能",
    tone: "violet",
  },
];
