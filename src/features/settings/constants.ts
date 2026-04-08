import {
  FolderOpen,
  Layers3,
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
  { value: "low", label: "轻聊" },
  { value: "medium", label: "均衡" },
  { value: "high", label: "深入" },
];

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "常规", icon: Settings2 },
  { id: "assistant", label: "模型配置", icon: Sparkles },
  { id: "mcp", label: "MCP 工具", icon: Layers3 },
  { id: "workspace", label: "资料与目录", icon: FolderOpen },
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
    operator: "飞书",
    description: "读取文档、日程、消息和协同办公数据",
    badge: "FS",
    tone: "blue",
    transport: "remote",
  },
  {
    id: "notion",
    name: "Notion",
    operator: "Notion",
    description: "阅读知识库、更新页面、整理工作文档",
    badge: "N",
    tone: "slate",
    transport: "remote",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    operator: "Google",
    description: "访问云盘文件、表格和共享资料",
    badge: "GD",
    tone: "green",
    transport: "remote",
  },
];
