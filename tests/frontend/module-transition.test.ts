import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

test("app warms lazy module chunks before the first sidebar switch", () => {
  const source = readSource("src/App.tsx");

  assert.match(source, /function preloadLazyViews\(\)/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /void loadSkillsView\(\);/);
  assert.match(source, /void loadToolsView\(\);/);
  assert.match(source, /void loadMemoryView\(\);/);
  assert.match(source, /void loadKnowledgeView\(\);/);
});

test("workspace module switches use an accessible transition shell", () => {
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");
  const moduleEnterBody = css.match(/@keyframes workspace-module-enter\s*{(?<body>[\s\S]*?)\n}/)?.groups?.body ?? "";

  assert.match(appSource, /const workspaceTransitionKey = view === "settings"/);
  assert.match(appSource, /className="workspace-view-transition"/);
  assert.match(appSource, /key=\{workspaceTransitionKey\}/);
  assert.match(css, /\.workspace-view-transition\s*{[^}]*animation:\s*workspace-module-enter/s);
  assert.match(css, /@keyframes workspace-module-enter/);
  assert.doesNotMatch(moduleEnterBody, /transform:/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.workspace-view-transition\s*{[^}]*animation:\s*none/s,
  );
});
