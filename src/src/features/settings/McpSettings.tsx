import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, LoaderCircle, Play, RefreshCw, Wrench, X } from "lucide-react";

import type {
  McpServerConfig,
  McpServerStatus,
  McpServerToolsResult,
  McpToolDebugResult,
  McpToolInfo,
  McpToolParameter,
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

type ToolFormState = Record<string, string>;

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

function buildFieldDefaults(tool: McpToolInfo): ToolFormState {
  return Object.fromEntries(
    tool.parameters.map((parameter) => {
      const schema = parameter.schema;
      if ("default" in schema && schema.default !== undefined && schema.default !== null) {
        return [parameter.name, String(schema.default)];
      }
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return [parameter.name, String(schema.enum[0])];
      }
      if (parameter.type === "boolean") return [parameter.name, "false"];
      return [parameter.name, ""];
    }),
  );
}

function buildArgumentsJson(tool: McpToolInfo, values: ToolFormState) {
  const result: Record<string, unknown> = {};

  for (const parameter of tool.parameters) {
    const raw = (values[parameter.name] ?? "").trim();
    if (!raw) continue;

    const schema = parameter.schema;
    const type = typeof schema.type === "string" ? schema.type : parameter.type;

    if (type === "boolean") {
      result[parameter.name] = raw === "true";
      continue;
    }

    if (type === "number" || type === "integer") {
      const nextNumber = Number(raw);
      result[parameter.name] = Number.isNaN(nextNumber) ? raw : nextNumber;
      continue;
    }

    if (type === "array" || type === "object") {
      try {
        result[parameter.name] = JSON.parse(raw);
      } catch {
        result[parameter.name] = raw;
      }
      continue;
    }

    result[parameter.name] = raw;
  }

  return JSON.stringify(result, null, 2);
}

function getSchemaEnum(schema: Record<string, unknown>) {
  return Array.isArray(schema.enum) ? schema.enum.map((item) => String(item)) : [];
}

function getToolDisplayName(tool: McpToolInfo) {
  return tool.title || tool.name;
}

function getToolParameterSummary(tool: McpToolInfo) {
  const requiredCount = tool.parameters.filter((parameter) => parameter.required).length;
  if (tool.parameters.length === 0) return "无需填写";
  if (requiredCount === 0) return `${tool.parameters.length} 项可选`;
  return `${requiredCount} 项必填`;
}

function getFieldPlaceholder(parameter: McpToolParameter) {
  const type = typeof parameter.schema.type === "string" ? parameter.schema.type : parameter.type;
  if (type === "array") return "请输入数组内容";
  if (type === "object") return "请输入对象内容";
  if (type === "number" || type === "integer") return "请输入数字";
  return "请输入";
}

function formatTransportLabel(transport: McpServerToolsResult["transport"]) {
  if (transport === "stdio") return "本地";
  if (transport === "sse") return "SSE";
  return "HTTP";
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
  const [debugStates, setDebugStates] = useState<Record<string, DebugState>>({});
  const [activeToolKey, setActiveToolKey] = useState<string | null>(null);
  const [toolForms, setToolForms] = useState<Record<string, ToolFormState>>({});

  useEffect(() => {
    const activeServerIds = new Set(mcpServers.map((server) => server.id));
    const isActiveKey = (key: string) => activeServerIds.has(key.split("::", 1)[0] || "");

    setToolStates((previous) => Object.fromEntries(Object.entries(previous).filter(([serverId]) => activeServerIds.has(serverId))));
    setDebugStates((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => isActiveKey(key))));
    setToolForms((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => isActiveKey(key))));

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

  const toolState = activeServer ? toolStates[activeServer.id] : undefined;
  const tools = toolState?.payload?.tools ?? [];
  const activeTool = useMemo(() => {
    if (!activeServer || !toolState?.payload || !activeToolKey) return null;
    return toolState.payload.tools.find((tool) => toolKey(activeServer.id, tool.name) === activeToolKey) ?? null;
  }, [activeServer, activeToolKey, toolState]);

  useEffect(() => {
    if (!toolState?.payload || !activeServer) return;
    const payload = toolState.payload;
    const firstTool = payload.tools[0];
    if (!firstTool) {
      setActiveToolKey(null);
      return;
    }

    const firstKey = toolKey(activeServer.id, firstTool.name);
    const exists = payload.tools.some((tool) => toolKey(activeServer.id, tool.name) === activeToolKey);
    if (!activeToolKey || !exists) {
      setActiveToolKey(firstKey);
    }

    setToolForms((previous) => {
      const next = { ...previous };
      for (const tool of payload.tools) {
        const key = toolKey(activeServer.id, tool.name);
        if (!next[key]) {
          next[key] = buildFieldDefaults(tool);
        }
      }
      return next;
    });
  }, [activeServer, activeToolKey, toolState]);

  if (!open || !activeServer) return null;

  const normalized = sanitizeMcpName(activeServer.name);
  const status = mcpStatusMap[normalized]?.status ?? (activeServer.enabled ? "connecting" : "disabled");
  const error = mcpStatusMap[normalized]?.error;
  const activeDebugState = activeTool ? debugStates[toolKey(activeServer.id, activeTool.name)] : undefined;

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
    } catch (inspectError) {
      setToolStates((previous) => ({
        ...previous,
        [server.id]: {
          ...previous[server.id],
          loading: false,
          error: inspectError instanceof Error ? inspectError.message : "获取工具失败",
        },
      }));
    }
  }

  async function runDebug(server: McpServerConfig, tool: McpToolInfo) {
    const key = toolKey(server.id, tool.name);
    const values = toolForms[key] ?? buildFieldDefaults(tool);

    setDebugStates((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        loading: true,
        error: undefined,
      },
    }));

    try {
      const result = await onDebugTool(server, tool.name, buildArgumentsJson(tool, values));
      setDebugStates((previous) => ({
        ...previous,
        [key]: {
          loading: false,
          result,
        },
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

  function updateToolForm(key: string, name: string, value: string) {
    setToolForms((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] ?? {}),
        [name]: value,
      },
    }));
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="mcp-workbench-modal simple" onClick={(event) => event.stopPropagation()}>
        <div className="skill-detail-head">
          <div className="skill-detail-title-wrap compact">
            <div className="skill-icon-shell large skill-accent-mint">
              <Wrench size={28} />
            </div>
            <div className="skill-detail-title-copy">
              <div className="skill-detail-title-row">
                <h3>{activeServer.name}</h3>
                <span className={clsx("skill-status-chip", activeServer.enabled ? "enabled" : "disabled")}>
                  {formatMcpStatusLabel(status)}
                </span>
              </div>
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
            刷新
          </button>

          <button className="ghost-text-button" onClick={onToggleAdvanced} type="button">
            {mcpAdvancedOpen ? "隐藏高级项" : "显示高级项"}
          </button>

          <button className="ghost-text-button danger" onClick={() => onRemoveMcpServer(activeServer.id)} type="button">
            <X size={14} />
            删除
          </button>
        </div>

        <div className="mcp-workbench-body simple">
          <section className="panel-card form-card settings-surface mcp-config-stage">
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
                  <span>地址</span>
                  <input
                    value={activeServer.url}
                    onChange={(event) => onUpdateMcp(activeServer.id, { url: event.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </label>

                {mcpAdvancedOpen ? (
                  <label>
                    <span>请求头</span>
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
                    <span className="mcp-block-title">参数</span>
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
                    <div className="mcp-empty-inline">还没有参数。</div>
                  )}
                </div>

                {mcpAdvancedOpen ? (
                  <label>
                    <span>环境变量</span>
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
                <span>超时</span>
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

            {error ? <div className="mcp-inline-error">{error}</div> : null}
          </section>

          <section className="panel-card form-card settings-surface mcp-tool-stage">
            <div className="mcp-stage-topbar">
              <div className="mcp-stage-title">
                <strong>工具</strong>
                {toolState?.payload ? (
                  <div className="mcp-tool-meta">
                    <span>{formatTransportLabel(toolState.payload.transport)}</span>
                    <span>{toolState.payload.tools.length} 个工具</span>
                    <span>{formatTime(toolState.payload.fetchedAt)}</span>
                  </div>
                ) : null}
              </div>

              <button
                className="secondary-button"
                onClick={() => void inspectServer(activeServer)}
                disabled={!activeServer.enabled || toolState?.loading}
                type="button"
              >
                {toolState?.loading ? <LoaderCircle size={14} className="spin" /> : <Wrench size={14} />}
                获取工具
              </button>
            </div>

            {toolState?.error ? <pre className="mcp-debug-output error">{toolState.error}</pre> : null}

            {!activeServer.enabled ? (
              <div className="mcp-stage-empty">
                <strong>先启用这个 MCP</strong>
                <span>启用后就能获取工具并调试。</span>
              </div>
            ) : toolState?.loading ? (
              <div className="mcp-stage-empty loading">
                <LoaderCircle size={18} className="spin" />
                <strong>正在获取工具</strong>
              </div>
            ) : !toolState?.payload ? (
              <div className="mcp-stage-empty">
                <strong>先获取工具</strong>
                <span>点右上角“获取工具”，这里就会显示可用工具。</span>
              </div>
            ) : tools.length === 0 ? (
              <div className="mcp-stage-empty">
                <strong>还没有可用工具</strong>
                <span>可以刷新一下，或者检查当前配置。</span>
              </div>
            ) : (
              <div className="mcp-tool-workbench">
                <div className="mcp-tool-rail">
                  {tools.map((tool) => {
                    const key = toolKey(activeServer.id, tool.name);
                    return (
                      <button
                        key={key}
                        className={clsx("mcp-tool-row", activeToolKey === key && "active")}
                        onClick={() => setActiveToolKey(key)}
                        type="button"
                      >
                        <strong>{getToolDisplayName(tool)}</strong>
                        <span>{getToolParameterSummary(tool)}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mcp-tool-editor">
                  {activeTool ? (
                    <>
                      <div className="mcp-tool-editor-head">
                        <div className="mcp-tool-editor-title">
                          <strong>{getToolDisplayName(activeTool)}</strong>
                          <span>{getToolParameterSummary(activeTool)}</span>
                        </div>

                        <button
                          className="secondary-button"
                          onClick={() => void runDebug(activeServer, activeTool)}
                          disabled={activeDebugState?.loading}
                          type="button"
                        >
                          {activeDebugState?.loading ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                          调试
                        </button>
                      </div>

                      {activeTool.parameters.length > 0 ? (
                        <div className="mcp-simple-form">
                          {activeTool.parameters.map((parameter) => {
                            const key = toolKey(activeServer.id, activeTool.name);
                            const value = toolForms[key]?.[parameter.name] ?? "";
                            const type = typeof parameter.schema.type === "string" ? parameter.schema.type : parameter.type;
                            const enumValues = getSchemaEnum(parameter.schema);

                            if (type === "boolean") {
                              return (
                                <label key={parameter.name}>
                                  <span>{parameter.name}{parameter.required ? " *" : ""}</span>
                                  <div className="select-shell field-select full-width">
                                    <select
                                      value={value || "false"}
                                      onChange={(event) => updateToolForm(key, parameter.name, event.target.value)}
                                    >
                                      <option value="false">否</option>
                                      <option value="true">是</option>
                                    </select>
                                    <ChevronDown size={13} />
                                  </div>
                                </label>
                              );
                            }

                            if (enumValues.length > 0) {
                              return (
                                <label key={parameter.name}>
                                  <span>{parameter.name}{parameter.required ? " *" : ""}</span>
                                  <div className="select-shell field-select full-width">
                                    <select
                                      value={value || enumValues[0]}
                                      onChange={(event) => updateToolForm(key, parameter.name, event.target.value)}
                                    >
                                      {enumValues.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown size={13} />
                                  </div>
                                </label>
                              );
                            }

                            if (type === "array" || type === "object") {
                              return (
                                <label key={parameter.name}>
                                  <span>{parameter.name}{parameter.required ? " *" : ""}</span>
                                  <textarea
                                    value={value}
                                    onChange={(event) => updateToolForm(key, parameter.name, event.target.value)}
                                    placeholder={getFieldPlaceholder(parameter)}
                                    rows={4}
                                  />
                                </label>
                              );
                            }

                            return (
                              <label key={parameter.name}>
                                <span>{parameter.name}{parameter.required ? " *" : ""}</span>
                                <input
                                  value={value}
                                  onChange={(event) => updateToolForm(key, parameter.name, event.target.value)}
                                  placeholder={getFieldPlaceholder(parameter)}
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mcp-empty-inline">这个工具不需要填写参数。</div>
                      )}

                      {activeDebugState?.error ? <pre className="mcp-debug-output error">{activeDebugState.error}</pre> : null}

                      {activeDebugState?.result ? (
                        <div className="mcp-result-block">
                          <div className="mcp-result-title">调试结果</div>
                          <pre className="mcp-debug-output">
                            {activeDebugState.result.content || activeDebugState.result.rawJson}
                          </pre>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
