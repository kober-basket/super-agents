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

function hasRuleForSelector(css: string, selector: string, bodyPattern: RegExp) {
  const target = `:root[data-theme="graphite"] ${selector}`;
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(css))) {
    const selectors = match[1]
      .split(",")
      .map((part) => part.trim().replace(/\s+/g, " "));

    if (selectors.includes(target) && bodyPattern.test(match[2])) {
      return true;
    }
  }

  return false;
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

test("dark themes normalize remaining app chrome and detail surfaces", () => {
  const css = readStyles();

  for (const selector of ["input", "textarea"]) {
    assert.equal(
      hasRuleForSelector(css, selector, /background:\s*var\(--input-bg\)/),
      true,
      `${selector} should use the dark input surface`,
    );
  }

  for (const selector of [
    ".chat-model-panel",
    ".composer-card",
    ".question-card",
    ".memory-sidebar",
    ".memory-panel",
    ".memory-entry-row",
    ".memory-modal",
    ".knowledge-sidebar",
    ".skill-card",
    ".workspace-file-preview",
    ".workspace-file-tree",
    ".preview-pane",
    ".file-tile",
    ".browser-instance-tabs",
    ".assistant-settings-stage .provider-detail-card",
    ".model-picker-modal",
    ".mcp-workbench-modal",
    ".mail-auth-request-card",
    ".remote-channel-list",
    ".remote-channel-detail",
  ]) {
    assert.equal(
      hasRuleForSelector(css, selector, /background:\s*var\(--dark-surface-[23]\)/),
      true,
      `${selector} should use a dark app surface`,
    );
  }

  for (const selector of [
    ".secondary-button",
    ".folder-button",
    ".composer-file-chip",
    ".chat-model-option",
    ".question-option",
    ".memory-type-row",
    ".memory-type-row.active",
    ".memory-type-row b",
    ".memory-type-icon",
    ".knowledge-picker-row",
    ".knowledge-base-row",
    ".knowledge-base-row.active",
    ".knowledge-base-count",
    ".model-picker-row",
    ".mail-auth-secondary-action",
    ".workspace-file-search",
    ".remote-channel-select",
    ".remote-channel-select.active",
  ]) {
    assert.equal(
      hasRuleForSelector(css, selector, /background:\s*var\(--control-bg\)|background:\s*var\(--dark-surface-3\)/),
      true,
      `${selector} should use a dark control surface`,
    );
  }
});
