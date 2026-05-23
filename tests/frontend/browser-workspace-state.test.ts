import assert from "node:assert/strict";
import test from "node:test";

import {
  restoreBrowserWorkspaceTab,
  serializeBrowserWorkspaceTab,
} from "../../src/lib/browser-workspace-state";
import { createBrowserRightPaneTab } from "../../src/lib/right-pane-tabs";

test("serializeBrowserWorkspaceTab stores normalized page state without transient loading", () => {
  const tab = createBrowserRightPaneTab("right-browser", "example.com/docs");
  const page = tab.browserTabs[0]!;
  page.preview.title = "Example Docs";
  page.preview.loading = true;

  const parsed = JSON.parse(serializeBrowserWorkspaceTab(tab));

  assert.equal(parsed.version, 1);
  assert.equal(parsed.activePageId, page.id);
  assert.deepEqual(parsed.pages, [
    {
      id: page.id,
      title: "Example Docs",
      url: "https://example.com/docs",
    },
  ]);
});

test("restoreBrowserWorkspaceTab rebuilds a browser tab from saved pages", () => {
  const restored = restoreBrowserWorkspaceTab(
    JSON.stringify({
      version: 1,
      activePageId: "page-2",
      pages: [
        { id: "page-1", title: "One", url: "https://one.example/" },
        { id: "page-2", title: "Two", url: "two.example/path" },
      ],
    }),
  );

  assert.equal(restored.kind, "browser");
  assert.equal(restored.activeBrowserTabId, "page-2");
  assert.deepEqual(
    restored.browserTabs.map((page) => ({
      id: page.id,
      title: page.preview.title,
      url: page.preview.url,
      loading: page.preview.loading,
    })),
    [
      { id: "page-1", title: "One", url: "https://one.example/", loading: false },
      { id: "page-2", title: "Two", url: "https://two.example/path", loading: false },
    ],
  );
});

test("restoreBrowserWorkspaceTab falls back when saved state is missing or invalid", () => {
  assert.equal(restoreBrowserWorkspaceTab(null).browserTabs[0]?.preview.url, "https://www.bing.com/");
  assert.equal(restoreBrowserWorkspaceTab("{bad json").browserTabs[0]?.preview.url, "https://www.bing.com/");
  assert.equal(
    restoreBrowserWorkspaceTab(JSON.stringify({ version: 1, activePageId: "", pages: [] })).browserTabs[0]?.preview.url,
    "https://www.bing.com/",
  );
});
