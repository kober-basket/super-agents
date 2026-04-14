import { FolderOpen } from "lucide-react";

import type { AppConfig } from "../../types";
import { SettingsOverviewStats } from "./SettingsOverviewStats";

interface WorkspaceSettingsProps {
  bridgeUrl: AppConfig["bridgeUrl"];
  mcpCount: number;
  opencodeRoot: AppConfig["opencodeRoot"];
  providerCount: number;
  threadCount: number;
  onOpenWorkspaceFolder: () => void | Promise<void>;
}

export function WorkspaceSettings({
  bridgeUrl,
  mcpCount,
  opencodeRoot,
  providerCount,
  threadCount,
  onOpenWorkspaceFolder,
}: WorkspaceSettingsProps) {
  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>工作区</h1>
        </div>
        <button className="secondary-button" onClick={() => void onOpenWorkspaceFolder()}>
          <FolderOpen size={14} />
          打开目录
        </button>
      </header>

      <div className="settings-stage-grid two">
        <article className="panel-card form-card settings-surface">
          <h3>当前目录</h3>
          <label>
            <span>工作目录</span>
            <input value={opencodeRoot} readOnly />
          </label>
          {bridgeUrl ? (
            <label>
              <span>连接地址</span>
              <input value={bridgeUrl} readOnly />
            </label>
          ) : null}
        </article>

        <article className="panel-card form-card settings-surface">
          <h3>概览</h3>
          <SettingsOverviewStats
            mcpCount={mcpCount}
            providerCount={providerCount}
            threadCount={threadCount}
          />
        </article>
      </div>
    </section>
  );
}
