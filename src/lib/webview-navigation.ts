import type { WebviewWindowOpenPayload } from "../types";
import { normalizeBrowserAddress } from "./browser-target";

export interface BrowserNavigationWebview {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  getURL?: () => string;
}

export interface BrowserWebviewNavigationState {
  currentUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  ready: boolean;
}

function isWebviewNotReadyError(error: unknown) {
  return error instanceof Error && error.message.includes("WebView must be attached");
}

export function readBrowserWebviewNavigationState(
  webview: BrowserNavigationWebview,
  fallbackUrl: string,
): BrowserWebviewNavigationState {
  try {
    return {
      currentUrl: webview.getURL?.() || fallbackUrl,
      canGoBack: Boolean(webview.canGoBack?.()),
      canGoForward: Boolean(webview.canGoForward?.()),
      ready: true,
    };
  } catch (error) {
    if (!isWebviewNotReadyError(error)) {
      throw error;
    }

    return {
      currentUrl: fallbackUrl,
      canGoBack: false,
      canGoForward: false,
      ready: false,
    };
  }
}

function isUnsafeBrowserWindowOpenUrl(value: string) {
  return /^javascript:/i.test(value);
}

export function resolveBrowserWindowOpenTarget(
  payload: WebviewWindowOpenPayload,
  activeWebContentsId: number | null | undefined,
) {
  if (!activeWebContentsId || payload.webContentsId !== activeWebContentsId) {
    return null;
  }

  const url = payload.url.trim();
  if (!url || isUnsafeBrowserWindowOpenUrl(url)) {
    return null;
  }

  return normalizeBrowserAddress(url);
}

export function shouldActivateBrowserWindowOpenTarget(payload: WebviewWindowOpenPayload) {
  return payload.disposition !== "background-tab";
}
