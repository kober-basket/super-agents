import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, LoaderCircle, Play, RefreshCw, Wrench, X } from "lucide-react";

import type {
  McpServerConfig,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugResult,
  McpToolInfo,
} from "../../types";
import { formatMcpStatusLabel, sanitizeMcpName } from "../shared/utils";

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
  initialServerId?: string | null;
  open: boolean;
  onClose: () => void;
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
  initialServerId,
  open,
  onClose,
  onDebugTool,
  onInspectServer,
  onRefresh,
  onRemoveMcpServer,
  onToggleAdvanced,
  onUpdateMcp,
}: McpSettingsProps) {
  const [activeServerId, setActiveServerId] = useState<string | null>(initialServerId ?? mcpServers[0]?.id ?? null);
  const [toolStates, setToolStates] = useState<Record<string, ToolState>>({});
  const [debugDrafts, setDebugDrafts] = useState<Record<string, string>>({});
  const [debugStates, setDebugStates] = useState<Record<string, DebugState>>({});
  const [debugOpenMap, setDebugOpenMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeServerIds = new Set(mcpServers.map((server) => server.id));
    const isActiveKey = (key: string) => activeServerIds.has(key.split("::", 1)[0] || "");

    setToolStates((previous) => Object.fromEntries(Object.entries(previous).filter(([serverId]) => activeServerIds.has(serverId))));
    setDebugDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => isActiveKey(key))));
    setDebugStates((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => isActiveKey(key))));
    setDebugOpenMap((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => isActiveKey(key))));

    if (mcpServers.length === 0) {
      setActiveServerId(null);
      return;
    }

    if (!activeServerId || !activeServerIds.has(activeServerId)) {
      setActiveServerId(initialServerId && activeServerIds.has(initialServerId) ? initialServerId : mcpServers[0]?.id ?? null);
    }
  }, [activeServerId, initialServerId, mcpServers]);

  useEffect(() => {
    if (!open || !initialServerId) return;
    setActiveServerId(initialServerId);
  }, [initialServerId, open]);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const activeServer = useMemo(
    () => mcpServers.find((server) => server.id === activeServerId) ?? null,
    [activeServerId, mcpServers],
  );

  if (!open) return null;

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
    } catch (inspectError) {
      setToolStates((previous) => ({
        ...previous,
        [server.id]: {
          ...previous[server.id],
          loading: false,
          error: inspectError instanceof Error ? inspectError.message : "获取工具列表失败",
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
    } catch (debugError) {
      setDebugStates((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          loading: false,
          error: debugError instanceof Error ? debugError.message : "调试失败",
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

  function handleRemove(serverId: string) {
    onRemoveMcpServer(serverId);
    onClose();
  }

  if (!activeServer) {
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="mcp-workbench-modal" onClick={(event) => event.stopPropagation()}>
          <div className="skill-detail-head">
            <div className="skill-detail-title-wrap compact">
              <div className="skill-icon-shell large skill-accent-mint">
                <Wrench size={28} />
              </div>
              <div className="skill-detail-title-copy">
                <div className="skill-detail-title-row">
                  <h3>MCP 工作台</h3>
                </div>
                <p>当前没有可配置的 MCP。</p>
              </div>
            </div>

            <button className="ghost-icon" onClick={onClose} title="关闭" type="button">
              <X size={16} />
            </button>
          </div>

          <div className="empty-panel spacious">
            <strong>没有找到 MCP 配置</strong>
            <p>回到工具页后先添加一个 MCP，再进入这个工作台配置和调试。</p>
          </div>
        </div>
      </div>
    );
  }

  const normalized = sanitizeMcpName(activeServer.name);
  const status = mcpStatusMap[normalized]?.status ?? (activeServer.enabled ? "connecting" : "disabled");
  const error = mcpStatusMap[normalized]?.error;
  const toolState = toolStates[activeServer.id];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="mcp-workbench-modal" onClick={(event) => event.stopPropagation()}>
        <div className="skill-detail-head">
          <div className="skill-detail-title-wrap compact">
            <div className="skill-icon-shell large skill-accent-mint">
              <Wrench size={28} />
            </div>
            <div className="skill-detail-title-copy">
              <div className="skill-detail-title-row">
                <h3>{activeServer.name}</h3>
                <span className={clsx("skill-status-chip", activeServer.enabled ? "enabled" : "disabled")}>
                  {activeServer.enabled ? "启用" : "停用"}
                </span>
              </div>
              <p>只配置当前 MCP，并在这里获取工具列表和调试调用。</p>
            </div>
          </div>

          <button className="ghost-icon" onClick={onClose} title="关闭" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="mcp-workbench-toolbar">
          <button
            className={clsx("toggle-button", activeServer.enabled && "active")}
            onClick={() => onUpdateMcp(activeServer.id, { enabled: !activeServer.enabled })}
            type="button"
          >
            {activeServer.enabled ? "已启用" : "未启用"}
          </button>

          <button className="secondary-button" onClick={() => void onRefresh()} disabled={mcpRefreshing} type="button">
            {mcpRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            刷新状态
          </button>

          <button className="ghost-text-button" onClick={onToggleAdvanced} type="button">
            {mcpAdvancedOpen ? "收起详细配置" : "显示详细配置"}
          </button>

          <button className="ghost-text-button danger" onClick={() => handleRemove(activeServer.id)} type="button">
            <X size={14} />
            删除
          </button>
        </div>

        <div className="mcp-workbench-body">
          <section className="panel-card form-card settings-surface">
            <div className="mcp-single-header">
              <div className="mcp-single-meta">
                <strong>连接配置</strong>
                <span>
                  状态：{formatMcpStatusLabel(status)}
                  {error ? ` / ${error}` : ""}
                </span>
              </div>
            </div>

            <div className="mcp-form-grid">
              <label>
                <span>名称</span>
                <input
                  value={activeServer.name}
                  onChange={(event) => onUpdateMcp(activeServer.id, { name: event.target.value })}
                />
              </label>

              <label>
                <span>连接方式</span>
                <div className="select-shell field-select full-width">
                  <select
                    value={activeServer.transport}
                    onChange={(event) =>
                      onUpdateMcp(activeServer.id, {
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
            </div>

            {activeServer.transport === "remote" ? (
              <>
                <label>
                  <span>MCP 地址</span>
                  <input
                    value={activeServer.url}
                    onChange={(event) => onUpdateMcp(activeServer.id, { url: event.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </label>

                {mcpAdvancedOpen ? (
                  <label>
                    <span>请求头(JSON)</span>
                    <textarea
                      value={activeServer.headersJson}
                      onChange={(event) => onUpdateMcp(activeServer.id, { headersJson: event.target.value })}
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
                    value={activeServer.command}
                    onChange={(event) => onUpdateMcp(activeServer.id, { command: event.target.value })}
                    placeholder="npx"
                  />
                </label>

                <div className="mcp-args-block">
                  <div className="split-row">
                    <div>
                      <span className="mcp-block-title">参数列表</span>
                      <p className="field-note">每一项都会作为独立参数传给本地 MCP 进程。</p>
                    </div>
                    <button className="ghost-text-button" onClick={() => addArgument(activeServer)} type="button">
                      添加参数
                    </button>
                  </div>

                  {activeServer.args.length > 0 ? (
                    <div className="mcp-arg-list">
                      {activeServer.args.map((arg, index) => (
                        <div key={`${activeServer.id}-arg-${index}`} className="mcp-arg-row">
                          <input
                            value={arg}
                            onChange={(event) => updateArgument(activeServer, index, event.target.value)}
                            placeholder={`参数 ${index + 1}`}
                          />
                          <button
                            className="ghost-text-button danger"
                            onClick={() => removeArgument(activeServer, index)}
                            type="button"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mcp-empty-inline">当前没有参数。</div>
                  )}
                </div>

                {mcpAdvancedOpen ? (
                  <label>
                    <span>环境变量(JSON)</span>
                    <textarea
                      value={activeServer.envJson}
                      onChange={(event) => onUpdateMcp(activeServer.id, { envJson: event.target.value })}
                      rows={3}
                    />
                  </label>
                ) : null}
              </>
            )}

            {mcpAdvancedOpen ? (
              <label>
                <span>超时(毫秒)</span>
                <input
                  value={String(activeServer.timeoutMs)}
                  onChange={(event) =>
                    onUpdateMcp(activeServer.id, {
                      timeoutMs: Number(event.target.value) || 30000,
                    })
                  }
                  placeholder="30000"
                />
              </label>
            ) : null}
          </section>

          <section className="panel-card form-card settings-surface">
            <div className="mcp-single-header">
              <div className="mcp-single-meta">
                <strong>工具获取与调试</strong>
                <span>先抓取工具列表，再按需展开某个工具调试。</span>
              </div>

              <button
                className="secondary-button"
                onClick={() => void inspectServer(activeServer)}
                disabled={!activeServer.enabled || toolState?.loading}
                type="button"
              >
                {toolState?.loading ? <LoaderCircle size={14} className="spin" /> : <Wrench size={14} />}
                {toolState?.payload ? "重新获取工具" : "获取工具列表"}
              </button>
            </div>

            {!activeServer.enabled ? (
              <div className="mcp-empty-inline">请先启用这个 MCP，再获取工具列表。</div>
            ) : null}

            {toolState?.error ? <pre className="mcp-debug-output error">{toolState.error}</pre> : null}

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
                  <div className="mcp-empty-inline">服务已连接，但没有返回任何工具。</div>
                ) : (
                  <div className="mcp-tool-list">
                    {toolState.payload.tools.map((tool) => {
                      const key = toolKey(activeServer.id, tool.name);
                      const debugState = debugStates[key];
                      const draft = debugDrafts[key] ?? buildArgumentsDraft(tool);
                      const isDebugOpen = Boolean(debugOpenMap[key]);

                      return (
                        <article key={key} className="mcp-tool-card">
                          <div className="mcp-tool-head">
                            <div>
                              <strong>{tool.title || tool.name}</strong>
                              {tool.title && tool.title !== tool.name ? <p className="field-note">{tool.name}</p> : null}
                            </div>

                            <div className="mcp-card-actions">
                              {tool.taskSupport ? <span className="mcp-task-pill">{tool.taskSupport}</span> : null}
                              <button
                                className="ghost-text-button"
                                onClick={() =>
                                  setDebugOpenMap((previous) => ({
                                    ...previous,
                                    [key]: !previous[key],
                                  }))
                                }
                                type="button"
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
                                  {parameter.description ? <p>{parameter.description}</p> : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mcp-empty-inline">这个工具没有参数。</div>
                          )}

                          {isDebugOpen ? (
                            <div className="mcp-debug-panel">
                              <label>
                                <span>调试参数(JSON)</span>
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
                                  onClick={() => void runDebug(activeServer, tool)}
                                  disabled={debugState?.loading}
                                  type="button"
                                >
                                  {debugState?.loading ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                                  运行调试
                                </button>
                              </div>

                              {debugState?.error ? <pre className="mcp-debug-output error">{debugState.error}</pre> : null}

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
            ) : (
              <div className="mcp-empty-inline">还没有获取工具列表。</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
