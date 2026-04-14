import clsx from "clsx";
import { FolderOpen } from "lucide-react";

import { formatBytes } from "../../lib/format";
import type { FileDropEntry } from "../../types";
import { fileKind } from "../shared/utils";

interface FileCardProps {
  file: FileDropEntry;
  onOpen: (file: FileDropEntry) => void;
}

export function FileCard({ file, onOpen }: FileCardProps) {
  return (
    <button className="file-tile" onClick={() => onOpen(file)}>
      <div className={clsx("file-tile-icon", file.kind ?? fileKind(file))}>
        <FolderOpen size={14} />
      </div>
      <div className="file-tile-copy">
        <strong>{file.name}</strong>
        <span>
          {formatBytes(file.size)} · {file.path}
        </span>
      </div>
    </button>
  );
}
