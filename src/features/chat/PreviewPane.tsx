import { PanelRightClose, X } from "lucide-react";

import { highlightCode, inferLanguage, markdownToHtml } from "../../lib/format";
import type { FilePreviewPayload } from "../../types";

interface PreviewPaneProps {
  preview: FilePreviewPayload;
  onClearPreview: () => void;
  onClosePane: () => void;
  onOpenLink: (url: string) => void;
}

export function PreviewPane({
  preview,
  onClearPreview,
  onClosePane,
  onOpenLink,
}: PreviewPaneProps) {
  return (
    <aside className="preview-pane">
      <header className="preview-head">
        <div>
          <strong>{preview.title}</strong>
          <span>{preview.path ?? "内联内容"}</span>
        </div>
        <div className="preview-actions">
          <button className="ghost-icon" onClick={onClosePane}>
            <PanelRightClose size={16} />
          </button>
          <button className="ghost-icon" onClick={onClearPreview}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="preview-body">
        {preview.kind === "image" ? (
          <img src={preview.content} alt={preview.title} className="preview-image" />
        ) : preview.kind === "web" ? (
          <iframe src={preview.url} title={preview.title} className="preview-frame" />
        ) : preview.kind === "html" ? (
          <iframe
            srcDoc={preview.content}
            title={preview.title}
            className="preview-frame"
            sandbox="allow-same-origin allow-scripts"
          />
        ) : preview.kind === "markdown" ? (
          <div
            className="preview-markdown"
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
        ) : preview.kind === "code" ? (
          <pre
            className="preview-code"
            dangerouslySetInnerHTML={{
              __html: highlightCode(
                preview.content,
                inferLanguage(preview.path, preview.mimeType),
              ),
            }}
          />
        ) : (
          <pre className="preview-code">{preview.content}</pre>
        )}
      </div>
    </aside>
  );
}
