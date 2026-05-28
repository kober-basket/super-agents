# Bundled Runtime Layout

This directory is copied into Electron `resources/runtime` by electron-builder.
It is intentionally not populated in source control with large runtime binaries.
Pinned runtime versions, download URLs, and SHA256 checksums live in
`vendor/runtime/manifest.json`.

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
  win32-arm64/
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
      python
      python3
    node/bin/node
    node/bin/npm
    node/bin/npx
    python/
      cpython-3.13-macos-aarch64-none -> cpython-3.13.13-macos-aarch64-none
  darwin-x64/
    bin/
      uv
      uvx
      python
      python3
    node/bin/node
    node/bin/npm
    node/bin/npx
    python/
      cpython-3.13-macos-x86_64-none -> cpython-3.13.13-macos-x86_64-none
  common/
    bin/
```

macOS Python is installed by `scripts/install-runtime.mjs` through the bundled
`uv` binary, using the pinned Python target in `manifest.json`. Python package
dependencies for large optional capabilities, such as document processing, are
not bundled here. They are installed lazily into the generated runtime support
directory by `super-agents-document-runtime`.

Set `SUPER_AGENTS_RUNTIME_ROOT` to test another runtime directory locally.
Run `npm run runtime:install` after cloning or when refreshing runtime binaries.
Then run `npm run runtime:check` before `npm run package:runtime`.
For Windows release builds, run `npm run runtime:check:win` before
`npm run package:runtime:win` to verify and package both x64 and arm64.
