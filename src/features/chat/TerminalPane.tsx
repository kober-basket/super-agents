import { useState, type FormEvent } from "react";
import { TerminalSquare } from "lucide-react";

import type { TerminalCommandResult } from "../../types";

interface TerminalPaneProps {
  cwd: string;
  onRunCommand: (payload: { command: string; cwd?: string; workspaceRoot?: string }) => Promise<TerminalCommandResult>;
}

type TerminalLine =
  | { id: string; kind: "command"; text: string }
  | { id: string; kind: "output"; text: string; exitCode: number };

export function TerminalPane({ cwd, onRunCommand }: TerminalPaneProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCommand = command.trim();
    if (!nextCommand || running) {
      return;
    }

    setCommand("");
    setRunning(true);
    const commandId = `terminal-command-${Date.now()}`;
    setLines((current) => [...current, { id: commandId, kind: "command", text: nextCommand }]);

    try {
      const result = await onRunCommand({ command: nextCommand, cwd, workspaceRoot: cwd });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      setLines((current) => [
        ...current,
        {
          id: `${commandId}-output`,
          kind: "output",
          text: output || `(exit ${result.exitCode})`,
          exitCode: result.exitCode,
        },
      ]);
    } catch (error) {
      setLines((current) => [
        ...current,
        {
          id: `${commandId}-error`,
          kind: "output",
          text: error instanceof Error ? error.message : "命令执行失败",
          exitCode: 1,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="terminal-pane">
      <header className="terminal-pane-head">
        <TerminalSquare size={15} />
        <span>{cwd || "当前工作目录"}</span>
      </header>
      <div className="terminal-pane-output" aria-live="polite">
        {lines.length === 0 ? <span className="terminal-muted">输入命令后按 Enter 执行</span> : null}
        {lines.map((line) =>
          line.kind === "command" ? (
            <div className="terminal-command-line" key={line.id}>
              <span>$</span>
              <strong>{line.text}</strong>
            </div>
          ) : (
            <pre className={line.exitCode === 0 ? "" : "error"} key={line.id}>{line.text}</pre>
          ),
        )}
      </div>
      <form className="terminal-command-form" onSubmit={handleSubmit}>
        <span>$</span>
        <input
          aria-label="终端命令"
          disabled={running}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={running ? "正在执行..." : "输入命令"}
          spellCheck={false}
          value={command}
        />
      </form>
    </section>
  );
}
