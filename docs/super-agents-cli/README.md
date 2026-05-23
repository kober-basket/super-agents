# Super Agents CLI Harness

`super-agents` is the agent-facing command harness for administering the desktop app itself. It follows the CLI-Anything idea: expose app capabilities as discoverable, JSON-first, scriptable operations that an agent can inspect before mutating.

## Entry Points

```bash
npm run cli -- --help
npm run cli -- --json status
npm run admin -- --json status
```

`super-agents-admin` remains a compatibility alias. New automation should prefer `super-agents`.

## Design Rules

- JSON-first: use `--json` for every command that another agent needs to parse.
- Discoverable: `status`, `tools list`, `skill list`, and `session status` are safe first calls.
- Stateful when useful: named CLI sessions store history and undo/redo stacks under `userData/cli/sessions`.
- Reversible config changes: config/model/MCP/permission/skill mutations snapshot `workspace.json` and can be undone with `session undo`.
- Conservative destructive actions: delete/remove commands require `--yes`.
- Secret-safe reads: config and provider outputs mask secrets unless `--include-secrets` is explicitly provided.

## Command Groups

```bash
super-agents --json status
super-agents --json session new --name maintenance
super-agents --session maintenance --json config patch --set contextTier=low
super-agents --session maintenance --json session undo

super-agents --json model provider add --id openrouter --name OpenRouter --base-url https://openrouter.ai/api/v1 --api-key "$OPENROUTER_API_KEY" --model "openai/gpt-5.2:GPT-5.2" --set-active
super-agents --json model add --provider openrouter --id "anthropic/claude-sonnet-4.5" --label "Claude Sonnet 4.5"
super-agents --json permission full-access on

super-agents --json conversation list
super-agents --json conversation show --id "<conversation-id>"
super-agents --json conversation export --id "<conversation-id>" --format markdown --out "./conversation.md"
super-agents --json conversation delete --id "<conversation-id>" --yes

super-agents --json memory add --type project_context --title "Policy" --content "Prefer JSON for CLI automation."
super-agents --json knowledge base create --id product --name "Product Notes"
super-agents --json mcp add --id filesystem --name Files --command node --arg server.js --env FOO=bar
super-agents --json skill list
super-agents --json tools list
```

## REPL

Running without a command starts a small REPL:

```bash
npm run cli --
```

Example input:

```text
status --json
conversation list --json
exit
```

The REPL keeps the global paths from startup, so `npm run cli -- --user-data <path>` makes every entered command target that app data directory.
