import assert from "node:assert/strict";
import test from "node:test";

import { chooseFloatingTooltipPlacement } from "../../src/lib/tooltip-placement";

test("tooltip placement defaults below when there is enough space", () => {
  assert.equal(
    chooseFloatingTooltipPlacement({
      anchorBottom: 220,
      anchorTop: 200,
      tooltipHeight: 120,
      viewportHeight: 600,
    }),
    "bottom",
  );
});

test("tooltip placement flips above when the bottom space is tight", () => {
  assert.equal(
    chooseFloatingTooltipPlacement({
      anchorBottom: 560,
      anchorTop: 540,
      tooltipHeight: 160,
      viewportHeight: 600,
    }),
    "top",
  );
});

test("tooltip placement uses the larger side when neither side fully fits", () => {
  assert.equal(
    chooseFloatingTooltipPlacement({
      anchorBottom: 320,
      anchorTop: 300,
      tooltipHeight: 360,
      viewportHeight: 500,
    }),
    "top",
  );
});

test("tooltip placement treats the message list bottom as the usable boundary", () => {
  assert.equal(
    chooseFloatingTooltipPlacement({
      anchorBottom: 330,
      anchorTop: 310,
      tooltipHeight: 220,
      viewportHeight: 720,
      boundaryBottom: 520,
    } as Parameters<typeof chooseFloatingTooltipPlacement>[0] & { boundaryBottom: number }),
    "top",
  );
});
