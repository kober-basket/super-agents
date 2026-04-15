import clsx from "clsx";
import type { CSSProperties } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

import type { AppSection, DesktopWindowState } from "../../types";

const SECTION_LABELS: Record<AppSection, string> = {
  chat: "对话",
  skills: "技能",
  tools: "工具",
  knowledge: "知识库",
  settings: "设置",
};

interface AppTitleBarProps {
  view: AppSection;
  sidebarWidth: number;
  windowState: DesktopWindowState | null;
  onClose: () => void | Promise<void>;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
}

export function AppTitleBar({
  view,
  sidebarWidth,
  windowState,
  onClose,
  onMinimize,
  onToggleMaximize,
}: AppTitleBarProps) {
  const isMac = windowState?.platform === "darwin";
  const style = {
    "--titlebar-sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <header className={clsx("window-titlebar", isMac && "mac")} style={style}>
      <div className="window-titlebar-copy">
        <strong>super-agents</strong>
        <span>{SECTION_LABELS[view]}</span>
      </div>

      <div className="window-titlebar-status-wrap">
        <div className={clsx("window-titlebar-status", "idle")} aria-label="当前状态">
          <span className="window-titlebar-status-dot" aria-hidden="true" />
          <div className="window-titlebar-status-copy">
            <span>OpenCode 空闲中 · 会话已就绪</span>
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
