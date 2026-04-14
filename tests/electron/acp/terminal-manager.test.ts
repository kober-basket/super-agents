import assert from "node:assert/strict";
import test from "node:test";

import { AcpTerminalManager } from "../../../electron/acp/terminal-manager";

test("AcpTerminalManager captures output and exit status", async () => {
  const manager = new AcpTerminalManager();

  try {
    const created = await manager.createTerminal({
      sessionId: "session-1",
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello');process.stderr.write(' world');"],
    });

    const exit = await manager.waitForTerminalExit({
      sessionId: "session-1",
      terminalId: created.terminalId,
    });
    const output = await manager.terminalOutput({
      sessionId: "session-1",
      terminalId: created.terminalId,
    });

    assert.equal(exit.exitCode, 0);
    assert.equal(output.output, "hello world");
    assert.equal(output.truncated, false);
  } finally {
    await manager.dispose();
  }
});
