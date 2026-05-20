export function isTrustedDesktopOrigin(origin: string) {
  if (!origin.trim()) {
    return false;
  }

  try {
    const url = new URL(origin);
    if (url.protocol === "file:") {
      return true;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return origin.startsWith("file://");
  }
}
