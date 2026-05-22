import type { WorkspaceDirectoryEntry } from "../types";

export function sortWorkspaceDirectoryEntries(entries: WorkspaceDirectoryEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}
