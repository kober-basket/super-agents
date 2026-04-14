import { useEffect, useState } from "react";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";

import type {
  McpServerConfig,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugResult,
  WorkspaceTool,
} from "../../types";
import { formatMcpStatusLabel, sanitizeMcpName } from "../shared/utils";
import { McpSettings } from "../settings/McpSettings";

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

  const runtimeTools = tools.filter((tool) => tool.source === "runtime");

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
            <h3>运行时工具</h3>
          </div>

          {runtimeTools.length > 0 ? (
            <div className="tool-grid">
              {runtimeTools.map((tool) => (
                <article key={tool.id} className="tool-card">
                  <div className="tool-card-head">
                    <div>
                      <strong>{tool.name}</strong>
                      <span>运行时工具</span>
                    </div>
                    <span className="tool-chip">{tool.observed ? "观察到" : "内置"}</span>
                  </div>
                  <p>{tool.description || "运行时工具"}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有运行时工具</strong>
            </div>
          )}
        </section>

        <section className="skills-section">
          <div className="skills-section-head with-action">
            <h3>MCP 工具</h3>
            <button className="primary-button" onClick={createMcpServer} type="button">
              <Plus size={14} />
              添加 MCP
            </button>
          </div>

          {mcpServers.length > 0 ? (
            <div className="tool-grid">
              {mcpServers.map((server) => {
                const normalized = sanitizeMcpName(server.name);
                const status = mcpStatusMap[normalized]?.status ?? (server.enabled ? "connecting" : "disabled");

                return (
                  <button
                    key={server.id}
                    className="tool-card tool-card-button"
                    onClick={() => openMcpModal(server.id)}
                    type="button"
                  >
                    <div className="tool-card-head">
                      <div>
                        <strong>{server.name}</strong>
                        <span>MCP 服务</span>
                      </div>
                      <span className="tool-chip">{server.enabled ? "已启用" : "未启用"}</span>
                    </div>
                    <p>{formatMcpStatusLabel(status)}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有 MCP</strong>
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
