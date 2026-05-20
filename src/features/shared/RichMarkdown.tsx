import mermaid from "mermaid";
import { useEffect, useMemo, useRef, type MouseEventHandler } from "react";

import { markdownToHtml } from "../../lib/format";

let mermaidReady = false;
let mermaidRenderIndex = 0;

function ensureMermaidReady() {
  if (mermaidReady) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
  });
  mermaidReady = true;
}

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderMermaidBlocks(root: HTMLElement, isCancelled: () => boolean) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".markdown-mermaid[data-mermaid-code]"));
  if (blocks.length === 0) {
    return;
  }

  ensureMermaidReady();

  for (const block of blocks) {
    const code = block.dataset.mermaidCode?.trim();
    if (!code) {
      continue;
    }

    const renderId = `markdown-mermaid-${++mermaidRenderIndex}`;
    block.classList.add("markdown-mermaid-rendering");

    try {
      const { svg, bindFunctions } = await mermaid.render(renderId, code);
      if (isCancelled() || !block.isConnected) {
        return;
      }

      block.innerHTML = svg;
      bindFunctions?.(block);
      block.classList.remove("markdown-mermaid-rendering");
      block.classList.add("markdown-mermaid-ready");
    } catch (error) {
      if (isCancelled() || !block.isConnected) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unable to render Mermaid diagram";
      block.classList.remove("markdown-mermaid-rendering");
      block.classList.add("markdown-mermaid-error");
      block.innerHTML = `<strong>Mermaid 渲染失败</strong><pre><code>${escapeText(message)}</code></pre>`;
    }
  }
}

interface RichMarkdownProps {
  as?: "article" | "div";
  className?: string;
  content: string;
  onClick?: MouseEventHandler<HTMLElement>;
}

export function RichMarkdown({ as = "div", className, content, onClick }: RichMarkdownProps) {
  const elementRef = useRef<HTMLElement | null>(null);
  const html = useMemo(() => markdownToHtml(content), [content]);
  const Component = as;

  useEffect(() => {
    let cancelled = false;
    const root = elementRef.current;

    if (root) {
      void renderMermaidBlocks(root, () => cancelled);
    }

    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <Component
      ref={(node) => {
        elementRef.current = node;
      }}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={onClick}
    />
  );
}
