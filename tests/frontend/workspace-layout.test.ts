import assert from "node:assert/strict";
import test from "node:test";

import { resolveRightPanePresentation } from "../../src/lib/workspace-layout";

test("right pane is only available while the chat workspace is active", () => {
  assert.equal(
    resolveRightPanePresentation({ view: "settings", rightPaneOpen: true, viewportWidth: 1600 }),
    "hidden",
  );
  assert.equal(
    resolveRightPanePresentation({ view: "tools", rightPaneOpen: true, viewportWidth: 1600 }),
    "hidden",
  );
  assert.equal(
    resolveRightPanePresentation({ view: "skills", rightPaneOpen: true, viewportWidth: 1600 }),
    "hidden",
  );
});

test("chat right pane stays inline when wide enough for the workspace", () => {
  assert.equal(
    resolveRightPanePresentation({ view: "chat", rightPaneOpen: true, viewportWidth: 1600 }),
    "inline",
  );
});

test("right pane does not cover non-chat workspaces at compact desktop widths", () => {
  assert.equal(
    resolveRightPanePresentation({ view: "settings", rightPaneOpen: true, viewportWidth: 1280 }),
    "hidden",
  );
  assert.equal(
    resolveRightPanePresentation({ view: "tools", rightPaneOpen: true, viewportWidth: 1024 }),
    "hidden",
  );
});

test("chat can still use the right pane as an overlay below the inline breakpoint", () => {
  assert.equal(
    resolveRightPanePresentation({ view: "chat", rightPaneOpen: true, viewportWidth: 1280 }),
    "overlay",
  );
});
