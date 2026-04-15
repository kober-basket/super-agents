import assert from "node:assert/strict";
import test from "node:test";

import { parseChatMessageContent } from "../../src/lib/chat-visuals";

test("parseChatMessageContent extracts mermaid visuals from fenced blocks", () => {
  const parsed = parseChatMessageContent(`
先看一下整体链路。

\`\`\`super-agents-visual
{
  "type": "diagram",
  "style": "mermaid",
  "title": "调用流程",
  "code": "graph TD; User-->API; API-->Worker;"
}
\`\`\`

这张图展示了入口到执行器的关系。
`);

  assert.equal(parsed.text, "先看一下整体链路。\n\n这张图展示了入口到执行器的关系。");
  assert.equal(parsed.visuals.length, 1);
  assert.equal(parsed.visuals[0]?.type, "diagram");
  assert.equal(parsed.visuals[0]?.title, "调用流程");
  assert.equal(parsed.invalidVisualCount, 0);
  assert.equal(parsed.hasPendingVisualBlock, false);
});

test("parseChatMessageContent extracts arrays of visuals", () => {
  const parsed = parseChatMessageContent(`
\`\`\`super-agents-visual
[
  {
    "type": "diagram",
    "style": "mermaid",
    "code": "graph TD; A-->B;"
  },
  {
    "type": "chart",
    "library": "vega-lite",
    "title": "趋势图",
    "spec": {
      "mark": "line",
      "data": {
        "values": [
          { "x": "2026-01", "y": 2 },
          { "x": "2026-02", "y": 5 }
        ]
      },
      "encoding": {
        "x": { "field": "x", "type": "ordinal" },
        "y": { "field": "y", "type": "quantitative" }
      }
    }
  }
]
\`\`\`
`);

  assert.equal(parsed.visuals.length, 2);
  assert.equal(parsed.visuals[0]?.type, "diagram");
  assert.equal(parsed.visuals[1]?.type, "chart");
});

test("parseChatMessageContent hides incomplete visual blocks while streaming", () => {
  const parsed = parseChatMessageContent(`
下面是结构图：

\`\`\`super-agents-visual
{
  "type": "diagram",
  "style": "mermaid",
`);

  assert.equal(parsed.text, "下面是结构图：");
  assert.equal(parsed.visuals.length, 0);
  assert.equal(parsed.hasPendingVisualBlock, true);
});

test("parseChatMessageContent counts invalid visual blocks without crashing", () => {
  const parsed = parseChatMessageContent(`
结论如下。

\`\`\`super-agents-visual
{
  "type": "chart",
  "spec": "not-an-object"
}
\`\`\`
`);

  assert.equal(parsed.visuals.length, 0);
  assert.equal(parsed.invalidVisualCount, 1);
});

