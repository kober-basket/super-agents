import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import type * as acp from "@agentclientprotocol/sdk";

const execFileAsync = promisify(execFile);

interface ManagedTerminal {
  child: ReturnType<typeof spawn>;
  exitStatus: acp.TerminalExitStatus | null;
  output: string;
  outputByteLimit: number | null;
  released: boolean;
  sessionId: string;
  truncated: boolean;
  waitForExit: Promise<acp.WaitForTerminalExitResponse>;
  resolveExit: (response: acp.WaitForTerminalExitResponse) => void;
}

function shouldUseShell(command: string) {
  if (process.platform !== "win32") {
    return false;
  }

  const extension = path.extname(command).toLowerCase();
  return extension === ".cmd" || extension === ".bat" || extension === "";
}

function normalizeOutputLimit(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.trunc(value));
}

function truncateOutput(text: string, outputByteLimit: number | null) {
  if (outputByteLimit == null) {
    return {
      output: text,
      truncated: false,
    };
  }

  if (outputByteLimit === 0) {
    return {
      output: "",
      truncated: text.length > 0,
    };
  }

  if (Buffer.byteLength(text, "utf8") <= outputByteLimit) {
    return {
      output: text,
      truncated: false,
    };
  }

  const keptChars: string[] = [];
  let retainedBytes = 0;
  for (const char of Array.from(text).reverse()) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (retainedBytes + charBytes > outputByteLimit) {
      break;
    }
    keptChars.push(char);
    retainedBytes += charBytes;
  }

  keptChars.reverse();
  return {
    output: keptChars.join(""),
    truncated: true,
  };
}

function buildEnv(env?: acp.EnvVariable[]) {
  const nextEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const entry of env ?? []) {
    const name = entry.name.trim();
    if (!name) {
      continue;
    }
    nextEnv[name] = entry.value;
  }
  return nextEnv;
}

async function killChildProcess(child: ReturnType<typeof spawn>) {
  if (child.killed) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => undefined);
    return;
  }

  child.kill("SIGTERM");
}

export class AcpTerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();

  private getTerminal(sessionId: string, terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.released || terminal.sessionId !== sessionId) {
      throw new Error(`Unknown terminal: ${terminalId}`);
    }
    return terminal;
  }

  async createTerminal(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    const terminalId = randomUUID();
    let resolveExit!: (response: acp.WaitForTerminalExitResponse) => void;
    const waitForExit = new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
      resolveExit = resolve;
    });

    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? process.cwd(),
      env: buildEnv(params.env),
      shell: shouldUseShell(params.command),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const terminal: ManagedTerminal = {
      child,
      exitStatus: null,
      output: "",
      outputByteLimit: normalizeOutputLimit(params.outputByteLimit),
      released: false,
      resolveExit,
      sessionId: params.sessionId,
      truncated: false,
      waitForExit,
    };

    const appendOutput = (chunk: string | Buffer) => {
      const next = truncateOutput(terminal.output + chunk.toString(), terminal.outputByteLimit);
      terminal.output = next.output;
      terminal.truncated = terminal.truncated || next.truncated;
    };

    const finalizeExit = (exitStatus: acp.TerminalExitStatus) => {
      if (!terminal.exitStatus) {
        terminal.exitStatus = exitStatus;
        terminal.resolveExit({
          exitCode: exitStatus.exitCode ?? null,
          signal: exitStatus.signal ?? null,
        });
      }
    };

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.once("error", (error) => {
      appendOutput(error.message);
      finalizeExit({
        exitCode: 1,
        signal: null,
      });
    });
    child.once("exit", (exitCode, signal) => {
      finalizeExit({
        exitCode: exitCode ?? null,
        signal: signal ?? null,
      });
    });

    this.terminals.set(terminalId, terminal);
    return {
      terminalId,
    };
  }

  async terminalOutput(params: acp.TerminalOutputRequest): Promise<acp.TerminalOutputResponse> {
    const terminal = this.getTerminal(params.sessionId, params.terminalId);
    return {
      exitStatus: terminal.exitStatus ?? undefined,
      output: terminal.output,
      truncated: terminal.truncated,
    };
  }

  async waitForTerminalExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    const terminal = this.getTerminal(params.sessionId, params.terminalId);
    return await terminal.waitForExit;
  }

  async killTerminal(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> {
    const terminal = this.getTerminal(params.sessionId, params.terminalId);
    await killChildProcess(terminal.child);
    return {};
  }

  async releaseTerminal(params: acp.ReleaseTerminalRequest): Promise<acp.ReleaseTerminalResponse> {
    const terminal = this.getTerminal(params.sessionId, params.terminalId);
    terminal.released = true;
    await killChildProcess(terminal.child);
    this.terminals.delete(params.terminalId);
    return {};
  }

  async dispose() {
    const terminals = Array.from(this.terminals.entries());
    this.terminals.clear();

    await Promise.all(
      terminals.map(async ([terminalId, terminal]) => {
        terminal.released = true;
        await killChildProcess(terminal.child).catch(() => undefined);
        this.terminals.delete(terminalId);
      }),
    );
  }
}
