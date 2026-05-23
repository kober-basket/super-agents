---
name: super-agents-admin
description: Use when the user asks to inspect, automate, or administer the Super Agents desktop app itself, including model providers, permissions, conversations, memory, skills, MCP, app config, or other local app state.
---

# super-agents-admin

Use the `super-agents` CLI as the primary harness when operating Super Agents itself. Keep output JSON unless a human explicitly wants interactive text.

## Entry Points

From the Super Agents source repository:

```bash
npm run cli -- --json <command>
```

Compatibility entry point:

```bash
npm run admin -- --json <command>
```

Installed package bins:

```bash
super-agents --json <command>
super-agents-admin --json <command>
```

Use `--user-data <path>` when the user points at a specific app data directory. Use `--state-path <path>` or `--db-path <path>` only when the exact file is known.

## Agent Workflow

1. Start with discovery:

```bash
npm run cli -- --json status
npm run cli -- --json tools list
npm run cli -- --json skill list
```

2. Use a named CLI session for multi-step work:

```bash
npm run cli -- --json session new --name "maintenance"
npm run cli -- --session maintenance --json session status
```

3. Prefer reversible config mutations:

```bash
npm run cli -- --session maintenance --json config patch --set "contextTier=low"
npm run cli -- --session maintenance --json session undo
npm run cli -- --session maintenance --json session redo
```

4. For exploratory local control, run the REPL:

```bash
npm run cli --
```

Inside the REPL, commands are the same, for example `status --json` or `conversation list --json`.

## Common Tasks

Add or update an OpenAI-compatible model provider and select a model:

```bash
npm run cli -- --json model provider add \
  --id "openrouter" \
  --name "OpenRouter" \
  --base-url "https://openrouter.ai/api/v1" \
  --api-key "$OPENROUTER_API_KEY" \
  --model "openai/gpt-5.2:GPT-5.2" \
  --set-active
```

Add another model to an existing provider:

```bash
npm run cli -- --json model add --provider openrouter --id "anthropic/claude-sonnet-4.5" --label "Claude Sonnet 4.5"
```

Enable or disable full filesystem access:

```bash
npm run cli -- --json permission full-access on
npm run cli -- --json permission full-access off
```

List, inspect, rename, export, or delete conversations:

```bash
npm run cli -- --json conversation list
npm run cli -- --json conversation show --id "<conversation-id>"
npm run cli -- --json conversation rename --id "<conversation-id>" --title "新的标题"
npm run cli -- --json conversation export --id "<conversation-id>" --format markdown --out "./conversation.md"
npm run cli -- --json conversation delete --id "<conversation-id>" --yes
```

Manage local structured memory:

```bash
npm run cli -- --json memory add --type project_context --title "CLI preference" --content "Use JSON output for agent automation."
npm run cli -- --json memory search --query "JSON output"
npm run cli -- --json memory delete --id "<memory-id>" --yes
```

Manage MCP server config:

```bash
npm run cli -- --json mcp add --id filesystem --name Files --command node --arg server.js --env FOO=bar
npm run cli -- --json mcp disable --id filesystem
```

Inspect current app config without leaking secrets:

```bash
npm run cli -- --json config show
```

## Safety Rules

- Full filesystem access, conversation deletion, memory deletion, MCP removal, and provider removal are high-trust or destructive operations. Confirm the user's intent before running them.
- Do not print API keys or tokens. The CLI masks secrets by default; do not use `--include-secrets` unless the user explicitly requests it.
- Prefer environment variables for keys in examples and shell commands.
- If an app window is running, tell the user that a restart or refresh may be needed for direct file changes to be reflected everywhere.
