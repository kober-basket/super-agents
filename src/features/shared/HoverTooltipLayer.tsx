import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const DATA_TOOLTIP = "data-tooltip";
const NATIVE_TITLE_CACHE = "data-native-title";
const TOOLTIP_GAP = 10;
const VIEWPORT_MARGIN = 12;
const HOVER_DELAY_MS = 260;
const FOCUS_DELAY_MS = 80;
const ARIA_TOOLTIP_SELECTOR = [
  "button[aria-label]",
  "a[aria-label]",
  "input[aria-label]",
  "textarea[aria-label]",
  "select[aria-label]",
  "[role='button'][aria-label]",
  "[role='menuitem'][aria-label]",
  "[role='tab'][aria-label]",
  "[tabindex][aria-label]",
].join(", ");
const TOOLTIP_SELECTOR = [`[${DATA_TOOLTIP}]`, "[title]", ARIA_TOOLTIP_SELECTOR].join(", ");

type TooltipPlacement = "top" | "bottom";

export interface TooltipCandidateElement {
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
}

interface TooltipRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface TooltipSize {
  width: number;
  height: number;
}

interface TooltipViewport {
  width: number;
  height: number;
}

interface TooltipState {
  label: string;
  x: number;
  y: number;
  placement: TooltipPlacement;
  measured: boolean;
}

function normalizeTooltipLabel(value: string | null) {
  const label = value?.replace(/\s+/g, " ").trim();
  return label ? label : null;
}

export function readTooltipLabel(element: TooltipCandidateElement) {
  return (
    normalizeTooltipLabel(element.getAttribute(DATA_TOOLTIP)) ??
    normalizeTooltipLabel(element.getAttribute("title")) ??
    normalizeTooltipLabel(element.getAttribute(NATIVE_TITLE_CACHE)) ??
    (element.matches(ARIA_TOOLTIP_SELECTOR) ? normalizeTooltipLabel(element.getAttribute("aria-label")) : null)
  );
}

export function computeTooltipPosition(
  anchorRect: TooltipRect,
  viewport: TooltipViewport,
  tooltipSize: TooltipSize,
) {
  const centeredX = anchorRect.left + anchorRect.width / 2 - tooltipSize.width / 2;
  const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - tooltipSize.width - VIEWPORT_MARGIN);
  const x = Math.min(Math.max(centeredX, VIEWPORT_MARGIN), maxX);
  const fitsAbove = anchorRect.top >= tooltipSize.height + TOOLTIP_GAP + VIEWPORT_MARGIN;
  const y = fitsAbove
    ? anchorRect.top - tooltipSize.height - TOOLTIP_GAP
    : Math.min(anchorRect.bottom + TOOLTIP_GAP, viewport.height - tooltipSize.height - VIEWPORT_MARGIN);

  return {
    x: Math.round(x),
    y: Math.round(Math.max(VIEWPORT_MARGIN, y)),
    placement: fitsAbove ? "top" : "bottom" as TooltipPlacement,
  };
}

function getTooltipTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(TOOLTIP_SELECTOR) as HTMLElement | null;
}

function cacheNativeTitle(target: HTMLElement) {
  const title = target.getAttribute("title");
  if (title === null) {
    return;
  }

  target.setAttribute(NATIVE_TITLE_CACHE, title);
  target.removeAttribute("title");
}

function restoreNativeTitle(target: HTMLElement | null) {
  if (!target?.hasAttribute(NATIVE_TITLE_CACHE)) {
    return;
  }

  const cachedTitle = target.getAttribute(NATIVE_TITLE_CACHE);
  target.removeAttribute(NATIVE_TITLE_CACHE);
  if (cachedTitle !== null && !target.hasAttribute("title")) {
    target.setAttribute("title", cachedTitle);
  }
}

function estimateTooltipSize(label: string): TooltipSize {
  const width = Math.min(Math.max(label.length * 7 + 26, 54), 280);
  return {
    width,
    height: label.length > 30 ? 50 : 34,
  };
}

function viewportSize(): TooltipViewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function HoverTooltipLayer() {
  const targetRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const clearShowTimer = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const closeTooltip = () => {
    clearShowTimer();
    restoreNativeTitle(targetRef.current);
    targetRef.current = null;
    setTooltip(null);
  };

  const openTooltip = (target: HTMLElement, delay: number) => {
    const label = readTooltipLabel(target);
    if (!label) {
      closeTooltip();
      return;
    }

    clearShowTimer();
    restoreNativeTitle(targetRef.current);
    cacheNativeTitle(target);
    targetRef.current = target;
    showTimerRef.current = window.setTimeout(() => {
      if (targetRef.current !== target || !target.isConnected) {
        return;
      }

      const currentLabel = readTooltipLabel(target) ?? label;
      const anchorRect = target.getBoundingClientRect();
      setTooltip({
        label: currentLabel,
        ...computeTooltipPosition(anchorRect, viewportSize(), estimateTooltipSize(currentLabel)),
        measured: false,
      });
    }, delay);
  };

  useEffect(() => {
    const handlePointerOver = (event: PointerEvent) => {
      const target = getTooltipTarget(event.target);
      if (!target || target === targetRef.current) {
        return;
      }
      openTooltip(target, HOVER_DELAY_MS);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const activeTarget = targetRef.current;
      const nextTarget = event.relatedTarget as Node | null;
      if (activeTarget && nextTarget && activeTarget.contains(nextTarget)) {
        return;
      }
      closeTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = getTooltipTarget(event.target);
      if (target) {
        openTooltip(target, FOCUS_DELAY_MS);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const activeTarget = targetRef.current;
      const nextTarget = event.relatedTarget as Node | null;
      if (activeTarget && nextTarget && activeTarget.contains(nextTarget)) {
        return;
      }
      closeTooltip();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTooltip();
      }
    };

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("pointerdown", closeTooltip, true);
    window.addEventListener("scroll", closeTooltip, true);
    window.addEventListener("resize", closeTooltip);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("pointerdown", closeTooltip, true);
      window.removeEventListener("scroll", closeTooltip, true);
      window.removeEventListener("resize", closeTooltip);
      window.removeEventListener("keydown", handleKeyDown);
      closeTooltip();
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip) {
      return;
    }

    const target = targetRef.current;
    const tooltipElement = tooltipRef.current;
    if (!target || !tooltipElement) {
      return;
    }

    const anchorRect = target.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const nextPosition = computeTooltipPosition(anchorRect, viewportSize(), tooltipRect);
    setTooltip((current) => current ? { ...current, ...nextPosition, measured: true } : current);
  }, [tooltip?.label]);

  if (!tooltip || typeof document === "undefined") {
    return null;
  }

  const style = {
    "--tooltip-x": `${tooltip.x}px`,
    "--tooltip-y": `${tooltip.y}px`,
  } as CSSProperties;

  return createPortal(
    <div
      ref={tooltipRef}
      className={tooltip.measured ? "app-tooltip ready" : "app-tooltip"}
      data-placement={tooltip.placement}
      role="tooltip"
      style={style}
    >
      <span className="app-tooltip-text">{tooltip.label}</span>
      <span aria-hidden="true" className="app-tooltip-arrow" />
    </div>,
    document.body,
  );
}
