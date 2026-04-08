import { LoaderCircle, RefreshCw } from "lucide-react";

import type { WorkspaceTool } from "../../types";

interface ToolsViewProps {
  tools: WorkspaceTool[];
  toolsRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
}

export function ToolsView({ tools, toolsRefreshing, onRefresh }: ToolsViewProps) {
  const runtimeTools = tools.filter((tool) => tool.source === "runtime");
  const mcpTools = tools.filter((tool) => tool.source === "mcp");

  return (
    <section className="skills-page">
      <div className="skills-inner">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>工具</h2>
            <p>这里单独展示工作台当前可用的运行时工具和各个 MCP 工具，不再和技能混在一起。</p>
          </div>

          <div className="skills-toolbar-actions">
            <button className="secondary-button" onClick={() => void onRefresh()} disabled={toolsRefreshing}>
              {toolsRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              刷新工具
            </button>
          </div>
        </header>

        <div className="skills-section">
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
                      <span>{tool.origin}</span>
                    </div>
                    <span className="tool-chip">{tool.observed ? "已观测" : "内置"}</span>
                  </div>
                  <p>{tool.description || "运行时工具"}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>暂时还没有运行时工具</strong>
              <p>等工作台跑过任务后，这里会展示已观测到的工具。</p>
            </div>
          )}
        </div>

        <div className="skills-section">
          <div className="skills-section-head">
            <h3>MCP 工具</h3>
          </div>

          {mcpTools.length > 0 ? (
            <div className="tool-grid">
              {mcpTools.map((tool) => (
                <article key={tool.id} className="tool-card">
                  <div className="tool-card-head">
                    <div>
                      <strong>{tool.title || tool.name}</strong>
                      <span>{tool.serverName || tool.origin}</span>
                    </div>
                    <span className="tool-chip">{tool.name}</span>
                  </div>
                  <p>{tool.description || "MCP 工具"}</p>
                  {tool.parameters && tool.parameters.length > 0 ? (
                    <div className="tool-parameter-list">
                      {tool.parameters.map((parameter) => (
                        <div key={`${tool.id}:${parameter.name}`} className="tool-parameter-item">
                          <strong>{parameter.name}</strong>
                          <span>
                            {parameter.type}
                            {parameter.required ? " · 必填" : " · 选填"}
                          </span>
                          {parameter.description ? <p>{parameter.description}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mcp-empty-inline">这个工具没有声明参数。</div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel compact">
              <strong>还没有可见的 MCP 工具</strong>
              <p>启用并连通 MCP 后，工具名、描述和参数会直接展示在这里。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
