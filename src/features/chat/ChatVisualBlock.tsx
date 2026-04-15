import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  MessageSquarePlus,
  Pointer,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import mermaid from "mermaid";
import embed, { type Result, type VisualizationSpec } from "vega-embed";

import {
  buildVisualFollowUpPrompt,
  summarizeSelectionDetails,
  type VisualSelectionContext,
} from "../../lib/chat-visual-interactions";
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

function isScalarSelectionValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function extractScalarSelectionDetails(value: unknown) {
  if (!isJsonRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(([, entryValue]) => isScalarSelectionValue(entryValue));
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.slice(0, 6));
}

function pickChartSelectionLabel(details: Record<string, unknown>) {
  const preferredKeys = ["label", "name", "title", "category", "series", "x", "key", "id"];

  for (const key of preferredKeys) {
    const value = details[key];
    if (isScalarSelectionValue(value)) {
      const candidate = String(value).trim();
      if (candidate) {
        return candidate;
      }
    }
  }

  const preview = Object.entries(details)
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ")
    .trim();

  return preview || "Selected data point";
}

function extractChartSelection(value: unknown): VisualSelectionContext | null {
  const details = extractScalarSelectionDetails(value);
  if (!details) {
    return null;
  }

  return {
    kind: "chart-datum",
    label: pickChartSelectionLabel(details),
    details,
  };
}

function normalizeDiagramNodeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractDiagramSelection(target: EventTarget | null): VisualSelectionContext | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const node = target.closest("g.node, .node");
  if (!(node instanceof Element)) {
    return null;
  }

  const label = normalizeDiagramNodeLabel(node.textContent ?? "");
  if (!label) {
    return null;
  }

  const nodeId = node.getAttribute("id") ?? node.getAttribute("data-id") ?? undefined;

  return {
    kind: "diagram-node",
    label,
    details: nodeId ? { id: nodeId } : undefined,
  };
}

function VisualFrame({
  visual,
  badge,
  children,
  footer,
}: {
  visual: ChatVisual;
  badge: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
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
      {footer}
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

function VisualFooter({
  visual,
  selection,
  onClearSelection,
  onSuggestPrompt,
}: {
  visual: ChatVisual;
  selection: VisualSelectionContext | null;
  onClearSelection: () => void;
  onSuggestPrompt?: (prompt: string) => void;
}) {
  const selectionSummary = selection ? summarizeSelectionDetails(selection.details) : "";
  const hint =
    selection !== null
      ? "Selection ready. You can reuse it in the composer."
      : "Click a point or node to continue from this visual.";

  return (
    <div className="chat-visual-footer">
      <div className="chat-visual-hint">
        <Pointer size={14} />
        <span>{hint}</span>
      </div>

      {selection ? (
        <div className="chat-visual-selection">
          <strong>{selection.label}</strong>
          {selectionSummary ? <span>{selectionSummary}</span> : null}
        </div>
      ) : null}

      {onSuggestPrompt ? (
        <div className="chat-visual-actions">
          <button
            className="chat-visual-action"
            onClick={() => onSuggestPrompt(buildVisualFollowUpPrompt(visual, selection))}
            type="button"
          >
            <MessageSquarePlus size={14} />
            <span>{selection ? "Use selection in composer" : "Continue from visual"}</span>
          </button>

          {selection ? (
            <button className="chat-visual-clear" onClick={onClearSelection} type="button">
              <X size={14} />
              <span>Clear selection</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MermaidVisual({
  visual,
  onSuggestPrompt,
}: {
  visual: Extract<ChatVisual, { type: "diagram" }>;
  onSuggestPrompt?: (prompt: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<VisualSelectionContext | null>(null);
  const renderId = useId().replace(/:/g, "");

  useEffect(() => {
    let cancelled = false;
    let detachClickListener: (() => void) | undefined;
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    container.innerHTML = "";
    setError(null);
    setSelection(null);
    ensureMermaidReady();

    void mermaid
      .render(`chat-visual-${renderId}`, visual.code)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);

        const handleClick = (event: Event) => {
          const nextSelection = extractDiagramSelection(event.target);
          if (nextSelection) {
            setSelection(nextSelection);
          }
        };

        containerRef.current.addEventListener("click", handleClick);
        detachClickListener = () => {
          containerRef.current?.removeEventListener("click", handleClick);
        };
      })
      .catch((renderError) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Unable to render Mermaid diagram");
        }
      });

    return () => {
      cancelled = true;
      detachClickListener?.();
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [renderId, visual.code]);

  if (error) {
    return <VisualError visual={visual} tone="diagram" message={error} />;
  }

  return (
    <VisualFrame
      visual={visual}
      badge={<Workflow size={16} />}
      footer={
        <VisualFooter
          onClearSelection={() => setSelection(null)}
          onSuggestPrompt={onSuggestPrompt}
          selection={selection}
          visual={visual}
        />
      }
    >
      <div ref={containerRef} className="chat-visual-surface chat-visual-mermaid" />
    </VisualFrame>
  );
}

function VegaLiteVisual({
  visual,
  onSuggestPrompt,
}: {
  visual: Extract<ChatVisual, { type: "chart" }>;
  onSuggestPrompt?: (prompt: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<VisualSelectionContext | null>(null);
  const specJson = JSON.stringify(visual.spec);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const spec = JSON.parse(specJson) as Record<string, unknown>;
    const disallowedPath = findDisallowedSpecPath(spec);
    if (disallowedPath) {
      setSelection(null);
      setError(`Chart config contains a blocked field: ${disallowedPath}`);
      container.innerHTML = "";
      return undefined;
    }

    let result: Result | null = null;
    let cancelled = false;
    setError(null);
    setSelection(null);

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
        embedResult.view.addEventListener("click", (_event: any, item: any) => {
          const nextSelection = extractChartSelection(item?.datum);
          if (nextSelection) {
            setSelection(nextSelection);
          }
        });
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
    <VisualFrame
      visual={visual}
      badge={<BarChart3 size={16} />}
      footer={
        <VisualFooter
          onClearSelection={() => setSelection(null)}
          onSuggestPrompt={onSuggestPrompt}
          selection={selection}
          visual={visual}
        />
      }
    >
      <div ref={containerRef} className="chat-visual-surface chat-visual-chart" />
    </VisualFrame>
  );
}

export function ChatVisualBlock({
  visual,
  onSuggestPrompt,
}: {
  visual: ChatVisual;
  onSuggestPrompt?: (prompt: string) => void;
}) {
  if (visual.type === "diagram" && visual.style === "mermaid") {
    return <MermaidVisual onSuggestPrompt={onSuggestPrompt} visual={visual} />;
  }

  if (visual.type === "chart" && visual.library === "vega-lite") {
    return <VegaLiteVisual onSuggestPrompt={onSuggestPrompt} visual={visual} />;
  }

  return (
    <VisualError
      visual={visual}
      tone={visual.type === "chart" ? "chart" : "diagram"}
      message="This visual type is not supported yet."
    />
  );
}
