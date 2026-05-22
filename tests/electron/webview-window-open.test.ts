import assert from "node:assert/strict";
import test from "node:test";

import { createWebviewWindowOpenPayload } from "../../electron/webview-window-open";

test("createWebviewWindowOpenPayload keeps tab intent for a valid webview popup", () => {
  assert.deepEqual(
    createWebviewWindowOpenPayload(12, {
      url: " https://example.com/path ",
      disposition: "foreground-tab",
    }),
    {
      webContentsId: 12,
      url: "https://example.com/path",
      disposition: "foreground-tab",
    },
  );
});

test("createWebviewWindowOpenPayload rejects unsafe or incomplete popup targets", () => {
  assert.equal(createWebviewWindowOpenPayload(12, { url: "" }), null);
  assert.equal(createWebviewWindowOpenPayload(12, { url: "javascript:alert(1)" }), null);
});
