import { FolderOpen } from "lucide-react";

import { SettingsOverviewStats } from "./SettingsOverviewStats";

interface GeneralSettingsProps {
  activeModelLabel: string | null;
  mcpCount: number;
  providerCount: number;
  threadCount: number;
  onOpenWorkspaceFolder: () => void | Promise<void>;
}

export function GeneralSettings({
  activeModelLabel,
  mcpCount,
  providerCount,
  threadCount,
  onOpenWorkspaceFolder,
}: GeneralSettingsProps) {
  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>常规</h1>
        </div>
        <button className="secondary-button" onClick={() => void onOpenWorkspaceFolder()}>
          <FolderOpen size={14} />
          打开目录
        </button>
      </header>

      <div className="settings-stage-grid">
        <article className="panel-card form-card settings-surface">
          <h3>概览</h3>
          <SettingsOverviewStats
            mcpCount={mcpCount}
            providerCount={providerCount}
            threadCount={threadCount}
          />
          <p className="field-note">默认模型：{activeModelLabel ?? "暂无可用模型"}</p>
        </article>
      </div>
    </section>
  );
}
