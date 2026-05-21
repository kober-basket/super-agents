import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeFenceLanguage(info: string) {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function renderHighlightedFence(content: string, language: string) {
  const normalizedLanguage = language.toLowerCase();
  const valid = normalizedLanguage && hljs.getLanguage(normalizedLanguage) ? normalizedLanguage : "";
  const highlighted = valid
    ? hljs.highlight(content, { language: valid, ignoreIllegals: true }).value
    : escapeHtml(content);
  const languageClass = valid ? ` language-${escapeHtml(valid)}` : "";

  return `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`;
}

const markdown = new MarkdownIt({
  breaks: true,
  html: true,
  linkify: true,
  typographer: true,
  highlight: (content, language) => renderHighlightedFence(content, language),
})
  .use(footnote)
  .use(taskLists, { enabled: false, label: true, labelAfter: true });

const defaultFenceRenderer = markdown.renderer.rules.fence;

markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = normalizeFenceLanguage(token.info);

  if (language === "mermaid") {
    const code = token.content.trim();
    const escapedCode = escapeHtml(code);
    return `<div class="markdown-mermaid" data-mermaid-code="${escapedCode}"></div>\n`;
  }

  if (defaultFenceRenderer) {
    return defaultFenceRenderer(tokens, index, options, env, self);
  }

  return self.renderToken(tokens, index, options);
};

const defaultLinkOpenRenderer = markdown.renderer.rules.link_open;

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href")?.trim() ?? "";
  if (href && !href.startsWith("#")) {
    token.attrSet("data-preview-link", "true");
  }

  return defaultLinkOpenRenderer
    ? defaultLinkOpenRenderer(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

export function formatRelativeTime(value: number) {
  const delta = Date.now() - value;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
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
  return markdown.render(content);
}

export function highlightCode(content: string, language: string) {
  const valid = hljs.getLanguage(language) ? language : "text";
  return hljs.highlight(content, { language: valid }).value;
}
