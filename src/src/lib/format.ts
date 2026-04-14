import { marked } from "marked";
import hljs from "highlight.js";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const safeHref = href || "";
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${safeHref}"${titleAttr} data-preview-link="true">${text}</a>`;
};

export function formatRelativeTime(value: number) {
  const delta = Date.now() - value;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function inferLanguage(path?: string | null, mimeType?: string) {
  const extension = path?.split(".").pop()?.toLowerCase() ?? "";
  const mapping: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    html: "xml",
    yml: "yaml",
    yaml: "yaml",
    py: "python",
    sh: "bash",
    ps1: "powershell",
    go: "go",
    rs: "rust",
    java: "java",
    txt: "text",
  };

  if (extension in mapping) return mapping[extension];
  if (mimeType?.startsWith("application/json")) return "json";
  if (mimeType?.startsWith("text/")) return "text";
  return "text";
}

export function markdownToHtml(content: string) {
  return marked.parse(content, { renderer }) as string;
}

export function highlightCode(content: string, language: string) {
  const valid = hljs.getLanguage(language) ? language : "text";
  return hljs.highlight(content, { language: valid }).value;
}
