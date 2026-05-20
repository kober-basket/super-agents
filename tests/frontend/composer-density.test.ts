import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readStyles() {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");

  return readFileSync(cssPath, "utf8");
}

test("chat composer uses a compact default height on home and thread pages", () => {
  const css = readStyles();

  assert.match(css, /\.chat-composer-card\s*{[^}]*gap:\s*8px/s);
  assert.match(css, /\.chat-composer-card\s*{[^}]*padding:\s*10px 14px/s);
  assert.match(css, /\.composer-rich-input\s*{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.composer-rich-input\s*{[^}]*max-height:\s*96px/s);
  assert.match(css, /\.chat-voice-button,\s*\.chat-send-button\s*{[^}]*width:\s*36px[^}]*height:\s*36px/s);
});
