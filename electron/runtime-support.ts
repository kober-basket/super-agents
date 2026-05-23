import { stat } from "node:fs/promises";
import path from "node:path";

type EnvRecord = Record<string, string | undefined>;

export interface RuntimeSupportOptions {
  runtimeRoot?: string;
  generatedRuntimeRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

function runtimePlatformKey(options: RuntimeSupportOptions = {}) {
  return `${options.platform ?? process.platform}-${options.arch ?? process.arch}`;
}

function electronResourcesPath() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === "string" && resourcesPath.trim() ? resourcesPath : "";
}

function isPackagedElectronRuntime() {
  return (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp !== true;
}

export function getRuntimeSupportRoot(options: RuntimeSupportOptions = {}) {
  const explicitRoot = options.runtimeRoot?.trim() || process.env.SUPER_AGENTS_RUNTIME_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const resourcesPath = electronResourcesPath();
  if (resourcesPath && isPackagedElectronRuntime()) {
    return path.join(resourcesPath, "runtime");
  }

  return path.resolve(process.cwd(), "vendor", "runtime");
}

export function getGeneratedRuntimeSupportRoot(options: RuntimeSupportOptions = {}) {
  const explicitRoot =
    options.generatedRuntimeRoot?.trim() || process.env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT?.trim();
  return explicitRoot ? path.resolve(explicitRoot) : "";
}

async function isDirectory(directoryPath: string) {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

function runtimeBinCandidates(runtimeRoot: string, options: RuntimeSupportOptions = {}) {
  const platform = options.platform ?? process.platform;
  const platformRoot = path.join(runtimeRoot, runtimePlatformKey(options));
  return [
    path.join(platformRoot, "bin"),
    platform === "win32" ? path.join(platformRoot, "node") : path.join(platformRoot, "node", "bin"),
    platform === "win32" ? path.join(platformRoot, "python") : path.join(platformRoot, "python", "bin"),
    path.join(runtimeRoot, "common", "bin"),
  ];
}

function generatedRuntimeBinCandidates(runtimeRoot: string, options: RuntimeSupportOptions = {}) {
  const platformRoot = path.join(runtimeRoot, runtimePlatformKey(options));
  return [
    path.join(platformRoot, "bin"),
    path.join(runtimeRoot, "common", "bin"),
  ];
}

export async function getRuntimeSupportBinDirs(options: RuntimeSupportOptions = {}) {
  const runtimeRoot = getRuntimeSupportRoot(options);
  const generatedRuntimeRoot = getGeneratedRuntimeSupportRoot(options);
  const candidates = [
    ...(generatedRuntimeRoot ? generatedRuntimeBinCandidates(generatedRuntimeRoot, options) : []),
    ...runtimeBinCandidates(runtimeRoot, options),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

function getPathKey(env: EnvRecord, platform: NodeJS.Platform) {
  if (platform !== "win32") {
    return "PATH";
  }

  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function removeDuplicateWindowsPathKeys(env: EnvRecord, keepKey: string, platform: NodeJS.Platform) {
  if (platform !== "win32") return;
  for (const key of Object.keys(env)) {
    if (key !== keepKey && key.toLowerCase() === "path") {
      delete env[key];
    }
  }
}

function compactEnv(env: EnvRecord) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export async function createRuntimeProcessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: RuntimeSupportOptions = {},
) {
  const platform = options.platform ?? process.platform;
  const env: EnvRecord = { ...baseEnv };
  const runtimeDirs = await getRuntimeSupportBinDirs(options);
  const pathKey = getPathKey(env, platform);
  const currentPath = env[pathKey] ?? "";
  const nextPath = [...runtimeDirs, currentPath].filter(Boolean).join(path.delimiter);

  if (nextPath) {
    env[pathKey] = nextPath;
  }
  removeDuplicateWindowsPathKeys(env, pathKey, platform);
  env.SUPER_AGENTS_RUNTIME_ROOT = getRuntimeSupportRoot(options);
  const generatedRuntimeRoot = getGeneratedRuntimeSupportRoot(options);
  if (generatedRuntimeRoot) {
    env.SUPER_AGENTS_GENERATED_RUNTIME_ROOT = generatedRuntimeRoot;
  }
  return compactEnv(env);
}

function windowsCommandCandidates(command: string) {
  const extension = path.extname(command);
  if (extension) return [command];
  return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command];
}

export async function resolveRuntimeCommand(command: string, options: RuntimeSupportOptions = {}) {
  const trimmed = command.trim();
  if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
    return trimmed;
  }

  const platform = options.platform ?? process.platform;
  const names = platform === "win32" ? windowsCommandCandidates(trimmed) : [trimmed];
  for (const directory of await getRuntimeSupportBinDirs(options)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (await isDirectory(path.dirname(candidate))) {
        try {
          const candidateStat = await stat(candidate);
          if (candidateStat.isFile()) {
            return candidate;
          }
        } catch {
          // Keep looking through PATH-like runtime directories.
        }
      }
    }
  }

  return trimmed;
}
