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
          <h1>外观</h1>
        </div>
      </header>

      <div className="settings-stage-grid">
        <article className="panel-card form-card settings-surface">
          <div className="panel-head">
            <div>
              <h2>配色方案</h2>
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
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </article>
      </div>
    </section>
  );
}
