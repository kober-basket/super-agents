import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { copyTextToClipboard } from "../../src/features/chat/clipboard";
import { buildConversationCopyMarkdown } from "../../src/features/chat/conversation-markdown";

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

test("conversation copy markdown includes title metadata and messages", () => {
  const markdown = buildConversationCopyMarkdown({
    id: "conversation-1",
    title: "需求整理",
    createdAt: Date.UTC(2026, 4, 20, 8, 0, 0),
    updatedAt: Date.UTC(2026, 4, 20, 8, 2, 0),
    lastMessageAt: Date.UTC(2026, 4, 20, 8, 2, 0),
    preview: "",
    messageCount: 2,
    workspaceRoot: "/tmp/super-agents-chat",
    selectedKnowledgeBaseIds: [],
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "帮我总结一下",
        createdAt: Date.UTC(2026, 4, 20, 8, 0, 0),
        updatedAt: Date.UTC(2026, 4, 20, 8, 0, 0),
      },
      {
        id: "message-2",
        role: "assistant",
        content: "当然可以。",
        createdAt: Date.UTC(2026, 4, 20, 8, 1, 0),
        updatedAt: Date.UTC(2026, 4, 20, 8, 1, 0),
      },
    ],
  });

  assert.match(markdown, /^# 需求整理/m);
  assert.match(markdown, /创建时间：2026-05-20 08:00/);
  assert.match(markdown, /消息数：2/);
  assert.match(markdown, /## 用户 · 2026-05-20 08:00/);
  assert.match(markdown, /帮我总结一下/);
  assert.match(markdown, /## Agent · 2026-05-20 08:01/);
  assert.match(markdown, /当然可以。/);
});

test("conversation copy markdown includes assistant runtime tool commands and output", () => {
  const markdown = buildConversationCopyMarkdown({
    id: "conversation-1",
    title: "执行记录",
    createdAt: Date.UTC(2026, 4, 20, 8, 0, 0),
    updatedAt: Date.UTC(2026, 4, 20, 8, 2, 0),
    lastMessageAt: Date.UTC(2026, 4, 20, 8, 2, 0),
    preview: "",
    messageCount: 1,
    workspaceRoot: "/tmp/super-agents-chat",
    selectedKnowledgeBaseIds: [],
    messages: [
      {
        id: "message-1",
        role: "assistant",
        content: "我运行了测试。",
        createdAt: Date.UTC(2026, 4, 20, 8, 1, 0),
        updatedAt: Date.UTC(2026, 4, 20, 8, 1, 0),
        runtimeTrace: {
          events: [],
          activityItems: [],
          timelineItems: [
            { id: "status-1", type: "status", text: "准备运行测试。" },
            { id: "tool-1", type: "tool", toolCallId: "tool-bash" },
          ],
          planEntries: [],
          toolCalls: [
            {
              toolCallId: "tool-bash",
              title: "bash",
              status: "completed",
              kind: "other",
              content: [{ type: "text", text: "ok\n1 test passed" }],
              rawInputJson: JSON.stringify({
                command: "npm run test:electron",
                description: "运行测试",
              }),
            },
            {
              toolCallId: "tool-question",
              title: "question",
              status: "cancelled",
              kind: "other",
              content: [{ type: "text", text: "Question cancelled: User cancelled question." }],
            },
          ],
          terminalOutputs: {},
          thoughtText: "",
        },
      },
    ],
  });

  assert.match(markdown, /### 执行过程/);
  assert.match(markdown, /准备运行测试。/);
  assert.match(markdown, /#### bash · 完成/);
  assert.match(markdown, /#### question · 取消/);
  assert.doesNotMatch(markdown, /已取消/);
  assert.match(markdown, /```bash\nnpm run test:electron\n```/);
  assert.match(markdown, /```text\nok\n1 test passed\n```/);
});

test("message copy hover target stays reachable while moving from the bubble to the action row", () => {
  const localCssPath = path.resolve(process.cwd(), "src/styles.css");
  const cssPath = existsSync(localCssPath)
    ? localCssPath
    : path.resolve(process.cwd(), "..", "src/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /\.message-row\s*{[^}]*position:\s*relative/s);
  assert.match(css, /\.message-row::before\s*{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.message-bubble::before\s*{[^}]*bottom:\s*-2[0-9]px[^}]*height:\s*2[0-9]px/s);
  assert.match(css, /\.message-bubble::before\s*{[^}]*width:\s*max\(calc\(100% \+ 28px\),\s*120px\)/s);
  assert.doesNotMatch(css, /\.message-row:hover\s+\.message-actions/s);
  assert.match(css, /\.message-bubble:hover\s+\.message-actions/s);
  assert.match(css, /\.message-actions\s*{[^}]*top:\s*calc\(100% \+ 4px\)/s);
  assert.match(css, /\.message-actions\s*{[^}]*justify-content:\s*flex-start/s);
  assert.match(css, /\.message-actions\.assistant\s*{[^}]*left:\s*0/s);
  assert.match(css, /\.message-actions\.assistant\s*{[^}]*right:\s*auto/s);
  assert.doesNotMatch(css, /\.message-actions\s*{[^}]*bottom:\s*-/s);
  assert.match(css, /\.message-actions::before\s*{[^}]*top:\s*-1[0-9]px[^}]*left:\s*-1[0-9]px/s);
  assert.match(css, /\.message-usage-tooltip\s*{[^}]*display:\s*grid/s);
  assert.match(css, /\.message-usage-tooltip\s*{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.message-usage-tooltip-row\s*{[^}]*grid-template-columns:\s*64px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.message-usage-tooltip-value\s*{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.message-usage-tooltip\s*{[^}]*background:\s*rgba\(31,\s*41,\s*55,\s*0\.96\)/s);
  assert.match(css, /\.message-usage-tooltip\s*{[^}]*position:\s*fixed/s);
  assert.match(css, /\.message-usage-tooltip\s*{[^}]*z-index:\s*1000/s);
  assert.doesNotMatch(css, /\.message-usage-tooltip\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.message-usage-tooltip\.is-visible\s*{[^}]*opacity:\s*1/s);
  assert.match(css, /\.message-usage-tooltip\[data-placement="bottom"\]::before\s*{[^}]*top:\s*-5px/s);
  assert.match(css, /\.message-usage-tooltip\[data-placement="top"\]::before\s*{[^}]*bottom:\s*-5px/s);
  assert.doesNotMatch(css, /\.message-usage:hover\s+\.message-usage-tooltip/s);
  assert.doesNotMatch(css, /\.message-usage:focus-visible\s+\.message-usage-tooltip/s);
});

test("assistant message actions place copy before usage tooltip and timestamp", () => {
  const localSourcePath = path.resolve(process.cwd(), "src/features/chat/ChatWorkspace.tsx");
  const sourcePath = existsSync(localSourcePath)
    ? localSourcePath
    : path.resolve(process.cwd(), "..", "src/features/chat/ChatWorkspace.tsx");
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /className=\{`message-actions[\s\S]*message\.role === "assistant"[\s\S]*<button[\s\S]*className=\{`message-action-button[\s\S]*<\/button>[\s\S]*<MessageUsageBadge/,
  );
  assert.match(source, /className="message-usage"[\s\S]*data-placement=\{placement\}/);
  assert.match(
    source,
    /const usageTooltipId = usageBadge \? `message-usage-tooltip-\$\{message\.id\}` : undefined;/,
  );
  assert.match(source, /chooseFloatingTooltipPlacement/);
  assert.match(source, /createPortal\(/);
  assert.match(source, /message-usage-tooltip-section/);
  assert.match(source, /message-usage-tooltip-row/);
  assert.match(source, /closest\("\.message-list"\)/);
  assert.match(source, /boundaryBottom/);
  assert.match(source, /const MESSAGE_USAGE_TOOLTIP_DELAY_MS = 1_500;/);
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*showTooltipTimerRef\.current = null;\s*setOpen\(true\);\s*\}, MESSAGE_USAGE_TOOLTIP_DELAY_MS\)/);
  assert.match(source, /window\.clearTimeout\(showTooltipTimerRef\.current\)/);
  assert.match(source, /onPointerEnter=\{scheduleTooltip\}/);
  assert.match(source, /onFocus=\{showTooltip\}/);
  assert.match(source, /onPointerLeave=\{hideTooltip\}/);
  assert.match(source, /onBlur=\{hideTooltip\}/);
  assert.match(
    source,
    /<MessageUsageBadge[\s\S]*id=\{usageTooltipId\}[\s\S]*label=\{usageBadge\.label\}[\s\S]*title=\{usageBadge\.title\}[\s\S]*\/>[\s\S]*<span className="message-time">/,
  );
  assert.doesNotMatch(
    source,
    /<span className="message-usage"\s+title=/,
  );
  assert.doesNotMatch(
    source,
    /<span className="message-usage"\s+aria-label=\{usageBadge\.title\}/,
  );
});

test("user message actions place copy after timestamp", () => {
  const localSourcePath = path.resolve(process.cwd(), "src/features/chat/ChatWorkspace.tsx");
  const sourcePath = existsSync(localSourcePath)
    ? localSourcePath
    : path.resolve(process.cwd(), "..", "src/features/chat/ChatWorkspace.tsx");
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /message\.role === "user" \? \([\s\S]*<span className="message-time">\{formatMessageTime\(message\.createdAt\)\}<\/span>[\s\S]*<button[\s\S]*className=\{`message-action-button/,
  );
});
