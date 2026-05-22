import assert from "node:assert/strict";
import test from "node:test";

import {
  readBrowserWebviewNavigationState,
  resolveBrowserWindowOpenTarget,
  shouldActivateBrowserWindowOpenTarget,
} from "../../src/lib/webview-navigation";

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
