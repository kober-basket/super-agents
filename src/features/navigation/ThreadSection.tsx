import clsx from "clsx";
import { Archive, ArchiveRestore, LoaderCircle, Trash2 } from "lucide-react";

import { formatRelativeTime } from "../../lib/format";
import { formatThreadTitle } from "../../lib/thread-title";
import type { ThreadSummary } from "../../types";

interface ThreadSectionProps {
  activeThreadId: string;
  busyThreadId?: string | null;
  items: ThreadSummary[];
  label: string;
  onArchiveThread: (thread: ThreadSummary, archived: boolean) => void | Promise<void>;
  onDeleteThread: (thread: ThreadSummary) => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
}

export function ThreadSection({
  activeThreadId,
  busyThreadId,
  items,
  label,
  onArchiveThread,
  onDeleteThread,
  onOpenThread,
}: ThreadSectionProps) {
  if (items.length === 0) return null;

  return (
    <section className="thread-section">
      <div className="thread-section-head">
        <span>{label}</span>
        <strong>{items.length}</strong>
      </div>

      <div className="thread-list">
        {items.map((thread) => {
          const isBusy = busyThreadId === thread.id;

          return (
            <div
              key={thread.id}
              className={clsx("thread-row", thread.id === activeThreadId && "active", thread.archived && "archived")}
            >
              <button className="thread-row-main" onClick={() => void onOpenThread(thread.id)} disabled={isBusy}>
                <div className="thread-mark" />
                <div className="thread-copy">
                  <strong>{formatThreadTitle(thread.title, thread.lastMessage)}</strong>
                  <div className="thread-subline">
                    {isBusy ? (
                      <span className="thread-meta">
                        <LoaderCircle size={13} className="spin" />
                        <span>处理中</span>
                      </span>
                    ) : (
                      <time className="thread-meta">{formatRelativeTime(thread.updatedAt)}</time>
                    )}
                  </div>
                </div>
              </button>

              <div className="thread-row-actions">
                {thread.archived ? (
                  <button
                    className="ghost-icon small thread-action"
                    onClick={() => void onArchiveThread(thread, false)}
                    disabled={isBusy}
                    title="恢复"
                  >
                    <ArchiveRestore size={14} />
                  </button>
                ) : (
                  <button
                    className="ghost-icon small thread-action"
                    onClick={() => void onArchiveThread(thread, true)}
                    disabled={isBusy}
                    title="归档"
                  >
                    <Archive size={14} />
                  </button>
                )}

                <button
                  className="ghost-icon small thread-action danger"
                  onClick={() => void onDeleteThread(thread)}
                  disabled={isBusy}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
