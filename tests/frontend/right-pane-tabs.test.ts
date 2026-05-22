import assert from "node:assert/strict";
import test from "node:test";

import {
  closeRightPaneTab,
  createBrowserRightPaneTab,
  createFileSystemRightPaneTab,
  createPreviewRightPaneTab,
  createTerminalRightPaneTab,
  hasBrowserRightPaneTab,
  RIGHT_BROWSER_TAB_ID,
  rightPaneTabTargetKey,
  upsertRightPaneTab,
  type RightPaneTab,
} from "../../src/lib/right-pane-tabs";
import type { FilePreviewPayload } from "../../src/types";

function preview(patch: Partial<FilePreviewPayload>): FilePreviewPayload {
  return {
    title: "Preview",
    path: null,
    kind: "text",
    mimeType: "text/plain",
    content: "",
    ...patch,
  };
}

test("rightPaneTabTargetKey groups browser tabs by normalized URL", () => {
  assert.equal(
    rightPaneTabTargetKey(preview({ kind: "web", url: "https://example.com/docs", path: "https://example.com/docs" })),
    "web:https://example.com/docs",
  );
});

test("upsertRightPaneTab focuses an existing tab for the same target", () => {
  const existing: RightPaneTab = {
    ...createPreviewRightPaneTab("tab-1", preview({ title: "Example", kind: "web", url: "https://example.com" })),
  };

  const result = upsertRightPaneTab(
    [existing],
    createPreviewRightPaneTab("tab-2", preview({ title: "Example updated", kind: "web", url: "https://example.com" })),
  );

  assert.equal(result.activeTabId, "tab-1");
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabs[0]?.title, "Example updated");
});

test("upsertRightPaneTab opens a new tab for a different file target", () => {
  const result = upsertRightPaneTab(
    [
      {
        ...createPreviewRightPaneTab("tab-1", preview({ title: "app.ts", kind: "code", path: "F:\\work\\app.ts" })),
      },
    ],
    createPreviewRightPaneTab("tab-2", preview({ title: "desktop.png", kind: "image", path: "F:\\work\\desktop.png" })),
  );

  assert.equal(result.activeTabId, "tab-2");
  assert.deepEqual(result.tabs.map((tab) => tab.id), ["tab-1", "tab-2"]);
});

test("closeRightPaneTab selects the next available neighbor", () => {
  const tabs: RightPaneTab[] = [
    createPreviewRightPaneTab("tab-1", preview({ title: "One" })),
    createPreviewRightPaneTab("tab-2", preview({ title: "Two" })),
    createPreviewRightPaneTab("tab-3", preview({ title: "Three" })),
  ];

  const result = closeRightPaneTab(tabs, "tab-2", "tab-2");

  assert.equal(result.activeTabId, "tab-3");
  assert.deepEqual(result.tabs.map((tab) => tab.id), ["tab-1", "tab-3"]);
});

test("file system tab is permanent and cannot be closed", () => {
  const files = createFileSystemRightPaneTab();
  const browser = createBrowserRightPaneTab("tab-browser");

  const result = closeRightPaneTab([files, browser], files.id, files.id);

  assert.equal(result.activeTabId, files.id);
  assert.deepEqual(result.tabs.map((tab) => tab.id), [files.id, browser.id]);
});

test("factory helpers create distinct browser and terminal instances", () => {
  const browser = createBrowserRightPaneTab();
  const terminal = createTerminalRightPaneTab("tab-terminal");

  assert.equal(browser.kind, "browser");
  assert.equal(browser.id, RIGHT_BROWSER_TAB_ID);
  assert.equal(browser.browserTabs.length, 1);
  assert.equal(hasBrowserRightPaneTab([createFileSystemRightPaneTab(), browser]), true);
  assert.equal(terminal.kind, "terminal");
  assert.equal(terminal.title, "终端");
});
