import clsx from "clsx";
import {
  Brain,
  CircleAlert,
  Database,
  Layers3,
  MessageSquarePlus,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import type { SidebarConversationReadState } from "../../lib/sidebar-conversation-read-state";
import type { AppSection } from "../../types";

export interface SidebarConversationItem {
  id: string;
  title: string;
  createdAt: number;
  readState?: SidebarConversationReadState;
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
  const readStateLabels: Record<SidebarConversationReadState, string> = {
    idle: "默认",
    running: "输出中",
    unread: "未读",
    attention: "需要处理",
  };

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
                    const readState = conversation.readState ?? "idle";
                    return (
                      <div
                        key={conversation.id}
                        className={clsx("sidebar-conversation-item", isActive && "active")}
                      >
                        <button
                          className="sidebar-conversation-trigger"
                          onClick={() => onOpenConversation(conversation.id)}
                          type="button"
                        >
                          <span
                            aria-label={`会话状态：${readStateLabels[readState]}`}
                            className={clsx("sidebar-conversation-dot", `state-${readState}`)}
                          >
                            {readState === "attention" ? <CircleAlert aria-hidden size={12} strokeWidth={2} /> : null}
                          </span>
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
