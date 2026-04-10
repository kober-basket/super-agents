import clsx from "clsx";
import { ArrowLeft } from "lucide-react";

import { SETTINGS_SECTIONS } from "./constants";
import type { SettingsSection } from "./types";

interface SettingsSidebarProps {
  settingsSection: SettingsSection;
  onBack: () => void;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsSidebar({
  settingsSection,
  onBack,
  onSelect,
}: SettingsSidebarProps) {
  return (
    <aside className="sidebar settings-sidebar">
      <button className="settings-back-link" onClick={onBack}>
        <ArrowLeft size={18} />
        <span>返回</span>
      </button>

      <div className="settings-nav">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;

          return (
            <button
              key={section.id}
              className={clsx("settings-nav-link", settingsSection === section.id && "active")}
              onClick={() => onSelect(section.id)}
            >
              <Icon size={18} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
