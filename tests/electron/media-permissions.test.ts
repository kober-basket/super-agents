import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedDesktopOrigin } from "../../electron/media-permissions";

test("media permission trusts local desktop app URLs with paths", () => {
  assert.equal(isTrustedDesktopOrigin("http://localhost:5173/"), true);
  assert.equal(isTrustedDesktopOrigin("http://localhost:5173/index.html"), true);
  assert.equal(isTrustedDesktopOrigin("http://127.0.0.1:5173/?v=1"), true);
  assert.equal(isTrustedDesktopOrigin("file:///F:/work/github/super-agents/dist/index.html"), true);
});

test("media permission rejects non-local URLs", () => {
  assert.equal(isTrustedDesktopOrigin("https://example.com"), false);
  assert.equal(isTrustedDesktopOrigin("http://192.168.1.10:5173"), false);
});
