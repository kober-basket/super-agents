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
          <h1>资料与目录</h1>
          <p>保留和本地办公资料相关的必要信息，避免把内部连接参数直接暴露出来。</p>
        </div>
        <button className="secondary-button" onClick={() => void onOpenWorkspaceFolder()}>
          <FolderOpen size={14} />
          打开资料夹
        </button>
      </header>

      <div className="settings-stage-grid two">
        <article className="panel-card form-card settings-surface">
          <h3>资料目录</h3>
          <label>
            <span>当前工作目录</span>
            <input value={opencodeRoot} readOnly />
          </label>
          {bridgeUrl ? (
            <label>
              <span>内部连接地址</span>
              <input value={bridgeUrl} readOnly />
            </label>
          ) : null}
          <p className="field-note">这里以查看为主，如果后面真要开放高级连接，再单独放进高级页。</p>
        </article>

        <article className="panel-card form-card settings-surface">
          <h3>协作规模</h3>
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
