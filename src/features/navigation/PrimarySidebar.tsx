import clsx from "clsx";
import {
  ChevronRight,
  Database,
  Layers3,
  MessageSquarePlus,
  Settings2,
  WandSparkles,
  Wrench,
} from "lucide-react";

import type { AppSection, ThreadSummary } from "../../types";
import { ThreadSection } from "./ThreadSection";

interface PrimarySidebarProps {
  activeThreadId: string;
  activeThreads: ThreadSummary[];
  archivedThreads: ThreadSummary[];
  view: AppSection;
  workspaceIssue?: string | null;
  onArchiveThread: (thread: ThreadSummary, archived: boolean) => void | Promise<void>;
  onCreateThread: () => void | Promise<void>;
  onDeleteThread: (thread: ThreadSummary) => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onRefreshThreadList: () => void | Promise<void>;
  onSetView: (view: AppSection) => void;
}

export function PrimarySidebar({
  activeThreadId,
  activeThreads,
  archivedThreads,
  view,
  workspaceIssue,
  onArchiveThread,
  onCreateThread,
  onDeleteThread,
  onOpenThread,
  onRefreshThreadList,
  onSetView,
}: PrimarySidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-primary">
        <button className={clsx("sidebar-link", view === "chat" && "active")} onClick={() => void onCreateThread()}>
          <MessageSquarePlus size={18} />
          <span>新聊天</span>
        </button>
        <button className={clsx("sidebar-link", view === "automation" && "active")} onClick={() => onSetView("automation")}>
          <WandSparkles size={18} />
          <span>自动化</span>
        </button>
        <button className={clsx("sidebar-link", view === "skills" && "active")} onClick={() => onSetView("skills")}>
          <Layers3 size={18} />
          <span>技能</span>
        </button>
        <button className={clsx("sidebar-link", view === "tools" && "active")} onClick={() => onSetView("tools")}>
          <Wrench size={18} />
          <span>工具</span>
        </button>
        <button className={clsx("sidebar-link", view === "knowledge" && "active")} onClick={() => onSetView("knowledge")}>
          <Database size={18} />
          <span>知识库</span>
        </button>
      </div>

      <div className="thread-pane">
        <div className="thread-pane-head">
          <span>聊天</span>
          <button className="ghost-icon small" onClick={() => void onRefreshThreadList()}>
            <ChevronRight size={14} />
          </button>
        </div>

        {workspaceIssue ? (
          <div className="thread-pane-status" role="alert">
            <strong>会话列表未完全刷新</strong>
            <span>{workspaceIssue}</span>
          </div>
        ) : null}

        {activeThreads.length === 0 && archivedThreads.length === 0 ? (
          <div className="thread-pane-empty">
            <strong>{workspaceIssue ? "暂时没法刷新会话列表" : "还没有会话"}</strong>
            <span>{workspaceIssue ? "当前已保留现有界面状态，你可以点右上角继续重试。" : "点上面的“新聊天”就能开始。"} </span>
          </div>
        ) : (
          <div className="thread-group">
            <ThreadSection
              activeThreadId={activeThreadId}
              items={activeThreads}
              label="最近"
              onArchiveThread={onArchiveThread}
              onDeleteThread={onDeleteThread}
              onOpenThread={onOpenThread}
            />
            <ThreadSection
              activeThreadId={activeThreadId}
              items={archivedThreads}
              label="归档"
              onArchiveThread={onArchiveThread}
              onDeleteThread={onDeleteThread}
              onOpenThread={onOpenThread}
            />
          </div>
        )}
      </div>

      <button className={clsx("sidebar-link", "bottom", view === "settings" && "active")} onClick={() => onSetView("settings")}>
        <Settings2 size={18} />
        <span>设置</span>
      </button>
    </aside>
  );
}
