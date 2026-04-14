import type { FileDropEntry, McpServerStatus, PreviewKind } from "../../types";

function createUid() {
  return Math.random().toString(36).slice(2);
}

export function normalizeDroppedFiles(fileList: FileList): FileDropEntry[] {
  return Array.from(fileList).map((file) => {
    const extended = file as File & { path?: string };
    return {
      id: createUid(),
      name: file.name,
      path: extended.path ?? file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    };
  });
}

export function fileKind(file: FileDropEntry): PreviewKind {
  if (file.dataUrl || file.url?.startsWith("data:image/") || file.mimeType.startsWith("image/")) {
    return "image";
  }
  if (file.name.match(/\.(md|mdx)$/i)) return "markdown";
  if (file.name.match(/\.(ts|tsx|js|jsx|json|css|html|yml|yaml|py|go|rs|java|sh|ps1)$/i)) {
    return "code";
  }
  if (file.name.match(/\.(txt|log|out|err)$/i)) return "text";
  return "binary";
}

export function sanitizeMcpName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function displayThreadTitle(title?: string | null) {
  if (!title || title === "New Thread") return "新对话";
  return title;
}

export function makeBadgeText(label: string, fallback = "SK") {
  const clean = label.replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, " ").trim();
  if (!clean) return fallback;

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 3).toUpperCase();
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatMcpStatusLabel(
  status: McpServerStatus["status"] | "connecting" | undefined,
) {
  switch (status) {
    case "connected":
      return "已连接";
    case "disabled":
      return "未启用";
    case "failed":
      return "连接失败";
    case "needs_auth":
      return "需要登录";
    case "needs_client_registration":
      return "需要注册客户端";
    case "connecting":
      return "连接中";
    default:
      return "未配置";
  }
}
