import clsx from "clsx";
import {
  Check,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import type { RuntimeSkill, SkillConfig } from "../../types";
import { makeBadgeText } from "../shared/utils";
import { SKILL_TONES, type RecommendedSkill } from "./constants";

export type InstalledSkillView = SkillConfig & { location: string };

interface SkillsViewProps {
  filteredInstalledSkills: InstalledSkillView[];
  filteredRecommendedSkills: RecommendedSkill[];
  filteredReferenceSkills: RuntimeSkill[];
  hasResults: boolean;
  skillQuery: string;
  skillsRefreshing: boolean;
  onPrepareSkillDraft: (name?: string, description?: string) => void;
  onRefresh: () => void | Promise<void>;
  onRunSkill: (
    skill: Pick<SkillConfig, "id" | "name" | "description" | "kind" | "enabled">,
  ) => void | Promise<void>;
  onSkillQueryChange: (value: string) => void;
  onUninstallSkill: (skill: SkillConfig) => void | Promise<void>;
  onUpdateInstalledSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
  onUseReferenceSkill: (skill: RuntimeSkill) => void;
}

export function SkillsView({
  filteredInstalledSkills,
  filteredRecommendedSkills,
  filteredReferenceSkills,
  hasResults,
  skillQuery,
  skillsRefreshing,
  onPrepareSkillDraft,
  onRefresh,
  onRunSkill,
  onSkillQueryChange,
  onUninstallSkill,
  onUpdateInstalledSkill,
  onUseReferenceSkill,
}: SkillsViewProps) {
  return (
    <section className="skills-page">
      <div className="skills-inner">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>鎶€鑳?/h2>
            <p>缁熶竴绠＄悊宸插畨瑁呮妧鑳姐€佸凡鍙戠幇鎶€鑳藉拰鎺ㄨ崘鎶€鑳姐€?/p>
          </div>

          <div className="skills-toolbar-actions">
            <button className="secondary-button" onClick={() => void onRefresh()} disabled={skillsRefreshing}>
              {skillsRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              鍒锋柊
            </button>

            <label className="search-field">
              <Search size={16} />
              <input
                value={skillQuery}
                onChange={(event) => onSkillQueryChange(event.target.value)}
                placeholder="鎼滅储鎶€鑳?
              />
            </label>

            <button className="primary-button" onClick={() => onPrepareSkillDraft()}>
              <Plus size={16} />
              鏂版妧鑳?            </button>
          </div>
        </header>

        <div className="skills-section">
          <div className="skills-section-head">
            <h3>宸插畨瑁呮妧鑳?/h3>
          </div>

          {filteredInstalledSkills.length > 0 ? (
            <div className="skill-grid installed-grid">
              {filteredInstalledSkills.map((skill, index) => {
                const tone = SKILL_TONES[index % SKILL_TONES.length];
                const isCodexSkill = skill.kind === "codex";

                return (
                  <article
                    key={skill.id}
                    className={clsx("skill-card installed", skill.enabled === false && "disabled")}
                  >
                    <div className={clsx("skill-mark", `tone-${tone}`)}>{makeBadgeText(skill.name)}</div>
                    <div className="skill-copy">
                      <strong>{skill.name}</strong>
                      <span>{skill.description || "鏈湴宸插畨瑁呮妧鑳?}</span>
                      <small>
                        {skill.location}
                        {isCodexSkill ? " 路 Codex" : " 路 鍛戒护"}
                        {skill.enabled === false ? " 路 宸插仠鐢? : ""}
                      </small>
                    </div>
                    <div className="skill-card-actions">
                      <button
                        className={clsx("skill-state-button installed", skill.enabled === false && "disabled")}
                        onClick={() => void onRunSkill(skill)}
                        title={isCodexSkill ? "甯﹀叆瀵硅瘽" : "杩愯鎶€鑳?}
                        disabled={skill.enabled === false}
                      >
                        {isCodexSkill ? <Sparkles size={16} /> : <Check size={16} />}
                      </button>
                      <button
                        className={clsx("toggle-button", skill.enabled && "active")}
                        onClick={() => onUpdateInstalledSkill(skill.id, { enabled: !skill.enabled })}
                      >
                        {skill.enabled ? "鍚敤涓? : "宸插仠鐢?}
                      </button>
                      <button className="ghost-text-button danger" onClick={() => void onUninstallSkill(skill)}>
                        <X size={14} />
                        鍗歌浇
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel">
              <strong>杩樻病鏈夊凡瀹夎鎶€鑳?/strong>
              <p>杩欓噷浼氭樉绀?super-agents 鍐呯疆鎶€鑳斤紝浠ュ强鏈満 Codex 宸插畨瑁呯殑榛樿鎶€鑳姐€?/p>
              <button className="secondary-button" onClick={() => onPrepareSkillDraft()}>
                <Plus size={14} />
                璧疯崏涓€涓妧鑳?              </button>
            </div>
          )}
        </div>

        {filteredReferenceSkills.length > 0 ? (
          <div className="skills-section">
            <div className="skills-section-head">
              <h3>宸插彂鐜扮殑 opencode 鎶€鑳?/h3>
            </div>

            <div className="skill-grid installed-grid">
              {filteredReferenceSkills.map((skill, index) => {
                const tone = SKILL_TONES[(index + 2) % SKILL_TONES.length];

                return (
                  <article key={skill.id} className="skill-card installed">
                    <div className={clsx("skill-mark", `tone-${tone}`)}>{makeBadgeText(skill.name)}</div>
                    <div className="skill-copy">
                      <strong>{skill.name}</strong>
                      <span>{skill.description || "opencode 鎶€鑳?}</span>
                      <small>{skill.location}</small>
                    </div>
                    <button className="skill-state-button" onClick={() => onUseReferenceSkill(skill)} title="甯﹀叆瀵硅瘽">
                      <Sparkles size={16} />
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="skills-section">
          <div className="skills-section-head">
            <h3>鎺ㄨ崘</h3>
          </div>

          {filteredRecommendedSkills.length > 0 ? (
            <div className="skill-grid recommended-grid">
              {filteredRecommendedSkills.map((skill) => (
                <article key={skill.id} className="skill-card recommended">
                  <div className={clsx("skill-mark", `tone-${skill.tone}`)}>{skill.badge}</div>
                  <div className="skill-copy">
                    <strong>{skill.name}</strong>
                    <span>{skill.description}</span>
                  </div>
                  <button
                    className="skill-state-button"
                    onClick={() => onPrepareSkillDraft(skill.name, skill.description)}
                    title="浠ヨ繖涓柟鍚戝垱寤烘妧鑳?
                  >
                    <Plus size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : hasResults ? null : (
            <div className="empty-panel compact">
              <strong>娌℃湁鍖归厤鍒版妧鑳?/strong>
              <p>鎹釜鍏抽敭璇嶈瘯璇曪紝鎴栬€呯洿鎺ュ垱寤轰竴涓柊鐨勬妧鑳借崏绋裤€?/p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
