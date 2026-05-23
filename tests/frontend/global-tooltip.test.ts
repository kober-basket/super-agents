import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  computeTooltipPosition,
  readTooltipLabel,
  type TooltipCandidateElement,
} from "../../src/features/shared/HoverTooltipLayer";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

function candidate(attributes: Record<string, string | undefined>): TooltipCandidateElement {
  return {
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
  };
}

test("global tooltip only shows explicit tooltip labels", () => {
  assert.equal(readTooltipLabel(candidate({ "data-tooltip": "刷新列表", title: "系统标题" })), "刷新列表");
  assert.equal(readTooltipLabel(candidate({ title: "  打开当前工作目录  " })), null);
  assert.equal(readTooltipLabel(candidate({ "aria-label": "删除会话" })), null);
  assert.equal(readTooltipLabel(candidate({ "aria-label": "文件路径" })), null);
  assert.equal(readTooltipLabel(candidate({ "data-tooltip": "   " })), null);
});

test("global tooltip positions above controls and clamps inside the viewport", () => {
  assert.deepEqual(
    computeTooltipPosition(
      { left: 260, right: 300, top: 180, bottom: 214, width: 40, height: 34 },
      { width: 640, height: 480 },
      { width: 160, height: 38 },
    ),
    { x: 200, y: 132, placement: "top" },
  );

  assert.deepEqual(
    computeTooltipPosition(
      { left: 8, right: 42, top: 10, bottom: 44, width: 34, height: 34 },
      { width: 320, height: 220 },
      { width: 180, height: 42 },
    ),
    { x: 12, y: 54, placement: "bottom" },
  );
});

test("app mounts a styled global tooltip layer", () => {
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");

  assert.match(appSource, /HoverTooltipLayer/);
  assert.match(css, /\.app-tooltip\s*{[^}]*position:\s*fixed;[^}]*z-index:\s*12000;[^}]*backdrop-filter:\s*blur\(18px\)/s);
  assert.match(css, /\.app-tooltip-arrow\s*{/);
  assert.match(css, /\.app-tooltip\[data-placement="bottom"\]\s+\.app-tooltip-arrow/s);
  assert.match(css, /@media\s+\(prefers-reduced-motion:\s*reduce\)/);
});
