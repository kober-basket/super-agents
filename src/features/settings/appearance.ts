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
    id: "porcelain",
    label: "瓷白晨光",
    description: "最浅一档的瓷白基底，界面更通透，适合想要轻盈观感的场景。",
    accentLabel: "冷雾灰蓝",
    swatches: ["#fafaf8", "#f1f2ee", "#6b7280"],
  },
  {
    id: "linen",
    label: "亚麻白",
    description: "温和米白基底，适合长时间阅读和低干扰办公。",
    accentLabel: "暖灰中性",
    swatches: ["#f3efe8", "#ece6db", "#475569"],
  },
  {
    id: "mist",
    label: "晨雾灰蓝",
    description: "轻雾灰蓝底色，介于冷静和柔和之间，适合日常使用。",
    accentLabel: "雾蓝细节",
    swatches: ["#f4f7fb", "#e4ebf5", "#5b6f8f"],
  },
  {
    id: "ocean",
    label: "海雾蓝",
    description: "冷静的浅蓝玻璃感，更偏工具化和专业感。",
    accentLabel: "清透蓝调",
    swatches: ["#eef6ff", "#dbeafe", "#1d4ed8"],
  },
  {
    id: "sage",
    label: "鼠尾草雾",
    description: "灰绿和雾白之间的低饱和过渡，比森林更轻，也比中性色更有呼吸感。",
    accentLabel: "柔雾青灰",
    swatches: ["#f4f7f2", "#e4ebdf", "#5f7467"],
  },
  {
    id: "forest",
    label: "松林绿",
    description: "柔和绿色搭配低刺激对比，视觉更安静。",
    accentLabel: "松针点缀",
    swatches: ["#eef8f1", "#d6f0de", "#166534"],
  },
  {
    id: "citrus",
    label: "青柠奶油",
    description: "浅奶油和青柠点缀，更轻快，也保留足够克制。",
    accentLabel: "鲜亮柠绿",
    swatches: ["#fbfaef", "#eef1cf", "#6b7f2a"],
  },
  {
    id: "sunset",
    label: "落日棕橘",
    description: "铜棕和暖粉的组合，更有温度，也更有辨识度。",
    accentLabel: "琥珀暖光",
    swatches: ["#fff3eb", "#ffe0cc", "#c2410c"],
  },
  {
    id: "aubergine",
    label: "暮莓紫",
    description: "偏灰的浆果紫搭配雾粉中性色，比常规紫色更高级。",
    accentLabel: "莓紫雾感",
    swatches: ["#faf5fb", "#ecdff0", "#7b4c72"],
  },
  {
    id: "dusk",
    label: "暮岚灰蓝",
    description: "进入深色前的一档灰蓝主题，压低对比和高光，夜间更稳。",
    accentLabel: "雾感石板蓝",
    swatches: ["#1b2128", "#27303a", "#8ea0b3"],
  },
  {
    id: "graphite",
    label: "铁墨夜色",
    description: "柔化后的深色石墨主题，减少刺眼蓝灰和亮边，层次更安静。",
    accentLabel: "低饱和冷灰",
    swatches: ["#161b22", "#222a34", "#9aa9b8"],
  },
  {
    id: "midnight",
    label: "深海夜雾",
    description: "更深一档的夜色配色，但保持低饱和和柔边，不走霓虹路线。",
    accentLabel: "沉静海雾蓝",
    swatches: ["#10151b", "#1a232d", "#89a0b5"],
  },
];

export function getAppearanceThemeOption(themeId: AppearanceThemeId) {
  return APPEARANCE_THEME_OPTIONS.find((option) => option.id === themeId) ?? APPEARANCE_THEME_OPTIONS[0];
}
