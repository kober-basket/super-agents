import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getRuntimeToolDisplay,
  shouldRenderRuntimeToolCommandPreview,
} from "../../src/lib/runtime-tool-display";
import type { ChatToolCall } from "../../src/types";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);
  return readFileSync(sourcePath, "utf8");
}

function toolCall(input: unknown, overrides: Partial<ChatToolCall> = {}): ChatToolCall {
  return {
    toolCallId: "tool-bash",
    title: "bash",
    status: "in_progress",
    kind: "other",
    content: [],
    rawInputJson: JSON.stringify(input, null, 2),
    ...overrides,
  };
}

test("running bash cards need a command preview before command output arrives", () => {
  const display = getRuntimeToolDisplay(
    toolCall({
      command: "npm run test:electron",
      description: "运行测试",
    }),
  );

  assert.equal(
    shouldRenderRuntimeToolCommandPreview(display, {
      hasCommandOutput: false,
    }),
    true,
  );
  assert.equal(
    shouldRenderRuntimeToolCommandPreview(display, {
      hasCommandOutput: true,
    }),
    false,
  );
});

test("chat workspace wires command previews into runtime tool cards", () => {
  const source = readSource("src/features/chat/ChatWorkspace.tsx");

  assert.match(source, /shouldRenderRuntimeToolCommandPreview/);
  assert.match(source, /activity-command-preview/);
});
