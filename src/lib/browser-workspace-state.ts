import { BROWSER_HOME_URL, buildBrowserPreview, normalizeBrowserAddress } from "./browser-target";
import {
  createBrowserRightPaneTab,
  RIGHT_BROWSER_TAB_ID,
  type RightPaneBrowserPage,
  type RightPaneBrowserTab,
} from "./right-pane-tabs";

export const BROWSER_WORKSPACE_STATE_STORAGE_KEY = "super-agents:browser-workspace-state";

const BROWSER_WORKSPACE_STATE_VERSION = 1;
const MAX_RESTORED_BROWSER_PAGES = 20;

interface StoredBrowserWorkspacePage {
  id: string;
  title: string;
  url: string;
}

interface StoredBrowserWorkspaceState {
  version: typeof BROWSER_WORKSPACE_STATE_VERSION;
  activePageId: string;
  pages: StoredBrowserWorkspacePage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnsafeRestoredUrl(value: string) {
  return /^javascript:/i.test(value);
}

function safePageId(value: unknown, index: number) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || `browser-page-${index + 1}`;
}

function safeTitle(value: unknown, fallbackUrl: string) {
  const title = typeof value === "string" ? value.trim() : "";
  return title || fallbackUrl;
}

function createPageFromStoredPage(
  storedPage: unknown,
  index: number,
): RightPaneBrowserPage | null {
  if (!isRecord(storedPage)) {
    return null;
  }

  const rawUrl = typeof storedPage.url === "string" ? storedPage.url.trim() : "";
  if (!rawUrl || isUnsafeRestoredUrl(rawUrl)) {
    return null;
  }

  const url = normalizeBrowserAddress(rawUrl);
  if (isUnsafeRestoredUrl(url)) {
    return null;
  }

  return {
    id: safePageId(storedPage.id, index),
    preview: {
      ...buildBrowserPreview(url, safeTitle(storedPage.title, url)),
      loading: false,
    },
  };
}

function storedPageFromBrowserPage(page: RightPaneBrowserPage): StoredBrowserWorkspacePage | null {
  const rawUrl = page.preview.url ?? page.preview.path ?? "";
  if (!rawUrl || isUnsafeRestoredUrl(rawUrl)) {
    return null;
  }

  const url = normalizeBrowserAddress(rawUrl);
  if (isUnsafeRestoredUrl(url)) {
    return null;
  }

  return {
    id: page.id,
    title: page.preview.title.trim() || url,
    url,
  };
}

function parseStoredBrowserWorkspaceState(value: string | null | undefined): StoredBrowserWorkspaceState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== BROWSER_WORKSPACE_STATE_VERSION || !Array.isArray(parsed.pages)) {
      return null;
    }

    return {
      version: BROWSER_WORKSPACE_STATE_VERSION,
      activePageId: typeof parsed.activePageId === "string" ? parsed.activePageId : "",
      pages: parsed.pages
        .slice(0, MAX_RESTORED_BROWSER_PAGES)
        .filter(isRecord)
        .map((page) => ({
          id: typeof page.id === "string" ? page.id : "",
          title: typeof page.title === "string" ? page.title : "",
          url: typeof page.url === "string" ? page.url : "",
        })),
    };
  } catch {
    return null;
  }
}

export function serializeBrowserWorkspaceTab(tab: RightPaneBrowserTab) {
  const pages = tab.browserTabs
    .slice(0, MAX_RESTORED_BROWSER_PAGES)
    .map(storedPageFromBrowserPage)
    .filter((page): page is StoredBrowserWorkspacePage => page !== null);
  const activePageId = pages.some((page) => page.id === tab.activeBrowserTabId)
    ? tab.activeBrowserTabId
    : pages[0]?.id ?? "";
  const state: StoredBrowserWorkspaceState = {
    version: BROWSER_WORKSPACE_STATE_VERSION,
    activePageId,
    pages,
  };

  return JSON.stringify(state);
}

export function parseBrowserWorkspaceTab(
  value: string | null | undefined,
  id = RIGHT_BROWSER_TAB_ID,
): RightPaneBrowserTab | null {
  const storedState = parseStoredBrowserWorkspaceState(value);
  if (!storedState) {
    return null;
  }

  const browserTabs = storedState.pages
    .map(createPageFromStoredPage)
    .filter((page): page is RightPaneBrowserPage => page !== null);
  if (browserTabs.length === 0) {
    return null;
  }

  const activeBrowserTabId = browserTabs.some((page) => page.id === storedState.activePageId)
    ? storedState.activePageId
    : browserTabs[0]!.id;
  const fallbackTab = createBrowserRightPaneTab(id);

  return {
    ...fallbackTab,
    browserTabs,
    activeBrowserTabId,
  };
}

export function restoreBrowserWorkspaceTab(
  value: string | null | undefined,
  id = RIGHT_BROWSER_TAB_ID,
  fallbackTarget = BROWSER_HOME_URL,
) {
  return parseBrowserWorkspaceTab(value, id) ?? createBrowserRightPaneTab(id, fallbackTarget);
}
