import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeProcessEnv, getRuntimeSupportBinDirs } from "../../electron/runtime-support";

test("runtime support prepends platform runtime directories to PATH", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-"));
  const platformKey = `${process.platform}-${process.arch}`;

  try {
    const commonBin = path.join(runtimeRoot, "common", "bin");
    const platformBin = path.join(runtimeRoot, platformKey, "bin");
    const nodeBin =
      process.platform === "win32"
        ? path.join(runtimeRoot, platformKey, "node")
        : path.join(runtimeRoot, platformKey, "node", "bin");
    const pythonBin =
      process.platform === "win32"
        ? path.join(runtimeRoot, platformKey, "python")
        : path.join(runtimeRoot, platformKey, "python", "bin");

    await mkdir(commonBin, { recursive: true });
    await mkdir(platformBin, { recursive: true });
    await mkdir(nodeBin, { recursive: true });
    await mkdir(pythonBin, { recursive: true });

    const dirs = await getRuntimeSupportBinDirs({ runtimeRoot });

    assert.deepEqual(dirs, [platformBin, nodeBin, pythonBin, commonBin]);

    const basePathKey = process.platform === "win32" ? "Path" : "PATH";
    const env = await createRuntimeProcessEnv({ [basePathKey]: "system-path" }, { runtimeRoot });
    const pathValue = env[basePathKey] ?? "";
    assert.equal(pathValue, [platformBin, nodeBin, pythonBin, commonBin, "system-path"].join(path.delimiter));
    assert.equal(env.SUPER_AGENTS_RUNTIME_ROOT, runtimeRoot);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("runtime support prepends generated command shims before bundled runtime directories", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-"));
  const generatedRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-generated-runtime-"));
  const platformKey = `${process.platform}-${process.arch}`;
  const originalGeneratedRoot = process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT;

  try {
    const generatedPlatformBin = path.join(generatedRoot, platformKey, "bin");
    const generatedCommonBin = path.join(generatedRoot, "common", "bin");
    const platformBin = path.join(runtimeRoot, platformKey, "bin");

    await mkdir(generatedPlatformBin, { recursive: true });
    await mkdir(generatedCommonBin, { recursive: true });
    await mkdir(platformBin, { recursive: true });

    process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT = generatedRoot;

    const dirs = await getRuntimeSupportBinDirs({ runtimeRoot });

    assert.deepEqual(dirs, [generatedPlatformBin, generatedCommonBin, platformBin]);

    const basePathKey = process.platform === "win32" ? "Path" : "PATH";
    const env = await createRuntimeProcessEnv({ [basePathKey]: "system-path" }, { runtimeRoot });
    const pathValue = env[basePathKey] ?? "";

    assert.equal(pathValue, [generatedPlatformBin, generatedCommonBin, platformBin, "system-path"].join(path.delimiter));
  } finally {
    if (originalGeneratedRoot === undefined) {
      delete process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT;
    } else {
      process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT = originalGeneratedRoot;
    }
    await rm(runtimeRoot, { recursive: true, force: true });
    await rm(generatedRoot, { recursive: true, force: true });
  }
});
