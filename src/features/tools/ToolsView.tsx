import { useEffect, useState } from "react";
import { LoaderCircle, Plus, RefreshCw, Settings2 } from "lucide-react";

import type {
  McpServerConfig,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugResult,
  WorkspaceTool,
} from "../../types";
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

  const builtinTools = tools.filter((tool) => tool.source === "builtin");
  const mcpTools = tools.filter((tool) => tool.source === "mcp");

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

  function formatParameterSummary(tool: WorkspaceTool, displayName = tool.name) {
    const count = tool.parameters?.length ?? 0;
    if (tool.source === "builtin") return null;

    const serverName = tool.serverName && tool.serverName !== displayName ? tool.serverName : "";
    if (count === 0) return serverName || null;
    return serverName ? `${serverName} · ${count} 个参数` : `${count} 个参数`;
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
            <div className="tool-grid">
              {builtinTools.map((tool) => (
                <article key={tool.id} className="tool-card">
                  <div className="tool-card-head">
                    <div>
                      <strong>{tool.name}</strong>
                    </div>
                    <span className="tool-chip">内置</span>
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
            <h3>MCP 工具</h3>
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

          {mcpTools.length > 0 ? (
            <div className="tool-grid">
              {mcpTools.map((tool) => {
                const displayName = tool.title || tool.name;
                const summary = formatParameterSummary(tool, displayName);

                return (
                  <button
                    key={tool.id}
                    className="tool-card tool-card-button"
                    onClick={() => openMcpModal(tool.serverId)}
                    type="button"
                  >
                    <div className="tool-card-head">
                      <div>
                        <strong>{displayName}</strong>
                        {summary ? <span>{summary}</span> : null}
                      </div>
                      <span className="tool-chip">MCP</span>
                    </div>
                    {tool.description ? <p>{tool.description}</p> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有 MCP 工具</strong>
              <p>
                {mcpServers.length > 0
                  ? "启用 MCP 服务后点击刷新工具，这里会显示实际可调用的 MCP 工具。"
                  : "添加一个 MCP 服务后，就能在这里统一查看和调试工具。"}
              </p>
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
