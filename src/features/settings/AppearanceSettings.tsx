import clsx from "clsx";

import type { AppConfig } from "../../types";
import { APPEARANCE_THEME_OPTIONS } from "./appearance";

interface AppearanceSettingsProps {
  appearance: AppConfig["appearance"];
  onThemeChange: (theme: AppConfig["appearance"]["theme"]) => void;
}

export function AppearanceSettings({
  appearance,
  onThemeChange,
}: AppearanceSettingsProps) {
  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>界面设置</h1>
          <p>切换应用色系，同时保留更简洁的桌面界面风格。</p>
        </div>
      </header>

      <div className="settings-stage-grid">
        <article className="panel-card form-card settings-surface">
          <div className="panel-head">
            <div>
              <h2>色系方案</h2>
              <p>选择一个更适合你工作状态的界面风格。</p>
            </div>
          </div>

          <div className="appearance-theme-grid">
            {APPEARANCE_THEME_OPTIONS.map((option) => {
              const active = option.id === appearance.theme;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={clsx("appearance-theme-card", active && "active")}
                  onClick={() => onThemeChange(option.id)}
                >
                  <div className="appearance-theme-sample">
                    {option.swatches.map((color) => (
                      <span
                        key={color}
                        className="appearance-theme-swatch"
                        style={{ background: color }}
                      />
                    ))}
                  </div>
                  <div className="appearance-theme-copy">
                    <div className="appearance-theme-title">
                      <strong>{option.label}</strong>
                      <span>{option.accentLabel}</span>
                    </div>
                    <p>{option.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel-card form-card settings-surface appearance-note-card">
          <div className="appearance-note-list">
            <div className="appearance-note-item">
              <strong>当前主题</strong>
              <span>{APPEARANCE_THEME_OPTIONS.find((option) => option.id === appearance.theme)?.label ?? "Linen"}</span>
            </div>
            <div className="appearance-note-item">
              <strong>窗口样式</strong>
              <span>已使用更简洁的自定义标题栏，减少默认菜单栏干扰。</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
