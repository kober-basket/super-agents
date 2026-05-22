import { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Home,
  PanelRightClose,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { BROWSER_HOME_URL, normalizeBrowserAddress } from "../../lib/browser-target";
import { highlightCode, inferLanguage } from "../../lib/format";
import {
  readBrowserWebviewNavigationState,
  resolveBrowserWindowOpenTarget,
  shouldActivateBrowserWindowOpenTarget,
  type BrowserNavigationWebview,
} from "../../lib/webview-navigation";
import type { FilePreviewPayload, WebviewWindowOpenPayload } from "../../types";
import { RichMarkdown } from "../shared/RichMarkdown";
import { describePreviewItem, getFileExtension, isOfficeDocument } from "../shared/utils";

const PdfPreview = lazy(async () => {
  const module = await import("./PdfPreview.js");
  return { default: module.PdfPreview };
});

const BROWSER_PARTITION = "persist:super-agents-browser";
const INLINE_HTML_LABEL = "内联 HTML";

type BrowserWebviewElement = HTMLElement & BrowserNavigationWebview & {
  getWebContentsId?: () => number;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
};

type WebviewNavigationEvent = Event & {
  title?: string;
  url?: string;
};

interface PreviewPaneProps {
  preview: FilePreviewPayload;
  embedded?: boolean;
  onClearPreview: () => void;
  onClosePane: () => void;
  onOpenLink: (url: string, options?: { activate?: boolean }) => void;
  onOpenExternal: (payload: { path?: string; url?: string }) => void;
  onBrowserStateChange?: (state: { title?: string; url?: string; loading?: boolean }) => void;
  onBrowserWindowOpen?: (listener: (payload: WebviewWindowOpenPayload) => void) => () => void;
}

function isRemoteUrl(value?: string) {
  return value?.startsWith("http://") || value?.startsWith("https://");
}

function isBrowserPreview(preview: FilePreviewPayload) {
  return preview.kind === "web" || preview.kind === "html";
}

function buildHtmlDataUrl(content: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
}

function browserSourceFromPreview(preview: FilePreviewPayload) {
  if (preview.kind === "web") {
    return normalizeBrowserAddress(preview.url ?? preview.path ?? BROWSER_HOME_URL);
  }

  if (preview.kind !== "html") {
    return null;
  }

  if (preview.url) {
    return preview.url;
  }

  if (preview.path) {
    return normalizeBrowserAddress(preview.path);
  }

  return buildHtmlDataUrl(preview.content);
}

function browserAddressLabel(source: string) {
  return source.startsWith("data:text/html") ? INLINE_HTML_LABEL : source;
}

function splitEditorLines(content: string) {
  const lines = content.split(/\r?\n/);
  return lines.length > 0 ? lines : [""];
}

function PreviewEditor({
  content,
  highlightedContent,
}: {
  content: string;
  highlightedContent?: string;
}) {
  const rawLines = splitEditorLines(content);
  const highlightedLines = highlightedContent ? splitEditorLines(highlightedContent) : null;
  const lineCount = Math.max(rawLines.length, highlightedLines?.length ?? 0, 1);

  return (
    <section className="preview-editor-shell" aria-label="文件内容">
      <div className="preview-editor-lines" data-native-wheel-scroll="true">
        {Array.from({ length: lineCount }).map((_, index) => {
          const highlightedLine = highlightedLines?.[index];
          const rawLine = rawLines[index] ?? "";

          return (
            <div className="preview-editor-line" key={`line-${index + 1}`}>
              <span className="preview-editor-line-number">{index + 1}</span>
              {highlightedLine !== undefined ? (
                <code
                  className="preview-editor-code"
                  dangerouslySetInnerHTML={{ __html: highlightedLine || " " }}
                />
              ) : (
                <code className="preview-editor-code">{rawLine || " "}</code>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PreviewPane({
  preview,
  embedded = false,
  onClearPreview,
  onClosePane,
  onOpenLink,
  onOpenExternal,
  onBrowserStateChange,
  onBrowserWindowOpen,
}: PreviewPaneProps) {
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const webContentsIdRef = useRef<number | null>(null);
  const initialBrowserSource = browserSourceFromPreview(preview) ?? BROWSER_HOME_URL;
  const [browserSource, setBrowserSource] = useState(initialBrowserSource);
  const [browserAddress, setBrowserAddress] = useState(browserAddressLabel(initialBrowserSource));
  const [browserLoading, setBrowserLoading] = useState(Boolean(preview.loading));
  const [browserTitle, setBrowserTitle] = useState(preview.title);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const browserMode = isBrowserPreview(preview);
  const onBrowserStateChangeRef = useRef(onBrowserStateChange);
  const onOpenLinkRef = useRef(onOpenLink);

  useEffect(() => {
    onBrowserStateChangeRef.current = onBrowserStateChange;
    onOpenLinkRef.current = onOpenLink;
  }, [onBrowserStateChange, onOpenLink]);

  useEffect(() => {
    if (!browserMode || !onBrowserWindowOpen) {
      return;
    }

    return onBrowserWindowOpen((payload) => {
      const target = resolveBrowserWindowOpenTarget(payload, webContentsIdRef.current);
      if (!target) {
        return;
      }

      onOpenLinkRef.current(target, { activate: shouldActivateBrowserWindowOpenTarget(payload) });
    });
  }, [browserMode, onBrowserWindowOpen]);

  useEffect(() => {
    const nextSource = browserSourceFromPreview(preview);
    if (!nextSource) {
      return;
    }

    setBrowserSource((currentSource) => {
      if (currentSource !== nextSource) {
        setBrowserAddress(browserAddressLabel(nextSource));
        setCanGoBack(false);
        setCanGoForward(false);
      }
      return nextSource;
    });
    setBrowserLoading(Boolean(preview.loading));
    setBrowserTitle(preview.title);
  }, [preview]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !browserMode) {
      return;
    }

    let webviewReady = false;

    const syncNavigationState = () => {
      if (!webviewReady) {
        return;
      }

      const navigationState = readBrowserWebviewNavigationState(webview, browserSource);
      if (!navigationState.ready) {
        return;
      }

      setCanGoBack(navigationState.canGoBack);
      setCanGoForward(navigationState.canGoForward);
      setBrowserAddress(browserAddressLabel(navigationState.currentUrl));
      onBrowserStateChangeRef.current?.({ url: navigationState.currentUrl });
    };

    const handleDomReady = () => {
      webviewReady = true;
      webContentsIdRef.current = webview.getWebContentsId?.() ?? null;
      syncNavigationState();
    };
    const handleStartLoading = () => setBrowserLoading(true);
    const handleStopLoading = () => {
      setBrowserLoading(false);
      onBrowserStateChangeRef.current?.({ loading: false });
      syncNavigationState();
    };
    const handleNavigate = () => syncNavigationState();
    const handleTitle = (event: Event) => {
      const title = (event as WebviewNavigationEvent).title?.trim();
      if (title) {
        setBrowserTitle(title);
        onBrowserStateChangeRef.current?.({ title });
      }
    };
    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("page-title-updated", handleTitle);

    return () => {
      webviewReady = false;
      webContentsIdRef.current = null;
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("page-title-updated", handleTitle);
    };
  }, [browserMode, browserSource]);

  const presentation = describePreviewItem({
    kind: preview.kind,
    path: preview.path,
    name: browserMode ? browserTitle : preview.title,
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
    browserMode
      ? browserAddress
      : normalizedPath && normalizedPath !== normalizedTitle && normalizedPath !== `${normalizedTitle}/`
        ? normalizedPath
        : titleLooksLikeUrl && extension
          ? `.${extension}`
          : null;

  function loadBrowserAddress(value: string) {
    if (value === INLINE_HTML_LABEL) {
      return;
    }

    const nextSource = normalizeBrowserAddress(value);
    setBrowserSource(nextSource);
    setBrowserAddress(browserAddressLabel(nextSource));
    setBrowserLoading(true);
    onBrowserStateChangeRef.current?.({ url: nextSource, loading: true });
  }

  function handleBrowserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedAddress = String(formData.get("browser-address") ?? browserAddress);
    loadBrowserAddress(submittedAddress);
  }

  function renderBrowser() {
    return (
      <section className="preview-browser">
        <form className="browser-toolbar" onSubmit={handleBrowserSubmit}>
          <div className="browser-nav-actions">
            <button
              className="ghost-icon"
              disabled={!canGoBack}
              onClick={() => webviewRef.current?.goBack?.()}
              title="后退"
              type="button"
            >
              <ArrowLeft size={15} />
            </button>
            <button
              className="ghost-icon"
              disabled={!canGoForward}
              onClick={() => webviewRef.current?.goForward?.()}
              title="前进"
              type="button"
            >
              <ArrowRight size={15} />
            </button>
            <button
              className="ghost-icon"
              onClick={() => webviewRef.current?.reload?.()}
              title="刷新"
              type="button"
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <label className="browser-address-field">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="浏览器地址或搜索关键词"
              name="browser-address"
              onChange={(event) => setBrowserAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                loadBrowserAddress(event.currentTarget.value);
              }}
              spellCheck={false}
              value={browserAddress}
            />
          </label>

          <button
            className="ghost-icon"
            onClick={() => loadBrowserAddress(BROWSER_HOME_URL)}
            title="主页"
            type="button"
          >
            <Home size={15} />
          </button>
        </form>

        <div className="preview-surface preview-webview-surface">
          {browserLoading ? <div className="browser-loading-bar" /> : null}
          <webview
            ref={webviewRef}
            allowpopups
            className="preview-webview"
            partition={BROWSER_PARTITION}
            src={browserSource}
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          />
        </div>
      </section>
    );
  }

  const renderUnsupported = () => {
    const officeDocument = isOfficeDocument(preview.path ?? preview.title, preview.mimeType);
    return (
      <section className="preview-surface preview-empty-state">
        <span className={clsx("preview-empty-badge", `tone-${presentation.tone}`)}>
          {presentation.badge}
        </span>
        <strong>{officeDocument ? "办公文档暂不支持内嵌预览" : "这种文件类型暂不支持内联预览"}</strong>
        <p>
          {officeDocument
            ? "请先使用系统应用打开；后续需要更完整的办公文档预览时，可以再接入专用渲染器。"
            : "二进制内容会回退为安全占位状态，避免渲染不可读文本。"}
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
    if (preview.loading && !browserMode) {
      return (
        <section className="preview-surface preview-empty-state">
          <span className={clsx("preview-empty-badge", `tone-${presentation.tone}`)}>
            {presentation.badge}
          </span>
          <strong>正在准备预览</strong>
          <p>正在读取文件并为当前内容选择合适的渲染方式...</p>
        </section>
      );
    }

    if (browserMode) {
      return renderBrowser();
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

    if (preview.kind === "markdown") {
      return (
        <RichMarkdown
          as="article"
          className="preview-surface preview-rich-surface preview-markdown"
          content={preview.content}
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
        <PreviewEditor
          content={preview.content}
          highlightedContent={highlightCode(preview.content, language)}
        />
      );
    }

    if (preview.kind === "text") {
      return <PreviewEditor content={preview.content} />;
    }

    return renderUnsupported();
  };

  if (embedded) {
    return <div className="preview-content-panel"><div className="preview-body">{renderBody()}</div></div>;
  }

  return (
    <aside className="preview-pane">
      <header className="preview-head">
        <div className="preview-head-main">
          <div className={clsx("preview-kind-badge", `tone-${presentation.tone}`)}>
            <span>{presentation.badge}</span>
          </div>
          <div className="preview-head-copy">
            <strong>{browserMode ? browserTitle : preview.title}</strong>
            {secondaryLabel ? <span>{secondaryLabel}</span> : null}
          </div>
        </div>

        <div className="preview-actions">
          {externalPayload ? (
            <button
              className="ghost-icon"
              onClick={() => onOpenExternal(externalPayload)}
              title={isRemote ? "在系统浏览器中打开" : "在系统应用中打开"}
              type="button"
            >
              <ArrowUpRight size={16} />
            </button>
          ) : null}
          <button className="ghost-icon" onClick={onClosePane} title="收起右侧栏" type="button">
            <PanelRightClose size={16} />
          </button>
          <button className="ghost-icon" onClick={onClearPreview} title="关闭" type="button">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="preview-body">{renderBody()}</div>
    </aside>
  );
}
