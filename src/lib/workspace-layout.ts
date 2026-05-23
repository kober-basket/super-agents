import type { AppSection } from "../types";

export type RightPanePresentation = "hidden" | "inline" | "overlay";

export interface RightPanePresentationInput {
  view: AppSection;
  rightPaneOpen: boolean;
  viewportWidth: number;
}

export function resolveRightPanePresentation({
  view,
  rightPaneOpen,
  viewportWidth,
}: RightPanePresentationInput): RightPanePresentation {
  if (!rightPaneOpen) {
    return "hidden";
  }

  if (view !== "chat") {
    return "hidden";
  }

  if (viewportWidth > 1400) {
    return "inline";
  }

  return "overlay";
}
