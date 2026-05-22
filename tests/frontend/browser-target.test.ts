import assert from "node:assert/strict";
import test from "node:test";

import { BROWSER_HOME_URL, buildBrowserPreview, normalizeBrowserAddress } from "../../src/lib/browser-target";

test("browser home defaults to Bing", () => {
  assert.equal(BROWSER_HOME_URL, "https://www.bing.com/");
  assert.equal(normalizeBrowserAddress(""), "https://www.bing.com/");
});

test("normalizeBrowserAddress keeps absolute web URLs", () => {
  assert.equal(normalizeBrowserAddress("https://example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeBrowserAddress("http://example.com/docs"), "http://example.com/docs");
});

test("normalizeBrowserAddress expands localhost targets", () => {
  assert.equal(normalizeBrowserAddress("localhost:4173"), "http://localhost:4173");
  assert.equal(normalizeBrowserAddress("127.0.0.1:5173/index.html"), "http://127.0.0.1:5173/index.html");
});

test("normalizeBrowserAddress turns search text into a browser search", () => {
  assert.equal(
    normalizeBrowserAddress("electron webview automation"),
    "https://www.bing.com/search?q=electron%20webview%20automation",
  );
});

test("normalizeBrowserAddress converts Windows file paths to file URLs", () => {
  assert.equal(
    normalizeBrowserAddress("F:\\work\\github\\super-agents\\index.html"),
    "file:///F:/work/github/super-agents/index.html",
  );
});

test("buildBrowserPreview creates a right-pane web preview without fetching", () => {
  const preview = buildBrowserPreview("example.com/docs");

  assert.equal(preview.kind, "web");
  assert.equal(preview.url, "https://example.com/docs");
  assert.equal(preview.path, "https://example.com/docs");
  assert.equal(preview.loading, false);
});
