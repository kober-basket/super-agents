import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type * as acp from "@agentclientprotocol/sdk";

import type { ChatTerminalOutput } from "../src/types";

interface ManagedTerminal {
  id: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  signal: string | null;
  waitForExit: Promise<void>;
}

function createChunkDecoder() {
  if (process.platform !== "win32") {
    return (chunk: Buffer) => chunk.toString("utf8");
  }

  const decoder = new TextDecoder("gbk", { fatal: false });
  return (chunk: Buffer) => {
    try {
      return decoder.decode(chunk, { stream: true });
    } catch {
      return chunk.toString("utf8");
    }
  };
}

function trimToByteLimit(value: string, outputByteLimit: number) {
  if (outputByteLimit <= 0) {
    return {
      output: value,
      truncated: false,
    };
  }

  let output = value;
  let truncated = false;
  while (Buffer.byteLength(output, "utf8") > outputByteLimit && output.length > 0) {
    output = output.slice(1);
    truncated = true;
  }

  return {
    output,
    truncated,
  };
}

function toTerminalPayload(terminal: ManagedTerminal): ChatTerminalOutput {
  return {
    terminalId: terminal.id,
    output: terminal.output,
    truncated: terminal.truncated,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
  };
}

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly decodeChunk = createChunkDecoder();

  constructor(
    private readonly onOutput: (payload: { sessionId: string; terminal: ChatTerminalOutput }) => void,
  ) {}

  async createTerminal(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    const terminalId = randomUUID();
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value])),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolveExit!: () => void;
    const waitForExit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const terminal: ManagedTerminal = {
      id: terminalId,
      child,
      output: "",
      truncated: false,
      outputByteLimit: Math.max(4_096, params.outputByteLimit ?? 65_536),
      exitCode: null,
      signal: null,
      waitForExit,
    };

    const appendChunk = (chunk: Buffer) => {
      const next = trimToByteLimit(
        `${terminal.output}${this.decodeChunk(chunk)}`,
        terminal.outputByteLimit,
      );
      terminal.output = next.output;
      terminal.truncated = next.truncated || terminal.truncated;
      this.onOutput({
        sessionId: params.sessionId,
        terminal: toTerminalPayload(terminal),
      });
    };

    child.stdout.on("data", appendChunk);
    child.stderr.on("data", appendChunk);
    child.on("close", (exitCode, signal) => {
      terminal.exitCode = exitCode ?? null;
      terminal.signal = signal ?? null;
      this.onOutput({
        sessionId: params.sessionId,
        terminal: toTerminalPayload(terminal),
      });
      resolveExit();
    });

    this.terminals.set(terminalId, terminal);
    return { terminalId };
  }

  async terminalOutput(params: acp.TerminalOutputRequest): Promise<acp.TerminalOutputResponse> {
    const terminal = this.requireTerminal(params.terminalId);
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus:
        terminal.exitCode !== null || terminal.signal !== null
          ? {
              exitCode: terminal.exitCode,
              signal: terminal.signal,
            }
          : undefined,
    };
  }

  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest,
  ): Promise<acp.WaitForTerminalExitResponse> {
    const terminal = this.requireTerminal(params.terminalId);
    await terminal.waitForExit;
    return {
      exitCode: terminal.exitCode,
      signal: terminal.signal,
    };
  }

  async killTerminal(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> {
    const terminal = this.requireTerminal(params.terminalId);
    if (!terminal.child.killed && terminal.exitCode === null && terminal.signal === null) {
      terminal.child.kill();
    }
    return {};
  }

  async releaseTerminal(params: acp.ReleaseTerminalRequest): Promise<acp.ReleaseTerminalResponse> {
    const terminal = this.requireTerminal(params.terminalId);
    if (!terminal.child.killed && terminal.exitCode === null && terminal.signal === null) {
      terminal.child.kill();
    }
    this.terminals.delete(params.terminalId);
    return {};
  }

  private requireTerminal(terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    return terminal;
  }
}
