import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { copyTextToClipboard } from "../../src/features/chat/clipboard";

test("message copy uses the Electron clipboard bridge before the browser clipboard", async () => {
  const calls: string[] = [];

  await copyTextToClipboard("hello", {
    desktopAgent: {
      writeClipboardText: async (text: string) => {
        calls.push(`electron:${text}`);
      },
    },
    navigator: {
      clipboard: {
        writeText: async () => {
          throw new Error("browser clipboard should not be used");
        },
      },
    },
  });

  assert.deepEqual(calls, ["electron:hello"]);
});

test("message copy falls back to the browser clipboard when the Electron bridge is unavailable", async () => {
  const calls: string[] = [];

  await copyTextToClipboard("fallback", {
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          calls.push(`browser:${text}`);
        },
      },
    },
  });

  assert.deepEqual(calls, ["browser:fallback"]);
});

test("message copy falls back to the browser clipboard when the Electron bridge rejects", async () => {
  const calls: string[] = [];

  await copyTextToClipboard("retry", {
    desktopAgent: {
      writeClipboardText: async () => {
        throw new Error("electron clipboard failed");
      },
    },
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          calls.push(`browser:${text}`);
        },
      },
    },
  });

  assert.deepEqual(calls, ["browser:retry"]);
});

test("message copy hover target stays reachable while moving from the bubble to the action row", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.message-row:hover\s+\.message-actions/s);
  assert.match(css, /\.message-row\s*{[^}]*position:\s*relative/s);
  assert.match(css, /\.message-row::before\s*{[^}]*bottom:\s*-3[0-9]px/s);
  assert.match(css, /\.message-actions\s*{[^}]*top:\s*calc\(100% \+ 4px\)/s);
  assert.doesNotMatch(css, /\.message-actions\s*{[^}]*bottom:\s*-/s);
  assert.match(css, /\.message-actions::before\s*{[^}]*top:\s*-1[0-9]px[^}]*left:\s*-1[0-9]px/s);
});
