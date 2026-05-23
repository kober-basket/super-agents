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

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("chat model picker options use single-line restrained selection styling", () => {
  const css = readStyles();
  const workspaceSource = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(workspaceSource, /className="chat-model-option-name"/);
  assert.match(workspaceSource, /className="chat-model-option-provider"/);
  assert.doesNotMatch(workspaceSource, /chat-model-option-check/);
  assert.doesNotMatch(css, /\.chat-model-option-check/);
  assert.match(css, /\.chat-model-panel\s*{[^}]*width:\s*min\(300px,\s*calc\(100vw - 40px\)\)/s);
  assert.match(
    css,
    /\.chat-model-option\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto[^}]*min-height:\s*44px/s,
  );
  assert.match(css, /\.chat-model-option\.selected\s*{[^}]*border-color:\s*rgba\(var\(--accent-rgb\),\s*0\.34\)/s);
  assert.match(css, /\.chat-model-option-name\s*{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.chat-model-option-provider\s*{[^}]*justify-self:\s*end[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.chat-model-option-provider\s*{[^}]*padding:\s*3px\s+8px/s);
  assert.match(css, /\.chat-model-option-provider\s*{[^}]*border-radius:\s*999px/s);
  assert.match(css, /\.chat-model-option-provider\s*{[^}]*background:\s*rgba\(100,\s*116,\s*139,\s*0\.1\)/s);
});
