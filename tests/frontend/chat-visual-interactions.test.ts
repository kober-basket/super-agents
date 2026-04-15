import assert from "node:assert/strict";
import test from "node:test";

import { buildVisualFollowUpPrompt, summarizeSelectionDetails } from "../../src/lib/chat-visual-interactions";

test("summarizeSelectionDetails compacts scalar detail fields", () => {
  const summary = summarizeSelectionDetails({
    month: "2026-04",
    revenue: 182.4,
    flagged: true,
    nested: { ignored: true },
  });

  assert.equal(summary, "month: 2026-04, revenue: 182.4, flagged: true");
});

test("buildVisualFollowUpPrompt uses chart selection context", () => {
  const prompt = buildVisualFollowUpPrompt(
    {
      id: "vis-1",
      type: "chart",
      library: "vega-lite",
      title: "Monthly revenue trend",
      spec: {},
    },
    {
      kind: "chart-datum",
      label: "April 2026",
      details: {
        revenue: 182.4,
        region: "North America",
      },
    },
  );

  assert.match(prompt, /Monthly revenue trend/);
  assert.match(prompt, /April 2026/);
  assert.match(prompt, /revenue: 182.4/);
});

test("buildVisualFollowUpPrompt falls back when nothing is selected", () => {
  const prompt = buildVisualFollowUpPrompt({
    id: "vis-2",
    type: "diagram",
    style: "mermaid",
    title: "Deployment flow",
    code: "graph TD; A-->B;",
  });

  assert.match(prompt, /Deployment flow/);
  assert.match(prompt, /dependencies|flow/i);
});

