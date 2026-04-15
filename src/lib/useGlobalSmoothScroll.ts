import { useEffect } from "react";

const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);
const EDITABLE_TARGET_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']";
const LINE_DELTA_PX = 30;
const PAGE_DELTA_FACTOR = 0.9;
const COARSE_PIXEL_DELTA_THRESHOLD = 6;
const TRACKPAD_PIXEL_DELTA_LIMIT = 18;
const IMMEDIATE_SCROLL_FRACTION = 0.18;
const ANIMATION_STOP_DISTANCE = 0.35;
const ANIMATION_STOP_VELOCITY = 6;
const SPRING_STIFFNESS = 245;
const SPRING_DAMPING = 26;
const VELOCITY_BOOST = 14;
const MAX_VELOCITY = 4800;
const WHEEL_SENSITIVITY = 1.18;

type Axis = "x" | "y";

interface ScrollAnimationState {
  currentLeft: number;
  currentTop: number;
  lastTimestamp: number | null;
  rafId: number | null;
  targetLeft: number;
  targetTop: number;
  velocityLeft: number;
  velocityTop: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isEditableTarget(target: Element) {
  return Boolean(target.closest(EDITABLE_TARGET_SELECTOR));
}

function isScrollableOnAxis(element: HTMLElement, axis: Axis) {
  const style = window.getComputedStyle(element);
  const overflowValue = axis === "y" ? style.overflowY : style.overflowX;

  if (!SCROLLABLE_OVERFLOW_VALUES.has(overflowValue)) {
    return false;
  }

  return axis === "y"
    ? element.scrollHeight - element.clientHeight > 1
    : element.scrollWidth - element.clientWidth > 1;
}

function canConsumeScroll(element: HTMLElement, deltaX: number, deltaY: number) {
  if (deltaY !== 0 && isScrollableOnAxis(element, "y")) {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    if ((deltaY < 0 && element.scrollTop > 0) || (deltaY > 0 && element.scrollTop < maxScrollTop - 0.5)) {
      return true;
    }
  }

  if (deltaX !== 0 && isScrollableOnAxis(element, "x")) {
    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    if ((deltaX < 0 && element.scrollLeft > 0) || (deltaX > 0 && element.scrollLeft < maxScrollLeft - 0.5)) {
      return true;
    }
  }

  return false;
}

function findScrollableTarget(start: Element, deltaX: number, deltaY: number) {
  let current: Element | null = start;

  while (current) {
    if (current instanceof HTMLElement && canConsumeScroll(current, deltaX, deltaY)) {
      return current;
    }
    current = current.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  if (scrollingElement instanceof HTMLElement && canConsumeScroll(scrollingElement, deltaX, deltaY)) {
    return scrollingElement;
  }

  return null;
}

function isLikelyTrackpadWheelEvent(event: WheelEvent) {
  const dominantDelta = Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY));

  if (!Number.isFinite(dominantDelta) || dominantDelta === 0) {
    return true;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE || event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return false;
  }

  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
    return true;
  }

  const hasFractionalDelta = !Number.isInteger(event.deltaX) || !Number.isInteger(event.deltaY);
  const hasDualAxisDelta = event.deltaX !== 0 && event.deltaY !== 0;

  if (dominantDelta <= COARSE_PIXEL_DELTA_THRESHOLD) {
    return true;
  }

  return dominantDelta < TRACKPAD_PIXEL_DELTA_LIMIT && (hasFractionalDelta || hasDualAxisDelta);
}

function normalizeWheelDelta(delta: number, deltaMode: number) {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * LINE_DELTA_PX;
  }

  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * window.innerHeight * PAGE_DELTA_FACTOR;
  }

  return delta;
}

function advanceAxis(current: number, target: number, velocity: number, deltaSeconds: number) {
  const distance = target - current;
  const nextVelocity = clamp(
    (velocity + distance * SPRING_STIFFNESS * deltaSeconds) * Math.exp(-SPRING_DAMPING * deltaSeconds),
    -MAX_VELOCITY,
    MAX_VELOCITY,
  );
  const nextCurrent = current + nextVelocity * deltaSeconds;

  if (Math.abs(target - nextCurrent) <= ANIMATION_STOP_DISTANCE && Math.abs(nextVelocity) <= ANIMATION_STOP_VELOCITY) {
    return {
      current: target,
      velocity: 0,
    };
  }

  if ((distance > 0 && nextCurrent > target) || (distance < 0 && nextCurrent < target)) {
    return {
      current: target,
      velocity: 0,
    };
  }

  return {
    current: nextCurrent,
    velocity: nextVelocity,
  };
}

export function useGlobalSmoothScroll() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animationStates = new Map<HTMLElement, ScrollAnimationState>();

    const stopAnimation = (element: HTMLElement) => {
      const state = animationStates.get(element);
      if (!state) {
        return;
      }

      if (state.rafId !== null) {
        window.cancelAnimationFrame(state.rafId);
      }

      animationStates.delete(element);
    };

    const stepAnimation = (element: HTMLElement, timestamp: number) => {
      const state = animationStates.get(element);
      if (!state) {
        return;
      }

      if (!element.isConnected) {
        stopAnimation(element);
        return;
      }

      const lastTimestamp = state.lastTimestamp ?? timestamp - 16;
      const elapsed = Math.min(timestamp - lastTimestamp, 32);
      const deltaSeconds = elapsed / 1000;
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);

      state.lastTimestamp = timestamp;
      state.targetLeft = clamp(state.targetLeft, 0, maxScrollLeft);
      state.targetTop = clamp(state.targetTop, 0, maxScrollTop);
      const nextLeft = advanceAxis(state.currentLeft, state.targetLeft, state.velocityLeft, deltaSeconds);
      const nextTop = advanceAxis(state.currentTop, state.targetTop, state.velocityTop, deltaSeconds);

      state.currentLeft = clamp(nextLeft.current, 0, maxScrollLeft);
      state.currentTop = clamp(nextTop.current, 0, maxScrollTop);
      state.velocityLeft = state.currentLeft === 0 || state.currentLeft === maxScrollLeft ? 0 : nextLeft.velocity;
      state.velocityTop = state.currentTop === 0 || state.currentTop === maxScrollTop ? 0 : nextTop.velocity;

      element.scrollLeft = state.currentLeft;
      element.scrollTop = state.currentTop;

      const doneX =
        Math.abs(state.targetLeft - state.currentLeft) <= ANIMATION_STOP_DISTANCE &&
        Math.abs(state.velocityLeft) <= ANIMATION_STOP_VELOCITY;
      const doneY =
        Math.abs(state.targetTop - state.currentTop) <= ANIMATION_STOP_DISTANCE &&
        Math.abs(state.velocityTop) <= ANIMATION_STOP_VELOCITY;

      if (doneX && doneY) {
        element.scrollLeft = state.targetLeft;
        element.scrollTop = state.targetTop;
        stopAnimation(element);
        return;
      }

      state.rafId = window.requestAnimationFrame((nextTimestamp) => stepAnimation(element, nextTimestamp));
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || reducedMotionQuery.matches) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element) || isEditableTarget(target) || isLikelyTrackpadWheelEvent(event)) {
        return;
      }

      const rawDeltaX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const rawDeltaY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      const deltaX = normalizeWheelDelta(rawDeltaX, event.deltaMode) * WHEEL_SENSITIVITY;
      const deltaY = normalizeWheelDelta(rawDeltaY, event.deltaMode) * WHEEL_SENSITIVITY;
      const scrollTarget = findScrollableTarget(target, deltaX, deltaY);

      if (!scrollTarget) {
        return;
      }

      event.preventDefault();

      const maxScrollLeft = Math.max(0, scrollTarget.scrollWidth - scrollTarget.clientWidth);
      const maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
      const existingState = animationStates.get(scrollTarget);
      const state =
        existingState ??
        {
          currentLeft: scrollTarget.scrollLeft,
          currentTop: scrollTarget.scrollTop,
          lastTimestamp: null,
          rafId: null,
          targetLeft: scrollTarget.scrollLeft,
          targetTop: scrollTarget.scrollTop,
          velocityLeft: 0,
          velocityTop: 0,
        };

      state.currentLeft = scrollTarget.scrollLeft;
      state.currentTop = scrollTarget.scrollTop;
      state.targetLeft = clamp(state.targetLeft + deltaX, 0, maxScrollLeft);
      state.targetTop = clamp(state.targetTop + deltaY, 0, maxScrollTop);
      state.velocityLeft = clamp(state.velocityLeft + deltaX * VELOCITY_BOOST, -MAX_VELOCITY, MAX_VELOCITY);
      state.velocityTop = clamp(state.velocityTop + deltaY * VELOCITY_BOOST, -MAX_VELOCITY, MAX_VELOCITY);

      // Apply a small synchronous shift so wheel input feels immediate before the inertia loop takes over.
      state.currentLeft = clamp(state.currentLeft + deltaX * IMMEDIATE_SCROLL_FRACTION, 0, maxScrollLeft);
      state.currentTop = clamp(state.currentTop + deltaY * IMMEDIATE_SCROLL_FRACTION, 0, maxScrollTop);
      scrollTarget.scrollLeft = state.currentLeft;
      scrollTarget.scrollTop = state.currentTop;
      animationStates.set(scrollTarget, state);

      if (state.rafId === null) {
        state.rafId = window.requestAnimationFrame((timestamp) => stepAnimation(scrollTarget, timestamp));
      }
    };

    const wheelListenerOptions: AddEventListenerOptions = { capture: true, passive: false };
    window.addEventListener("wheel", handleWheel, wheelListenerOptions);

    return () => {
      window.removeEventListener("wheel", handleWheel, wheelListenerOptions);
      animationStates.forEach((state) => {
        if (state.rafId !== null) {
          window.cancelAnimationFrame(state.rafId);
        }
      });
      animationStates.clear();
    };
  }, []);
}
