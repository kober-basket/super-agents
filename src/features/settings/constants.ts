import {
  FolderOpen,
  Palette,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { AppConfig, McpTransport } from "../../types";
import type { SettingsSection } from "./types";

export const CONTEXT_CHOICES: Array<{
  value: AppConfig["contextTier"];
  label: string;
}> = [
  { value: "low", label: "轻量" },
  { value: "medium", label: "均衡" },
  { value: "high", label: "深入" },
];

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "常规", icon: Settings2 },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "assistant", label: "模型", icon: Sparkles },
  { id: "workspace", label: "工作区", icon: FolderOpen },
];

export interface RecommendedMcpServer {
  id: string;
  name: string;
  operator: string;
  description: string;
  badge: string;
  tone: string;
  transport: McpTransport;
}

export const RECOMMENDED_MCP_SERVERS: RecommendedMcpServer[] = [
  {
    id: "feishu",
    name: "Feishu",
    operator: "Feishu",
    description: "Read docs, messages, calendars, and team collaboration content.",
    badge: "FS",
    tone: "blue",
    transport: "remote",
  },
  {
    id: "notion",
    name: "Notion",
    operator: "Notion",
    description: "Browse knowledge bases, synced pages, and workspace documents.",
    badge: "N",
    tone: "slate",
    transport: "remote",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    operator: "Google",
    description: "Access drive files, spreadsheets, and shared documents.",
    badge: "GD",
    tone: "green",
    transport: "remote",
  },
];
