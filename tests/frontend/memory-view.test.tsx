import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MemoryView } from "../../src/features/memory/MemoryView";
import type { MemoryEntry } from "../../src/types";

function createEntry(patch: Partial<MemoryEntry>): MemoryEntry {
  const timestamp = Date.UTC(2026, 4, 23, 8, 0, 0);
  return {
    id: patch.id ?? "memory-1",
    type: patch.type ?? "user_preference",
    scope: patch.scope ?? "global",
    title: patch.title ?? "回答语言",
    content: patch.content ?? "用户偏好中文回答。",
    tags: patch.tags ?? ["中文"],
    enabled: patch.enabled ?? true,
    createdAt: patch.createdAt ?? timestamp,
    updatedAt: patch.updatedAt ?? timestamp,
    workspaceRoot: patch.workspaceRoot,
  };
}

test("memory view renders memory entries, type filters, and disabled state", () => {
  const entries = [
    createEntry({ id: "one", title: "回答语言", type: "user_preference" }),
    createEntry({
      id: "two",
      title: "完成验证",
      type: "feedback_rule",
      enabled: false,
      tags: ["verification"],
    }),
  ];

  const html = renderToStaticMarkup(
    <MemoryView
      entries={entries}
      refreshing={false}
      workspaceRoot="F:\\work\\github\\super-agents"
      onCreateMemory={async () => undefined}
      onDeleteMemory={async () => undefined}
      onRefresh={async () => undefined}
      onToast={() => undefined}
      onUpdateMemory={async () => undefined}
    />,
  );

  assert.match(html, /记忆/);
  assert.match(html, /用户偏好/);
  assert.match(html, /反馈规则/);
  assert.match(html, /回答语言/);
  assert.match(html, /完成验证/);
  assert.match(html, /已停用/);
});
