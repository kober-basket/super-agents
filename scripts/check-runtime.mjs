import { access } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const runtimeRoot = path.resolve(process.env.SUPER_AGENTS_RUNTIME_ROOT || path.join(repoRoot, "vendor", "runtime"));
const platformKey = `${process.platform}-${process.arch}`;
const platformRoot = path.join(runtimeRoot, platformKey);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function commandPath(name) {
  if (process.platform === "win32") {
    return path.join(platformRoot, "node", name);
  }
  return path.join(platformRoot, "node", "bin", name);
}

const required = [
  commandPath(process.platform === "win32" ? "node.exe" : "node"),
  commandPath(process.platform === "win32" ? "npm.cmd" : "npm"),
  commandPath(process.platform === "win32" ? "npx.cmd" : "npx"),
];

if (process.platform === "win32") {
  required.push(path.join(platformRoot, "python", "python.exe"));
  required.push(path.join(platformRoot, "bin", "python3.cmd"));
}

const missing = [];
for (const filePath of required) {
  if (!(await exists(filePath))) {
    missing.push(path.relative(repoRoot, filePath));
  }
}

if (missing.length > 0) {
  console.error(`Missing bundled runtime files for ${platformKey}:`);
  for (const filePath of missing) {
    console.error(`- ${filePath}`);
  }
  console.error("");
  console.error("Expected layout:");
  console.error(`- vendor/runtime/${platformKey}/node/...`);
  if (process.platform === "win32") {
    console.error(`- vendor/runtime/${platformKey}/python/python.exe`);
    console.error(`- vendor/runtime/${platformKey}/bin/python3.cmd`);
  }
  process.exit(1);
}

console.log(`Bundled runtime looks ready for ${platformKey}.`);
