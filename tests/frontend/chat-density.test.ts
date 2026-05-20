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

test("assistant markdown content uses compact transcript heading sizes", () => {
  const css = readStyles();

  assert.match(css, /\.message-text\s+h1\s*{[^}]*font-size:\s*18px/s);
  assert.match(css, /\.message-text\s+h2\s*{[^}]*font-size:\s*16px/s);
  assert.match(css, /\.message-text\s+h3\s*{[^}]*font-size:\s*14px/s);
  assert.doesNotMatch(css, /\.message-text\s+h1\s*{[^}]*font-size:\s*2em/s);
});

test("chat transcript spacing is tighter for work logs", () => {
  const css = readStyles();

  assert.match(css, /\.message-list\s*{[^}]*gap:\s*14px/s);
  assert.match(css, /\.message-bubble\s*{[^}]*gap:\s*8px/s);
  assert.match(css, /\.activity-summary\s*{[^}]*padding:\s*6px 8px/s);
});
