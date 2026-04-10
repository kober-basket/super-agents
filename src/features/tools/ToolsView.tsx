import { useEffect, useMemo, useState } from "react";
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
  const mcpTools = tools.filter((tool) => tool.source === "mcp");

  const mcpToolsByServer = useMemo(() => {
    const map = new Map<string, WorkspaceTool[]>();
    for (const tool of mcpTools) {
      const key = tool.serverId || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(tool);
    }
    return map;
  }, [mcpTools]);

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
            <h2>Tools</h2>
          </div>

          <div className="skills-toolbar-actions">
            <button className="secondary-button" onClick={() => void onRefresh()} disabled={toolsRefreshing} type="button">
              {toolsRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              Refresh Tools
            </button>
          </div>
        </header>

        <section className="skills-section">
          <div className="skills-section-head">
            <h3>Runtime Tools</h3>
          </div>

          {runtimeTools.length > 0 ? (
            <div className="tool-grid">
              {runtimeTools.map((tool) => (
                <article key={tool.id} className="tool-card">
                  <div className="tool-card-head">
                    <div>
                      <strong>{tool.name}</strong>
                      <span>{tool.origin}</span>
                    </div>
                    <span className="tool-chip">{tool.observed ? "Observed" : "Built-in"}</span>
                  </div>
                  <p>{tool.description || "Runtime tool"}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>No runtime tools yet</strong>
            </div>
          )}
        </section>

        <section className="skills-section">
          <div className="skills-section-head with-action">
            <h3>MCP Tools</h3>
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
                const serverTools = mcpToolsByServer.get(server.id) ?? [];

                return (
                  <button
                    key={server.id}
                    className="tool-card tool-card-button mcp-server-overview-card"
                    onClick={() => openMcpModal(server.id)}
                    type="button"
                  >
                    <div className="tool-card-head">
                      <div>
                        <strong>{server.name}</strong>
                        <span>{server.transport === "remote" ? "Remote MCP" : "Local MCP"}</span>
                      </div>
                      <span className="tool-chip">{server.enabled ? "Enabled" : "Disabled"}</span>
                    </div>

                    <p>{formatMcpStatusLabel(status)}</p>

                    <div className="mcp-card-meta-row">
                      <span>{serverTools.length} tools</span>
                      <span>{server.transport === "remote" ? "Remote" : "Local"}</span>
                    </div>

                    {serverTools.length > 0 ? (
                      <div className="mcp-card-tool-preview">
                        {serverTools.slice(0, 3).map((tool) => (
                          <span key={tool.id} className="mcp-card-tool-chip">
                            {tool.title || tool.name}
                          </span>
                        ))}
                        {serverTools.length > 3 ? <span className="mcp-card-tool-chip muted">+{serverTools.length - 3}</span> : null}
                      </div>
                    ) : (
                      <div className="mcp-empty-inline">还没有抓取到工具，点击后可配置并获取工具列表。</div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有 MCP</strong>
              <p>添加一个 MCP 后，这里会像其他工具一样显示它的卡片入口。</p>
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
