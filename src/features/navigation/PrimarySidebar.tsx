import clsx from "clsx";
import {
  Database,
  FileText,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  Settings2,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import type { AppSection, ThreadSummary } from "../../types";
import { ThreadSection } from "./ThreadSection";

interface PrimarySidebarProps {
  activeThreadId: string;
  activeThreads: ThreadSummary[];
  archivedThreads: ThreadSummary[];
  busyThreadId?: string | null;
  creatingThread?: boolean;
  view: AppSection;
  workspaceIssue?: string | null;
  onArchiveThread: (thread: ThreadSummary, archived: boolean) => void | Promise<void>;
  onCreateThread: () => void | Promise<void>;
  onDeleteThread: (thread: ThreadSummary) => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onSetView: (view: AppSection) => void;
}

export function PrimarySidebar({
  activeThreadId,
  activeThreads,
  archivedThreads,
  busyThreadId,
  creatingThread,
  view,
  workspaceIssue,
  onArchiveThread,
  onCreateThread,
  onDeleteThread,
  onOpenThread,
  onSetView,
}: PrimarySidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-primary">
        <button
          className={clsx("sidebar-link", view === "chat" && "active")}
          onClick={() => void onCreateThread()}
          disabled={creatingThread}
        >
          {creatingThread ? <LoaderCircle size={18} className="spin" /> : <MessageSquarePlus size={18} />}
          <span>新聊天</span>
        </button>
        <button className={clsx("sidebar-link", view === "skills" && "active")} onClick={() => onSetView("skills")}>
          <Layers3 size={18} />
          <span>技能</span>
        </button>
        <button className={clsx("sidebar-link", view === "tools" && "active")} onClick={() => onSetView("tools")}>
          <Wrench size={18} />
          <span>工具</span>
        </button>
        <button
          className={clsx("sidebar-link", view === "knowledge" && "active")}
          onClick={() => onSetView("knowledge")}
        >
          <Database size={18} />
          <span>知识库</span>
        </button>
        <button className={clsx("sidebar-link", view === "reports" && "active")} onClick={() => onSetView("reports")}>
          <FileText size={18} />
          <span>报告生成</span>
        </button>
        <button
          className={clsx("sidebar-link", view === "emergency" && "active")}
          onClick={() => onSetView("emergency")}
        >
          <ShieldAlert size={18} />
          <span>应急预案</span>
        </button>
      </div>

      <div className="thread-pane">
        {workspaceIssue ? (
          <div className="thread-pane-status" role="alert">
            <strong>会话列表未完全刷新</strong>
            <span>{workspaceIssue}</span>
          </div>
        ) : null}

        {activeThreads.length === 0 && archivedThreads.length === 0 ? (
          <div className="thread-pane-empty">
            <strong>{workspaceIssue ? "暂时无法刷新会话列表" : "还没有会话"}</strong>
            <span>
              {workspaceIssue
                ? "当前已保留现有界面状态，你可以继续操作，稍后再重试。"
                : "点上面的“新聊天”就能开始；归档后的会话会显示在下方“已归档”区域。"}
            </span>
          </div>
        ) : (
          <div className="thread-group">
            <ThreadSection
              activeThreadId={activeThreadId}
              busyThreadId={busyThreadId}
              items={activeThreads}
              label="历史会话"
              onArchiveThread={onArchiveThread}
              onDeleteThread={onDeleteThread}
              onOpenThread={onOpenThread}
            />
            <ThreadSection
              activeThreadId={activeThreadId}
              busyThreadId={busyThreadId}
              items={archivedThreads}
              label="已归档"
              emptyHint="归档后的会话会显示在这里"
              onArchiveThread={onArchiveThread}
              onDeleteThread={onDeleteThread}
              onOpenThread={onOpenThread}
            />
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className={clsx("sidebar-link", "bottom", view === "settings" && "active")}
          onClick={() => onSetView("settings")}
        >
          <Settings2 size={18} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
