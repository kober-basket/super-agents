import { ShieldCheck } from "lucide-react";

import type { SecurityConfig } from "../../types";

interface PermissionsSettingsProps {
  security: SecurityConfig;
  onToggleFullFileSystemAccess: (enabled: boolean) => void;
}

export function PermissionsSettings({
  security,
  onToggleFullFileSystemAccess,
}: PermissionsSettingsProps) {
  return (
    <section className="settings-stage permissions-settings-stage">
      <header className="settings-stage-header">
        <div className="settings-stage-heading">
          <h1>权限</h1>
        </div>
      </header>

      <div className="settings-block">
        <article className="panel-card form-card settings-surface permission-card">
          <div className="permission-card-copy">
            <div className="permission-card-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h3>完全访问权限</h3>
              <p>
                允许内置文件工具直接访问工作区之外的本机路径。关闭时，访问项目外目录会继续弹出授权确认。
              </p>
            </div>
          </div>

          <div className="permission-card-toggle">
            <span>{security.fullFileSystemAccess ? "已开启" : "已关闭"}</span>
            <label className="provider-switch" aria-label="完全访问权限开关">
              <input
                checked={security.fullFileSystemAccess}
                onChange={(event) => onToggleFullFileSystemAccess(event.target.checked)}
                type="checkbox"
              />
              <span className="provider-switch-track">
                <span className="provider-switch-thumb" />
              </span>
            </label>
          </div>
        </article>
      </div>
    </section>
  );
}
