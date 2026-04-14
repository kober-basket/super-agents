import clsx from "clsx";
import { Copy, Minus, Square, X } from "lucide-react";

import type { AppSection, DesktopWindowState } from "../../types";

const SECTION_LABELS: Record<AppSection, string> = {
  chat: "对话",
  skills: "技能",
  tools: "工具",
  knowledge: "知识库",
  settings: "设置",
};

export interface RuntimeEngineStatusSummary {
  title: string;
  engineLabel: string;
  label: string;
  detail: string;
  tone: "idle" | "active" | "warning";
}

interface DescribeRuntimeEngineStatusInput {
  engineLabel?: string;
  hasSession: boolean;
  busy: boolean;
  blockedOnQuestion: boolean;
}

export function describeRuntimeEngineStatus({
  engineLabel = "OpenCode",
  hasSession,
  busy,
  blockedOnQuestion,
}: DescribeRuntimeEngineStatusInput): RuntimeEngineStatusSummary {
  if (busy) {
    return {
      title: "运行引擎",
      engineLabel,
      label: "运行中",
      detail: "会话正在执行",
      tone: "active",
    };
  }

  if (blockedOnQuestion) {
    return {
      title: "运行引擎",
      engineLabel,
      label: "待处理",
      detail: "需要继续答复",
      tone: "warning",
    };
  }

  if (hasSession) {
    return {
      title: "运行引擎",
      engineLabel,
      label: "空闲中",
      detail: "会话已就绪",
      tone: "idle",
    };
  }

  return {
    title: "运行引擎",
    engineLabel,
    label: "未启动",
    detail: "等待新建会话",
    tone: "idle",
  };
}

interface AppTitleBarProps {
  view: AppSection;
  runtimeStatus: RuntimeEngineStatusSummary;
  windowState: DesktopWindowState | null;
  onClose: () => void | Promise<void>;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
}

export function AppTitleBar({
  view,
  runtimeStatus,
  windowState,
  onClose,
  onMinimize,
  onToggleMaximize,
}: AppTitleBarProps) {
  const isMac = windowState?.platform === "darwin";

  return (
    <header className={clsx("window-titlebar", isMac && "mac")}>
      <div className="window-titlebar-copy">
        <strong>super-agents</strong>
        <span>{SECTION_LABELS[view]}</span>
      </div>

      <div className="window-titlebar-status-wrap">
        <div className={clsx("window-titlebar-status", runtimeStatus.tone)} aria-label="运行引擎状态">
          <span className="window-titlebar-status-dot" aria-hidden="true" />
          <div className="window-titlebar-status-copy">
            <strong>{runtimeStatus.title}</strong>
            <span>
              {runtimeStatus.engineLabel} {runtimeStatus.label} · {runtimeStatus.detail}
            </span>
          </div>
        </div>
      </div>

      {isMac ? null : (
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            onClick={() => void onMinimize()}
            aria-label="最小化窗口"
            title="最小化"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="window-control"
            onClick={() => void onToggleMaximize()}
            aria-label={windowState?.maximized ? "还原窗口" : "最大化窗口"}
            title={windowState?.maximized ? "还原" : "最大化"}
          >
            {windowState?.maximized ? <Copy size={13} /> : <Square size={12} />}
          </button>
          <button
            type="button"
            className="window-control danger"
            onClick={() => void onClose()}
            aria-label="关闭窗口"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
