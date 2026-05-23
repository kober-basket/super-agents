# Bundled Runtime Layout

This directory is copied into Electron `resources/runtime` by electron-builder.
It is intentionally not populated in source control with large runtime binaries.

Expected layout for release builds:

```text
vendor/runtime/
  win32-x64/
    bin/
      python3.cmd
      uv.exe
      uvx.exe
      uvw.exe
    node/
      node.exe
      npm.cmd
      npx.cmd
      node_modules/npm/...
    python/
      python.exe
      python*.zip
      DLLs/...
  darwin-arm64/
    bin/
      uv
      uvx
    node/bin/node
    node/bin/npm
    node/bin/npx
  darwin-x64/
    bin/
      uv
      uvx
    node/bin/node
    node/bin/npm
    node/bin/npx
  common/
    bin/
```

Set `SUPER_AGENTS_RUNTIME_ROOT` to test another runtime directory locally.
Run `npm run runtime:check` before `npm run package:runtime`.
