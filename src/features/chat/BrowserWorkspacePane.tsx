import { useMemo } from "react";
import { Globe2, Plus, X } from "lucide-react";

import { BROWSER_HOME_URL, buildBrowserPreview } from "../../lib/browser-target";
import type { RightPaneBrowserPage } from "../../lib/right-pane-tabs";
import type { WebviewWindowOpenPayload } from "../../types";
import { PreviewPane } from "./PreviewPane";

interface BrowserWorkspacePaneProps {
  initialPages: RightPaneBrowserPage[];
  activePageId: string;
  onClosePane: () => void;
  onOpenExternal: (payload: { path?: string; url?: string }) => void;
  onPagesChange: (pages: RightPaneBrowserPage[], activePageId: string) => void;
  onBrowserWindowOpen?: (listener: (payload: WebviewWindowOpenPayload) => void) => () => void;
}

function createBrowserPage(target = BROWSER_HOME_URL): RightPaneBrowserPage {
  const title = target === BROWSER_HOME_URL ? "新标签页" : target;
  return {
    id: `browser-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    preview: buildBrowserPreview(target, title),
  };
}

export function BrowserWorkspacePane({
  initialPages,
  activePageId,
  onClosePane,
  onOpenExternal,
  onPagesChange,
  onBrowserWindowOpen,
}: BrowserWorkspacePaneProps) {
  const fallbackPages = useMemo(() => [createBrowserPage()], []);
  const pages = initialPages.length > 0 ? initialPages : fallbackPages;
  const activeInternalTabId = activePageId || pages[0]?.id || "";
  const activePage = pages.find((page) => page.id === activeInternalTabId) ?? pages[0] ?? createBrowserPage();

  function commitBrowserTabs(nextPages: RightPaneBrowserPage[], nextActivePageId: string) {
    onPagesChange(nextPages, nextActivePageId);
  }

  function updateActivePage(patch: { title?: string; url?: string; loading?: boolean }) {
    const nextPages = pages.map((page) => {
      if (page.id !== activeInternalTabId) {
        return page;
      }

      const nextUrl = patch.url ?? page.preview.url ?? page.preview.path ?? BROWSER_HOME_URL;
      return {
        ...page,
        preview: {
          ...page.preview,
          title: patch.title ?? page.preview.title,
          path: nextUrl,
          url: nextUrl,
          loading: patch.loading ?? page.preview.loading,
        },
      };
    });
    commitBrowserTabs(nextPages, activeInternalTabId);
  }

  function openInternalTab(target = BROWSER_HOME_URL, options: { activate?: boolean } = {}) {
    const nextPage = createBrowserPage(target);
    commitBrowserTabs([...pages, nextPage], options.activate === false ? activeInternalTabId : nextPage.id);
  }

  function closeInternalTab(pageId: string) {
    if (pages.length <= 1) {
      return;
    }

    const closingIndex = pages.findIndex((page) => page.id === pageId);
    const nextPages = pages.filter((page) => page.id !== pageId);
    const nextActivePageId =
      activeInternalTabId === pageId
        ? nextPages[closingIndex]?.id ?? nextPages[closingIndex - 1]?.id ?? nextPages[0]?.id ?? ""
        : activeInternalTabId;
    commitBrowserTabs(nextPages, nextActivePageId);
  }

  return (
    <section className="browser-workspace">
      <div className="browser-instance-tabs" role="tablist" aria-label="浏览器内部标签页">
        {pages.map((page) => {
          const active = page.id === activePage.id;
          return (
            <div className={`browser-instance-tab ${active ? "active" : ""}`} key={page.id}>
              <button
                aria-selected={active}
                onClick={() => commitBrowserTabs(pages, page.id)}
                role="tab"
                title={page.preview.title}
                type="button"
              >
                <Globe2 size={13} />
                <span>{page.preview.title}</span>
              </button>
              {pages.length > 1 ? (
                <button
                  aria-label={`关闭 ${page.preview.title}`}
                  className="browser-instance-tab-close"
                  onClick={() => closeInternalTab(page.id)}
                  type="button"
                >
                  <X size={11} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          aria-label="新建网页标签页"
          className="browser-instance-new-tab"
          onClick={() => openInternalTab()}
          type="button"
        >
          <Plus size={14} />
        </button>
      </div>

      <PreviewPane
        embedded
        preview={activePage.preview}
        onClearPreview={() => closeInternalTab(activePage.id)}
        onClosePane={onClosePane}
        onOpenExternal={onOpenExternal}
        onOpenLink={(url, options) => openInternalTab(url, options)}
        onBrowserStateChange={updateActivePage}
        onBrowserWindowOpen={onBrowserWindowOpen}
      />
    </section>
  );
}
