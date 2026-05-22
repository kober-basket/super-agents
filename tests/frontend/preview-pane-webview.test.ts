import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  readBrowserWebviewNavigationState,
  resolveBrowserWindowOpenTarget,
  shouldActivateBrowserWindowOpenTarget,
} from "../../src/lib/webview-navigation";

function readPreviewPaneSource() {
  const localPath = path.resolve(process.cwd(), "src/features/chat/PreviewPane.tsx");
  const sourcePath = existsSync(localPath)
    ? localPath
    : path.resolve(process.cwd(), "..", "src/features/chat/PreviewPane.tsx");

  return readFileSync(sourcePath, "utf8");
}

test("readBrowserWebviewNavigationState falls back before Electron webview is dom-ready", () => {
  const earlyWebview = {
    getURL() {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.");
    },
    canGoBack() {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.");
    },
    canGoForward() {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.");
    },
  };

  assert.deepEqual(readBrowserWebviewNavigationState(earlyWebview, "https://duckduckgo.com/"), {
    currentUrl: "https://duckduckgo.com/",
    canGoBack: false,
    canGoForward: false,
    ready: false,
  });
});

test("shouldActivateBrowserWindowOpenTarget preserves Chrome foreground and background tab intent", () => {
  assert.equal(
    shouldActivateBrowserWindowOpenTarget({
      webContentsId: 42,
      url: "https://example.com/foreground",
      disposition: "foreground-tab",
    }),
    true,
  );

  assert.equal(
    shouldActivateBrowserWindowOpenTarget({
      webContentsId: 42,
      url: "https://example.com/background",
      disposition: "background-tab",
    }),
    false,
  );
});

test("PreviewPane renders Electron webview popups as a string attribute", () => {
  const source = readPreviewPaneSource();

  assert.match(source, /allowpopups="true"/);
});

test("PreviewPane renders inline HTML content when no absolute file URL is available", () => {
  const source = readPreviewPaneSource();

  assert.match(source, /function hasAbsoluteFileTarget\(preview: FilePreviewPayload\)/);
  assert.match(source, /if \(preview\.path && hasAbsoluteFileTarget\(preview\)\) \{\s*return normalizeBrowserAddress\(preview\.path\);/s);
  assert.match(source, /if \(preview\.content\) \{\s*return buildHtmlDataUrl\(preview\.content\);/s);
});

test("resolveBrowserWindowOpenTarget only opens requests from the active webview", () => {
  assert.equal(
    resolveBrowserWindowOpenTarget(
      {
        webContentsId: 42,
        url: "example.com/docs",
        disposition: "foreground-tab",
      },
      42,
    ),
    "https://example.com/docs",
  );

  assert.equal(
    resolveBrowserWindowOpenTarget(
      {
        webContentsId: 7,
        url: "example.com/docs",
        disposition: "foreground-tab",
      },
      42,
    ),
    null,
  );
});
