import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function repoRoot() {
  return path.basename(process.cwd()) === ".test-dist" ? path.dirname(process.cwd()) : process.cwd();
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function documentRuntimeScript() {
  return path.join(repoRoot(), "scripts", "super-agents-document-runtime.mjs");
}

test("document runtime CLI creates a uv-managed dependency environment once", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-document-runtime-"));
  const runtimeRoot = path.join(tempDir, "runtime");
  const generatedRuntimeRoot = path.join(tempDir, "generated-runtime");
  const requirementsRoot = path.join(tempDir, "requirements");
  const platformKey = `${process.platform}-${process.arch}`;
  const runtimeBin = path.join(runtimeRoot, platformKey, "bin");
  const fakeUvLog = path.join(tempDir, "uv.log");

  try {
    await mkdir(runtimeBin, { recursive: true });
    await mkdir(requirementsRoot, { recursive: true });
    await writeFile(path.join(requirementsRoot, "docx-basic.txt"), "defusedxml==0.7.1\n", "utf8");
    await writeFile(path.join(runtimeBin, "python3"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(
      path.join(runtimeBin, "uv"),
      [
        "#!/bin/sh",
        "echo uv progress line",
        `printf '%s\\n' "$*" >> ${JSON.stringify(fakeUvLog)}`,
        "if [ \"$1\" = \"venv\" ]; then",
        "  env_dir=\"$4\"",
        "  mkdir -p \"$env_dir/bin\"",
        "  printf '#!/bin/sh\\nexit 0\\n' > \"$env_dir/bin/python\"",
        "  chmod +x \"$env_dir/bin/python\"",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = spawnSync(process.execPath, [documentRuntimeScript(), "ensure", "docx-basic", "--json"], {
      cwd: repoRoot(),
      env: {
        ...process.env,
        SUPER_AGENTS_RUNTIME_ROOT: runtimeRoot,
        SUPER_AGENTS_GENERATED_RUNTIME_ROOT: generatedRuntimeRoot,
        SUPER_AGENTS_DOCUMENT_REQUIREMENTS_ROOT: requirementsRoot,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout) as { group: string; pythonPath: string; installed: boolean };
    assert.equal(payload.group, "docx-basic");
    assert.equal(payload.installed, true);
    assert.match(payload.pythonPath, /document-envs[\\/].+[\\/]bin[\\/]python$/);
    assert.equal(await pathExists(payload.pythonPath), true);

    const firstLog = await readFile(fakeUvLog, "utf8");
    assert.match(firstLog, /venv --python/);
    assert.match(firstLog, /pip install --python/);

    const second = spawnSync(process.execPath, [documentRuntimeScript(), "ensure", "docx-basic", "--json"], {
      cwd: repoRoot(),
      env: {
        ...process.env,
        SUPER_AGENTS_RUNTIME_ROOT: runtimeRoot,
        SUPER_AGENTS_GENERATED_RUNTIME_ROOT: generatedRuntimeRoot,
        SUPER_AGENTS_DOCUMENT_REQUIREMENTS_ROOT: requirementsRoot,
      },
      encoding: "utf8",
    });

    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondPayload = JSON.parse(second.stdout) as { installed: boolean; pythonPath: string };
    assert.equal(secondPayload.installed, false);
    assert.equal(secondPayload.pythonPath, payload.pythonPath);
    assert.equal(await readFile(fakeUvLog, "utf8"), firstLog);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
