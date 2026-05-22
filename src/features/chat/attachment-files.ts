import type { FileDropEntry } from "../../types";
import { fileKind } from "../shared/utils";

interface ComposerAttachmentReadOptions {
  createId?: () => string;
  readAsDataUrl?: (file: File) => Promise<string>;
  readAsText?: (file: File) => Promise<string>;
}

function createUid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取图片失败")));
    reader.readAsDataURL(file);
  });
}

async function readFileText(file: File) {
  if (typeof file.text === "function") {
    return await file.text();
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取文件失败")));
    reader.readAsText(file);
  });
}

function shouldReadInlineText(entry: FileDropEntry) {
  return entry.kind === "text" || entry.kind === "markdown" || entry.kind === "code" || entry.kind === "html";
}

export async function createComposerAttachmentsFromFiles(
  fileList: FileList | File[],
  options: ComposerAttachmentReadOptions = {},
) {
  const files = Array.from(fileList);
  const createId = options.createId ?? createUid;
  const readAsDataUrl = options.readAsDataUrl ?? readFileAsDataUrl;
  const readAsText = options.readAsText ?? readFileText;

  return await Promise.all(
    files.map(async (file, index): Promise<FileDropEntry> => {
      const extended = file as File & { path?: string };
      const name = file.name || `pasted-file-${index + 1}`;
      const entry: FileDropEntry = {
        id: createId(),
        name,
        path: extended.path || name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      };
      const kind = fileKind(entry);
      const withKind: FileDropEntry = { ...entry, kind };

      if (kind === "image") {
        const dataUrl = await readAsDataUrl(file).catch(() => "");
        return dataUrl ? { ...withKind, dataUrl } : withKind;
      }

      if (shouldReadInlineText(withKind)) {
        const content = await readAsText(file).catch(() => "");
        return content ? { ...withKind, content } : withKind;
      }

      return withKind;
    }),
  );
}
