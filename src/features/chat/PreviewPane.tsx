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
            ? "Office files are not embedded yet"
            : "This file type is not available for inline preview"}
        </strong>
        <p>
          {officeDocument
            ? "Use the system app for now, or plug in an Office viewer later if you want richer inline rendering."
            : "Binary content now falls back to a safe placeholder instead of rendering unreadable text."}
        </p>
        {externalPayload ? (
          <button
            className="preview-open-button"
            onClick={() => onOpenExternal(externalPayload)}
            type="button"
          >
            {isRemote ? "Open in browser" : "Open in system app"}
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
          <strong>Preparing preview</strong>
          <p>Reading the file and selecting the best renderer for this content...</p>
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
              <strong>Loading PDF viewer</strong>
              <p>The document shell is ready. The PDF renderer is loading on demand.</p>
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
            <span>Renderer</span>
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
            <span>Renderer</span>
            <strong>Plain text</strong>
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
              title={isRemote ? "Open in browser" : "Open in system app"}
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
