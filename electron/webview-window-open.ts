import type { WebviewWindowOpenDisposition, WebviewWindowOpenPayload } from "../src/types";

const DEFAULT_DISPOSITION: WebviewWindowOpenDisposition = "default";
const VALID_DISPOSITIONS = new Set<WebviewWindowOpenDisposition>([
  "default",
  "foreground-tab",
  "background-tab",
  "new-window",
  "other",
]);

function isValidDisposition(value: unknown): value is WebviewWindowOpenDisposition {
  return typeof value === "string" && VALID_DISPOSITIONS.has(value as WebviewWindowOpenDisposition);
}

function isUnsafeBrowserUrl(value: string) {
  return /^javascript:/i.test(value);
}

export function createWebviewWindowOpenPayload(
  webContentsId: number,
  details: { url?: unknown; disposition?: unknown },
): WebviewWindowOpenPayload | null {
  const url = typeof details.url === "string" ? details.url.trim() : "";
  if (!url || isUnsafeBrowserUrl(url)) {
    return null;
  }

  return {
    webContentsId,
    url,
    disposition: isValidDisposition(details.disposition) ? details.disposition : DEFAULT_DISPOSITION,
  };
}
