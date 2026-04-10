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
  const activeTheme =
    APPEARANCE_THEME_OPTIONS.find((option) => option.id === appearance.theme) ?? APPEARANCE_THEME_OPTIONS[0];

  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>外观设置</h1>
          <p>切换应用配色方案，让界面风格更贴合你的工作状态。</p>
        </div>
      </header>

      <div className="settings-stage-grid">
        <article className="panel-card form-card settings-surface">
          <div className="panel-head">
            <div>
              <h2>配色方案</h2>
              <p>现在提供更多主题，浅色、暖色、深色都可以直接切换。</p>
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
              <span>{activeTheme.label}</span>
            </div>
            <div className="appearance-note-item">
              <strong>窗口样式</strong>
              <span>主题会同步作用于侧栏、卡片、按钮和标题栏，不再出现中英混杂。</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
