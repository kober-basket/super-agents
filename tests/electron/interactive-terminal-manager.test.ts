import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InteractiveTerminalManager } from "../../electron/interactive-terminal-manager";
import type { TerminalPtyFactory } from "../../electron/interactive-terminal-manager";
import type { TerminalSessionSnapshot } from "../../src/types";

function waitForOutput(
  events: TerminalSessionSnapshot[],
  predicate: (output: string) => boolean,
  timeoutMs = 8_000,
) {
  const startedAt = Date.now();

  return new Promise<TerminalSessionSnapshot>((resolve, reject) => {
    const tick = () => {
      const match = [...events].reverse().find((event) => predicate(event.output));
      if (match) {
        resolve(match);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for terminal output. Last output: ${events.at(-1)?.output ?? ""}`));
        return;
      }

      setTimeout(tick, 25);
    };

    tick();
  });
}

function quotePowerShell(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function createStatefulPtyFactory(initialCwd: string): TerminalPtyFactory {
  let currentCwd = initialCwd;
  const dataListeners: Array<(chunk: string) => void> = [];
  const exitListeners: Array<(event: { exitCode: number }) => void> = [];

  const emitData = (chunk: string) => {
    queueMicrotask(() => {
      for (const listener of dataListeners) {
        listener(chunk);
      }
    });
  };

  return {
    spawn: () => ({
      process: "fake-pty",
      clear: () => undefined,
      kill: () => {
        for (const listener of exitListeners) {
          listener({ exitCode: 0 });
        }
      },
      onData: (listener: (chunk: string) => void) => {
        dataListeners.push(listener);
        return {
          dispose: () => {
            const index = dataListeners.indexOf(listener);
            if (index >= 0) {
              dataListeners.splice(index, 1);
            }
          },
        };
      },
      onExit: (listener: (event: { exitCode: number }) => void) => {
        exitListeners.push(listener);
        return {
          dispose: () => {
            const index = exitListeners.indexOf(listener);
            if (index >= 0) {
              exitListeners.splice(index, 1);
            }
          },
        };
      },
      resize: () => undefined,
      write: (input: string) => {
        if (input.includes("__SA_ONE__")) {
          emitData("__SA_ONE__\r\n");
        }
        if (input.includes("__SA_CLEAR__")) {
          emitData("__SA_CLEAR__\r\n");
        }

        const powerShellLocation = /Set-Location -LiteralPath '((?:[^']|'')+)'/.exec(input);
        if (powerShellLocation) {
          currentCwd = powerShellLocation[1].replace(/''/g, "'");
        }

        const posixLocation = /(?:^|\n)cd\s+("[^"]+"|'[^']+'|\S+)/.exec(input);
        if (posixLocation) {
          const rawPath = posixLocation[1];
          currentCwd = rawPath.startsWith("\"") ? JSON.parse(rawPath) : rawPath.replace(/^'|'$/g, "");
        }

        if (input.includes("Get-Location") || /(?:^|\n)pwd(?:\n|$)/.test(input)) {
          emitData(`${currentCwd}\r\n`);
        }
      },
    }),
  };
}

test("interactive terminal streams output and keeps shell state across inputs", async (t) => {
  const events: TerminalSessionSnapshot[] = [];
  const cwd = await mkdtemp(path.join(os.tmpdir(), "super-agents-terminal-"));
  const nested = path.join(cwd, "nested");
  await mkdir(nested);
  const manager = new InteractiveTerminalManager(
    (event) => {
      events.push(event.terminal);
    },
    { ptyFactory: createStatefulPtyFactory(cwd) },
  );

  const session = await manager.createTerminalSession({ cwd, workspaceRoot: cwd });

  t.after(async () => {
    await manager.releaseTerminalSession({ terminalId: session.terminalId }).catch(() => undefined);
  });

  await manager.writeTerminalInput({
    terminalId: session.terminalId,
    input: process.platform === "win32" ? 'Write-Output "__SA_ONE__"\r\n' : 'printf "__SA_ONE__\\n"\n',
  });

  await waitForOutput(events, (output) => output.includes("__SA_ONE__"));

  await manager.writeTerminalInput({
    terminalId: session.terminalId,
    input:
      process.platform === "win32"
        ? `Set-Location -LiteralPath ${quotePowerShell(nested)}\r\nGet-Location | Select-Object -ExpandProperty Path\r\n`
        : `cd ${JSON.stringify(nested)}\npwd\n`,
  });

  const updated = await waitForOutput(events, (output) => output.includes(nested));
  assert.equal(updated.status, "running");
  assert.match(updated.output, /__SA_ONE__/);
});

test("interactive terminal can clear buffered output without ending the session", async (t) => {
  const events: TerminalSessionSnapshot[] = [];
  const cwd = await mkdtemp(path.join(os.tmpdir(), "super-agents-terminal-clear-"));
  const manager = new InteractiveTerminalManager(
    (event) => {
      events.push(event.terminal);
    },
    { ptyFactory: createStatefulPtyFactory(cwd) },
  );
  const session = await manager.createTerminalSession({ cwd, workspaceRoot: cwd });

  t.after(async () => {
    await manager.releaseTerminalSession({ terminalId: session.terminalId }).catch(() => undefined);
  });

  await manager.writeTerminalInput({
    terminalId: session.terminalId,
    input: process.platform === "win32" ? 'Write-Output "__SA_CLEAR__"\r\n' : 'printf "__SA_CLEAR__\\n"\n',
  });
  await waitForOutput(events, (output) => output.includes("__SA_CLEAR__"));

  const cleared = await manager.clearTerminalSession({ terminalId: session.terminalId });

  assert.equal(cleared.status, "running");
  assert.equal(cleared.output, "");
  assert.equal(cleared.truncated, false);
});

test("interactive terminal uses a PTY adapter for input and resize", async () => {
  const events: TerminalSessionSnapshot[] = [];
  const writes: string[] = [];
  const resizes: Array<{ columns: number; rows: number }> = [];
  let dataListener: (chunk: string) => void = () => undefined;

  const manager = new InteractiveTerminalManager(
    (event) => {
      events.push(event.terminal);
    },
    {
      ptyFactory: {
        spawn: (_command, _args, options) => ({
          process: "fake-pty",
          write: (input: string) => writes.push(input),
          resize: (columns: number, rows: number) => resizes.push({ columns, rows }),
          kill: () => undefined,
          onData: (listener: (chunk: string) => void) => {
            dataListener = listener;
            return { dispose: () => undefined };
          },
          onExit: () => ({ dispose: () => undefined }),
          options,
        }),
      },
    },
  );

  const session = await manager.createTerminalSession({
    columns: 120,
    cwd: process.cwd(),
    rows: 36,
    workspaceRoot: process.cwd(),
  });
  dataListener?.("PTY_READY");

  await manager.writeTerminalInput({ terminalId: session.terminalId, input: "dir\r" });
  const resized = await manager.resizeTerminalSession({
    terminalId: session.terminalId,
    columns: 100,
    rows: 28,
  });

  assert.equal(writes.at(-1), "dir\r");
  assert.deepEqual(resizes.at(-1), { columns: 100, rows: 28 });
  assert.equal(resized.columns, 100);
  assert.equal(resized.rows, 28);
  assert.equal(events.at(-1)?.output.includes("PTY_READY"), true);
});
