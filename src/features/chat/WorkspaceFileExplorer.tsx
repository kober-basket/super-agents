import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  ChevronRight,
  Code2,
  File,
  FileArchive,
  FileImage,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Hash,
  ListTree,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sheet,
  SlidersHorizontal,
} from "lucide-react";

import { getWorkspaceFileIconMeta, type WorkspaceFileIconMeta } from "../../lib/workspace-file-icons";
import type { FilePreviewPayload, WorkspaceDirectoryEntry, WorkspaceDirectoryListing } from "../../types";
import { PreviewPane } from "./PreviewPane";

interface WorkspaceFileExplorerProps {
  workspaceRoot: string;
  onListDirectory: (payload?: { path?: string; workspaceRoot?: string }) => Promise<WorkspaceDirectoryListing>;
  onReadPreview: (payload: { path?: string; url?: string; content?: string; kind?: string; title?: string }) => Promise<FilePreviewPayload>;
  onOpenExternal: (payload: { path?: string; url?: string }) => void;
  onOpenLink: (url: string) => void;
}

function basename(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function breadcrumbParts(filePath: string, rootPath: string) {
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const relativePath = normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
  const parts = relativePath.split("/").filter(Boolean);

  return parts.length > 0 ? parts : [basename(filePath)];
}

function WorkspaceFileTypeIcon({ meta }: { meta: WorkspaceFileIconMeta }) {
  const className = `workspace-file-type-icon ${meta.kind}`;
  const iconProps = { size: 15, "aria-hidden": true } as const;

  if (meta.kind === "archive") {
    return <span className={className} title={meta.label}><FileArchive {...iconProps} /></span>;
  }
  if (meta.kind === "code") {
    return <span className={className} title={meta.label}><Code2 {...iconProps} /></span>;
  }
  if (meta.kind === "config") {
    return <span className={className} title={meta.label}><SlidersHorizontal {...iconProps} /></span>;
  }
  if (meta.kind === "document") {
    return <span className={className} title={meta.label}><FileText {...iconProps} /></span>;
  }
  if (meta.kind === "image") {
    return <span className={className} title={meta.label}><FileImage {...iconProps} /></span>;
  }
  if (meta.kind === "json") {
    return <span className={className} title={meta.label}><Braces {...iconProps} /></span>;
  }
  if (meta.kind === "lock") {
    return <span className={className} title={meta.label}><LockKeyhole {...iconProps} /></span>;
  }
  if (meta.kind === "markdown") {
    return <span className={`${className} text-mark`} title={meta.label}>M</span>;
  }
  if (meta.kind === "pdf") {
    return <span className={className} title={meta.label}><FileType {...iconProps} /></span>;
  }
  if (meta.kind === "python") {
    return <span className={`${className} text-mark`} title={meta.label}>PY</span>;
  }
  if (meta.kind === "spreadsheet") {
    return <span className={className} title={meta.label}><Sheet {...iconProps} /></span>;
  }
  if (meta.kind === "yaml") {
    return <span className={className} title={meta.label}><Hash {...iconProps} /></span>;
  }

  return <span className={className} title={meta.label}><File {...iconProps} /></span>;
}

export function WorkspaceFileExplorer({
  workspaceRoot,
  onListDirectory,
  onReadPreview,
  onOpenExternal,
  onOpenLink,
}: WorkspaceFileExplorerProps) {
  const [listings, setListings] = useState<Record<string, WorkspaceDirectoryListing>>({});
  const [rootPath, setRootPath] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<FilePreviewPayload | null>(null);
  const [query, setQuery] = useState("");
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rootListing = rootPath ? listings[rootPath] : null;

  async function loadDirectory(path?: string) {
    const targetPath = path || undefined;
    setLoadingPath(targetPath ?? "root");
    setError(null);
    try {
      const listing = await onListDirectory({ path: targetPath, workspaceRoot });
      setRootPath(listing.rootPath);
      setListings((current) => ({ ...current, [listing.path]: listing }));
      if (!path) {
        setExpanded((current) => new Set([...current, listing.path]));
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "加载文件目录失败";
      setError(message.includes("No handler registered") ? "目录服务尚未启动，请重启 Electron 开发窗口后重试。" : message);
    } finally {
      setLoadingPath(null);
    }
  }

  useEffect(() => {
    void loadDirectory();
  }, [workspaceRoot]);

  async function toggleDirectory(entry: WorkspaceDirectoryEntry) {
    const nextExpanded = new Set(expanded);
    if (nextExpanded.has(entry.path)) {
      nextExpanded.delete(entry.path);
      setExpanded(nextExpanded);
      return;
    }

    nextExpanded.add(entry.path);
    setExpanded(nextExpanded);
    if (!listings[entry.path]) {
      await loadDirectory(entry.path);
    }
  }

  async function openFile(entry: WorkspaceDirectoryEntry) {
    setSelectedPath(entry.path);
    setSelectedPreview({
      title: entry.name,
      path: entry.path,
      kind: "text",
      mimeType: entry.mimeType ?? "text/plain",
      content: "",
      loading: true,
    });

    try {
      const preview = await onReadPreview({ path: entry.path, title: entry.name });
      setSelectedPreview(preview);
    } catch {
      setSelectedPreview({
        title: entry.name,
        path: entry.path,
        kind: "text",
        mimeType: "text/plain",
        content: "打开文件失败。",
      });
    }
  }

  function clearSelectedFile() {
    setSelectedPath(null);
    setSelectedPreview(null);
  }

  const normalizedQuery = query.trim().toLowerCase();

  function renderEntries(parentPath: string, depth = 0) {
    const listing = listings[parentPath];
    if (!listing) {
      return null;
    }

    return listing.entries
      .filter((entry) => !normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery))
      .map((entry) => {
        const directory = entry.kind === "directory";
        const open = expanded.has(entry.path);
        const fileIconMeta = directory ? null : getWorkspaceFileIconMeta(entry);
        return (
          <div key={entry.path}>
            <button
              className={`workspace-file-row ${selectedPath === entry.path ? "active" : ""}`}
              onClick={() => {
                if (directory) {
                  void toggleDirectory(entry);
                  return;
                }
                void openFile(entry);
              }}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              title={entry.path}
              type="button"
            >
              {directory ? (
                <ChevronRight className={open ? "open" : ""} size={14} />
              ) : (
                <span className="workspace-file-spacer" />
              )}
              {directory ? (
                open ? (
                  <FolderOpen size={15} />
                ) : (
                  <Folder size={15} />
                )
              ) : fileIconMeta ? (
                <WorkspaceFileTypeIcon meta={fileIconMeta} />
              ) : (
                <File size={15} />
              )}
              <span>{entry.name}</span>
            </button>
            {directory && open ? renderEntries(entry.path, depth + 1) : null}
          </div>
        );
      });
  }

  const selectedBreadcrumbParts = selectedPreview?.path
    ? breadcrumbParts(selectedPreview.path, rootPath)
    : [basename(rootPath) || "workspace"];

  return (
    <section className={`workspace-file-explorer ${selectedPreview ? "has-preview" : "tree-only"}`}>
      <aside className="workspace-file-tree">
        <div className="workspace-file-tree-toolbar" aria-label="文件浏览工具">
          <button className="workspace-file-toolbar-button active" title="文件树" type="button">
            <ListTree size={16} />
          </button>
          <button className="workspace-file-toolbar-button" title="搜索文件" type="button">
            <Search size={16} />
          </button>
          <span className="workspace-file-toolbar-spacer" />
          <button className="workspace-file-toolbar-button" disabled title="后退" type="button">
            <ArrowLeft size={16} />
          </button>
          <button className="workspace-file-toolbar-button" disabled title="前进" type="button">
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="workspace-file-tree-head">
          <label className="workspace-file-search">
            <Search size={14} />
            <input
              aria-label="筛选文件"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选文件..."
              value={query}
            />
          </label>
          <button
            aria-label="刷新文件目录"
            className="ghost-icon"
            onClick={() => void loadDirectory(rootPath || undefined)}
            type="button"
          >
            <RefreshCw size={14} className={loadingPath ? "spin" : ""} />
          </button>
        </div>
        <div className="workspace-file-root" title={rootPath}>
          {rootListing?.relativePath || basename(rootPath) || "workspace"}
        </div>
        <div className="workspace-file-list" data-native-wheel-scroll="true">
          {error ? <div className="workspace-file-error">{error}</div> : null}
          {!error && !rootListing ? <div className="workspace-file-loading">正在加载文件...</div> : null}
          {rootListing ? renderEntries(rootListing.path) : null}
        </div>
      </aside>

      {selectedPreview ? (
        <div className="workspace-file-preview">
          <div className="workspace-file-breadcrumb">
            <nav className="workspace-file-breadcrumb-path" aria-label="文件路径">
              {selectedBreadcrumbParts.map((part, index) => {
                const current = index === selectedBreadcrumbParts.length - 1;
                return (
                  <span
                    key={`${part}-${index}`}
                    className={`workspace-file-breadcrumb-segment ${current ? "current" : ""}`}
                  >
                    {part}
                    {!current ? <ChevronRight size={14} aria-hidden="true" /> : null}
                  </span>
                );
              })}
            </nav>
            {selectedPreview.path ? (
              <button
                className="workspace-file-breadcrumb-action"
                onClick={() => onOpenExternal({ path: selectedPreview.path ?? undefined })}
                title="在系统应用中打开"
                type="button"
              >
                <MoreHorizontal size={16} />
              </button>
            ) : null}
          </div>
          <PreviewPane
            embedded
            preview={selectedPreview}
            onClearPreview={clearSelectedFile}
            onClosePane={() => undefined}
            onOpenExternal={onOpenExternal}
            onOpenLink={onOpenLink}
          />
        </div>
      ) : null}
    </section>
  );
}
