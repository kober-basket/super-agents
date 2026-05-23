# Electron Test Notes

## Super Agents CLI Harness

Focused verification for the agent-facing CLI:

```bash
npx tsc tests/electron/super-agents-admin-cli.test.ts --module NodeNext --target ES2022 --moduleResolution NodeNext --esModuleInterop --skipLibCheck --types node,react,react-dom --outDir .test-dist
node --test .test-dist/tests/electron/super-agents-admin-cli.test.js
```

Covered behavior:

- `status` reports app paths and harness capabilities.
- named CLI sessions record history and undo/redo `workspace.json` mutations.
- model providers, models, full filesystem access, and MCP server config can be managed.
- memory, knowledge base metadata, skill discovery, and tool discovery are machine-readable.
- conversations can be listed, shown, renamed, exported to Markdown, and deleted with `--yes`.
- `super-agents-admin` remains a compatible entry point and `super-agents` can process stdin commands as a REPL.
