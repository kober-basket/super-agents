import type { ChatVisual } from "../types";

export interface VisualSelectionContext {
  kind: "chart-datum" | "diagram-node";
  label: string;
  details?: Record<string, unknown>;
}

function truncate(value: string, maxLength = 180) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function compactValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? truncate(trimmed, 60) : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

export function summarizeSelectionDetails(details?: Record<string, unknown>) {
  if (!details) {
    return "";
  }

  const parts = Object.entries(details)
    .map(([key, value]) => {
      const compact = compactValue(value);
      return compact ? `${key}: ${compact}` : null;
    })
    .filter(Boolean) as string[];

  return truncate(parts.join(", "), 180);
}

export function buildVisualFollowUpPrompt(
  visual: ChatVisual,
  selection?: VisualSelectionContext | null,
) {
  const visualLabel =
    visual.title?.trim() ||
    visual.description?.trim() ||
    (visual.type === "chart" ? "the current chart" : "the current diagram");

  if (!selection) {
    return visual.type === "chart"
      ? `Please continue from "${visualLabel}" and explain the main patterns, anomalies, and next questions worth exploring.`
      : `Please continue from "${visualLabel}" and explain the key flow, important dependencies, and likely bottlenecks.`;
  }

  const detailText = summarizeSelectionDetails(selection.details);
  const focusText = detailText ? `${selection.label} (${detailText})` : selection.label;

  if (selection.kind === "chart-datum") {
    return `Please continue from "${visualLabel}" and analyze this selected data point: ${focusText}. Explain what it means, why it matters, and what to compare it with next.`;
  }

  return `Please continue from "${visualLabel}" and focus on this selected node or step: ${focusText}. Explain its role, upstream/downstream impact, and any risks or improvements around it.`;
}

