import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type * as acp from "@agentclientprotocol/sdk";

function normalizeForComparison(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function assertWorkspacePath(workspaceRoot: string, filePath: string) {
  if (!path.isAbsolute(filePath)) {
    throw new Error("ACP file operations require absolute paths.");
  }

  const normalizedRoot = normalizeForComparison(path.resolve(workspaceRoot));
  const normalizedPath = normalizeForComparison(path.resolve(filePath));
  const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;

  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootPrefix)) {
    throw new Error(`Path is outside the active workspace: ${filePath}`);
  }

  return path.resolve(filePath);
}

function sliceLines(content: string, line?: number | null, limit?: number | null) {
  if (line == null && limit == null) {
    return content;
  }

  const entries = content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [content];
  if (entries.at(-1) === "") {
    entries.pop();
  }

  const startIndex = Math.max((line ?? 1) - 1, 0);
  const endIndex = limit == null ? entries.length : startIndex + Math.max(limit, 0);
  return entries.slice(startIndex, endIndex).join("");
}

export async function readWorkspaceTextFile(
  workspaceRoot: string,
  params: acp.ReadTextFileRequest,
): Promise<acp.ReadTextFileResponse> {
  const filePath = assertWorkspacePath(workspaceRoot, params.path);
  const content = await readFile(filePath, "utf8");
  return {
    content: sliceLines(content, params.line, params.limit),
  };
}

export async function writeWorkspaceTextFile(
  workspaceRoot: string,
  params: acp.WriteTextFileRequest,
): Promise<acp.WriteTextFileResponse> {
  const filePath = assertWorkspacePath(workspaceRoot, params.path);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, params.content, "utf8");
  return {};
}
