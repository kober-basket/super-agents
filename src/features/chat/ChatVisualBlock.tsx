import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BarChart3, TriangleAlert, Workflow } from "lucide-react";
import mermaid from "mermaid";
import embed, { type Result, type VisualizationSpec } from "vega-embed";

import type { ChatVisual } from "../../types";

let mermaidReady = false;

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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function findDisallowedSpecPath(value: unknown, path = "spec"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const disallowedPath = findDisallowedSpecPath(value[index], `${path}[${index}]`);
      if (disallowedPath) {
        return disallowedPath;
      }
    }
    return null;
  }

  if (!isJsonRecord(value)) {
    if (typeof value === "string" && value.trim().toLowerCase().startsWith("javascript:")) {
      return path;
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (key === "url" || key === "href") {
      return keyPath;
    }

    const disallowedPath = findDisallowedSpecPath(nestedValue, keyPath);
    if (disallowedPath) {
      return disallowedPath;
    }
  }

  return null;
}

function normalizeChartSpec(spec: Record<string, unknown>) {
  const clonedSpec = cloneJsonRecord(spec);
  if (!("$schema" in clonedSpec)) {
    clonedSpec.$schema = "https://vega.github.io/schema/vega-lite/v5.json";
  }
  return clonedSpec as VisualizationSpec;
}

function VisualFrame({
  visual,
  badge,
  children,
}: {
  visual: ChatVisual;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="chat-visual-card">
      <header className="chat-visual-head">
        <div className="chat-visual-badge">{badge}</div>
        <div className="chat-visual-copy">
          <strong>{visual.title ?? (visual.type === "chart" ? "Data chart" : "Diagram")}</strong>
          {visual.description ? <span>{visual.description}</span> : null}
        </div>
      </header>
      <div className="chat-visual-body">{children}</div>
    </section>
  );
}

function VisualError({
  visual,
  tone,
  message,
}: {
  visual: ChatVisual;
  tone: "chart" | "diagram";
  message: string;
}) {
  return (
    <VisualFrame
      visual={visual}
      badge={tone === "chart" ? <BarChart3 size={16} /> : <Workflow size={16} />}
    >
      <div className="chat-visual-error" role="alert">
        <TriangleAlert size={16} />
        <span>{message}</span>
      </div>
    </VisualFrame>
  );
}

function MermaidVisual({ visual }: { visual: Extract<ChatVisual, { type: "diagram" }> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, "");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    container.innerHTML = "";
    setError(null);
    ensureMermaidReady();

    void mermaid
      .render(`chat-visual-${renderId}`, visual.code)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);
      })
      .catch((renderError) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Unable to render Mermaid diagram");
        }
      });

    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [renderId, visual.code]);

  if (error) {
    return <VisualError visual={visual} tone="diagram" message={error} />;
  }

  return (
    <VisualFrame visual={visual} badge={<Workflow size={16} />}>
      <div ref={containerRef} className="chat-visual-surface chat-visual-mermaid" />
    </VisualFrame>
  );
}

function VegaLiteVisual({ visual }: { visual: Extract<ChatVisual, { type: "chart" }> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const specJson = JSON.stringify(visual.spec);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const spec = JSON.parse(specJson) as Record<string, unknown>;
    const disallowedPath = findDisallowedSpecPath(spec);
    if (disallowedPath) {
      setError(`Chart config contains a blocked field: ${disallowedPath}`);
      container.innerHTML = "";
      return undefined;
    }

    let result: Result | null = null;
    let cancelled = false;
    setError(null);

    void embed(container, normalizeChartSpec(spec), {
      actions: false,
      mode: "vega-lite",
      renderer: "svg",
    })
      .then((embedResult) => {
        if (cancelled) {
          embedResult.view.finalize();
          return;
        }

        result = embedResult;
      })
      .catch((renderError) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Unable to render Vega-Lite chart");
        }
      });

    return () => {
      cancelled = true;
      result?.view.finalize();
      container.innerHTML = "";
    };
  }, [specJson]);

  if (error) {
    return <VisualError visual={visual} tone="chart" message={error} />;
  }

  return (
    <VisualFrame visual={visual} badge={<BarChart3 size={16} />}>
      <div ref={containerRef} className="chat-visual-surface chat-visual-chart" />
    </VisualFrame>
  );
}

export function ChatVisualBlock({ visual }: { visual: ChatVisual }) {
  if (visual.type === "diagram" && visual.style === "mermaid") {
    return <MermaidVisual visual={visual} />;
  }

  if (visual.type === "chart" && visual.library === "vega-lite") {
    return <VegaLiteVisual visual={visual} />;
  }

  return (
    <VisualError
      visual={visual}
      tone={visual.type === "chart" ? "chart" : "diagram"}
      message="This visual type is not supported yet."
    />
  );
}
