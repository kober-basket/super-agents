---
name: super-agents-admin
description: Use when the user asks to inspect, automate, or administer the Super Agents desktop app itself, including model providers, permissions, conversations, memory, skills, MCP, app config, or other local app state.
---

# super-agents-admin

Use the `super-agents` CLI as the primary harness when operating Super Agents itself. Keep output JSON unless a human explicitly wants interactive text.

## Entry Points

Inside Super Agents agent shell, terminal, or MCP-launched child processes, use the built-in command shim:

```bash
super-agents --json <command>
```

Compatibility entry point:

```bash
super-agents-admin --json <command>
```

When developing from the Super Agents source repository and the built-in shim is unavailable:

```bash
npm run cli -- --json <command>
npm run admin -- --json <command>
```

Use `--user-data <path>` when the user points at a specific app data directory. Use `--state-path <path>` or `--db-path <path>` only when the exact file is known.

## Agent Workflow

1. Start with discovery:

```bash
super-agents --json status
super-agents --json tools list
super-agents --json skill list
```

2. Use a named CLI session for multi-step work:

```bash
super-agents --json session new --name "maintenance"
super-agents --session maintenance --json session status
```

3. Prefer reversible config mutations:

```bash
super-agents --session maintenance --json config patch --set "contextTier=low"
super-agents --session maintenance --json session undo
super-agents --session maintenance --json session redo
```

4. For exploratory local control, run the REPL:

```bash
super-agents
```

Inside the REPL, commands are the same, for example `status --json` or `conversation list --json`.

## Common Tasks

Add or update an OpenAI-compatible model provider and select a model:

```bash
super-agents --json model provider add \
  --id "openrouter" \
  --name "OpenRouter" \
  --base-url "https://openrouter.ai/api/v1" \
  --api-key "$OPENROUTER_API_KEY" \
  --model "openai/gpt-5.2:GPT-5.2" \
  --set-active
```

Add another model to an existing provider:

```bash
super-agents --json model add --provider openrouter --id "anthropic/claude-sonnet-4.5" --label "Claude Sonnet 4.5"
```

Enable or disable full filesystem access:

```bash
super-agents --json permission full-access on
super-agents --json permission full-access off
```

List, inspect, rename, export, or delete conversations:

```bash
super-agents --json conversation list
super-agents --json conversation show --id "<conversation-id>"
super-agents --json conversation rename --id "<conversation-id>" --title "新的标题"
super-agents --json conversation export --id "<conversation-id>" --format markdown --out "./conversation.md"
super-agents --json conversation delete --id "<conversation-id>" --yes
```

Manage local structured memory:

```bash
super-agents --json memory add --type project_context --title "CLI preference" --content "Use JSON output for agent automation."
super-agents --json memory search --query "JSON output"
super-agents --json memory delete --id "<memory-id>" --yes
```

Manage MCP server config:

```bash
super-agents --json mcp add --id filesystem --name Files --command node --arg server.js --env FOO=bar
super-agents --json mcp disable --id filesystem
```

Inspect current app config without leaking secrets:

```bash
super-agents --json config show
```

## Safety Rules

- Full filesystem access, conversation deletion, memory deletion, MCP removal, and provider removal are high-trust or destructive operations. Confirm the user's intent before running them.
- Do not print API keys or tokens. The CLI masks secrets by default; do not use `--include-secrets` unless the user explicitly requests it.
- Prefer environment variables for keys in examples and shell commands.
- If an app window is running, tell the user that a restart or refresh may be needed for direct file changes to be reflected everywhere.
