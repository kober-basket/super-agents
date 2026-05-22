import type { FilePreviewPayload } from "../types";

export const BROWSER_HOME_URL = "https://duckduckgo.com/";

function hasUrlScheme(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function looksLikeLocalhost(value: string) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(value);
}

function looksLikeDomain(value: string) {
  return /^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/i.test(value);
}

function looksLikeWindowsPath(value: string) {
  return /^[a-z]:[\\/]/i.test(value);
}

function windowsPathToFileUrl(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return `file:///${encodeURI(normalized).replace(/#/g, "%23")}`;
}

export function normalizeBrowserAddress(value: string) {
  const input = value.trim();
  if (!input) {
    return BROWSER_HOME_URL;
  }

  if (looksLikeWindowsPath(input)) {
    return windowsPathToFileUrl(input);
  }

  if (looksLikeLocalhost(input)) {
    return `http://${input}`;
  }

  if (hasUrlScheme(input)) {
    return input;
  }

  if (looksLikeDomain(input)) {
    return `https://${input}`;
  }

  return `${BROWSER_HOME_URL}?q=${encodeURIComponent(input)}`;
}

export function buildBrowserPreview(target: string, title = "浏览器"): FilePreviewPayload {
  const url = normalizeBrowserAddress(target);
  return {
    title,
    path: url,
    kind: "web",
    mimeType: "text/html",
    content: "",
    url,
    loading: false,
  };
}
