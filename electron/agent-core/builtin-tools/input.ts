export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function arrayInput(input: unknown, key: string): unknown[] {
  if (!isRecord(input)) {
    return [];
  }
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

export function sanitizeIdentifier(value: string, fallback: string) {
  const normalized = value.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}
