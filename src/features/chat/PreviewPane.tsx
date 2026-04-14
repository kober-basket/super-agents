import { Suspense, lazy } from "react";
import clsx from "clsx";
import { ArrowUpRight, PanelRightClose, X } from "lucide-react";

import { highlightCode, inferLanguage, markdownToHtml } from "../../lib/format";
import type { FilePreviewPayload } from "../../types";
import { describePreviewItem, getFileExtension, isOfficeDocument } from "../shared/utils";

const PdfPreview = lazy(async () => {
  const module = await import("./PdfPreview");
  return { default: module.PdfPreview };
});

interface PreviewPaneProps {
  preview: FilePreviewPayload;
  onClearPreview: () => void;
  onClosePane: () => void;
  onOpenLink: (url: string) => void;
  onOpenExternal: (payload: { path?: string; url?: string }) => void;
}

function isRemoteUrl(value?: string) {
  return value?.startsWith("http://") || value?.startsWith("https://");
}

export function PreviewPane({
  preview,
  onClearPreview,
  onClosePane,
  onOpenLink,
  onOpenExternal,
}: PreviewPaneProps) {
  const presentation = describePreviewItem({
    kind: preview.kind,
    path: preview.path,
    name: preview.title,
    mimeType: preview.mimeType,
  });
  const extension = getFileExtension(preview.path ?? preview.title);
  const isRemote = isRemoteUrl(preview.url);
  const externalPayload = isRemote
    ? { url: preview.url }
    : preview.path
      ? { path: preview.path }
      : null;
  const titleLooksLikeUrl = /^https?:\/\//i.test(preview.title);
  const normalizedPath = (preview.path ?? "").trim();
  const normalizedTitle = preview.title.trim();
  const secondaryLabel =
    normalizedPath && normalizedPath !== normalizedTitle && normalizedPath !== `${normalizedTitle}/`
      ? normalizedPath
      : titleLooksLikeUrl && extension
        ? `.${extension}`
        : null;

  const renderUnsupported = () => {
    const officeDocument = isOfficeDocument(preview.path ?? preview.title, preview.mimeType);
    return (
      <section className="preview-surface preview-empty-state">
        <span className={clsx("preview-empty-badge", `tone-${presentation.tone}`)}>
          {presentation.badge}
        </span>
        <strong>
          {officeDocument
            ? "Office 文件暂不支持内嵌预览"
            : "这种文件类型暂不支持内联预览"}
        </strong>
        <p>
          {officeDocument
            ? "目前请先使用系统应用打开；如果后续需要更丰富的内联渲染，可以再接入 Office 预览器。"
            : "二进制内容目前会回退为安全占位状态，避免渲染不可读文本。"}
        </p>
        {externalPayload ? (
          <button
            className="preview-open-button"
            onClick={() => onOpenExternal(externalPayload)}
            type="button"
          >
            {isRemote ? "在浏览器中打开" : "在系统应用中打开"}
          </button>
        ) : null}
      </section>
    );
  };

  const renderBody = () => {
    if (preview.loading) {
      return (
        <section className="preview-surface preview-empty-state">
          <span className={clsx("preview-empty-badge", `tone-${presentation.tone}`)}>
            {presentation.badge}
          </span>
          <strong>正在准备预览</strong>
          <p>正在读取文件并为当前内容选择最合适的渲染方式...</p>
        </section>
      );
    }

    if (preview.kind === "image") {
      return (
        <div className="preview-surface preview-image-stage">
          <img src={preview.content} alt={preview.title} className="preview-image" />
        </div>
      );
    }

    if (preview.kind === "pdf") {
      return (
        <Suspense
          fallback={
            <section className="preview-surface preview-empty-state">
              <span className={clsx("preview-empty-badge", `tone-${presentation.tone}`)}>
                {presentation.badge}
              </span>
              <strong>正在加载 PDF 预览器</strong>
              <p>文档外壳已就绪，PDF 渲染器正在按需加载。</p>
            </section>
          }
        >
          <PdfPreview preview={preview} />
        </Suspense>
      );
    }

    if (preview.kind === "web") {
      return (
        <div className="preview-surface preview-frame-shell">
          <iframe src={preview.url} title={preview.title} className="preview-frame" />
        </div>
      );
    }

    if (preview.kind === "html") {
      return (
        <div className="preview-surface preview-frame-shell">
          <iframe
            srcDoc={preview.content}
            title={preview.title}
            className="preview-frame"
            sandbox="allow-same-origin allow-scripts"
          />
        </div>
      );
    }

    if (preview.kind === "markdown") {
      return (
        <article
          className="preview-surface preview-rich-surface preview-markdown"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(preview.content) }}
          onClick={(event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const link = target.closest("a[data-preview-link='true']");
            if (!(link instanceof HTMLAnchorElement)) return;
            const href = link.getAttribute("href")?.trim();
            if (!href) return;
            event.preventDefault();
            onOpenLink(href);
          }}
        />
      );
    }

    if (preview.kind === "code") {
      const language = inferLanguage(preview.path, preview.mimeType);
      return (
        <section className="preview-surface preview-code-shell">
          <div className="preview-surface-head">
            <span>渲染器</span>
            <strong>{language.toUpperCase()}</strong>
          </div>
          <pre
            className="preview-code"
            dangerouslySetInnerHTML={{
              __html: highlightCode(preview.content, language),
            }}
          />
        </section>
      );
    }

    if (preview.kind === "text") {
      return (
        <section className="preview-surface preview-code-shell">
          <div className="preview-surface-head">
            <span>渲染器</span>
            <strong>纯文本</strong>
          </div>
          <pre className="preview-code">{preview.content}</pre>
        </section>
      );
    }

    return renderUnsupported();
  };

  return (
    <aside className="preview-pane">
      <header className="preview-head">
        <div className="preview-head-main">
          <div className={clsx("preview-kind-badge", `tone-${presentation.tone}`)}>
            <span>{presentation.badge}</span>
          </div>
          <div className="preview-head-copy">
            <strong>{preview.title}</strong>
            {secondaryLabel ? <span>{secondaryLabel}</span> : null}
          </div>
        </div>

        <div className="preview-actions">
          {externalPayload ? (
            <button
              className="ghost-icon"
              onClick={() => onOpenExternal(externalPayload)}
              title={isRemote ? "在浏览器中打开" : "在系统应用中打开"}
              type="button"
            >
              <ArrowUpRight size={16} />
            </button>
          ) : null}
          <button className="ghost-icon" onClick={onClosePane} type="button">
            <PanelRightClose size={16} />
          </button>
          <button className="ghost-icon" onClick={onClearPreview} type="button">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="preview-body">{renderBody()}</div>
    </aside>
  );
}
