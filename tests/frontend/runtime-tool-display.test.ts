import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeToolDiffs,
  getRuntimeDiffLineNumberColumns,
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

test("runtime tool display summarizes skill calls by loaded skill name", () => {
  const display = getRuntimeToolDisplay(toolCall({ name: "stock-expert" }, { title: "skill" }));

  assert.equal(display.title, "skill");
  assert.equal(display.detail, "加载 stock-expert 技能");
  assert.equal(display.isKnownTool, true);
});

test("runtime tool display extracts edit diffs from tool input", () => {
  const diffs = buildRuntimeToolDiffs(
    toolCall(
      {
        path: "src/features/chat/ChatWorkspace.tsx",
        oldString: "alpha\nshared\nold label\nomega\n",
        newString: "alpha\nshared\nnew label\nomega\n",
      },
      { title: "edit" },
    ),
  );

  assert.deepEqual(diffs, [
    {
      path: "src/features/chat/ChatWorkspace.tsx",
      oldText: "alpha\nshared\nold label\nomega\n",
      newText: "alpha\nshared\nnew label\nomega\n",
      lines: [
        { kind: "context", oldLineNumber: 1, newLineNumber: 1, text: "alpha" },
        { kind: "context", oldLineNumber: 2, newLineNumber: 2, text: "shared" },
        { kind: "removed", oldLineNumber: 3, newLineNumber: null, text: "old label" },
        { kind: "added", oldLineNumber: null, newLineNumber: 3, text: "new label" },
        { kind: "context", oldLineNumber: 4, newLineNumber: 4, text: "omega" },
      ],
    },
  ]);
});

test("runtime tool display extracts partial write content while input is streaming", () => {
  const diffs = buildRuntimeToolDiffs({
    title: "write",
    rawInputJson: "{\"path\":\"notes/live.md\",\"content\":\"Line one\\nLine two",
  });

  assert.deepEqual(diffs, [
    {
      path: "notes/live.md",
      oldText: null,
      newText: "Line one\nLine two",
      lines: [
        { kind: "added", oldLineNumber: null, newLineNumber: 1, text: "Line one" },
        { kind: "added", oldLineNumber: null, newLineNumber: 2, text: "Line two" },
      ],
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
  assert.deepEqual(diffs[0]?.lines, [
    { kind: "removed", oldLineNumber: 1, newLineNumber: null, text: "  color: red;" },
    { kind: "added", oldLineNumber: null, newLineNumber: 1, text: "  color: blue;" },
  ]);
});

test("runtime tool display keeps unchanged middle lines as context", () => {
  const diffs = buildRuntimeToolDiffs(
    toolCall(
      {
        path: "src/example.ts",
        oldString: "before\nold first\nshared middle\nold second\nafter\n",
        newString: "before\nnew first\nshared middle\nnew second\nafter\n",
      },
      { title: "edit" },
    ),
  );

  assert.deepEqual(diffs[0]?.lines, [
    { kind: "context", oldLineNumber: 1, newLineNumber: 1, text: "before" },
    { kind: "removed", oldLineNumber: 2, newLineNumber: null, text: "old first" },
    { kind: "added", oldLineNumber: null, newLineNumber: 2, text: "new first" },
    { kind: "context", oldLineNumber: 3, newLineNumber: 3, text: "shared middle" },
    { kind: "removed", oldLineNumber: 4, newLineNumber: null, text: "old second" },
    { kind: "added", oldLineNumber: null, newLineNumber: 4, text: "new second" },
    { kind: "context", oldLineNumber: 5, newLineNumber: 5, text: "after" },
  ]);
});

test("runtime diff line numbers use one gutter for one-sided changes", () => {
  assert.deepEqual(
    getRuntimeDiffLineNumberColumns([
      { kind: "added", oldLineNumber: null, newLineNumber: 1, text: "created" },
    ]),
    ["new"],
  );

  assert.deepEqual(
    getRuntimeDiffLineNumberColumns([
      { kind: "removed", oldLineNumber: 1, newLineNumber: null, text: "old" },
      { kind: "added", oldLineNumber: null, newLineNumber: 1, text: "new" },
    ]),
    ["old", "new"],
  );
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
