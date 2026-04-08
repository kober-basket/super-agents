# super-agents

Electron desktop agent client built on OpenCode, Vite, React, and TypeScript.

## Development

1. Install dependencies:

```bash
npm install
```

2. On Windows, the app uses the vendored OpenCode runtime at `vendor/opencode/windows-x64/opencode.exe`.
   On other platforms, keep using a local `opencode` install or set `OPENCODE_PATH`.

3. Start the app:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Notes

- The repository intentionally does not commit local build output, caches, or logs.
- The Windows OpenCode runtime is checked in via Git LFS so fresh clones can run without a machine-wide install.
- If you already have older local app data under `kober`, the app migrates it to `super-agents` on startup.
