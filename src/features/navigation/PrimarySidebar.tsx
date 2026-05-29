import clsx from "clsx";
import {
  Brain,
  Database,
  Layers3,
  MessageSquarePlus,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import type { AppSection } from "../../types";
import type { SidebarConversationRunStatus } from "./conversation-status";

export interface SidebarConversationItem {
  id: string;
  title: string;
  createdAt: number;
  runStatus?: SidebarConversationRunStatus;
  isGenerating?: boolean;
}

interface PrimarySidebarProps {
  view: AppSection;
  conversations: SidebarConversationItem[];
  activeConversationId: string | null;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onSetView: (view: AppSection) => void;
}

function normalizeConversationRunStatus(conversation: SidebarConversationItem): SidebarConversationRunStatus {
  return conversation.runStatus ?? (conversation.isGenerating ? "running" : "idle");
}

function conversationRunStatusLabel(status: SidebarConversationRunStatus) {
  if (status === "running") return "执行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "执行出错";
  if (status === "cancelled") return "已取消";
  return "空闲";
}

export function PrimarySidebar({
  view,
  conversations,
  activeConversationId,
  onCreateConversation,
  onDeleteConversation,
  onOpenConversation,
  onSetView,
}: PrimarySidebarProps) {
  const isChatHomeActive = view === "chat" && activeConversationId === null;

  return (
    <aside className="sidebar">
      <div className="sidebar-primary">
        <div className="sidebar-feature-section">
          <button
            className={clsx("sidebar-link", isChatHomeActive && "sidebar-link-strong", isChatHomeActive && "active")}
            onClick={onCreateConversation}
            type="button"
          >
            <MessageSquarePlus size={16} />
            <span>新对话</span>
          </button>

          <button
            className={clsx("sidebar-link", view === "skills" && "active")}
            onClick={() => onSetView("skills")}
            type="button"
          >
            <Layers3 size={16} />
            <span>技能</span>
          </button>
          <button
            className={clsx("sidebar-link", view === "tools" && "active")}
            onClick={() => onSetView("tools")}
            type="button"
          >
            <Wrench size={16} />
            <span>工具</span>
          </button>
          <button
            className={clsx("sidebar-link", view === "memory" && "active")}
            onClick={() => onSetView("memory")}
            type="button"
          >
            <Brain size={16} />
            <span>记忆</span>
          </button>
          <button
            className={clsx("sidebar-link", view === "knowledge" && "active")}
            onClick={() => onSetView("knowledge")}
            type="button"
          >
            <Database size={16} />
            <span>知识库</span>
          </button>

          <div className="sidebar-conversation-section">
            <div className="sidebar-section-label">
              <span>会话</span>
              <strong>{conversations.length}</strong>
            </div>

            <div className="sidebar-conversation-list">
              {conversations.length > 0
                ? conversations.map((conversation) => {
                    const isActive = view === "chat" && activeConversationId === conversation.id;
                    const runStatus = normalizeConversationRunStatus(conversation);
                    const runStatusLabel = conversationRunStatusLabel(runStatus);
                    return (
                      <div
                        key={conversation.id}
                        className={clsx(
                          "sidebar-conversation-item",
                          isActive && "active",
                          runStatus !== "idle" && `status-${runStatus}`,
                          runStatus === "running" && "is-generating",
                        )}
                      >
                        <button
                          className="sidebar-conversation-trigger"
                          onClick={() => onOpenConversation(conversation.id)}
                          type="button"
                        >
                          <span
                            aria-label={`会话状态：${runStatusLabel}`}
                            className="sidebar-conversation-dot"
                            role="img"
                            title={runStatusLabel}
                          />
                          <div className="sidebar-conversation-copy">
                            <strong title={conversation.title}>{conversation.title}</strong>
                          </div>
                        </button>
                        <div className="sidebar-conversation-action">
                          <span className="sidebar-conversation-time">
                            {formatRelativeTime(conversation.createdAt)}
                          </span>
                          <button
                            aria-label={`删除会话 ${conversation.title}`}
                            className="sidebar-conversation-delete"
                            onClick={() => onDeleteConversation(conversation.id)}
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          className={clsx("sidebar-link", "bottom", view === "settings" && "active")}
          onClick={() => onSetView("settings")}
          type="button"
        >
          <Settings2 size={16} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
