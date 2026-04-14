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
    label: "亚麻白",
    description: "温和米白基底，适合长时间阅读和低干扰办公。",
    accentLabel: "暖灰中性",
    swatches: ["#f3efe8", "#ece6db", "#475569"],
  },
  {
    id: "ocean",
    label: "海雾蓝",
    description: "冷静的浅蓝玻璃感，更偏工具化和专业感。",
    accentLabel: "清透蓝调",
    swatches: ["#eef6ff", "#dbeafe", "#1d4ed8"],
  },
  {
    id: "forest",
    label: "松林绿",
    description: "柔和绿色搭配低刺激对比，视觉更安静。",
    accentLabel: "松针点缀",
    swatches: ["#eef8f1", "#d6f0de", "#166534"],
  },
  {
    id: "sunset",
    label: "落日棕",
    description: "铜棕和暖粉的组合，更有温度也更有辨识度。",
    accentLabel: "琥珀暖光",
    swatches: ["#fff3eb", "#ffe0cc", "#c2410c"],
  },
  {
    id: "graphite",
    label: "石墨夜",
    description: "优化后的深色石墨主题，减少生硬蓝感，层次更稳。",
    accentLabel: "冷银聚焦",
    swatches: ["#11161d", "#1d2733", "#9fb4c8"],
  },
  {
    id: "mist",
    label: "晨雾灰",
    description: "轻雾灰蓝基底，介于冷静和柔和之间，适合日常使用。",
    accentLabel: "雾蓝细节",
    swatches: ["#f4f7fb", "#e4ebf5", "#5b6f8f"],
  },
  {
    id: "citrus",
    label: "青柠奶油",
    description: "浅奶油和青柠点缀，更轻快，也保留足够克制。",
    accentLabel: "鲜亮柠绿",
    swatches: ["#fbfaef", "#eef1cf", "#6b7f2a"],
  },
  {
    id: "aubergine",
    label: "暮莓紫",
    description: "偏灰的浆果紫搭配雾粉中性色，比常规紫色更高级。",
    accentLabel: "莓紫雾感",
    swatches: ["#faf5fb", "#ecdff0", "#7b4c72"],
  },
];

export function getAppearanceThemeOption(themeId: AppearanceThemeId) {
  return APPEARANCE_THEME_OPTIONS.find((option) => option.id === themeId) ?? APPEARANCE_THEME_OPTIONS[0];
}
