import { BROWSER_HOME_URL, buildBrowserPreview } from "./browser-target";
import type { FilePreviewPayload } from "../types";

export const RIGHT_FILES_TAB_ID = "right-files";
export const RIGHT_BROWSER_TAB_ID = "right-browser";

export interface RightPaneBrowserPage {
  id: string;
  preview: FilePreviewPayload;
}

export interface RightPaneFileSystemTab {
  id: typeof RIGHT_FILES_TAB_ID;
  kind: "files";
  title: string;
  closable: false;
}

export interface RightPanePreviewTab {
  id: string;
  kind: "preview";
  title: string;
  preview: FilePreviewPayload;
  closable: true;
}

export interface RightPaneBrowserTab {
  id: string;
  kind: "browser";
  title: string;
  browserTabs: RightPaneBrowserPage[];
  activeBrowserTabId: string;
  closable: true;
}

export interface RightPaneTerminalTab {
  id: string;
  kind: "terminal";
  title: string;
  closable: true;
}

export type RightPaneTab =
  | RightPaneFileSystemTab
  | RightPanePreviewTab
  | RightPaneBrowserTab
  | RightPaneTerminalTab;

export function createFileSystemRightPaneTab(): RightPaneFileSystemTab {
  return {
    id: RIGHT_FILES_TAB_ID,
    kind: "files",
    title: "文件",
    closable: false,
  };
}

export function createPreviewRightPaneTab(id: string, preview: FilePreviewPayload): RightPanePreviewTab {
  return {
    id,
    kind: "preview",
    title: preview.title,
    preview,
    closable: true,
  };
}

export function createBrowserRightPaneTab(id = RIGHT_BROWSER_TAB_ID, target = BROWSER_HOME_URL): RightPaneBrowserTab {
  const page = {
    id: `${id}-page-1`,
    preview: buildBrowserPreview(target, "新标签页"),
  };

  return {
    id,
    kind: "browser",
    title: "浏览器",
    browserTabs: [page],
    activeBrowserTabId: page.id,
    closable: true,
  };
}

export function createTerminalRightPaneTab(id: string): RightPaneTerminalTab {
  return {
    id,
    kind: "terminal",
    title: "终端",
    closable: true,
  };
}

export function hasBrowserRightPaneTab(tabs: RightPaneTab[]) {
  return tabs.some((tab) => tab.kind === "browser");
}

export function rightPaneTabTargetKey(preview: FilePreviewPayload) {
  if ((preview.kind === "web" || preview.kind === "html") && preview.url) {
    return `${preview.kind}:${preview.url}`;
  }

  if (preview.path) {
    return `${preview.kind}:${preview.path}`;
  }

  if (preview.url) {
    return `${preview.kind}:${preview.url}`;
  }

  return null;
}

export function upsertRightPaneTab(tabs: RightPaneTab[], nextTab: RightPaneTab) {
  if (nextTab.kind === "files") {
    return {
      tabs: tabs.some((tab) => tab.kind === "files") ? tabs : [nextTab, ...tabs],
      activeTabId: RIGHT_FILES_TAB_ID,
    };
  }

  if (nextTab.kind !== "preview") {
    return {
      tabs: [...tabs, nextTab],
      activeTabId: nextTab.id,
    };
  }

  const nextKey = rightPaneTabTargetKey(nextTab.preview);
  if (!nextKey) {
    return {
      tabs: [...tabs, nextTab],
      activeTabId: nextTab.id,
    };
  }

  const existingIndex = tabs.findIndex(
    (tab) => tab.kind === "preview" && rightPaneTabTargetKey(tab.preview) === nextKey,
  );
  if (existingIndex === -1) {
    return {
      tabs: [...tabs, nextTab],
      activeTabId: nextTab.id,
    };
  }

  const existingTab = tabs[existingIndex];
  const updatedTabs = tabs.map((tab, index) =>
    index === existingIndex ? { ...nextTab, id: existingTab.id } : tab,
  );

  return {
    tabs: updatedTabs,
    activeTabId: existingTab.id,
  };
}

export function replaceRightPaneTabByTarget(
  tabs: RightPaneTab[],
  targetKey: string | null,
  preview: FilePreviewPayload,
) {
  if (!targetKey) {
    return tabs;
  }

  return tabs.map((tab) =>
    tab.kind === "preview" && rightPaneTabTargetKey(tab.preview) === targetKey
      ? { ...tab, title: preview.title, preview }
      : tab,
  );
}

export function closeRightPaneTab(tabs: RightPaneTab[], activeTabId: string | null, tabId: string) {
  const closingTab = tabs.find((tab) => tab.id === tabId);
  if (!closingTab || !closingTab.closable) {
    return { tabs, activeTabId };
  }

  const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
  const nextTabs = tabs.filter((tab) => tab.id !== tabId);
  if (activeTabId !== tabId) {
    return { tabs: nextTabs, activeTabId };
  }

  const nextActiveTab = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? nextTabs[0] ?? null;
  return {
    tabs: nextTabs,
    activeTabId: nextActiveTab?.id ?? null,
  };
}
