import {
  Clipboard,
  LoaderCircle,
  RotateCcw,
  Scissors,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IDisposable, ITerminalOptions, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import type {
  TerminalSessionCreateInput,
  TerminalSessionEvent,
  TerminalSessionInput,
  TerminalSessionResizeInput,
  TerminalSessionSnapshot,
} from "../../types";

interface TerminalPaneProps {
  cwd: string;
  onClearSession: (terminalId: string) => Promise<TerminalSessionSnapshot>;
  onCopyText: (text: string) => Promise<void>;
  onCreateSession: (payload: TerminalSessionCreateInput) => Promise<TerminalSessionSnapshot>;
  onReleaseSession: (terminalId: string) => Promise<void>;
  onResizeSession: (payload: TerminalSessionResizeInput) => Promise<TerminalSessionSnapshot>;
  onRestartSession: (terminalId: string) => Promise<TerminalSessionSnapshot>;
  onStopSession: (terminalId: string) => Promise<TerminalSessionSnapshot>;
  onTerminalEvent: (listener: (event: TerminalSessionEvent) => void) => () => void;
  onWriteInput: (payload: TerminalSessionInput) => Promise<TerminalSessionSnapshot>;
}

const TERMINAL_OPTIONS: ITerminalOptions = {
  allowProposedApi: false,
  convertEol: true,
  cursorBlink: true,
  cursorStyle: "bar",
  fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.18,
  macOptionIsMeta: true,
  scrollback: 8_000,
  theme: {
    background: "#0b1118",
    black: "#1f2937",
    blue: "#60a5fa",
    brightBlack: "#64748b",
    brightBlue: "#93c5fd",
    brightCyan: "#67e8f9",
    brightGreen: "#86efac",
    brightMagenta: "#f0abfc",
    brightRed: "#fca5a5",
    brightWhite: "#f8fafc",
    brightYellow: "#fde68a",
    cursor: "#7dd3fc",
    cyan: "#22d3ee",
    foreground: "#d8dee9",
    green: "#34d399",
    magenta: "#d946ef",
    red: "#f87171",
    selectionBackground: "#334155",
    white: "#e5e7eb",
    yellow: "#fbbf24",
  },
};

function terminalStatusLabel(session: TerminalSessionSnapshot | null, error: string | null) {
  if (error) return "异常";
  if (!session || session.status === "starting") return "启动中";
  if (session.status === "running") return "运行中";
  if (session.status === "exited") return "已停止";
  return "异常";
}

function terminalStatusDetail(session: TerminalSessionSnapshot | null, error: string | null) {
  if (error) return error;
  if (!session) return "终端正在启动";
  if (session.status === "running") return `${session.shell} 已连接`;
  if (session.status === "exited") return `退出码 ${session.exitCode ?? 0}`;
  return session.signal ? `信号 ${session.signal}` : `退出码 ${session.exitCode ?? 1}`;
}

function writeSnapshotToTerminal(
  terminal: Terminal,
  snapshot: TerminalSessionSnapshot,
  lastOutputRef: { current: string },
) {
  const previousOutput = lastOutputRef.current;
  const nextOutput = snapshot.output;

  if (!nextOutput) {
    terminal.clear();
    lastOutputRef.current = "";
    return;
  }

  if (nextOutput.startsWith(previousOutput)) {
    terminal.write(nextOutput.slice(previousOutput.length));
  } else {
    terminal.reset();
    terminal.write(nextOutput);
  }
  lastOutputRef.current = nextOutput;
}

export function TerminalPane({
  cwd,
  onClearSession,
  onCopyText,
  onCreateSession,
  onReleaseSession,
  onResizeSession,
  onRestartSession,
  onStopSession,
  onTerminalEvent,
  onWriteInput,
}: TerminalPaneProps) {
  const [session, setSession] = useState<TerminalSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [action, setAction] = useState<"clear" | "copy" | "restart" | "stop" | "interrupt" | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastOutputRef = useRef("");
  const canWrite = Boolean(session?.terminalId && session.status === "running" && !error);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const terminalId = sessionIdRef.current;
    if (!terminal || !fitAddon || !terminalId) {
      return;
    }

    try {
      fitAddon.fit();
      void onResizeSession({
        terminalId,
        columns: terminal.cols,
        rows: terminal.rows,
      });
    } catch {
      // The host may still be measuring during mount or pane animation.
    }
  }, [onResizeSession]);

  useEffect(() => {
    return onTerminalEvent((event) => {
      if (event.terminal.terminalId !== sessionIdRef.current) {
        return;
      }
      setSession(event.terminal);
      setError(null);
      const terminal = terminalRef.current;
      if (terminal) {
        writeSnapshotToTerminal(terminal, event.terminal, lastOutputRef);
      }
    });
  }, [onTerminalEvent]);

  useEffect(() => {
    let disposed = false;
    let createdTerminalId: string | null = null;
    let dataDisposable: IDisposable | null = null;
    let resizeObserver: ResizeObserver | null = null;

    setSession(null);
    setError(null);
    sessionIdRef.current = null;
    lastOutputRef.current = "";

    async function setupTerminal() {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) {
        return;
      }

      const terminal = new Terminal(TERMINAL_OPTIONS);
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      fitAddon.fit();

      dataDisposable = terminal.onData((input) => {
        const terminalId = sessionIdRef.current;
        if (!terminalId) {
          return;
        }
        void onWriteInput({ terminalId, input }).catch((writeError) => {
          setError(writeError instanceof Error ? writeError.message : "终端输入失败");
        });
      });

      resizeObserver = new ResizeObserver(() => fitAndResize());
      resizeObserver.observe(host);

      const nextSession = await onCreateSession({
        columns: terminal.cols,
        cwd,
        rows: terminal.rows,
        workspaceRoot: cwd,
      });
      if (disposed) {
        void onReleaseSession(nextSession.terminalId);
        return;
      }

      createdTerminalId = nextSession.terminalId;
      sessionIdRef.current = nextSession.terminalId;
      setSession(nextSession);
      writeSnapshotToTerminal(terminal, nextSession, lastOutputRef);
      window.setTimeout(fitAndResize, 80);
    }

    void setupTerminal().catch((setupError) => {
      if (!disposed) {
        setError(setupError instanceof Error ? setupError.message : "终端启动失败");
      }
    });

    return () => {
      disposed = true;
      dataDisposable?.dispose();
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      if (createdTerminalId) {
        void onReleaseSession(createdTerminalId);
      }
    };
  }, [cwd, fitAndResize, onCreateSession, onReleaseSession, onWriteInput]);

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => setCopied(false), 1_200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function writeInput(input: string, nextAction: typeof action = null) {
    if (!session?.terminalId) {
      return;
    }

    setAction(nextAction);
    try {
      setSession(await onWriteInput({ terminalId: session.terminalId, input }));
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : "终端输入失败");
    } finally {
      setAction(null);
    }
  }

  async function handleClear() {
    if (!session?.terminalId) return;
    setAction("clear");
    try {
      terminalRef.current?.clear();
      lastOutputRef.current = "";
      setSession(await onClearSession(session.terminalId));
      terminalRef.current?.focus();
    } finally {
      setAction(null);
    }
  }

  async function handleCopy() {
    if (!session?.output) return;
    setAction("copy");
    try {
      await onCopyText(session.output);
      setCopied(true);
      terminalRef.current?.focus();
    } finally {
      setAction(null);
    }
  }

  async function handleStop() {
    if (!session?.terminalId) return;
    setAction("stop");
    try {
      setSession(await onStopSession(session.terminalId));
      terminalRef.current?.focus();
    } finally {
      setAction(null);
    }
  }

  async function handleRestart() {
    if (!session?.terminalId) return;
    setAction("restart");
    try {
      setError(null);
      terminalRef.current?.reset();
      lastOutputRef.current = "";
      const nextSession = await onRestartSession(session.terminalId);
      sessionIdRef.current = nextSession.terminalId;
      setSession(nextSession);
      if (terminalRef.current) {
        writeSnapshotToTerminal(terminalRef.current, nextSession, lastOutputRef);
        terminalRef.current.focus();
      }
      window.setTimeout(fitAndResize, 40);
    } finally {
      setAction(null);
    }
  }

  const statusLabel = terminalStatusLabel(session, error);
  const statusDetail = terminalStatusDetail(session, error);

  return (
    <section className="terminal-pane advanced">
      <header className="terminal-pane-head">
        <div className="terminal-title-group">
          <span className="terminal-title-icon">
            <TerminalSquare size={15} />
          </span>
          <div className="terminal-title-copy">
            <strong>{session?.shell ?? "终端"}</strong>
            <span title={session?.cwd || cwd}>{session?.cwd || cwd || "当前工作目录"}</span>
          </div>
        </div>

        <div className="terminal-toolbar" aria-label="终端操作">
          <span className={`terminal-status-pill status-${error ? "failed" : session?.status ?? "starting"}`}>
            {action ? <LoaderCircle size={12} className="spin" /> : null}
            {statusLabel}
          </span>
          <button
            aria-label="复制输出"
            className={copied ? "copied" : ""}
            disabled={!session?.output}
            onClick={handleCopy}
            title="复制输出"
            type="button"
          >
            <Clipboard size={14} />
          </button>
          <button
            aria-label="清空输出"
            disabled={!session}
            onClick={handleClear}
            title="清空输出"
            type="button"
          >
            <Trash2 size={14} />
          </button>
          <button
            aria-label="发送 Ctrl+C"
            disabled={!canWrite}
            onClick={() => void writeInput("\x03", "interrupt")}
            title="发送 Ctrl+C"
            type="button"
          >
            <Scissors size={14} />
          </button>
          <button
            aria-label="停止终端"
            disabled={!session || session.status !== "running"}
            onClick={handleStop}
            title="停止终端"
            type="button"
          >
            <Square size={13} />
          </button>
          <button
            aria-label="重启终端"
            disabled={!session}
            onClick={handleRestart}
            title="重启终端"
            type="button"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </header>

      <div className="terminal-xterm-shell">
        {!session?.output && !error ? (
          <div className="terminal-empty-state">
            <TerminalSquare size={18} />
            <strong>{statusDetail}</strong>
          </div>
        ) : null}
        {error ? (
          <div className="terminal-empty-state error">
            <TerminalSquare size={18} />
            <strong>{statusDetail}</strong>
          </div>
        ) : null}
        <div ref={hostRef} className="terminal-xterm-host" aria-label="终端会话" />
        {session?.truncated ? (
          <div className="terminal-truncated">输出较长，复制时只保留最近内容。</div>
        ) : null}
      </div>
    </section>
  );
}
