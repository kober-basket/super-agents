import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeToolDiffs,
  getRuntimeToolDisplay,
  shouldShowRawToolPayload,
} from "../../src/lib/runtime-tool-display";
import type { ChatToolCall } from "../../src/types";

function toolCall(input: unknown, overrides: Partial<ChatToolCall> = {}): ChatToolCall {
  return {
    toolCallId: "tool-1",
    title: "read",
    status: "completed",
    content: [],
    rawInputJson: JSON.stringify(input, null, 2),
    ...overrides,
  };
}

test("runtime tool display summarizes read calls by file path", () => {
  const display = getRuntimeToolDisplay(toolCall({ path: "src/App.tsx" }));

  assert.equal(display.title, "read");
  assert.equal(display.detail, "src/App.tsx");
});

test("runtime tool display uses bash descriptions before commands", () => {
  const display = getRuntimeToolDisplay(
    toolCall(
      {
        command: "npm run test:electron",
        description: "运行 Electron 和前端逻辑测试",
      },
      { title: "bash" },
    ),
  );

  assert.equal(display.title, "bash");
  assert.equal(display.detail, "运行 Electron 和前端逻辑测试");
  assert.equal(display.command, "npm run test:electron");
});

test("runtime tool display extracts edit diffs from tool input", () => {
  const diffs = buildRuntimeToolDiffs(
    toolCall(
      {
        path: "src/features/chat/ChatWorkspace.tsx",
        oldString: "old label",
        newString: "new label",
      },
      { title: "edit" },
    ),
  );

  assert.deepEqual(diffs, [
    {
      path: "src/features/chat/ChatWorkspace.tsx",
      oldText: "old label",
      newText: "new label",
    },
  ]);
});

test("runtime tool display preserves whitespace inside edit diffs", () => {
  const diffs = buildRuntimeToolDiffs(
    toolCall(
      {
        path: "src/styles.css",
        oldString: "  color: red;\n",
        newString: "  color: blue;\n",
      },
      { title: "edit" },
    ),
  );

  assert.equal(diffs[0]?.oldText, "  color: red;\n");
  assert.equal(diffs[0]?.newText, "  color: blue;\n");
});

test("known readable tools hide raw payloads once friendly details exist", () => {
  const display = getRuntimeToolDisplay(
    toolCall({ path: "src/App.tsx" }, { content: [{ type: "text", text: "file content" }] }),
  );

  assert.equal(
    shouldShowRawToolPayload(display, {
      hasReadableContent: true,
      hasGeneratedDiffs: false,
    }),
    false,
  );
});
