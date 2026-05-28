import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface CliCommand {
  name: string;
  scriptFile: string;
}

export interface CliShimInstallOptions {
  appPath: string;
  runtimeRoot: string;
  platform?: NodeJS.Platform;
}

export interface InstalledCliCommand {
  name: string;
  scriptPath: string;
  shimPath: string;
}

const CLI_COMMANDS: CliCommand[] = [
  { name: "super-agents", scriptFile: "super-agents.mjs" },
  { name: "super-agents-admin", scriptFile: "super-agents-admin.mjs" },
  { name: "super-agents-document-runtime", scriptFile: "super-agents-document-runtime.mjs" },
];

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCliScriptsRoot(appPath: string) {
  const candidates = [
    path.join(appPath, "scripts"),
    path.join(path.dirname(appPath), "scripts"),
    path.join(process.cwd(), "scripts"),
  ];

  for (const candidate of candidates) {
    const hasAllScripts = await Promise.all(
      CLI_COMMANDS.map((command) => pathExists(path.join(candidate, command.scriptFile))),
    );
    if (hasAllScripts.every(Boolean)) {
      return candidate;
    }
  }

  throw new Error(`Super Agents CLI scripts were not found near app path: ${appPath}`);
}

function posixShim(scriptFile: string) {
  return [
    "#!/bin/sh",
    'SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)',
    `exec node "$SCRIPT_DIR/../../cli/${scriptFile}" "$@"`,
    "",
  ].join("\n");
}

function windowsShim(scriptFile: string) {
  return [
    "@echo off",
    "setlocal",
    "set \"SCRIPT_DIR=%~dp0\"",
    `node "%SCRIPT_DIR%..\\..\\cli\\${scriptFile}" %*`,
    "",
  ].join("\r\n");
}

function shimFileName(commandName: string, platform: NodeJS.Platform) {
  return platform === "win32" ? `${commandName}.cmd` : commandName;
}

function shimContent(scriptFile: string, platform: NodeJS.Platform) {
  return platform === "win32" ? windowsShim(scriptFile) : posixShim(scriptFile);
}

async function copyCliScript(scriptsRoot: string, runtimeRoot: string, scriptFile: string) {
  const sourcePath = path.join(scriptsRoot, scriptFile);
  const targetPath = path.join(runtimeRoot, "cli", scriptFile);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, await readFile(sourcePath), "utf8");
  return targetPath;
}

async function writeCommandShim(runtimeRoot: string, command: CliCommand, platform: NodeJS.Platform) {
  const targetPath = path.join(runtimeRoot, "common", "bin", shimFileName(command.name, platform));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, shimContent(command.scriptFile, platform), "utf8");
  if (platform !== "win32") {
    await chmod(targetPath, 0o755);
  }
  return targetPath;
}

export async function installCliShims(options: CliShimInstallOptions) {
  const appPath = path.resolve(options.appPath);
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const platform = options.platform ?? process.platform;
  const scriptsRoot = await resolveCliScriptsRoot(appPath);
  const commands: InstalledCliCommand[] = [];

  for (const command of CLI_COMMANDS) {
    const scriptPath = await copyCliScript(scriptsRoot, runtimeRoot, command.scriptFile);
    const shimPath = await writeCommandShim(runtimeRoot, command, platform);
    commands.push({ name: command.name, scriptPath, shimPath });
  }

  return { commands };
}
