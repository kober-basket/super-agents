import { useState } from "react";
import clsx from "clsx";
import {
  ArchiveRestore,
  ArchiveX,
  Database,
  Layers3,
  MessageSquarePlus,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import type { AppSection, ChatSessionSummary } from "../../types";

interface PrimarySidebarProps {
  activeChatSessionId: string | null;
  chatSessions: ChatSessionSummary[];
  view: AppSection;
  onNewChat: () => void;
  onArchiveChatSession: (sessionId: string) => void;
  onDeleteChatSession: (sessionId: string) => void;
  onSelectChatSession: (sessionId: string) => void;
  onSetView: (view: AppSection) => void;
  onUnarchiveChatSession: (sessionId: string) => void;
}

export function PrimarySidebar({
  activeChatSessionId,
  chatSessions,
  view,
  onNewChat,
  onArchiveChatSession,
  onDeleteChatSession,
  onSelectChatSession,
  onSetView,
  onUnarchiveChatSession,
}: PrimarySidebarProps) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const activeSessions = chatSessions.filter((session) => !session.archivedAt);
  const archivedSessions = chatSessions.filter((session) => Boolean(session.archivedAt));

  function renderSessionList(sessions: ChatSessionSummary[], archived: boolean) {
    return (
      <div className="thread-list">
        {sessions.map((session) => {
          const isConfirmingDelete = confirmingDeleteId === session.id;

          return (
            <div
              key={session.id}
              className={clsx(
                "thread-row",
                session.id === activeChatSessionId && "active",
                session.archivedAt && "archived",
                isConfirmingDelete && "confirming-delete",
              )}
            >
              <button
                className="thread-row-main"
                onClick={() => onSelectChatSession(session.id)}
                type="button"
              >
                <div className="thread-mark" />
                <div className="thread-copy">
                  <strong>{session.title.trim() || "新对话"}</strong>
                  <div className="thread-subline">
                    <time className="thread-meta">{formatRelativeTime(session.updatedAt)}</time>
                  </div>
                </div>
              </button>

              <div className="thread-row-actions">
                {archived ? (
                  <button
                    aria-label="恢复会话"
                    className="icon-action-button thread-action"
                    onClick={() => {
                      setConfirmingDeleteId(null);
                      onUnarchiveChatSession(session.id);
                    }}
                    type="button"
                  >
                    <ArchiveRestore size={15} />
                  </button>
                ) : (
                  <button
                    aria-label="归档会话"
                    className="icon-action-button thread-action"
                    onClick={() => {
                      setConfirmingDeleteId(null);
                      onArchiveChatSession(session.id);
                    }}
                    type="button"
                  >
                    <ArchiveX size={15} />
                  </button>
                )}
                <button
                  aria-label={isConfirmingDelete ? "确认删除会话" : "删除会话"}
                  className="icon-action-button thread-action danger"
                  onClick={() => {
                    if (isConfirmingDelete) {
                      setConfirmingDeleteId(null);
                      onDeleteChatSession(session.id);
                      return;
                    }
                    setConfirmingDeleteId(session.id);
                  }}
                  onBlur={() => {
                    if (confirmingDeleteId === session.id) {
                      setConfirmingDeleteId(null);
                    }
                  }}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-primary">
        <button
          className={clsx("sidebar-link", view === "chat" && "active")}
          onClick={onNewChat}
          type="button"
        >
          <MessageSquarePlus size={18} />
          <span>新对话</span>
        </button>
        <button
          className={clsx("sidebar-link", view === "skills" && "active")}
          onClick={() => onSetView("skills")}
          type="button"
        >
          <Layers3 size={18} />
          <span>技能</span>
        </button>
        <button
          className={clsx("sidebar-link", view === "tools" && "active")}
          onClick={() => onSetView("tools")}
          type="button"
        >
          <Wrench size={18} />
          <span>工具</span>
        </button>
        <button
          className={clsx("sidebar-link", view === "knowledge" && "active")}
          onClick={() => onSetView("knowledge")}
          type="button"
        >
          <Database size={18} />
          <span>知识库</span>
        </button>
      </div>

      <div className="thread-pane">
        {chatSessions.length === 0 ? (
          <div className="thread-pane-empty">
            <strong>还没有会话</strong>
            <span>发送第一条消息后，这里会出现新的会话。</span>
          </div>
        ) : (
          <div className="thread-group">
            <section className="thread-section">
              <div className="thread-section-head">
                <span>会话</span>
                <strong>{activeSessions.length}</strong>
              </div>
              {renderSessionList(activeSessions, false)}
            </section>

            {archivedSessions.length > 0 ? (
              <section className="thread-section">
                <div className="thread-section-head">
                  <span>已归档</span>
                  <strong>{archivedSessions.length}</strong>
                </div>
                {renderSessionList(archivedSessions, true)}
              </section>
            ) : null}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className={clsx("sidebar-link", "bottom", view === "settings" && "active")}
          onClick={() => onSetView("settings")}
          type="button"
        >
          <Settings2 size={18} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
