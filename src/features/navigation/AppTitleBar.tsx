import { Copy, Minus, Square, X } from "lucide-react";

import type { AppSection, DesktopWindowState } from "../../types";

interface AppTitleBarProps {
  view: AppSection;
  sidebarWidth: number;
  windowState: DesktopWindowState | null;
  onClose: () => void | Promise<void>;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
}

export function AppTitleBar({
  view: _view,
  sidebarWidth: _sidebarWidth,
  windowState,
  onClose,
  onMinimize,
  onToggleMaximize,
}: AppTitleBarProps) {
  const isMac = windowState?.platform === "darwin";

  if (isMac) {
    return null;
  }

  return (
    <div className="window-titlebar">
      <div className="window-controls-overlay">
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
    </div>
  );
}
