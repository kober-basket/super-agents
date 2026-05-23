import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  BrainCircuit,
  Camera,
  ClipboardList,
  CloudDownload,
  Code2,
  Database,
  FilePlus2,
  FileSearch,
  FileUp,
  FolderTree,
  GitPullRequest,
  Globe,
  Inbox,
  Keyboard,
  Layers,
  ListChecks,
  Mail,
  MailCheck,
  MailPlus,
  MessageCircleQuestion,
  MousePointerClick,
  Network,
  PanelTop,
  PencilLine,
  PlugZap,
  Plus,
  Radar,
  Search,
  Send,
  TerminalSquare,
  TextCursorInput,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type {
  McpConnectionStatus,
  McpServerConfig,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugResult,
  WorkspaceTool,
} from "../../types";
import { McpSettings } from "../settings/McpSettings";
import { formatMcpStatusLabel, sanitizeMcpName } from "../shared/utils";

interface ToolsViewProps {
  mcpAdvancedOpen: boolean;
  mcpRefreshing: boolean;
  mcpServers: McpServerConfig[];
  mcpStatusMap: Record<string, McpServerStatus>;
  tools: WorkspaceTool[];
  onAddMcpServer: () => void;
  onDebugTool: (server: McpServerConfig, toolName: string, argumentsJson: string) => Promise<McpToolDebugResult>;
  onInspectServer: (server: McpServerConfig) => Promise<McpServerToolsResult>;
  onRefreshMcp: () => void | Promise<void>;
  onRemoveMcpServer: (serverId: string) => void;
  onToggleAdvanced: () => void;
  onUpdateMcp: (serverId: string, patch: Partial<McpServerConfig>) => void;
}

const TOOL_ICON_TONES = [
  "skill-accent-indigo",
  "skill-accent-sky",
  "skill-accent-mint",
  "skill-accent-amber",
  "skill-accent-rose",
  "skill-accent-violet",
] as const;

type ToolIconTone = (typeof TOOL_ICON_TONES)[number];
type ToolVisual = { icon: LucideIcon; tone: ToolIconTone };
type BuiltinToolGroup = { key: string; label: string; order: number; tools: WorkspaceTool[] };

const BUILTIN_TOOL_VISUALS: Partial<Record<string, ToolVisual>> = {
  apply_patch: { icon: GitPullRequest, tone: "skill-accent-violet" },
  bash: { icon: TerminalSquare, tone: "skill-accent-indigo" },
  browser_click: { icon: MousePointerClick, tone: "skill-accent-sky" },
  browser_drag: { icon: MousePointerClick, tone: "skill-accent-sky" },
  browser_evaluate: { icon: Code2, tone: "skill-accent-violet" },
  browser_fill: { icon: TextCursorInput, tone: "skill-accent-mint" },
  browser_fill_form: { icon: TextCursorInput, tone: "skill-accent-mint" },
  browser_get_console_message: { icon: TerminalSquare, tone: "skill-accent-indigo" },
  browser_get_network_request: { icon: Network, tone: "skill-accent-sky" },
  browser_hover: { icon: MousePointerClick, tone: "skill-accent-sky" },
  browser_list_console_messages: { icon: TerminalSquare, tone: "skill-accent-indigo" },
  browser_list_network_requests: { icon: Network, tone: "skill-accent-sky" },
  browser_list_pages: { icon: PanelTop, tone: "skill-accent-sky" },
  browser_navigate: { icon: Globe, tone: "skill-accent-sky" },
  browser_press_key: { icon: Keyboard, tone: "skill-accent-indigo" },
  browser_screenshot: { icon: Camera, tone: "skill-accent-sky" },
  browser_select_page: { icon: PanelTop, tone: "skill-accent-sky" },
  browser_snapshot: { icon: Camera, tone: "skill-accent-sky" },
  browser_type_text: { icon: Keyboard, tone: "skill-accent-indigo" },
  browser_upload_file: { icon: FileUp, tone: "skill-accent-amber" },
  browser_wait_for: { icon: PanelTop, tone: "skill-accent-amber" },
  edit: { icon: PencilLine, tone: "skill-accent-amber" },
  glob: { icon: Radar, tone: "skill-accent-sky" },
  grep: { icon: Search, tone: "skill-accent-sky" },
  list: { icon: FolderTree, tone: "skill-accent-mint" },
  mail: { icon: Inbox, tone: "skill-accent-rose" },
  mail_auth: { icon: MailCheck, tone: "skill-accent-mint" },
  mail_draft: { icon: MailPlus, tone: "skill-accent-amber" },
  mail_send: { icon: Send, tone: "skill-accent-rose" },
  memory: { icon: Database, tone: "skill-accent-mint" },
  multi_edit: { icon: Layers, tone: "skill-accent-amber" },
  question: { icon: MessageCircleQuestion, tone: "skill-accent-violet" },
  read: { icon: FileSearch, tone: "skill-accent-mint" },
  skill: { icon: BrainCircuit, tone: "skill-accent-violet" },
  todo_read: { icon: ClipboardList, tone: "skill-accent-indigo" },
  todo_write: { icon: ListChecks, tone: "skill-accent-mint" },
  web_fetch: { icon: CloudDownload, tone: "skill-accent-rose" },
  web_search: { icon: Globe, tone: "skill-accent-sky" },
  write: { icon: FilePlus2, tone: "skill-accent-amber" },
};

const CATEGORY_TOOL_VISUALS: Record<NonNullable<WorkspaceTool["category"]>, ToolVisual> = {
  browser: { icon: PanelTop, tone: "skill-accent-sky" },
  context: { icon: BrainCircuit, tone: "skill-accent-violet" },
  mail: { icon: Mail, tone: "skill-accent-rose" },
  other: { icon: Wrench, tone: "skill-accent-indigo" },
  runtime: { icon: TerminalSquare, tone: "skill-accent-indigo" },
  web: { icon: Globe, tone: "skill-accent-sky" },
  workspace: { icon: FolderTree, tone: "skill-accent-mint" },
};

const DEFAULT_TOOL_CATEGORY_ORDER = 90;

export function ToolsView({
  mcpAdvancedOpen,
  mcpRefreshing,
  mcpServers,
  mcpStatusMap,
  tools,
  onAddMcpServer,
  onDebugTool,
  onInspectServer,
  onRefreshMcp,
  onRemoveMcpServer,
  onToggleAdvanced,
  onUpdateMcp,
}: ToolsViewProps) {
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpModalServerId, setMcpModalServerId] = useState<string | null>(null);
  const [pendingNewServer, setPendingNewServer] = useState(false);
  const [activeBuiltinCategory, setActiveBuiltinCategory] = useState<string | null>(null);

  const builtinToolGroups = useMemo(
    () => groupBuiltinTools(tools.filter((tool) => tool.source === "builtin")),
    [tools],
  );
  const activeBuiltinGroup =
    builtinToolGroups.find((group) => group.key === activeBuiltinCategory) ?? builtinToolGroups[0] ?? null;

  useEffect(() => {
    if (!pendingNewServer || mcpServers.length === 0) return;
    const latestServer = mcpServers[mcpServers.length - 1];
    setMcpModalServerId(latestServer?.id ?? null);
    setMcpModalOpen(true);
    setPendingNewServer(false);
  }, [mcpServers, pendingNewServer]);

  useEffect(() => {
    if (builtinToolGroups.length === 0) {
      if (activeBuiltinCategory !== null) setActiveBuiltinCategory(null);
      return;
    }
    if (!builtinToolGroups.some((group) => group.key === activeBuiltinCategory)) {
      setActiveBuiltinCategory(builtinToolGroups[0].key);
    }
  }, [activeBuiltinCategory, builtinToolGroups]);

  function openMcpModal(serverId?: string) {
    setMcpModalServerId(serverId ?? null);
    setMcpModalOpen(true);
  }

  function createMcpServer() {
    setPendingNewServer(true);
    onAddMcpServer();
  }

  return (
    <section className="skills-page tools-page">
      <div className="skills-inner">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>工具</h2>
          </div>
        </header>

        <section className="skills-section">
          <div className="skills-section-head with-action">
            <h3>MCP 服务</h3>
            <button className="mcp-add-button" onClick={createMcpServer} type="button">
              <Plus size={14} />
              添加 MCP
            </button>
          </div>

          {mcpServers.length > 0 ? (
            <div className="tool-list">
              {mcpServers.map((server) => {
                const normalized = sanitizeMcpName(server.name);
                const status = mcpStatusMap[normalized]?.status ?? (server.enabled ? "connecting" : "disabled");
                return (
                  <button
                    key={server.id}
                    className="tool-list-row skill-list-row skill-tile"
                    onClick={() => openMcpModal(server.id)}
                    type="button"
                  >
                    <ToolIcon icon={PlugZap} label={server.name} tone={resolveMcpTone(status)} />
                    <div className="skill-tile-copy">
                      <strong title={server.name}>{server.name}</strong>
                      <p>{formatMcpTransport(server)}</p>
                    </div>
                    <div className="skill-tile-status">
                      <span className={clsx("skill-status-chip", getMcpStatusClass(status))}>
                        {formatMcpStatusLabel(status)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className="skills-section">
          <div className="skills-section-head">
            <h3>内置工具</h3>
          </div>

          {builtinToolGroups.length > 0 ? (
            <div className="tool-category-list">
              <div className="tool-category-tabs" role="tablist" aria-label="内置工具分类">
                {builtinToolGroups.map((group) => {
                  const active = activeBuiltinGroup?.key === group.key;
                  const tabId = createToolCategoryDomId("tool-category-tab", group.key);
                  const panelId = createToolCategoryDomId("tool-category-panel", group.key);
                  return (
                    <button
                      key={group.key}
                      aria-controls={panelId}
                      aria-selected={active}
                      className={clsx("tool-category-tab", active && "active")}
                      id={tabId}
                      onClick={() => setActiveBuiltinCategory(group.key)}
                      role="tab"
                      type="button"
                    >
                      <span>{group.label}</span>
                      <em>{group.tools.length}</em>
                    </button>
                  );
                })}
              </div>

              {activeBuiltinGroup ? (
                <section
                  key={activeBuiltinGroup.key}
                  aria-labelledby={createToolCategoryDomId("tool-category-tab", activeBuiltinGroup.key)}
                  className="tool-category tool-category-panel"
                  id={createToolCategoryDomId("tool-category-panel", activeBuiltinGroup.key)}
                  role="tabpanel"
                >
                  <div className="tool-list">
                    {activeBuiltinGroup.tools.map((tool, index) => (
                      <BuiltinToolRow key={tool.id} index={index} tool={tool} />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有内置工具</strong>
              <p>刷新后会显示 read、write、edit、list、grep、glob、web_search、web_fetch、bash。</p>
            </div>
          )}
        </section>
      </div>

      <McpSettings
        mcpAdvancedOpen={mcpAdvancedOpen}
        mcpRefreshing={mcpRefreshing}
        mcpServers={mcpServers}
        mcpStatusMap={mcpStatusMap}
        initialServerId={mcpModalServerId}
        open={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
        onDebugTool={onDebugTool}
        onInspectServer={onInspectServer}
        onRefresh={onRefreshMcp}
        onRemoveMcpServer={onRemoveMcpServer}
        onToggleAdvanced={onToggleAdvanced}
        onUpdateMcp={onUpdateMcp}
      />
    </section>
  );
}

function BuiltinToolRow({ index, tool }: { index: number; tool: WorkspaceTool }) {
  const visual = resolveBuiltinToolVisual(tool, index);
  return (
    <article className="tool-list-row skill-list-row skill-tile">
      <ToolIcon icon={visual.icon} label={tool.name} tone={visual.tone} />
      <div className="skill-tile-copy">
        <strong title={tool.name}>{tool.name}</strong>
        {tool.description ? (
          <p className="tool-description" title={tool.description}>
            {tool.description}
          </p>
        ) : null}
      </div>
      <div className="skill-tile-status">
        <span className="skill-status-chip enabled">可用</span>
      </div>
    </article>
  );
}

function groupBuiltinTools(tools: WorkspaceTool[]): BuiltinToolGroup[] {
  const groups = new Map<string, BuiltinToolGroup>();
  for (const tool of tools) {
    const key = tool.category ?? "other";
    const group = groups.get(key) ?? {
      key,
      label: tool.categoryLabel ?? "其他",
      order: tool.categoryOrder ?? DEFAULT_TOOL_CATEGORY_ORDER,
      tools: [],
    };
    group.tools.push(tool);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      tools: group.tools.slice().sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    }))
    .sort((left, right) => {
      const categoryOrder = left.order - right.order;
      if (categoryOrder !== 0) return categoryOrder;
      return left.label.localeCompare(right.label, "zh-CN");
    });
}

function createToolCategoryDomId(prefix: string, key: string) {
  return `${prefix}-${key.replace(/[^a-z0-9_-]+/gi, "-")}`;
}

function ToolIcon({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: ToolIconTone }) {
  return (
    <div className={clsx("skill-icon-shell", "skill-icon-premium", tone)} title={label}>
      <Icon size={20} strokeWidth={2.1} />
      <span aria-hidden="true" className="skill-icon-orbit" />
    </div>
  );
}

function resolveBuiltinToolVisual(tool: WorkspaceTool, index: number) {
  const name = normalizeToolName(tool.name);
  return (
    BUILTIN_TOOL_VISUALS[name] ??
    (tool.category ? CATEGORY_TOOL_VISUALS[tool.category] : undefined) ?? {
      icon: Wrench,
      tone: TOOL_ICON_TONES[index % TOOL_ICON_TONES.length],
    }
  );
}

function normalizeToolName(name: string) {
  return name.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function formatMcpTransport(server: McpServerConfig) {
  return server.transport === "remote" ? "远程" : "本地";
}

function resolveMcpTone(status: McpConnectionStatus | "connecting"): ToolIconTone {
  if (status === "connected") return "skill-accent-mint";
  if (status === "disabled") return "skill-accent-indigo";
  return "skill-accent-amber";
}

function getMcpStatusClass(status: McpConnectionStatus | "connecting") {
  if (status === "connected") return "enabled";
  if (status === "disabled") return "disabled";
  return "quiet";
}
