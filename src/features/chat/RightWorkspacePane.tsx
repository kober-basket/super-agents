import clsx from "clsx";
import {
  ChevronDown,
  FileCode2,
  Files,
  Globe2,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import type { RightPaneTab } from "../../lib/right-pane-tabs";

interface RightWorkspacePaneProps {
  tabs: RightPaneTab[];
  activeTabId: string | null;
  canCreateBrowserTab: boolean;
  onCloseTab: (tabId: string) => void;
  onCreateBrowserTab: () => void;
  onCreateTerminalTab: () => void;
  onSelectTab: (tabId: string) => void;
  renderTabContent: (tab: RightPaneTab) => ReactNode;
}

function iconForTab(tab: RightPaneTab) {
  if (tab.kind === "files") return Files;
  if (tab.kind === "browser") return Globe2;
  if (tab.kind === "terminal") return SquareTerminal;
  return FileCode2;
}

export function RightWorkspacePane({
  tabs,
  activeTabId,
  canCreateBrowserTab,
  onCloseTab,
  onCreateBrowserTab,
  onCreateTerminalTab,
  onSelectTab,
  renderTabContent,
}: RightWorkspacePaneProps) {
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;

  function handleCreateBrowserTab() {
    onCreateBrowserTab();
    setActionMenuOpen(false);
  }

  function handleCreateTerminalTab() {
    onCreateTerminalTab();
    setActionMenuOpen(false);
  }

  return (
    <aside className="preview-pane right-workspace-pane">
      <header className="right-workspace-head">
        <div className="right-workspace-tabs" role="tablist" aria-label="右侧栏标签页">
          {tabs.map((tab) => {
            const Icon = iconForTab(tab);
            const active = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                className={clsx("right-workspace-tab", active && "active", `kind-${tab.kind}`)}
              >
                <button
                  aria-selected={active}
                  className="right-workspace-tab-trigger"
                  onClick={() => onSelectTab(tab.id)}
                  role="tab"
                  title={tab.title}
                  type="button"
                >
                  <Icon size={14} />
                  <span>{tab.title}</span>
                </button>
                {tab.closable ? (
                  <button
                    aria-label={`关闭 ${tab.title}`}
                    className="right-workspace-tab-close"
                    onClick={() => onCloseTab(tab.id)}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="right-workspace-actions">
          <button
            aria-expanded={actionMenuOpen}
            aria-haspopup="menu"
            aria-label="新建右侧栏项目"
            className="right-workspace-add-button"
            onClick={() => setActionMenuOpen((open) => !open)}
            title="新建"
            type="button"
          >
            <Plus size={15} />
            <ChevronDown size={12} />
          </button>
          {actionMenuOpen ? (
            <div className="right-workspace-action-menu" role="menu">
              {canCreateBrowserTab ? (
                <button onClick={handleCreateBrowserTab} role="menuitem" type="button">
                  <Globe2 size={15} />
                  <span>浏览器</span>
                  <em>单实例</em>
                </button>
              ) : null}
              <button onClick={handleCreateTerminalTab} role="menuitem" type="button">
                <SquareTerminal size={15} />
                <span>终端</span>
                <em>新实例</em>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {activeTab ? (
        renderTabContent(activeTab)
      ) : (
        <section className="right-workspace-empty">
          <strong>右侧栏已就绪</strong>
          <span>文件、浏览器和终端会在这里以标签页方式显示。</span>
          <button className="preview-open-button" onClick={canCreateBrowserTab ? handleCreateBrowserTab : handleCreateTerminalTab} type="button">
            {canCreateBrowserTab ? "打开浏览器" : "新建终端"}
          </button>
        </section>
      )}
    </aside>
  );
}
