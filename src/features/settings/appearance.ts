import type { AppearanceThemeId } from "../../types";

export interface AppearanceThemeOption {
  id: AppearanceThemeId;
  label: string;
  description: string;
  accentLabel: string;
  swatches: [string, string, string];
}

const LEGACY_THEME_FALLBACKS: Partial<Record<AppearanceThemeId, AppearanceThemeId>> = {
  porcelain: "linen",
  ocean: "mist",
  forest: "sage",
  citrus: "olive",
  midnight: "graphite",
};

const LEGACY_HIDDEN_THEME_OPTIONS: AppearanceThemeOption[] = [
  {
    id: "porcelain",
    label: "瓷白晨光",
    description: "更接近纯白的轻亮底色，已并入更平衡的亚麻白方向。",
    accentLabel: "冷雾灰蓝",
    swatches: ["#fafaf8", "#f1f2ee", "#6b7280"],
  },
  {
    id: "ocean",
    label: "海雾蓝",
    description: "冷调浅蓝方向，已由层次更稳的晨雾灰蓝覆盖。",
    accentLabel: "清透蓝调",
    swatches: ["#eef6ff", "#dbeafe", "#1d4ed8"],
  },
  {
    id: "forest",
    label: "松林绿",
    description: "偏浅的自然绿主题，已由更克制的鼠尾草雾整合。",
    accentLabel: "松针点缀",
    swatches: ["#eef8f1", "#d6f0de", "#166534"],
  },
  {
    id: "citrus",
    label: "青柠奶油",
    description: "偏浅黄绿的轻快方案，已由中间亮度的橄榄灰绿接替。",
    accentLabel: "鲜亮柠绿",
    swatches: ["#fbfaef", "#eef1cf", "#6b7f2a"],
  },
  {
    id: "midnight",
    label: "深海夜雾",
    description: "更深的冷夜配色，已与铁墨夜色合并为同一层级。",
    accentLabel: "沉静海雾蓝",
    swatches: ["#10151b", "#1a232d", "#89a0b5"],
  },
];

export const APPEARANCE_THEME_OPTIONS: AppearanceThemeOption[] = [
  {
    id: "linen",
    label: "亚麻白",
    description: "温和米白基底，阅读和长时间工作都很舒服。",
    accentLabel: "暖灰中性",
    swatches: ["#f3efe8", "#ece6db", "#475569"],
  },
  {
    id: "mist",
    label: "晨雾灰蓝",
    description: "轻雾蓝灰的日常浅色，比纯白更柔和，也更耐看。",
    accentLabel: "雾蓝细节",
    swatches: ["#f4f7fb", "#e4ebf5", "#5b6f8f"],
  },
  {
    id: "sage",
    label: "鼠尾草雾",
    description: "低饱和灰绿浅底，安静、自然，不会显得发灰。",
    accentLabel: "柔雾青灰",
    swatches: ["#f4f7f2", "#e4ebdf", "#5f7467"],
  },
  {
    id: "sunset",
    label: "落日杏棕",
    description: "带一点暖粉和铜杏色，界面更有温度和识别度。",
    accentLabel: "珊瑚暖光",
    swatches: ["#fff3eb", "#ffe0cc", "#c2410c"],
  },
  {
    id: "aubergine",
    label: "暮茄紫",
    description: "偏灰的浆果紫调，轻盈里带一点成熟感。",
    accentLabel: "雾感莓紫",
    swatches: ["#faf5fb", "#ecdff0", "#7b4c72"],
  },
  {
    id: "harbor",
    label: "港湾灰蓝",
    description: "介于浅色与深色之间的冷静灰蓝，层次更沉稳。",
    accentLabel: "钢蓝点缀",
    swatches: ["#d7e0ea", "#bcc9d6", "#4f6984"],
  },
  {
    id: "olive",
    label: "橄榄灰绿",
    description: "略带泥感的中间亮度绿调，比浅绿更稳，比深绿更轻。",
    accentLabel: "苔绿强调",
    swatches: ["#dbe0d2", "#c3cbaf", "#5d6941"],
  },
  {
    id: "slate",
    label: "石板灰",
    description: "中性偏冷的石板灰，适合希望界面更克制但不想太暗的场景。",
    accentLabel: "烟灰蓝",
    swatches: ["#d8dde2", "#c0c8d1", "#53606d"],
  },
  {
    id: "dusk",
    label: "暮岚灰蓝",
    description: "进入深色前的一档灰蓝主题，夜间使用更稳。",
    accentLabel: "雾感石板蓝",
    swatches: ["#1b2128", "#27303a", "#8ea0b3"],
  },
  {
    id: "graphite",
    label: "铁墨夜色",
    description: "柔化后的石墨深色，减少刺眼高光，层次更安静。",
    accentLabel: "低饱和冷灰",
    swatches: ["#161b22", "#222a34", "#9aa9b8"],
  },
  {
    id: "ember",
    label: "余烬棕夜",
    description: "暖棕底色配合克制橙光，更像夜间工作台。",
    accentLabel: "铜棕微光",
    swatches: ["#17110f", "#10202b", "#d26a47"],
  },
];

export function getVisibleAppearanceThemeOption(themeId: AppearanceThemeId) {
  return APPEARANCE_THEME_OPTIONS.find((option) => option.id === themeId) ?? null;
}

export function getAppearanceThemeOption(themeId: AppearanceThemeId) {
  return (
    getVisibleAppearanceThemeOption(themeId) ??
    LEGACY_HIDDEN_THEME_OPTIONS.find((option) => option.id === themeId) ??
    (LEGACY_THEME_FALLBACKS[themeId]
      ? APPEARANCE_THEME_OPTIONS.find((option) => option.id === LEGACY_THEME_FALLBACKS[themeId])
      : null) ??
    APPEARANCE_THEME_OPTIONS[0]
  );
}
