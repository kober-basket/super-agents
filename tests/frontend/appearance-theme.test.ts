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

test("harbor theme uses a softer mist-blue palette", () => {
  const css = readStyles();
  const harborTheme = css.match(/:root\[data-theme="harbor"\]\s*{(?<body>[^}]+)}/)?.groups?.body ?? "";

  assert.match(harborTheme, /--window:\s*#edf3f7;/);
  assert.match(harborTheme, /--sidebar:\s*#e6eef4;/);
  assert.match(harborTheme, /--panel:\s*#fbfdff;/);
  assert.match(harborTheme, /--line:\s*#d5e0ea;/);
  assert.match(harborTheme, /--accent:\s*#687f96;/);
  assert.doesNotMatch(harborTheme, /--window:\s*#dbe3eb;/);
});

test("assistant model settings soften hard region boundaries", () => {
  const css = readStyles();

  assert.match(
    css,
    /\.assistant-settings-stage\s+\.provider-detail-card\s*{[^}]*background:\s*rgba\(255, 255, 255, 0\.78\)/s,
  );
  assert.match(
    css,
    /\.assistant-settings-stage\s+\.provider-nav-card\s*{[^}]*border-color:\s*rgba\(var\(--accent-rgb\), 0\.1\)/s,
  );
  assert.match(
    css,
    /\.assistant-settings-stage\s+\.model-picker-row\s*{[^}]*background:\s*rgba\(255, 255, 255, 0\.54\)/s,
  );
  assert.match(
    css,
    /\.assistant-settings-stage\s+\.model-capability-tag\.tools\s*{[^}]*background:\s*rgba\(191, 117, 73, 0\.12\)/s,
  );
  assert.match(
    css,
    /button:focus-visible\s*{[^}]*outline:\s*2px solid rgba\(var\(--accent-rgb\), 0\.24\)/s,
  );
});
