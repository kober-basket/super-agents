import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MemoryView } from "../../src/features/memory/MemoryView";
import type { MemoryEntry } from "../../src/types";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

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

test("memory type list borrows knowledge sidebar tone treatment", () => {
  const html = renderToStaticMarkup(
    <MemoryView
      entries={[createEntry({ id: "one", title: "回答语言", type: "user_preference" })]}
      refreshing={false}
      workspaceRoot="F:\\work\\github\\super-agents"
      onCreateMemory={async () => undefined}
      onDeleteMemory={async () => undefined}
      onRefresh={async () => undefined}
      onToast={() => undefined}
      onUpdateMemory={async () => undefined}
    />,
  );
  const css = readSource("src/styles.css");

  assert.match(html, /class="memory-type-row tone-\d active"/);
  assert.match(html, /class="memory-type-icon tone-\d"/);
  assert.match(css, /\.memory-type-row\.active\s*{[^}]*var\(--memory-tone\)/s);
  assert.match(css, /\.memory-type-row\.active\s+\.memory-type-icon\s*{[^}]*var\(--memory-tone\)/s);
  assert.doesNotMatch(css, /\.memory-type-row\.active\s*{[^}]*background:\s*#fff;/s);
});

test("memory view omits explanatory helper copy", () => {
  const html = renderToStaticMarkup(
    <MemoryView
      entries={[]}
      refreshing={false}
      workspaceRoot="F:\\work\\github\\super-agents"
      onCreateMemory={async () => undefined}
      onDeleteMemory={async () => undefined}
      onRefresh={async () => undefined}
      onToast={() => undefined}
      onUpdateMemory={async () => undefined}
    />,
  );

  assert.match(html, /暂无记忆/);
  assert.doesNotMatch(html, /条启用/);
  assert.doesNotMatch(html, /条总计/);
  assert.doesNotMatch(html, /所有记忆/);
  assert.doesNotMatch(html, /回答习惯和个人偏好/);
  assert.doesNotMatch(html, /长期执行规则/);
  assert.doesNotMatch(html, /当前项目和工作方式/);
  assert.doesNotMatch(html, /外部系统和资料线索/);
  assert.doesNotMatch(html, /还没有长期条目/);
});
