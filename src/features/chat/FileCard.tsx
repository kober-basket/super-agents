import clsx from "clsx";

import { formatBytes } from "../../lib/format";
import type { FileDropEntry } from "../../types";
import { describePreviewItem, fileKind } from "../shared/utils";

interface FileCardProps {
  file: FileDropEntry;
  onOpen: (file: FileDropEntry) => void;
}

export function FileCard({ file, onOpen }: FileCardProps) {
  const kind = file.kind ?? fileKind(file);
  const presentation = describePreviewItem({
    kind,
    path: file.path,
    name: file.name,
    mimeType: file.mimeType,
  });
  const secondaryText = file.size > 0 ? formatBytes(file.size) : "已附加文件";

  return (
    <button className="file-tile" onClick={() => onOpen(file)}>
      <div className={clsx("file-tile-icon", `tone-${presentation.tone}`)}>
        <span>{presentation.badge}</span>
      </div>
      <div className="file-tile-copy">
        <div className="file-tile-title">
          <strong>{file.name}</strong>
          <em>{presentation.label}</em>
        </div>
        <span>{secondaryText}</span>
      </div>
    </button>
  );
}
