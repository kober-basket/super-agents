#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.dirname(path.dirname(scriptPath));

const BUILTIN_GROUPS = {
  "docx-basic": {
    description: "Word document unpack/edit/validate helpers",
    requirements: [
      "defusedxml==0.7.1",
      "lxml>=6.0.0,<7",
      "python-docx>=1.2.0,<2",
    ],
  },
  "xlsx-basic": {
    description: "Excel and CSV creation, editing, and analysis",
    requirements: [
      "openpyxl>=3.1.5,<4",
      "pandas>=2.2.0,<4",
      "xlsxwriter>=3.2.0,<4",
    ],
  },
  "pptx-basic": {
    description: "PowerPoint XML helpers, thumbnails, and text extraction",
    requirements: [
      "defusedxml==0.7.1",
      "Pillow>=12.0.0,<13",
      "python-pptx>=1.0.2,<2",
      "markitdown[pptx]>=0.1.6,<0.2",
    ],
  },
  "pdf-basic": {
    description: "Basic PDF parsing, writing, forms, and image conversion wrappers",
    requirements: [
      "pypdf>=6.0.0,<7",
      "pdfplumber>=0.11.0,<0.12",
      "pdf2image>=1.17.0,<2",
      "Pillow>=12.0.0,<13",
      "reportlab>=4.4.0,<5",
    ],
  },
  "pdfkit-core": {
    description: "Core advanced PDF toolkit dependencies",
    requirements: [
      "PyMuPDF>=1.27.0,<2",
      "pypdf>=6.0.0,<7",
      "Pillow>=12.0.0,<13",
      "reportlab>=4.4.0,<5",
      "numpy>=2.3.0,<3",
      "pdfplumber>=0.11.0,<0.12",
      "pytesseract>=0.3.13,<0.4",
      "markdown>=3.10.0,<4",
      "python-docx>=1.2.0,<2",
      "fonttools>=4.60.0,<5",
    ],
  },
  "pdfkit-optional": {
    description: "Optional PDF table extraction, Word conversion, and compression packages",
    requirements: [
      "camelot-py>=1.0.9,<2",
      "tabula-py>=2.10.0,<3",
      "pdf2docx>=0.5.13,<0.6",
      "pikepdf>=10.0.0,<11",
      "opencv-python-headless>=4.13.0,<5",
    ],
  },
  "pdfkit-formula": {
    description: "Formula detection model dependencies; large and installed only on demand",
    requirements: [
      "pix2tex>=0.1.4,<0.2",
    ],
  },
};

function usage() {
  return `Usage:
  super-agents-document-runtime list [--json]
  super-agents-document-runtime ensure <group> [--json] [--print-python]
  super-agents-document-runtime python <group> -- <python-args...>

Environment:
  SUPER_AGENTS_RUNTIME_ROOT                 Bundled runtime root
  SUPER_AGENTS_GENERATED_RUNTIME_ROOT       Writable generated runtime root
  SUPER_AGENTS_DOCUMENT_REQUIREMENTS_ROOT   Optional requirements override for tests/dev
`;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function defaultRuntimeRoot() {
  return path.resolve(process.env.SUPER_AGENTS_RUNTIME_ROOT || path.join(repoRoot, "vendor", "runtime"));
}

function defaultGeneratedRuntimeRoot() {
  if (process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT?.trim()) {
    return path.resolve(process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "super-agents", "runtime-support");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "super-agents", "runtime-support");
  }
  return path.join(os.homedir(), ".local", "share", "super-agents", "runtime-support");
}

function commandName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function scriptName(baseName) {
  return process.platform === "win32" ? `${baseName}.cmd` : baseName;
}

async function resolveUv(runtimeRoot) {
  const candidate = path.join(runtimeRoot, platformKey(), "bin", commandName("uv"));
  return (await exists(candidate)) ? candidate : "uv";
}

async function resolveBundledPython(runtimeRoot) {
  const platformRoot = path.join(runtimeRoot, platformKey());
  const candidates =
    process.platform === "win32"
      ? [
          path.join(platformRoot, "bin", "python3.cmd"),
          path.join(platformRoot, "python", "python.exe"),
        ]
      : [
          path.join(platformRoot, "bin", "python3"),
          path.join(platformRoot, "python", "bin", "python3"),
        ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Bundled Python was not found in ${platformRoot}. Run npm run runtime:install first.`);
}

async function requirementContent(groupName) {
  const overrideRoot = process.env.SUPER_AGENTS_DOCUMENT_REQUIREMENTS_ROOT?.trim();
  if (overrideRoot) {
    return await readFile(path.join(path.resolve(overrideRoot), `${groupName}.txt`), "utf8");
  }

  const group = BUILTIN_GROUPS[groupName];
  if (!group) {
    throw new Error(`Unknown document runtime dependency group: ${groupName}`);
  }
  return `${group.requirements.join("\n")}\n`;
}

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

function envPythonPath(envDir) {
  return process.platform === "win32"
    ? path.join(envDir, "Scripts", "python.exe")
    : path.join(envDir, "bin", "python");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.forwardOutputToStderr ? ["ignore", "pipe", "pipe"] : options.stdio || "inherit",
    });
    if (options.forwardOutputToStderr) {
      child.stdout?.pipe(process.stderr);
      child.stderr?.pipe(process.stderr);
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function ensureGroup(groupName) {
  const requirements = await requirementContent(groupName);
  const requirementsHash = hashContent(requirements);
  const runtimeRoot = defaultRuntimeRoot();
  const generatedRoot = defaultGeneratedRuntimeRoot();
  const envRoot = path.join(generatedRoot, "document-envs");
  const envDir = path.join(envRoot, `${groupName}-${requirementsHash.slice(0, 12)}`);
  const metadataPath = path.join(envDir, ".super-agents-document-runtime.json");
  const pythonPath = envPythonPath(envDir);
  const metadata = await readJson(metadataPath);

  if (metadata?.requirementsHash === requirementsHash && metadata?.group === groupName && (await exists(pythonPath))) {
    return { group: groupName, envDir, pythonPath, requirementsHash, installed: false };
  }

  const uv = await resolveUv(runtimeRoot);
  const bundledPython = await resolveBundledPython(runtimeRoot);
  const requirementsFile = path.join(envRoot, "requirements", `${groupName}-${requirementsHash.slice(0, 12)}.txt`);

  await mkdir(path.dirname(requirementsFile), { recursive: true });
  await writeFile(requirementsFile, requirements, "utf8");

  await run(uv, ["venv", "--python", bundledPython, envDir], { forwardOutputToStderr: true });
  await run(uv, ["pip", "install", "--python", pythonPath, "-r", requirementsFile], { forwardOutputToStderr: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        group: groupName,
        requirementsHash,
        requirementsFile,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  return { group: groupName, envDir, pythonPath, requirementsHash, installed: true };
}

function printList(json) {
  const groups = Object.entries(BUILTIN_GROUPS).map(([name, info]) => ({
    name,
    description: info.description,
    packageCount: info.requirements.length,
  }));
  if (json) {
    process.stdout.write(`${JSON.stringify({ groups }, null, 2)}\n`);
    return;
  }
  for (const group of groups) {
    process.stdout.write(`${group.name}\t${group.description}\n`);
  }
}

function parseFlags(args) {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const positionals = args.filter((arg) => !arg.startsWith("--"));
  return { flags, positionals };
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    process.stdout.write(usage());
    return;
  }

  if (command === "list") {
    const { flags } = parseFlags(rest);
    printList(flags.has("--json"));
    return;
  }

  if (command === "ensure") {
    const { flags, positionals } = parseFlags(rest);
    const groupName = positionals[0];
    if (!groupName) {
      throw new Error("ensure requires a dependency group name");
    }
    const result = await ensureGroup(groupName);
    if (flags.has("--print-python")) {
      process.stdout.write(`${result.pythonPath}\n`);
    } else if (flags.has("--json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${result.pythonPath}\n`);
    }
    return;
  }

  if (command === "python") {
    const separatorIndex = rest.indexOf("--");
    const groupName = separatorIndex >= 0 ? rest[0] : undefined;
    if (!groupName || separatorIndex < 0) {
      throw new Error("python requires a dependency group and -- before Python arguments");
    }
    const result = await ensureGroup(groupName);
    const pythonArgs = rest.slice(separatorIndex + 1);
    await run(result.pythonPath, pythonArgs);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
