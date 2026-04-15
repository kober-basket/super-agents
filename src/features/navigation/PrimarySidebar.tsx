import clsx from "clsx";
import { Database, Layers3, MessageSquarePlus, Settings2, Trash2, Wrench } from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import type { AppSection } from "../../types";

export interface SidebarConversationItem {
  id: string;
  title: string;
  createdAt: number;
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
            className={clsx(
              "sidebar-link",
              isChatHomeActive && "sidebar-link-strong",
              isChatHomeActive && "active",
            )}
            onClick={onCreateConversation}
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

          <div className="sidebar-conversation-section">
            <div className="sidebar-section-label">
              <span>会话</span>
              <strong>{conversations.length}</strong>
            </div>

            <div className="sidebar-conversation-list">
              {conversations.length > 0 ? (
                conversations.map((conversation) => {
                  const isActive = view === "chat" && activeConversationId === conversation.id;
                  return (
                    <div
                      key={conversation.id}
                      className={clsx(
                        "sidebar-conversation-item",
                        isActive && "active",
                        conversation.isGenerating && "is-generating",
                      )}
                    >
                      <button
                        className="sidebar-conversation-trigger"
                        onClick={() => onOpenConversation(conversation.id)}
                        type="button"
                      >
                        <div className="sidebar-conversation-dot" aria-hidden="true" />
                        <div className="sidebar-conversation-copy">
                          <strong title={conversation.title}>{conversation.title}</strong>
                          <span>{formatRelativeTime(conversation.createdAt)}</span>
                        </div>
                      </button>
                      <button
                        aria-label={`删除会话 ${conversation.title}`}
                        className="sidebar-conversation-delete"
                        onClick={() => onDeleteConversation(conversation.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })
              ) : null}
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
          <Settings2 size={18} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
