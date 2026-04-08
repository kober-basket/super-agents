# super-agents

Electron desktop agent client built on OpenCode, Vite, React, and TypeScript.

## Development

1. Install dependencies:

```bash
npm install
```

2. Make sure `opencode` is available on your machine:

- install it globally so `opencode` is on `PATH`, or
- set `OPENCODE_PATH` to the executable location

3. Start the app:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Notes

- The repository intentionally does not commit local build output, caches, logs, or bundled runtime binaries.
- If you already have older local app data under `kober`, the app migrates it to `super-agents` on startup.
