export function formatToolMetadataLines(metadata?: Record<string, unknown>) {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const permission =
    "permission" in metadata && metadata.permission && typeof metadata.permission === "object"
      ? (metadata.permission as Record<string, unknown>)
      : null;

  if (!permission) {
    return [];
  }

  const optionName = typeof permission.optionName === "string" ? permission.optionName.trim() : "";
  const outcome = typeof permission.outcome === "string" ? permission.outcome.trim() : "";

  if (optionName) {
    return [`Permission: ${optionName}`];
  }

  if (outcome) {
    return [`Permission: ${outcome}`];
  }

  return [];
}
