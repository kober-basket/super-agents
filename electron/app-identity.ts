import { access, cp } from "node:fs/promises";
import path from "node:path";

export const APP_NAME = "super-agents";
export const APP_DATA_DIR = "super-agents";
export const APP_WINDOW_TITLE = APP_NAME;

const LEGACY_APP_DATA_DIRS = ["kober", "openclaw-desktop-workbench"];
async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function migrateLegacyAppData(appDataRoot: string) {
  const targetDir = path.join(appDataRoot, APP_DATA_DIR);
  if (await pathExists(targetDir)) {
    return targetDir;
  }

  for (const legacyDirName of LEGACY_APP_DATA_DIRS) {
    const legacyDir = path.join(appDataRoot, legacyDirName);
    if (!(await pathExists(legacyDir))) {
      continue;
    }

    // Preserve existing local state when the desktop brand changes.
    await cp(legacyDir, targetDir, { recursive: true, force: false });
    return targetDir;
  }

  return targetDir;
}

export function resolveOpencodeConfigDir(appDataRoot: string) {
  return path.join(appDataRoot, APP_DATA_DIR, "opencode");
}

export function resolveGeneratedSupportDir(appDataRoot: string) {
  return path.join(appDataRoot, APP_DATA_DIR, "runtime-support");
}
