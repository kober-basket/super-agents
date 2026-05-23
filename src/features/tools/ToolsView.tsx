import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ClipboardList,
  CloudDownload,
  FilePlus2,
  FileSearch,
  FolderTree,
  GitPullRequest,
  Globe,
  Layers,
  ListChecks,
  MessageCircleQuestion,
  PencilLine,
  PlugZap,
  Plus,
  Radar,
  Search,
  TerminalSquare,
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
  "tool-accent-slate",
  "tool-accent-sky",
  "tool-accent-emerald",
  "tool-accent-amber",
  "tool-accent-rose",
  "tool-accent-violet",
] as const;

type ToolIconTone = (typeof TOOL_ICON_TONES)[number];

const BUILTIN_TOOL_VISUALS: Partial<Record<string, { icon: LucideIcon; tone: ToolIconTone }>> = {
  apply_patch: { icon: GitPullRequest, tone: "tool-accent-violet" },
  bash: { icon: TerminalSquare, tone: "tool-accent-slate" },
  edit: { icon: PencilLine, tone: "tool-accent-amber" },
  glob: { icon: Radar, tone: "tool-accent-sky" },
  grep: { icon: Search, tone: "tool-accent-sky" },
  list: { icon: FolderTree, tone: "tool-accent-emerald" },
  multi_edit: { icon: Layers, tone: "tool-accent-amber" },
  question: { icon: MessageCircleQuestion, tone: "tool-accent-violet" },
  read: { icon: FileSearch, tone: "tool-accent-emerald" },
  todo_read: { icon: ClipboardList, tone: "tool-accent-slate" },
  todo_write: { icon: ListChecks, tone: "tool-accent-emerald" },
  web_fetch: { icon: CloudDownload, tone: "tool-accent-rose" },
  web_search: { icon: Globe, tone: "tool-accent-sky" },
  write: { icon: FilePlus2, tone: "tool-accent-amber" },
};

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

  const builtinTools = tools.filter((tool) => tool.source === "builtin");

  useEffect(() => {
    if (!pendingNewServer || mcpServers.length === 0) return;
    const latestServer = mcpServers[mcpServers.length - 1];
    setMcpModalServerId(latestServer?.id ?? null);
    setMcpModalOpen(true);
    setPendingNewServer(false);
  }, [mcpServers, pendingNewServer]);

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
          ) : (
            <div className="empty-panel compact">
              <strong>还没有 MCP 服务</strong>
              <p>添加一个 MCP 服务后，点击服务进入配置页获取和调试工具。</p>
            </div>
          )}
        </section>

        <section className="skills-section">
          <div className="skills-section-head">
            <h3>内置工具</h3>
          </div>

          {builtinTools.length > 0 ? (
            <div className="tool-list">
              {builtinTools.map((tool, index) => {
                const visual = resolveBuiltinToolVisual(tool, index);
                return (
                <article key={tool.id} className="tool-list-row skill-list-row skill-tile">
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
              })}
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

function ToolIcon({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: ToolIconTone }) {
  return (
    <div className={clsx("skill-icon-shell", "tool-icon-shell", tone)} title={label}>
      <Icon size={20} strokeWidth={2.1} />
      <span aria-hidden="true" className="tool-icon-spark" />
    </div>
  );
}

function resolveBuiltinToolVisual(tool: WorkspaceTool, index: number) {
  const name = normalizeToolName(tool.name);
  return BUILTIN_TOOL_VISUALS[name] ?? { icon: Wrench, tone: TOOL_ICON_TONES[index % TOOL_ICON_TONES.length] };
}

function normalizeToolName(name: string) {
  return name.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function formatMcpTransport(server: McpServerConfig) {
  return server.transport === "remote" ? "远程" : "本地";
}

function resolveMcpTone(status: McpConnectionStatus | "connecting"): ToolIconTone {
  if (status === "connected") return "tool-accent-emerald";
  if (status === "disabled") return "tool-accent-slate";
  return "tool-accent-amber";
}

function getMcpStatusClass(status: McpConnectionStatus | "connecting") {
  if (status === "connected") return "enabled";
  if (status === "disabled") return "disabled";
  return "quiet";
}
