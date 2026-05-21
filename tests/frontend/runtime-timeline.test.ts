import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeTimelineRenderItems,
  buildRuntimeLiveRenderItems,
  formatRuntimeTraceDuration,
  isStreamingTimelineThoughtItem,
  runtimeActivityRenderMode,
  runtimeTraceGroupSummaryLabel,
  shouldRenderRuntimeStateBlocks,
  shouldAutoScrollReasoningContent,
  shouldRenderLiveThinkingPlaceholder,
  shouldOpenRuntimeTraceGroup,
  shouldShowRuntimeThinkingIndicator,
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

test("runtime live render items preserve message and tool order", () => {
  const renderItems = buildRuntimeLiveRenderItems(
    [
      { id: "m1", timestamp: 1, type: "message_delta", text: "First. " },
      { id: "tool-a-start", timestamp: 2, type: "tool_call_started", toolCallId: "tool-a" },
      { id: "m2", timestamp: 3, type: "message_delta", text: "Second. " },
      { id: "m3", timestamp: 4, type: "message_delta", text: "More." },
      { id: "tool-b-start", timestamp: 5, type: "tool_call_started", toolCallId: "tool-b" },
    ],
    [toolCall("tool-a"), toolCall("tool-b")],
  );

  assert.deepEqual(renderItems, [
    { id: "live-text-m1", type: "text", text: "First. " },
    { id: "live-tool-tool-a", type: "tool", toolCallId: "tool-a" },
    { id: "live-text-m2", type: "text", text: "Second. More." },
    { id: "live-tool-tool-b", type: "tool", toolCallId: "tool-b" },
  ]);
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

test("runtime trace group stays open while streaming provisional assistant text", () => {
  assert.equal(shouldOpenRuntimeTraceGroup({ isStreaming: true, hasAssistantText: true }), true);
  assert.equal(shouldOpenRuntimeTraceGroup({ isStreaming: true, hasAssistantText: false }), true);
  assert.equal(shouldOpenRuntimeTraceGroup({ isStreaming: false, hasAssistantText: true }), false);
});

test("runtime activity renders live outside the trace group until the turn is committed", () => {
  assert.equal(runtimeActivityRenderMode({ blockCount: 0, isStreaming: true }), "hidden");
  assert.equal(runtimeActivityRenderMode({ blockCount: 2, isStreaming: true }), "live");
  assert.equal(runtimeActivityRenderMode({ blockCount: 2, isStreaming: false }), "trace");
});

test("completed runtime state does not render loose tool cards before persisted trace arrives", () => {
  assert.equal(shouldRenderRuntimeStateBlocks({ isStreaming: true, hasPersistedTrace: false }), true);
  assert.equal(shouldRenderRuntimeStateBlocks({ isStreaming: true, hasPersistedTrace: true }), true);
  assert.equal(shouldRenderRuntimeStateBlocks({ isStreaming: false, hasPersistedTrace: true }), false);
  assert.equal(shouldRenderRuntimeStateBlocks({ isStreaming: false, hasPersistedTrace: false }), false);
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

test("runtime thinking indicator hides once assistant text is streaming", () => {
  assert.equal(
    shouldShowRuntimeThinkingIndicator({
      isStreaming: true,
      isThinking: true,
      hasAssistantText: false,
    }),
    true,
  );
  assert.equal(
    shouldShowRuntimeThinkingIndicator({
      isStreaming: true,
      isThinking: true,
      hasAssistantText: true,
    }),
    false,
  );
  assert.equal(
    shouldShowRuntimeThinkingIndicator({
      isStreaming: false,
      isThinking: true,
      hasAssistantText: false,
    }),
    false,
  );
});

test("live runtime shows thinking placeholder before text or tools arrive", () => {
  assert.equal(
    shouldRenderLiveThinkingPlaceholder({
      blockCount: 0,
      hasAssistantText: false,
      isStreaming: true,
    }),
    true,
  );
  assert.equal(
    shouldRenderLiveThinkingPlaceholder({
      blockCount: 1,
      hasAssistantText: false,
      isStreaming: true,
    }),
    false,
  );
  assert.equal(
    shouldRenderLiveThinkingPlaceholder({
      blockCount: 0,
      hasAssistantText: true,
      isStreaming: true,
    }),
    false,
  );
  assert.equal(
    shouldRenderLiveThinkingPlaceholder({
      blockCount: 0,
      hasAssistantText: false,
      isStreaming: false,
    }),
    false,
  );
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

test("runtime tool summary keeps tool names readable before truncating details", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.activity-summary-title\s+strong\s*{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /\.activity-summary-title\s+em\s*{[^}]*flex:\s*1 1 auto/s);
});

test("runtime status markdown stays compact inside the process timeline", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.runtime-status-line\s+h1,\s*\.runtime-status-line\s+h2,\s*\.runtime-status-line\s+h3\s*{[^}]*font-size:\s*var\(--chat-content-font-size\)/s);
  assert.match(css, /\.runtime-status-line\s+table\s*{[^}]*font-size:\s*12px/s);
});

test("runtime status markdown uses the same inline typography as assistant messages", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.runtime-status-line\s+strong\s*{[^}]*font-weight:\s*var\(--font-weight-semibold\)/s);
  assert.match(css, /\.runtime-status-line\s+code\s*{[^}]*font-family:\s*"JetBrains Mono"/s);
});

test("assistant message tables inherit the surrounding message type scale", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.message-text\s+table\s*{[^}]*font-size:\s*inherit/s);
  assert.match(css, /\.message-text\s+table\s*{[^}]*line-height:\s*inherit/s);
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
