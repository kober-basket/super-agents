import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RemoteChannelMessage {
  accountId: string;
  peerId: string;
  title: string;
  text: string;
  attachmentPaths: string[];
  contextToken?: string;
  replyText: (text: string) => Promise<void>;
}

export interface RemoteChannelCallbacks {
  onMessage: (message: RemoteChannelMessage) => void;
  onError?: (error: unknown) => void;
  onRunningChange?: (running: boolean) => void;
}

export interface RemoteChannelMonitor {
  stop: () => Promise<void>;
}

export function sanitizePathSegment(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "unknown";
}

export function sanitizeFileName(value: string, fallback = "attachment.bin") {
  const safeValue = value.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return safeValue || fallback;
}

export async function writeRemoteAttachment(params: {
  rootDir: string;
  channel: string;
  accountId: string;
  peerId: string;
  fileName: string;
  buffer: Buffer;
}) {
  const directory = path.join(
    params.rootDir,
    params.channel,
    sanitizePathSegment(params.accountId),
    sanitizePathSegment(params.peerId),
  );
  await mkdir(directory, { recursive: true });
  const targetPath = path.join(
    directory,
    `${Date.now()}-${randomUUID()}-${sanitizeFileName(params.fileName)}`,
  );
  await writeFile(targetPath, params.buffer);
  return targetPath;
}

export function readHeader(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  if ("get" in headers && typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get: (headerName: string) => string | null }).get(name);
    return value ?? undefined;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.find((item): item is string => typeof item === "string");
    }
  }

  return undefined;
}

export function parseContentDispositionFileName(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const basicMatch = value.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1];
}
