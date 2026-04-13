import { MessageSquareShare, Palette, Sparkles, type LucideIcon } from "lucide-react";

import type { AppConfig, McpTransport } from "../../types";
import type { SettingsSection } from "./types";

export const CONTEXT_CHOICES: Array<{
  value: AppConfig["contextTier"];
  label: string;
}> = [
  { value: "low", label: "\u8f7b\u91cf" },
  { value: "medium", label: "\u5747\u8861" },
  { value: "high", label: "\u6df1\u5165" },
];

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "appearance", label: "\u5916\u89c2", icon: Palette },
  { id: "assistant", label: "\u6a21\u578b", icon: Sparkles },
  { id: "remote-control", label: "\u8fdc\u7a0b\u63a7\u5236", icon: MessageSquareShare },
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
