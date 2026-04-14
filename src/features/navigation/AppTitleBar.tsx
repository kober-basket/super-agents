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

interface AppTitleBarProps {
  view: AppSection;
  windowState: DesktopWindowState | null;
  onClose: () => void | Promise<void>;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
}

export function AppTitleBar({
  view,
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

      {isMac ? null : (
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            onClick={() => void onMinimize()}
            aria-label="Minimize window"
            title="最小化"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="window-control"
            onClick={() => void onToggleMaximize()}
            aria-label={windowState?.maximized ? "Restore window" : "Maximize window"}
            title={windowState?.maximized ? "还原" : "最大化"}
          >
            {windowState?.maximized ? <Copy size={13} /> : <Square size={12} />}
          </button>
          <button
            type="button"
            className="window-control danger"
            onClick={() => void onClose()}
            aria-label="Close window"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
