import type { AppearanceThemeId } from "../../types";

export interface AppearanceThemeOption {
  id: AppearanceThemeId;
  label: string;
  description: string;
  accentLabel: string;
  swatches: [string, string, string];
}

export const APPEARANCE_THEME_OPTIONS: AppearanceThemeOption[] = [
  {
    id: "linen",
    label: "Linen",
    description: "Warm neutral surfaces with a restrained editorial accent.",
    accentLabel: "Warm neutral",
    swatches: ["#f3efe8", "#ece6db", "#475569"],
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Cool blue glass tones for a clearer technical feel.",
    accentLabel: "Blue current",
    swatches: ["#eef6ff", "#dbeafe", "#1d4ed8"],
  },
  {
    id: "forest",
    label: "Forest",
    description: "Natural green depth with softer cards and calmer contrast.",
    accentLabel: "Pine accent",
    swatches: ["#eef8f1", "#d6f0de", "#166534"],
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Copper and rose surfaces for a more expressive desktop mood.",
    accentLabel: "Amber glow",
    swatches: ["#fff3eb", "#ffe0cc", "#c2410c"],
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Low-light slate chrome with higher focus on active content.",
    accentLabel: "Slate contrast",
    swatches: ["#1f2937", "#334155", "#cbd5e1"],
  },
];

export function getAppearanceThemeOption(themeId: AppearanceThemeId) {
  return APPEARANCE_THEME_OPTIONS.find((option) => option.id === themeId) ?? APPEARANCE_THEME_OPTIONS[0];
}
