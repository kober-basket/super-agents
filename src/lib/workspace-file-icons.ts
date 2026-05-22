import type { WorkspaceDirectoryEntry } from "../types";

export type WorkspaceFileIconKind =
  | "archive"
  | "code"
  | "config"
  | "document"
  | "image"
  | "json"
  | "lock"
  | "markdown"
  | "pdf"
  | "python"
  | "spreadsheet"
  | "text"
  | "yaml";

export interface WorkspaceFileIconMeta {
  kind: WorkspaceFileIconKind;
  label: string;
}

const EXTENSION_ICON_META: Record<string, WorkspaceFileIconMeta> = {
  c: { kind: "code", label: "代码文件" },
  cpp: { kind: "code", label: "代码文件" },
  cs: { kind: "code", label: "代码文件" },
  css: { kind: "code", label: "CSS 文件" },
  csv: { kind: "spreadsheet", label: "表格文件" },
  doc: { kind: "document", label: "文档文件" },
  docx: { kind: "document", label: "文档文件" },
  go: { kind: "code", label: "Go 文件" },
  h: { kind: "code", label: "代码文件" },
  html: { kind: "code", label: "HTML 文件" },
  jpeg: { kind: "image", label: "图片文件" },
  jpg: { kind: "image", label: "图片文件" },
  js: { kind: "code", label: "JavaScript 文件" },
  json: { kind: "json", label: "JSON 文件" },
  jsx: { kind: "code", label: "React 文件" },
  lock: { kind: "lock", label: "锁定文件" },
  log: { kind: "text", label: "日志文件" },
  md: { kind: "markdown", label: "Markdown 文件" },
  mdx: { kind: "markdown", label: "MDX 文件" },
  pdf: { kind: "pdf", label: "PDF 文件" },
  png: { kind: "image", label: "图片文件" },
  ppt: { kind: "document", label: "演示文稿" },
  pptx: { kind: "document", label: "演示文稿" },
  ps1: { kind: "code", label: "PowerShell 文件" },
  py: { kind: "python", label: "Python 文件" },
  rb: { kind: "code", label: "Ruby 文件" },
  rs: { kind: "code", label: "Rust 文件" },
  sh: { kind: "code", label: "Shell 文件" },
  svg: { kind: "image", label: "图片文件" },
  toml: { kind: "config", label: "配置文件" },
  ts: { kind: "code", label: "TypeScript 文件" },
  tsx: { kind: "code", label: "React 文件" },
  txt: { kind: "text", label: "文本文件" },
  vue: { kind: "code", label: "Vue 文件" },
  xls: { kind: "spreadsheet", label: "表格文件" },
  xlsx: { kind: "spreadsheet", label: "表格文件" },
  xml: { kind: "code", label: "XML 文件" },
  yaml: { kind: "yaml", label: "YAML 文件" },
  yml: { kind: "yaml", label: "YAML 文件" },
  zip: { kind: "archive", label: "压缩文件" },
};

const SPECIAL_FILE_ICON_META: Record<string, WorkspaceFileIconMeta> = {
  "package.json": { kind: "json", label: "Package JSON" },
  "pnpm-lock.yaml": { kind: "yaml", label: "YAML 文件" },
  "package-lock.json": { kind: "lock", label: "npm 锁定文件" },
  "yarn.lock": { kind: "lock", label: "Yarn 锁定文件" },
  "uv.lock": { kind: "lock", label: "uv 锁定文件" },
};

function getExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === normalized.length - 1) {
    return "";
  }
  return normalized.slice(lastDot + 1);
}

export function getWorkspaceFileIconMeta(entry: WorkspaceDirectoryEntry): WorkspaceFileIconMeta | null {
  if (entry.kind === "directory") {
    return null;
  }

  const fileName = entry.name.trim().toLowerCase();
  const special = SPECIAL_FILE_ICON_META[fileName];
  if (special) {
    return special;
  }

  const extension = getExtension(fileName);
  return EXTENSION_ICON_META[extension] ?? { kind: "text", label: "文件" };
}
