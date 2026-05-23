import { randomUUID } from "node:crypto";
import path from "node:path";
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";
import * as nodePty from "node-pty";

import type {
  TerminalSessionCreateInput,
  TerminalSessionEvent,
  TerminalSessionInput,
  TerminalSessionResizeInput,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
} from "../src/types";
import { createRuntimeProcessEnv } from "./runtime-support";

interface ShellSpec {
  command: string;
  args: string[];
  label: string;
}

export interface TerminalPty {
  process: string;
  write(input: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  clear?: () => void;
  onData(listener: (chunk: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number | string }) => void): { dispose(): void };
}

export interface TerminalPtyFactory {
  spawn(
    command: string,
    args: string[],
    options: IPtyForkOptions | IWindowsPtyForkOptions,
  ): TerminalPty;
}

interface InteractiveTerminalManagerOptions {
  ptyFactory?: TerminalPtyFactory;
}

interface ManagedTerminalSession {
  terminalId: string;
  cwd: string;
  workspaceRoot: string;
  shell: string;
  output: string;
  truncated: boolean;
  status: TerminalSessionStatus;
  exitCode: number | null;
  signal: string | null;
  columns: number;
  rows: number;
  createdAt: number;
  updatedAt: number;
  outputByteLimit: number;
  pty: TerminalPty | null;
  disposables: Array<{ dispose(): void }>;
  waitForExit: Promise<void>;
  resolveExit: () => void;
}

const DEFAULT_OUTPUT_BYTE_LIMIT = 512 * 1024;
const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 28;

const nodePtyFactory: TerminalPtyFactory = {
  spawn(command, args, options) {
    return nodePty.spawn(command, args, options) as IPty;
  },
};

function createShellSpec(): ShellSpec {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"],
      label: "PowerShell",
    };
  }

  const shell = process.env.SHELL?.trim() || "/bin/sh";
  return {
    command: shell,
    args: [],
    label: path.basename(shell),
  };
}

function normalizeDimension(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(2, Math.min(500, Math.floor(Number(value))));
}

function trimToByteLimit(value: string, outputByteLimit: number) {
  if (outputByteLimit <= 0 || Buffer.byteLength(value, "utf8") <= outputByteLimit) {
    return {
      output: value,
      truncated: false,
    };
  }

  let output = value;
  while (Buffer.byteLength(output, "utf8") > outputByteLimit && output.length > 0) {
    output = output.slice(1);
  }

  return {
    output,
    truncated: true,
  };
}

function createExitPromise() {
  let resolveExit!: () => void;
  const waitForExit = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  return { waitForExit, resolveExit };
}

function snapshotTerminal(terminal: ManagedTerminalSession): TerminalSessionSnapshot {
  return {
    terminalId: terminal.terminalId,
    cwd: terminal.cwd,
    shell: terminal.shell,
    output: terminal.output,
    truncated: terminal.truncated,
    status: terminal.status,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    columns: terminal.columns,
    rows: terminal.rows,
    createdAt: terminal.createdAt,
    updatedAt: terminal.updatedAt,
  };
}

function disposeListeners(terminal: ManagedTerminalSession) {
  for (const disposable of terminal.disposables) {
    try {
      disposable.dispose();
    } catch {
      // Listener cleanup is best-effort; the PTY itself is the source of truth.
    }
  }
  terminal.disposables = [];
}

function killPty(pty: TerminalPty | null) {
  if (!pty) {
    return;
  }

  try {
    pty.kill();
  } catch {
    // The PTY may already be closed.
  }
}

export class InteractiveTerminalManager {
  private readonly terminals = new Map<string, ManagedTerminalSession>();
  private readonly ptyFactory: TerminalPtyFactory;

  constructor(
    private readonly onEvent: (event: TerminalSessionEvent) => void,
    options: InteractiveTerminalManagerOptions = {},
  ) {
    this.ptyFactory = options.ptyFactory ?? nodePtyFactory;
  }

  async createTerminalSession(params: TerminalSessionCreateInput): Promise<TerminalSessionSnapshot> {
    const shell = createShellSpec();
    const now = Date.now();
    const exitPromise = createExitPromise();
    const cwd = path.resolve(params.cwd?.trim() || process.cwd());
    const terminal: ManagedTerminalSession = {
      terminalId: randomUUID(),
      cwd,
      workspaceRoot: path.resolve(params.workspaceRoot?.trim() || cwd),
      shell: shell.label,
      output: "",
      truncated: false,
      status: "starting",
      exitCode: null,
      signal: null,
      columns: normalizeDimension(params.columns, DEFAULT_COLUMNS),
      rows: normalizeDimension(params.rows, DEFAULT_ROWS),
      createdAt: now,
      updatedAt: now,
      outputByteLimit: Math.max(16 * 1024, params.outputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT),
      pty: null,
      disposables: [],
      waitForExit: exitPromise.waitForExit,
      resolveExit: exitPromise.resolveExit,
    };

    this.terminals.set(terminal.terminalId, terminal);
    await this.startTerminalProcess(terminal, shell);
    return snapshotTerminal(terminal);
  }

  async writeTerminalInput(params: TerminalSessionInput): Promise<TerminalSessionSnapshot> {
    const terminal = this.requireTerminal(params.terminalId);
    if (terminal.status !== "running" || !terminal.pty) {
      throw new Error("Terminal is not running.");
    }

    terminal.pty.write(params.input);
    return snapshotTerminal(terminal);
  }

  async resizeTerminalSession(params: TerminalSessionResizeInput): Promise<TerminalSessionSnapshot> {
    const terminal = this.requireTerminal(params.terminalId);
    const columns = normalizeDimension(params.columns, terminal.columns);
    const rows = normalizeDimension(params.rows, terminal.rows);
    terminal.columns = columns;
    terminal.rows = rows;
    terminal.updatedAt = Date.now();

    if (terminal.pty && terminal.status === "running") {
      terminal.pty.resize(columns, rows);
    }

    this.emit(terminal);
    return snapshotTerminal(terminal);
  }

  async clearTerminalSession(params: { terminalId: string }): Promise<TerminalSessionSnapshot> {
    const terminal = this.requireTerminal(params.terminalId);
    terminal.output = "";
    terminal.truncated = false;
    terminal.updatedAt = Date.now();
    terminal.pty?.clear?.();
    this.emit(terminal);
    return snapshotTerminal(terminal);
  }

  async stopTerminalSession(params: { terminalId: string }): Promise<TerminalSessionSnapshot> {
    const terminal = this.requireTerminal(params.terminalId);
    killPty(terminal.pty);
    await Promise.race([
      terminal.waitForExit,
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (terminal.status === "running") {
      terminal.status = "exited";
      terminal.signal = terminal.signal ?? "SIGHUP";
      terminal.updatedAt = Date.now();
      this.emit(terminal);
    }
    return snapshotTerminal(terminal);
  }

  async restartTerminalSession(params: { terminalId: string }): Promise<TerminalSessionSnapshot> {
    const terminal = this.requireTerminal(params.terminalId);
    killPty(terminal.pty);
    await Promise.race([
      terminal.waitForExit,
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    disposeListeners(terminal);

    const exitPromise = createExitPromise();
    terminal.output = "";
    terminal.truncated = false;
    terminal.status = "starting";
    terminal.exitCode = null;
    terminal.signal = null;
    terminal.waitForExit = exitPromise.waitForExit;
    terminal.resolveExit = exitPromise.resolveExit;
    terminal.updatedAt = Date.now();
    await this.startTerminalProcess(terminal, createShellSpec());
    return snapshotTerminal(terminal);
  }

  async releaseTerminalSession(params: { terminalId: string }): Promise<void> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      return;
    }

    this.terminals.delete(params.terminalId);
    disposeListeners(terminal);
    killPty(terminal.pty);
  }

  async shutdown() {
    await Promise.all(
      [...this.terminals.keys()].map((terminalId) => this.releaseTerminalSession({ terminalId })),
    );
  }

  private async startTerminalProcess(terminal: ManagedTerminalSession, shell: ShellSpec) {
    const env = await createRuntimeProcessEnv({
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
    });
    const pty = this.ptyFactory.spawn(shell.command, shell.args, {
      cols: terminal.columns,
      rows: terminal.rows,
      cwd: terminal.cwd,
      env,
      name: "xterm-256color",
      ...(process.platform === "win32" ? { useConpty: true } : {}),
    });

    terminal.pty = pty;
    terminal.shell = shell.label;
    terminal.status = "running";
    terminal.updatedAt = Date.now();
    this.emit(terminal);

    terminal.disposables.push(
      pty.onData((chunk) => {
        if (this.terminals.get(terminal.terminalId) !== terminal) {
          return;
        }
        this.appendOutput(terminal, chunk);
      }),
      pty.onExit((event) => {
        if (this.terminals.get(terminal.terminalId) !== terminal || terminal.pty !== pty) {
          return;
        }
        terminal.exitCode = event.exitCode;
        terminal.signal = event.signal === undefined ? null : String(event.signal);
        terminal.status = event.exitCode === 0 ? "exited" : "failed";
        terminal.updatedAt = Date.now();
        this.emit(terminal);
        terminal.resolveExit();
      }),
    );
  }

  private appendOutput(terminal: ManagedTerminalSession, chunk: string) {
    if (!chunk) {
      return;
    }

    const next = trimToByteLimit(`${terminal.output}${chunk}`, terminal.outputByteLimit);
    terminal.output = next.output;
    terminal.truncated = terminal.truncated || next.truncated;
    terminal.updatedAt = Date.now();
    this.emit(terminal);
  }

  private emit(terminal: ManagedTerminalSession) {
    this.onEvent({ terminal: snapshotTerminal(terminal) });
  }

  private requireTerminal(terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    return terminal;
  }
}
