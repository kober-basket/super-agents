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
    id: "openai-docs",
    name: "openai-docs",
    description: "Use official OpenAI docs and primary sources for product and API guidance.",
    badge: "Codex",
    tone: "blue",
  },
  {
    id: "skill-creator",
    name: "skill-creator",
    description: "Help design and structure a new skill for repeatable workflows.",
    badge: "Codex",
    tone: "violet",
  },
  {
    id: "skill-installer",
    name: "skill-installer",
    description: "Install or import curated Codex skills into the local workspace skill library.",
    badge: "Codex",
    tone: "green",
  },
  {
    id: "meeting-minutes",
    name: "meeting-minutes",
    description: "Turn rough notes into concise meeting minutes with actions and owners.",
    badge: "Built-in",
    tone: "amber",
  },
  {
    id: "email-draft",
    name: "email-draft",
    description: "Draft a clear work email from requirements or bullet points.",
    badge: "Built-in",
    tone: "rose",
  },
  {
    id: "schedule-summary",
    name: "schedule-summary",
    description: "Summarize schedules and call out conflicts, risks, and next steps.",
    badge: "Built-in",
    tone: "ink",
  },
];
