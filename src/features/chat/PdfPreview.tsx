import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";

import type { FilePreviewPayload } from "../../types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_ZOOM_FACTOR = 0.7;
const MAX_ZOOM_FACTOR = 2.2;
const ZOOM_STEP = 0.1;
const MIN_EFFECTIVE_SCALE = 0.45;
const MAX_EFFECTIVE_SCALE = 2.4;

interface PdfPreviewProps {
  preview: FilePreviewPayload;
}

export function PdfPreview({ preview }: PdfPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [stageWidth, setStageWidth] = useState(860);
  const [pageNaturalWidth, setPageNaturalWidth] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const source = useMemo(() => preview.content || preview.url || "", [preview.content, preview.url]);
  const devicePixelRatio = useMemo(
    () => (typeof window !== "undefined" ? Math.min(Math.max(window.devicePixelRatio || 1, 2), 3) : 2),
    [],
  );

  useEffect(() => {
    setNumPages(0);
    setZoomFactor(1);
    setPageNaturalWidth(null);
    setLoadError(null);
  }, [preview.content, preview.path, preview.url]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setStageWidth(entry.contentRect.width);
    });

    observer.observe(node);
    setStageWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  const fitWidth = pageNaturalWidth ? Math.max(stageWidth - 48, 240) / pageNaturalWidth : 1;
  const effectiveScale = Math.min(
    Math.max(fitWidth * zoomFactor, MIN_EFFECTIVE_SCALE),
    MAX_EFFECTIVE_SCALE,
  );
  const zoomPercent = Math.round(zoomFactor * 100);
  const pageNumbers = Array.from({ length: numPages }, (_, index) => index + 1);

  const zoomOut = () => setZoomFactor((value) => Math.max(MIN_ZOOM_FACTOR, Number((value - ZOOM_STEP).toFixed(2))));
  const zoomIn = () => setZoomFactor((value) => Math.min(MAX_ZOOM_FACTOR, Number((value + ZOOM_STEP).toFixed(2))));
  const resetZoom = () => setZoomFactor(1);

  return (
    <section className="preview-surface preview-pdf-shell">
      <div className="preview-toolbar">
        <div className="preview-toolbar-group">
          <button
            className="preview-toolbar-icon"
            disabled={zoomFactor <= MIN_ZOOM_FACTOR}
            onClick={zoomOut}
            title="缩小"
            type="button"
          >
            <Minus size={15} />
          </button>
          <div className="preview-toolbar-readout">
            <strong>{zoomPercent}%</strong>
          </div>
          <button
            className="preview-toolbar-icon"
            disabled={zoomFactor >= MAX_ZOOM_FACTOR}
            onClick={zoomIn}
            title="放大"
            type="button"
          >
            <Plus size={15} />
          </button>
          <button
            className="preview-toolbar-reset"
            onClick={resetZoom}
            title="适应面板"
            type="button"
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <div className="preview-toolbar-readout compact">
          <strong>{numPages || "--"} 页</strong>
        </div>
      </div>

      <div className="pdf-stage" ref={stageRef}>
        {loadError ? (
          <div className="pdf-state" role="alert">
            <strong>PDF 预览失败</strong>
            <span>{loadError}</span>
          </div>
        ) : source ? (
          <Document
            file={source}
            loading={
              <div className="pdf-state">
                <strong>正在加载 PDF</strong>
                <span>正在准备页面内容...</span>
              </div>
            }
            noData={
              <div className="pdf-state">
                <strong>没有 PDF 源文件</strong>
                <span>当前预览数据里没有可读取的文件。</span>
              </div>
            }
            onLoadError={(error) => setLoadError(error instanceof Error ? error.message : "无法加载 PDF")}
            onLoadSuccess={({ numPages: nextNumPages }) => {
              setNumPages(nextNumPages);
            }}
          >
            <div className="pdf-page-wrap">
              {pageNumbers.map((pageNumber) => (
                <div className="pdf-page-card" key={pageNumber}>
                  <Page
                    className="pdf-page"
                    devicePixelRatio={devicePixelRatio}
                    loading={
                      <div className="pdf-state compact">
                        <strong>正在渲染第 {pageNumber} 页</strong>
                        <span>马上就好...</span>
                      </div>
                    }
                    onLoadSuccess={(page) => {
                      setPageNaturalWidth((current) =>
                        current !== page.originalWidth ? page.originalWidth : current,
                      );
                    }}
                    pageNumber={pageNumber}
                    renderAnnotationLayer
                    renderTextLayer
                    renderMode="canvas"
                    scale={effectiveScale}
                  />
                  <span className="pdf-page-index">{pageNumber}</span>
                </div>
              ))}
            </div>
          </Document>
        ) : (
          <div className="pdf-state">
            <strong>没有 PDF 源文件</strong>
            <span>当前预览数据里没有可读取的文件。</span>
          </div>
        )}
      </div>
    </section>
  );
}
