import { useEffect, useState } from "react";
import clsx from "clsx";
import { LoaderCircle, Plus, RefreshCw, Settings2 } from "lucide-react";

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
  toolsRefreshing: boolean;
  onAddMcpServer: () => void;
  onDebugTool: (server: McpServerConfig, toolName: string, argumentsJson: string) => Promise<McpToolDebugResult>;
  onInspectServer: (server: McpServerConfig) => Promise<McpServerToolsResult>;
  onRefresh: () => void | Promise<void>;
  onRefreshMcp: () => void | Promise<void>;
  onRemoveMcpServer: (serverId: string) => void;
  onToggleAdvanced: () => void;
  onUpdateMcp: (serverId: string, patch: Partial<McpServerConfig>) => void;
}

export function ToolsView({
  mcpAdvancedOpen,
  mcpRefreshing,
  mcpServers,
  mcpStatusMap,
  tools,
  toolsRefreshing,
  onAddMcpServer,
  onDebugTool,
  onInspectServer,
  onRefresh,
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
    <section className="skills-page">
      <div className="skills-inner">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>工具</h2>
          </div>

          <div className="skills-toolbar-actions">
            <button className="secondary-button" onClick={() => void onRefresh()} disabled={toolsRefreshing} type="button">
              {toolsRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              刷新工具
            </button>
          </div>
        </header>

        <section className="skills-section">
          <div className="skills-section-head">
            <h3>内置工具</h3>
          </div>

          {builtinTools.length > 0 ? (
            <div className="tool-list">
              {builtinTools.map((tool) => (
                <article key={tool.id} className="tool-list-row tool-card">
                  <div className="tool-card-head">
                    <div>
                      <strong>{tool.name}</strong>
                    </div>
                  </div>
                  {tool.description ? <p>{tool.description}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有内置工具</strong>
              <p>刷新后会显示 read、write、edit、list、grep、glob、web_search、web_fetch、bash。</p>
            </div>
          )}
        </section>

        <section className="skills-section">
          <div className="skills-section-head with-action">
            <h3>MCP 服务</h3>
            <div className="skills-toolbar-actions inline">
              <button className="secondary-button" onClick={() => openMcpModal()} type="button">
                <Settings2 size={14} />
                管理 MCP
              </button>
              <button className="primary-button" onClick={createMcpServer} type="button">
                <Plus size={14} />
                添加 MCP
              </button>
            </div>
          </div>

          {mcpServers.length > 0 ? (
            <div className="tool-list">
              {mcpServers.map((server) => {
                const normalized = sanitizeMcpName(server.name);
                const status = mcpStatusMap[normalized]?.status ?? (server.enabled ? "connecting" : "disabled");
                return (
                  <button
                    key={server.id}
                    className="tool-list-row tool-card tool-card-button"
                    onClick={() => openMcpModal(server.id)}
                    type="button"
                  >
                    <div className="tool-card-head">
                      <div>
                        <strong>{server.name}</strong>
                        <span>{formatMcpTransport(server)}</span>
                      </div>
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

function formatMcpTransport(server: McpServerConfig) {
  return server.transport === "remote" ? "远程" : "本地";
}

function getMcpStatusClass(status: McpConnectionStatus | "connecting") {
  if (status === "connected") return "enabled";
  if (status === "disabled") return "disabled";
  return "quiet";
}
