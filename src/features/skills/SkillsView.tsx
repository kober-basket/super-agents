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
            <h2>技能</h2>
            <p>统一管理已安装技能、已发现技能，以及推荐的技能模板。</p>
          </div>

          <div className="skills-toolbar-actions">
            <button className="secondary-button" onClick={() => void onRefresh()} disabled={skillsRefreshing}>
              {skillsRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              刷新
            </button>

            <label className="search-field">
              <Search size={16} />
              <input
                value={skillQuery}
                onChange={(event) => onSkillQueryChange(event.target.value)}
                placeholder="搜索技能"
              />
            </label>

            <button className="primary-button" onClick={() => onPrepareSkillDraft()}>
              <Plus size={16} />
              新建技能
            </button>
          </div>
        </header>

        <div className="skills-section">
          <div className="skills-section-head">
            <h3>已安装技能</h3>
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
                      <span>{skill.description || "暂无描述"}</span>
                      <small>
                        {skill.location}
                        {isCodexSkill ? " · Codex" : " · Workspace"}
                        {skill.enabled === false ? " · 已禁用" : ""}
                      </small>
                    </div>
                    <div className="skill-card-actions">
                      <button
                        className={clsx("skill-state-button installed", skill.enabled === false && "disabled")}
                        onClick={() => void onRunSkill(skill)}
                        title={isCodexSkill ? "带入对话" : "立即运行"}
                        disabled={skill.enabled === false}
                      >
                        {isCodexSkill ? <Sparkles size={16} /> : <Check size={16} />}
                      </button>
                      <button
                        className={clsx("toggle-button", skill.enabled && "active")}
                        onClick={() => onUpdateInstalledSkill(skill.id, { enabled: !skill.enabled })}
                      >
                        {skill.enabled ? "已启用" : "已禁用"}
                      </button>
                      <button className="ghost-text-button danger" onClick={() => void onUninstallSkill(skill)}>
                        <X size={14} />
                        卸载
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-panel">
              <strong>还没有已安装技能</strong>
              <p>你可以先创建一个技能，或者把下方发现/推荐的技能带入当前会话继续完善。</p>
              <button className="secondary-button" onClick={() => onPrepareSkillDraft()}>
                <Plus size={14} />
                创建第一个技能
              </button>
            </div>
          )}
        </div>

        {filteredReferenceSkills.length > 0 ? (
          <div className="skills-section">
            <div className="skills-section-head">
              <h3>已发现技能</h3>
            </div>

            <div className="skill-grid installed-grid">
              {filteredReferenceSkills.map((skill, index) => {
                const tone = SKILL_TONES[(index + 2) % SKILL_TONES.length];

                return (
                  <article key={skill.id} className="skill-card installed">
                    <div className={clsx("skill-mark", `tone-${tone}`)}>{makeBadgeText(skill.name)}</div>
                    <div className="skill-copy">
                      <strong>{skill.name}</strong>
                      <span>{skill.description || "来自运行时发现的技能"}</span>
                      <small>{skill.location}</small>
                    </div>
                    <button className="skill-state-button" onClick={() => onUseReferenceSkill(skill)} title="带入对话">
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
            <h3>推荐模板</h3>
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
                    title="用这个模板创建技能"
                  >
                    <Plus size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : hasResults ? null : (
            <div className="empty-panel compact">
              <strong>没有匹配的技能结果</strong>
              <p>换个关键词试试，或者直接新建一个技能模板。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
