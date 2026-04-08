import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown, LoaderCircle, Play, Plus, RefreshCw, Wrench, X } from "lucide-react";

import type {
  McpServerConfig,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugResult,
  McpToolInfo,
} from "../../types";
import { formatMcpStatusLabel, sanitizeMcpName } from "../shared/utils";
import {
  RECOMMENDED_MCP_SERVERS,
  type RecommendedMcpServer,
} from "./constants";

type ToolState = {
  loading?: boolean;
  error?: string;
  payload?: McpServerToolsResult;
};

type DebugState = {
  loading?: boolean;
  error?: string;
  result?: McpToolDebugResult;
};

interface McpSettingsProps {
  mcpAdvancedOpen: boolean;
  mcpRefreshing: boolean;
  mcpServers: McpServerConfig[];
  mcpStatusMap: Record<string, McpServerStatus>;
  onAddMcpServer: () => void;
  onAddRecommendedMcpServer: (server: RecommendedMcpServer) => void;
  onDebugTool: (server: McpServerConfig, toolName: string, argumentsJson: string) => Promise<McpToolDebugResult>;
  onInspectServer: (server: McpServerConfig) => Promise<McpServerToolsResult>;
  onRefresh: () => void | Promise<void>;
  onRemoveMcpServer: (serverId: string) => void;
  onToggleAdvanced: () => void;
  onUpdateMcp: (serverId: string, patch: Partial<McpServerConfig>) => void;
}

function toolKey(serverId: string, toolName: string) {
  return `${serverId}::${toolName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildDraftValue(schema: unknown): unknown {
  if (!isRecord(schema)) return "";
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const type = schema.type;
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return buildDraftValue(schema.anyOf[0]);
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return buildDraftValue(schema.oneOf[0]);
  }

  return "";
}

function buildArgumentsDraft(tool: McpToolInfo) {
  const properties = isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
  const draft = Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => [name, buildDraftValue(schema)]),
  );

  return JSON.stringify(draft, null, 2);
}

function formatTransportLabel(transport: McpServerToolsResult["transport"]) {
  if (transport === "stdio") return "本地";
  if (transport === "sse") return "SSE";
  return "Streamable HTTP";
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function McpSettings({
  mcpAdvancedOpen,
  mcpRefreshing,
  mcpServers,
  mcpStatusMap,
  onAddMcpServer,
  onAddRecommendedMcpServer,
  onDebugTool,
  onInspectServer,
  onRefresh,
  onRemoveMcpServer,
  onToggleAdvanced,
  onUpdateMcp,
}: McpSettingsProps) {
  const [toolStates, setToolStates] = useState<Record<string, ToolState>>({});
  const [debugDrafts, setDebugDrafts] = useState<Record<string, string>>({});
  const [debugStates, setDebugStates] = useState<Record<string, DebugState>>({});
  const [debugOpenMap, setDebugOpenMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeServerIds = new Set(mcpServers.map((server) => server.id));
    const isActiveKey = (key: string) => activeServerIds.has(key.split("::", 1)[0] || "");

    setToolStates((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([serverId]) => activeServerIds.has(serverId)),
      ),
    );
    setDebugDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => isActiveKey(key)),
      ),
    );
    setDebugStates((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => isActiveKey(key)),
      ),
    );
    setDebugOpenMap((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => isActiveKey(key)),
      ),
    );
  }, [mcpServers]);

  async function inspectServer(server: McpServerConfig) {
    setToolStates((previous) => ({
      ...previous,
      [server.id]: {
        ...previous[server.id],
        loading: true,
        error: undefined,
      },
    }));

    try {
      const payload = await onInspectServer(server);
      setToolStates((previous) => ({
        ...previous,
        [server.id]: {
          loading: false,
          payload,
        },
      }));
      setDebugDrafts((previous) => {
        const next = { ...previous };
        for (const tool of payload.tools) {
          const key = toolKey(server.id, tool.name);
          if (!next[key]) {
            next[key] = buildArgumentsDraft(tool);
          }
        }
        return next;
      });
    } catch (error) {
      setToolStates((previous) => ({
        ...previous,
        [server.id]: {
          ...previous[server.id],
          loading: false,
          error: error instanceof Error ? error.message : "获取工具列表失败",
        },
      }));
    }
  }

  async function runDebug(server: McpServerConfig, tool: McpToolInfo) {
    const key = toolKey(server.id, tool.name);
    const argumentsJson = debugDrafts[key] ?? buildArgumentsDraft(tool);

    setDebugStates((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        loading: true,
        error: undefined,
      },
    }));

    try {
      const result = await onDebugTool(server, tool.name, argumentsJson);
      setDebugStates((previous) => ({
        ...previous,
        [key]: {
          loading: false,
          result,
        },
      }));
      setDebugOpenMap((previous) => ({
        ...previous,
        [key]: true,
      }));
    } catch (error) {
      setDebugStates((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          loading: false,
          error: error instanceof Error ? error.message : "调试失败",
        },
      }));
    }
  }

  function updateArgument(server: McpServerConfig, index: number, value: string) {
    onUpdateMcp(server.id, {
      args: server.args.map((item, currentIndex) => (currentIndex === index ? value : item)),
    });
  }

  function addArgument(server: McpServerConfig) {
    onUpdateMcp(server.id, {
      args: [...server.args, ""],
    });
  }

  function removeArgument(server: McpServerConfig, index: number) {
    onUpdateMcp(server.id, {
      args: server.args.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>MCP 工具</h1>
          <p>
            这里可以配置本地 / 远程 MCP，并在启用后主动拉取工具定义做调试。
            <button className="link-button" onClick={onToggleAdvanced}>
              {mcpAdvancedOpen ? "收起详细配置" : "显示详细配置"}
            </button>
          </p>
        </div>

        <button className="secondary-button" onClick={() => void onRefresh()} disabled={mcpRefreshing}>
          {mcpRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          刷新
        </button>
      </header>

      <div className="settings-block">
        <div className="settings-block-head">
          <h3>自定义服务</h3>
        </div>

        <div className="settings-hero-panel">
          <button className="settings-hero-action" onClick={onAddMcpServer}>
            <div className="settings-hero-copy">
              <strong>
                {mcpServers.length > 0
                  ? `已配置 ${mcpServers.length} 个 MCP 服务`
                  : "还没有 MCP 服务"}
              </strong>
              <span>
                {mcpServers.length > 0
                  ? "支持查看工具名、描述、参数结构，并直接做一次调试调用。"
                  : "先新增一个 MCP 服务，再填写最少的连接信息。"}
              </span>
            </div>
            <div className="settings-hero-meta">
              <Plus size={18} />
              <span>添加服务</span>
            </div>
          </button>
        </div>

        {mcpServers.length > 0 ? (
          <div className="settings-stage-grid two">
            {mcpServers.map((server) => {
              const normalized = sanitizeMcpName(server.name);
              const status = mcpStatusMap[normalized]?.status ?? (server.enabled ? "connecting" : "disabled");
              const error = mcpStatusMap[normalized]?.error;
              const toolState = toolStates[server.id];

              return (
                <article
                  key={server.id}
                  className={clsx(
                    "panel-card form-card settings-surface mcp-server-card",
                    toolState?.payload && "span-two",
                  )}
                >
                  <div className="split-row">
                    <div>
                      <h3>{server.name}</h3>
                      <p className="field-note">
                        状态：{formatMcpStatusLabel(status)}
                        {error ? ` / ${error}` : ""}
                      </p>
                    </div>
                    <div className="mcp-card-actions">
                      <button
                        className={clsx("toggle-button", server.enabled && "active")}
                        onClick={() => onUpdateMcp(server.id, { enabled: !server.enabled })}
                      >
                        {server.enabled ? "已启用" : "未启用"}
                      </button>
                      <button className="ghost-text-button danger" onClick={() => onRemoveMcpServer(server.id)}>
                        <X size={14} />
                        删除
                      </button>
                    </div>
                  </div>

                  <label>
                    <span>名称</span>
                    <input value={server.name} onChange={(event) => onUpdateMcp(server.id, { name: event.target.value })} />
                  </label>

                  <label>
                    <span>连接方式</span>
                    <div className="select-shell field-select full-width">
                      <select
                        value={server.transport}
                        onChange={(event) =>
                          onUpdateMcp(server.id, {
                            transport: event.target.value as McpServerConfig["transport"],
                          })
                        }
                      >
                        <option value="local">本地</option>
                        <option value="remote">远程</option>
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </label>

                  {server.transport === "remote" ? (
                    <>
                      <label>
                        <span>MCP 地址</span>
                        <input
                          value={server.url}
                          onChange={(event) => onUpdateMcp(server.id, { url: event.target.value })}
                          placeholder="https://example.com/mcp"
                        />
                      </label>
                      {mcpAdvancedOpen ? (
                        <label>
                          <span>请求头（JSON）</span>
                          <textarea
                            value={server.headersJson}
                            onChange={(event) =>
                              onUpdateMcp(server.id, { headersJson: event.target.value })
                            }
                            rows={3}
                          />
                        </label>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label>
                        <span>启动命令</span>
                        <input
                          value={server.command}
                          onChange={(event) => onUpdateMcp(server.id, { command: event.target.value })}
                          placeholder="command"
                        />
                      </label>

                      <div className="mcp-args-block">
                        <div className="split-row">
                          <div>
                            <span className="mcp-block-title">参数项</span>
                            <p className="field-note">每一项会作为一个独立参数传给本地 MCP 进程。</p>
                          </div>
                          <button className="ghost-text-button" onClick={() => addArgument(server)}>
                            <Plus size={14} />
                            添加参数
                          </button>
                        </div>

                        {server.args.length > 0 ? (
                          <div className="mcp-arg-list">
                            {server.args.map((arg, index) => (
                              <div key={`${server.id}-arg-${index}`} className="mcp-arg-row">
                                <input
                                  value={arg}
                                  onChange={(event) => updateArgument(server, index, event.target.value)}
                                  placeholder={`参数 ${index + 1}`}
                                />
                                <button
                                  className="ghost-text-button danger"
                                  onClick={() => removeArgument(server, index)}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mcp-empty-inline">当前没有参数项</div>
                        )}
                      </div>

                      {mcpAdvancedOpen ? (
                        <label>
                          <span>环境变量（JSON）</span>
                          <textarea
                            value={server.envJson}
                            onChange={(event) =>
                              onUpdateMcp(server.id, { envJson: event.target.value })
                            }
                            rows={3}
                          />
                        </label>
                      ) : null}
                    </>
                  )}

                  {mcpAdvancedOpen ? (
                    <label>
                      <span>超时（毫秒）</span>
                      <input
                        value={String(server.timeoutMs)}
                        onChange={(event) =>
                          onUpdateMcp(server.id, {
                            timeoutMs: Number(event.target.value) || 30000,
                          })
                        }
                        placeholder="timeoutMs"
                      />
                    </label>
                  ) : null}

                  <div className="mcp-inspector-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void inspectServer(server)}
                      disabled={!server.enabled || toolState?.loading}
                    >
                      {toolState?.loading ? <LoaderCircle size={14} className="spin" /> : <Wrench size={14} />}
                      {toolState?.payload ? "重新获取工具" : "获取工具列表"}
                    </button>
                    <p className="field-note">
                      {server.enabled ? "启用后可主动拉取工具名、描述和参数结构。" : "请先启用服务，再获取工具列表。"}
                    </p>
                  </div>

                  {toolState?.error ? <p className="mcp-inline-error">{toolState.error}</p> : null}

                  {toolState?.payload ? (
                    <div className="mcp-tool-panel">
                      <div className="mcp-tool-panel-head">
                        <div className="mcp-tool-meta">
                          <span>{formatTransportLabel(toolState.payload.transport)}</span>
                          <span>{toolState.payload.tools.length} 个工具</span>
                          <span>最近同步 {formatTime(toolState.payload.fetchedAt)}</span>
                        </div>
                      </div>

                      {toolState.payload.tools.length === 0 ? (
                        <div className="mcp-empty-inline">服务已连接，但没有返回工具。</div>
                      ) : (
                        <div className="mcp-tool-list">
                          {toolState.payload.tools.map((tool) => {
                            const key = toolKey(server.id, tool.name);
                            const debugState = debugStates[key];
                            const draft = debugDrafts[key] ?? buildArgumentsDraft(tool);
                            const isDebugOpen = Boolean(debugOpenMap[key]);

                            return (
                              <article key={key} className="mcp-tool-card">
                                <div className="mcp-tool-head">
                                  <div>
                                    <strong>{tool.title || tool.name}</strong>
                                    {tool.title && tool.title !== tool.name ? (
                                      <p className="field-note">{tool.name}</p>
                                    ) : null}
                                  </div>
                                  <div className="mcp-card-actions">
                                    {tool.taskSupport ? (
                                      <span className="mcp-task-pill">{tool.taskSupport}</span>
                                    ) : null}
                                    <button
                                      className="ghost-text-button"
                                      onClick={() =>
                                        setDebugOpenMap((previous) => ({
                                          ...previous,
                                          [key]: !previous[key],
                                        }))
                                      }
                                    >
                                      <Play size={14} />
                                      {isDebugOpen ? "收起调试" : "调试"}
                                    </button>
                                  </div>
                                </div>

                                <p className="field-note">{tool.description || "暂无工具描述。"}</p>

                                {tool.parameters.length > 0 ? (
                                  <div className="mcp-parameter-list">
                                    {tool.parameters.map((parameter) => (
                                      <div key={`${key}-${parameter.name}`} className="mcp-parameter-item">
                                        <div className="mcp-parameter-top">
                                          <strong>{parameter.name}</strong>
                                          <span>{parameter.type}</span>
                                          {parameter.required ? <em>必填</em> : <em>可选</em>}
                                        </div>
                                        {parameter.description ? (
                                          <p>{parameter.description}</p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="mcp-empty-inline">这个工具没有参数。</div>
                                )}

                                {isDebugOpen ? (
                                  <div className="mcp-debug-panel">
                                    <label>
                                      <span>调试参数（JSON）</span>
                                      <textarea
                                        value={draft}
                                        onChange={(event) =>
                                          setDebugDrafts((previous) => ({
                                            ...previous,
                                            [key]: event.target.value,
                                          }))
                                        }
                                        rows={Math.min(12, Math.max(5, draft.split("\n").length + 1))}
                                      />
                                    </label>

                                    <div className="mcp-card-actions">
                                      <button
                                        className="secondary-button"
                                        onClick={() => void runDebug(server, tool)}
                                        disabled={debugState?.loading}
                                      >
                                        {debugState?.loading ? (
                                          <LoaderCircle size={14} className="spin" />
                                        ) : (
                                          <Play size={14} />
                                        )}
                                        运行调试
                                      </button>
                                    </div>

                                    {debugState?.error ? (
                                      <pre className="mcp-debug-output error">{debugState.error}</pre>
                                    ) : null}

                                    {debugState?.result ? (
                                      <div className="mcp-debug-result">
                                        <div className="mcp-tool-meta">
                                          <span>{formatTransportLabel(debugState.result.transport)}</span>
                                          <span>{debugState.result.isError ? "返回错误" : "调用完成"}</span>
                                          <span>{formatTime(debugState.result.invokedAt)}</span>
                                        </div>

                                        {debugState.result.content ? (
                                          <pre className="mcp-debug-output">{debugState.result.content}</pre>
                                        ) : (
                                          <div className="mcp-empty-inline">本次调用没有文本输出。</div>
                                        )}

                                        {debugState.result.taskLog ? (
                                          <details>
                                            <summary>任务执行日志</summary>
                                            <pre className="mcp-debug-output">{debugState.result.taskLog}</pre>
                                          </details>
                                        ) : null}

                                        {debugState.result.structuredContentJson ? (
                                          <details>
                                            <summary>结构化结果</summary>
                                            <pre className="mcp-debug-output">{debugState.result.structuredContentJson}</pre>
                                          </details>
                                        ) : null}

                                        {debugState.result.stderr ? (
                                          <details>
                                            <summary>服务 stderr</summary>
                                            <pre className="mcp-debug-output">{debugState.result.stderr}</pre>
                                          </details>
                                        ) : null}

                                        <details>
                                          <summary>原始返回 JSON</summary>
                                          <pre className="mcp-debug-output">{debugState.result.rawJson}</pre>
                                        </details>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      )}

                      {toolState.payload.stderr ? (
                        <details>
                          <summary>服务 stderr</summary>
                          <pre className="mcp-debug-output">{toolState.payload.stderr}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="settings-block">
        <div className="settings-block-head with-action">
          <h3>推荐连接</h3>
          <button className="ghost-text-button" onClick={() => void onRefresh()}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>

        <div className="server-list-panel">
          {RECOMMENDED_MCP_SERVERS.map((server) => {
            const exists = mcpServers.some(
              (item) => sanitizeMcpName(item.name) === sanitizeMcpName(server.name),
            );

            return (
              <article key={server.id} className="server-row">
                <div className={clsx("server-mark", `tone-${server.tone}`)}>{server.badge}</div>
                <div className="server-copy">
                  <strong>
                    {server.name}
                    <span> 维护方：{server.operator}</span>
                  </strong>
                  <p>{server.description}</p>
                </div>
                <button
                  className={clsx("server-row-action", exists && "installed")}
                  onClick={() => onAddRecommendedMcpServer(server)}
                >
                  {exists ? "已添加" : "安装"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
