import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TerminalPane } from "../../src/features/chat/TerminalPane";
import type { TerminalSessionEvent, TerminalSessionSnapshot } from "../../src/types";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

const mockSession: TerminalSessionSnapshot = {
  terminalId: "terminal-test",
  cwd: "F:\\work\\github\\super-agents",
  shell: "PowerShell",
  output: "",
  truncated: false,
  status: "running",
  exitCode: null,
  signal: null,
  columns: 100,
  rows: 28,
  createdAt: 1,
  updatedAt: 1,
};

test("terminal pane renders advanced session controls", () => {
  const html = renderToStaticMarkup(
    <TerminalPane
      cwd={mockSession.cwd}
      onClearSession={async () => mockSession}
      onCopyText={async () => undefined}
      onCreateSession={async () => mockSession}
      onReleaseSession={async () => undefined}
      onResizeSession={async () => mockSession}
      onRestartSession={async () => mockSession}
      onTerminalEvent={(_listener: (event: TerminalSessionEvent) => void) => () => undefined}
      onStopSession={async () => mockSession}
      onWriteInput={async () => mockSession}
    />,
  );

  assert.match(html, /class="terminal-pane advanced"/);
  assert.match(html, /title="复制输出"/);
  assert.match(html, /title="清空输出"/);
  assert.match(html, /title="停止终端"/);
  assert.match(html, /title="重启终端"/);
  assert.match(html, /终端正在启动/);
});

test("terminal pane renders an xterm host instead of a line-buffered command log", () => {
  const html = renderToStaticMarkup(
    <TerminalPane
      cwd={mockSession.cwd}
      onClearSession={async () => mockSession}
      onCopyText={async () => undefined}
      onCreateSession={async () => mockSession}
      onReleaseSession={async () => undefined}
      onResizeSession={async () => mockSession}
      onRestartSession={async () => mockSession}
      onTerminalEvent={(_listener: (event: TerminalSessionEvent) => void) => () => undefined}
      onStopSession={async () => mockSession}
      onWriteInput={async () => mockSession}
    />,
  );

  assert.match(html, /class="terminal-xterm-host"/);
  assert.doesNotMatch(html, /class="terminal-command-input"/);
});

test("terminal pane styles define a fixed toolbar and xterm viewport", () => {
  const css = readSource("src/styles.css");

  assert.match(css, /\.terminal-toolbar\s*{/);
  assert.match(css, /\.terminal-xterm-host\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.terminal-pane\s+\.xterm\s*{[^}]*font-family:\s*"JetBrains Mono"/s);
});
