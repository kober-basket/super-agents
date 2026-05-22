import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RightWorkspacePane } from "../../src/features/chat/RightWorkspacePane";
import {
  createBrowserRightPaneTab,
  createFileSystemRightPaneTab,
} from "../../src/lib/right-pane-tabs";

test("right workspace pane renders tabs and global pane controls", () => {
  const html = renderToStaticMarkup(
    <RightWorkspacePane
      activeTabId="tab-browser"
      canCreateBrowserTab={false}
      tabs={[
        createFileSystemRightPaneTab(),
        createBrowserRightPaneTab("tab-browser"),
      ]}
      onCloseTab={() => undefined}
      onCreateBrowserTab={() => undefined}
      onCreateTerminalTab={() => undefined}
      onSelectTab={() => undefined}
      renderTabContent={(tab) => <div className="mock-tab-content">{tab.title}</div>}
    />,
  );

  assert.match(html, /role="tablist"/);
  assert.match(html, /文件/);
  assert.match(html, /浏览器/);
  assert.match(html, /aria-label="新建右侧栏项目"/);
  assert.doesNotMatch(html, /aria-label="新建浏览器实例"/);
  assert.doesNotMatch(html, /aria-label="新建终端实例"/);
  assert.doesNotMatch(html, /preview-head/);
});

test("right workspace pane does not render a close button for the permanent file tab", () => {
  const html = renderToStaticMarkup(
    <RightWorkspacePane
      activeTabId="right-files"
      canCreateBrowserTab
      tabs={[createFileSystemRightPaneTab()]}
      onCloseTab={() => undefined}
      onCreateBrowserTab={() => undefined}
      onCreateTerminalTab={() => undefined}
      onSelectTab={() => undefined}
      renderTabContent={(tab) => <div>{tab.title}</div>}
    />,
  );

  assert.doesNotMatch(html, /关闭 文件/);
});
