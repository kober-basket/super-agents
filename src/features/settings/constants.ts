import { MessageSquareShare, Palette, Sparkles, type LucideIcon } from "lucide-react";

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
  { id: "appearance", label: "外观", icon: Palette },
  { id: "assistant", label: "模型", icon: Sparkles },
  { id: "remote-control", label: "远程控制", icon: MessageSquareShare },
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
    name: "飞书",
    operator: "飞书",
    description: "读取文档、消息、日历和团队协作内容。",
    badge: "FS",
    tone: "blue",
    transport: "remote",
  },
  {
    id: "notion",
    name: "Notion",
    operator: "Notion",
    description: "浏览知识库、同步页面和工作区文档。",
    badge: "N",
    tone: "slate",
    transport: "remote",
  },
  {
    id: "google-drive",
    name: "谷歌云盘",
    operator: "谷歌",
    description: "访问云盘文件、表格和共享文档。",
    badge: "GD",
    tone: "green",
    transport: "remote",
  },
];
