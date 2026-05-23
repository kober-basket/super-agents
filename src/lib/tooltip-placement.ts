export type FloatingTooltipPlacement = "bottom" | "top";

export interface FloatingTooltipPlacementInput {
  anchorBottom: number;
  anchorTop: number;
  boundaryBottom?: number;
  tooltipHeight: number;
  viewportHeight: number;
  margin?: number;
}

export function chooseFloatingTooltipPlacement({
  anchorBottom,
  anchorTop,
  boundaryBottom,
  tooltipHeight,
  viewportHeight,
  margin = 12,
}: FloatingTooltipPlacementInput): FloatingTooltipPlacement {
  const usableBottom = Math.min(viewportHeight, boundaryBottom ?? viewportHeight);
  const spaceBelow = Math.max(0, usableBottom - anchorBottom);
  const spaceAbove = Math.max(0, anchorTop);
  const neededSpace = tooltipHeight + margin;

  if (spaceBelow >= neededSpace) {
    return "bottom";
  }

  if (spaceAbove >= neededSpace || spaceAbove > spaceBelow) {
    return "top";
  }

  return "bottom";
}
