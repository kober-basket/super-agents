import type { FileDropEntry, McpServerStatus, PreviewKind } from "../../types";

const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "pps",
  "ppsx",
]);

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
  if (file.kind) return file.kind;
  if (file.dataUrl || file.url?.startsWith("data:image/") || file.mimeType.startsWith("image/")) {
    return "image";
  }
  if (file.mimeType === "application/pdf" || file.name.match(/\.pdf$/i)) return "pdf";
  if (file.name.match(/\.(md|mdx)$/i)) return "markdown";
  if (file.name.match(/\.(html|htm)$/i)) return "html";
  if (file.name.match(/\.(ts|tsx|js|jsx|json|css|yml|yaml|py|go|rs|java|sh|ps1)$/i)) {
    return "code";
  }
  if (file.name.match(/\.(txt|log|out|err)$/i)) return "text";
  if (file.mimeType.startsWith("text/")) return "text";
  return "binary";
}

export function getFileExtension(value?: string | null) {
  const normalized = value?.split("?")[0]?.split("#")[0] ?? "";
  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  return extension && extension !== normalized.toLowerCase() ? extension : "";
}

export function isOfficeDocument(value?: string | null, mimeType?: string) {
  const extension = getFileExtension(value);
  if (OFFICE_EXTENSIONS.has(extension)) return true;
  return (
    mimeType?.startsWith("application/vnd.openxmlformats-officedocument") === true ||
    mimeType?.startsWith("application/vnd.ms-") === true
  );
}

export function describePreviewItem(input: {
  kind?: PreviewKind;
  path?: string | null;
  name?: string | null;
  mimeType?: string;
}) {
  const extension = getFileExtension(input.path ?? input.name);
  const uppercaseExtension = extension ? extension.toUpperCase().slice(0, 4) : "FILE";

  if (input.kind === "pdf" || extension === "pdf" || input.mimeType === "application/pdf") {
    return { badge: "PDF", label: "PDF document", tone: "rose" } as const;
  }
  if (input.kind === "image") {
    return { badge: extension ? uppercaseExtension : "IMG", label: "Image asset", tone: "amber" } as const;
  }
  if (input.kind === "web") {
    return { badge: "WEB", label: "Web page", tone: "blue" } as const;
  }
  if (input.kind === "html") {
    return { badge: "HTML", label: "HTML preview", tone: "orange" } as const;
  }
  if (input.kind === "markdown") {
    return { badge: extension ? uppercaseExtension : "MD", label: "Markdown note", tone: "green" } as const;
  }
  if (input.kind === "code") {
    return { badge: extension ? uppercaseExtension : "CODE", label: "Source file", tone: "violet" } as const;
  }
  if (input.kind === "text") {
    return { badge: extension ? uppercaseExtension : "TXT", label: "Text document", tone: "ink" } as const;
  }
  if (isOfficeDocument(input.path ?? input.name, input.mimeType)) {
    return { badge: uppercaseExtension, label: "Office document", tone: "blue" } as const;
  }
  return { badge: uppercaseExtension, label: "Binary file", tone: "slate" } as const;
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
