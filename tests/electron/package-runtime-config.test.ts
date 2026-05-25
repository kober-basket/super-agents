import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function repoRoot() {
  return path.basename(process.cwd()) === ".test-dist" ? path.dirname(process.cwd()) : process.cwd();
}

test("package config exposes Windows runtime scripts and consistent artifact names", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    build: {
      mac: {
        artifactName: string;
      };
      win: {
        artifactName: string;
        extraResources: Array<{ from: string; to: string; filter: string[] }>;
      };
    };
  };

  assert.equal(
    pkg.scripts["runtime:check:win:x64"],
    "cross-env SUPER_AGENTS_RUNTIME_PLATFORM=win32 SUPER_AGENTS_RUNTIME_ARCH=x64 node scripts/check-runtime.mjs",
  );
  assert.equal(
    pkg.scripts["runtime:check:win:arm64"],
    "cross-env SUPER_AGENTS_RUNTIME_PLATFORM=win32 SUPER_AGENTS_RUNTIME_ARCH=arm64 node scripts/check-runtime.mjs",
  );
  assert.equal(pkg.scripts["runtime:check:win"], "npm run runtime:check:win:x64 && npm run runtime:check:win:arm64");
  assert.equal(
    pkg.scripts["package:runtime:win:x64"],
    "npm run runtime:check:win:x64 && npm run build && electron-builder --win --x64",
  );
  assert.equal(
    pkg.scripts["package:runtime:win:arm64"],
    "npm run runtime:check:win:arm64 && npm run build && electron-builder --win --arm64",
  );
  assert.equal(
    pkg.scripts["package:runtime:win"],
    "npm run runtime:check:win && npm run build && electron-builder --win --x64 && electron-builder --win --arm64",
  );

  assert.equal(pkg.build.mac.artifactName, "${productName}-${version}-${arch}.${ext}");
  assert.equal(pkg.build.win.artifactName, "${productName}-${version}-${arch}.${ext}");
  assert.deepEqual(pkg.build.win.extraResources, [
    {
      from: "vendor/runtime/win32-${arch}",
      to: "runtime/win32-${arch}",
      filter: ["**/*"],
    },
  ]);
});
