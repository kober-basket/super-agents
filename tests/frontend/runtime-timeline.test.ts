import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeTimelineRenderItems,
  formatRuntimeTraceDuration,
  isStreamingTimelineThoughtItem,
  runtimeTraceGroupSummaryLabel,
  shouldAutoScrollReasoningContent,
  shouldOpenRuntimeTraceGroup,
  sanitizeTimelineStatusText,
} from "../../src/lib/runtime-timeline";
import type { ChatRuntimeTimelineItem, ChatToolCall } from "../../src/types";

function toolCall(toolCallId: string): ChatToolCall {
  return {
    toolCallId,
    title: toolCallId,
    status: "completed",
    content: [{ type: "text", text: `${toolCallId} output` }],
  };
}

test("runtime timeline render items include tool calls missing from the stored timeline", () => {
  const timelineItems: ChatRuntimeTimelineItem[] = [
    { id: "thought-1", type: "thought", text: "Before. " },
    { id: "tool-a", type: "tool", toolCallId: "tool-a" },
  ];

  const renderItems = buildRuntimeTimelineRenderItems(timelineItems, [
    toolCall("tool-a"),
    toolCall("tool-b"),
  ]);

  assert.deepEqual(
    renderItems.map((item) => (item.type === "tool" ? item.toolCallId : item.type)),
    ["thought", "tool-a", "tool-b"],
  );
});

test("runtime timeline render items omit activity summary rows", () => {
  const timelineItems: ChatRuntimeTimelineItem[] = [
    { id: "thought-1", type: "thought", text: "Before. " },
    {
      id: "activity-exploration",
      type: "activity",
      activity: {
        id: "exploration",
        kind: "exploration",
        text: "已探索 1 次搜索",
        status: "completed",
        searchCount: 1,
      },
    },
    { id: "tool-a", type: "tool", toolCallId: "tool-a" },
  ];

  const renderItems = buildRuntimeTimelineRenderItems(timelineItems, [toolCall("tool-a")]);

  assert.deepEqual(
    renderItems.map((item) => (item.type === "tool" ? item.toolCallId : item.type)),
    ["thought", "tool-a"],
  );
});

test("only the latest timeline thought previews while streaming", () => {
  const timelineItems: ChatRuntimeTimelineItem[] = [
    { id: "thought-1", type: "thought", text: "Before tool. " },
    { id: "tool-a", type: "tool", toolCallId: "tool-a" },
    { id: "thought-2", type: "thought", text: "Current thought. " },
  ];

  assert.equal(isStreamingTimelineThoughtItem(timelineItems, 0, true), false);
  assert.equal(isStreamingTimelineThoughtItem(timelineItems, 2, true), true);
  assert.equal(isStreamingTimelineThoughtItem(timelineItems, 2, false), false);
});

test("runtime trace group opens only while the turn is active", () => {
  assert.equal(shouldOpenRuntimeTraceGroup(true), true);
  assert.equal(shouldOpenRuntimeTraceGroup(false), false);
  assert.equal(shouldOpenRuntimeTraceGroup(undefined), false);
});

test("runtime trace group label follows active and failed states", () => {
  assert.equal(runtimeTraceGroupSummaryLabel({ isStreaming: true }), "处理中");
  assert.equal(runtimeTraceGroupSummaryLabel({ isStreaming: false }), "已处理");
  assert.equal(runtimeTraceGroupSummaryLabel({ isStreaming: false, hasError: true }), "执行失败");
  assert.equal(runtimeTraceGroupSummaryLabel({ isStreaming: true, durationMs: 65_000 }), "处理中 1m 5s");
  assert.equal(runtimeTraceGroupSummaryLabel({ isStreaming: false, durationMs: 3_000 }), "已处理 0m 3s");
});

test("runtime trace duration uses minute and second labels", () => {
  assert.equal(formatRuntimeTraceDuration(0), "0m 0s");
  assert.equal(formatRuntimeTraceDuration(119_900), "1m 59s");
});

test("reasoning content auto-scrolls only while it is open and streaming", () => {
  assert.equal(shouldAutoScrollReasoningContent({ isOpen: true, isStreaming: true }), true);
  assert.equal(shouldAutoScrollReasoningContent({ isOpen: false, isStreaming: true }), false);
  assert.equal(shouldAutoScrollReasoningContent({ isOpen: true, isStreaming: false }), false);
});

test("timeline reasoning aligns its label and content with message text", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.timeline-reasoning-block\s+\.reasoning-dot\s*{[^}]*position:\s*static/s);
  assert.match(css, /\.timeline-reasoning-block\s+\.reasoning-dot\s*{[^}]*left:\s*auto/s);
  assert.match(css, /\.timeline-reasoning-block\s+\.reasoning-trigger\s*{[^}]*padding:\s*4px 0/s);
  assert.match(css, /\.timeline-reasoning-block\s+\.reasoning-content\s*{[^}]*padding:\s*2px 0 10px 26px/s);
});

test("streaming reasoning preview is capped to three scrollable lines", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.streaming-reasoning-preview\.open\s+\.reasoning-content\s+pre\s*{[^}]*max-height:\s*calc\(1\.55em \* 3\)/s);
  assert.match(css, /\.streaming-reasoning-preview\.open\s+\.reasoning-content\s+pre\s*{[^}]*overflow-y:\s*auto/s);
});

test("open reasoning content is capped to short scrollable content", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.reasoning-block\.open\s+\.reasoning-content\s+pre\s*{[^}]*max-height:\s*calc\(1\.55em \* 3\)/s);
  assert.match(css, /\.reasoning-block\.open\s+\.reasoning-content\s+pre\s*{[^}]*overflow-y:\s*auto/s);
});

test("open timeline reasoning keeps the same transparent shell as collapsed reasoning", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.timeline-reasoning-block\.open\s*{[^}]*background:\s*transparent/s);
  assert.match(css, /\.timeline-reasoning-block\.open\s+\.reasoning-trigger\s*{[^}]*width:\s*auto/s);
  assert.match(css, /\.timeline-reasoning-block\.open\s+\.reasoning-trigger\s*{[^}]*padding:\s*4px 0/s);
});

test("dark themes keep reasoning blocks transparent", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /:root\[data-theme="graphite"\]\s+\.reasoning-block,\s*:root\[data-theme="dusk"\]\s+\.reasoning-block,\s*:root\[data-theme="midnight"\]\s+\.reasoning-block,\s*:root\[data-theme="ember"\]\s+\.reasoning-block\s*{[^}]*background:\s*transparent/s);
  assert.match(css, /:root\[data-theme="graphite"\]\s+\.reasoning-block,\s*:root\[data-theme="dusk"\]\s+\.reasoning-block,\s*:root\[data-theme="midnight"\]\s+\.reasoning-block,\s*:root\[data-theme="ember"\]\s+\.reasoning-block\s*{[^}]*box-shadow:\s*none/s);
});

test("internal duplicate tool status lines are hidden from timeline rendering", () => {
  assert.equal(
    sanitizeTimelineStatusText('Skipped duplicate tool call "read"; reused the previous result.\n'),
    "",
  );
  assert.equal(
    sanitizeTimelineStatusText(
      [
        'Skipped duplicate tool call "read"; reused the previous result.',
        "我已经读取了关键文件。",
        'Skipped duplicate tool call "grep"; reused the previous result.',
      ].join("\n"),
    ),
    "我已经读取了关键文件。",
  );
});
