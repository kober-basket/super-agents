import clsx from "clsx";
import { Boxes, FilePlus2, FolderOpen, Import as ImportIcon, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { workspaceClient } from "../../services/workspace-client";
import type { SkillConfig } from "../../types";
import { RichMarkdown } from "../shared/RichMarkdown";

export type InstalledSkillView = SkillConfig & { location: string };

interface SkillsViewProps {
  filteredInstalledSkills: InstalledSkillView[];
  hasResults: boolean;
  skillQuery: string;
  skillsImporting: boolean;
  skillsRefreshing: boolean;
  onImportLocalSkill: () => void | Promise<void>;
  onPrepareSkillDraft: (name?: string, description?: string) => void;
  onRefresh: () => void | Promise<void>;
  onSkillQueryChange: (value: string) => void;
  onUninstallSkill: (skill: SkillConfig) => void | Promise<void>;
  onUpdateInstalledSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
}

type SkillModalState = { kind: "installed"; skill: InstalledSkillView };

const SKILL_ACCENTS = [
  "skill-accent-sky",
  "skill-accent-amber",
  "skill-accent-violet",
  "skill-accent-mint",
  "skill-accent-rose",
  "skill-accent-indigo",
] as const;

export function SkillsView({
  filteredInstalledSkills,
  hasResults,
  skillQuery,
  skillsImporting,
  skillsRefreshing,
  onImportLocalSkill,
  onPrepareSkillDraft,
  onRefresh,
  onSkillQueryChange,
  onUninstallSkill,
  onUpdateInstalledSkill,
}: SkillsViewProps) {
  const [activeSkill, setActiveSkill] = useState<SkillModalState | null>(null);
  const [modalMarkdown, setModalMarkdown] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [skillActionsOpen, setSkillActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSkillFolder = activeSkill ? resolveSkillFolderPath(activeSkill) : "";
  const builtinSkills = filteredInstalledSkills.filter((skill) => skill.system);
  const userSkills = filteredInstalledSkills.filter((skill) => !skill.system);

  useEffect(() => {
    if (!activeSkill) return undefined;

    let cancelled = false;

    async function loadSkillContent() {
      const currentSkill = activeSkill;
      if (!currentSkill) return;
      setModalLoading(true);
      try {
        const markdown = await resolveSkillMarkdown(currentSkill);
        if (!cancelled) setModalMarkdown(markdown);
      } catch {
        if (!cancelled) setModalMarkdown(fallbackMarkdown(currentSkill));
      } finally {
        if (!cancelled) setModalLoading(false);
      }
    }

    void loadSkillContent();

    return () => {
      cancelled = true;
    };
  }, [activeSkill]);

  useEffect(() => {
    if (!activeSkill) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveSkill(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSkill]);

  useEffect(() => {
    if (!skillActionsOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (actionsMenuRef.current?.contains(event.target as Node)) return;
      setSkillActionsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSkillActionsOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [skillActionsOpen]);

  return (
    <section className="skills-page">
      <div className="skills-inner">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>技能</h2>
          </div>

          <div className="skills-toolbar-actions">
            <label className="search-field skill-search-field">
              <Search size={16} />
              <input
                value={skillQuery}
                onChange={(event) => onSkillQueryChange(event.target.value)}
                placeholder="搜索技能"
              />
            </label>

            <button
              aria-label="刷新技能"
              className="secondary-button skill-toolbar-icon-button"
              disabled={skillsRefreshing}
              onClick={() => void onRefresh()}
              title="刷新"
              type="button"
            >
              <RefreshCw size={16} className={skillsRefreshing ? "spin" : undefined} />
            </button>

            <div className="skill-actions-menu-wrap" ref={actionsMenuRef}>
              <button
                aria-expanded={skillActionsOpen}
                aria-haspopup="menu"
                aria-label="添加技能"
                className="secondary-button skill-toolbar-icon-button"
                onClick={() => setSkillActionsOpen((open) => !open)}
                title="添加技能"
                type="button"
              >
                <Plus size={18} />
              </button>

              {skillActionsOpen ? (
                <div className="skill-actions-menu" role="menu">
                  <button
                    disabled={skillsImporting}
                    onClick={() => {
                      setSkillActionsOpen(false);
                      void onImportLocalSkill();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {skillsImporting ? <LoaderCircle size={16} className="spin" /> : <ImportIcon size={16} />}
                    <span>{skillsImporting ? "导入中..." : "导入技能"}</span>
                  </button>
                  <button
                    onClick={() => {
                      setSkillActionsOpen(false);
                      onPrepareSkillDraft();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <FilePlus2 size={16} />
                    <span>新建技能</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {filteredInstalledSkills.length > 0 ? (
          <>
            <SkillSection
              title="内置技能"
              skills={builtinSkills}
              emptyText="没有匹配的内置技能。"
              accentOffset={0}
              onSelectSkill={(skill) => setActiveSkill({ kind: "installed", skill })}
            />
            <SkillSection
              title="用户安装"
              skills={userSkills}
              emptyText="没有匹配的用户安装技能。"
              accentOffset={builtinSkills.length}
              onSelectSkill={(skill) => setActiveSkill({ kind: "installed", skill })}
            />
          </>
        ) : (
          <section className="skills-section">
            <div className="empty-panel">
              <strong>还没有已安装技能</strong>
              <p>可以先新建一个，或者导入本地技能。</p>
              <button className="secondary-button" onClick={() => onPrepareSkillDraft()}>
                <Plus size={14} />
                创建第一个技能
              </button>
            </div>
          </section>
        )}

        {hasResults ? null : (
          <div className="skills-empty-banner">
            <span>当前搜索没有结果，试试更短的关键词。</span>
          </div>
        )}
      </div>

      {activeSkill ? (
        <div className="modal-scrim" onClick={() => setActiveSkill(null)}>
          <div className="skill-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="skill-detail-head">
              <div className="skill-detail-title-wrap compact">
                <div className={clsx("skill-icon-shell", "large", resolveAccent(activeSkill.skill.name.length))}>
                  <Boxes size={28} />
                </div>
                <div className="skill-detail-title-copy">
                  <div className="skill-detail-title-row">
                    <h3>{activeSkill.skill.name}</h3>
                    {activeSkill.kind === "installed" ? (
                      <>
                        {activeSkill.skill.system ? <span className="skill-status-chip subtle">内置技能</span> : null}
                        <span className={clsx("skill-status-chip", activeSkill.skill.enabled ? "enabled" : "disabled")}>
                          {activeSkill.skill.enabled ? "启用" : "停用"}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p>{activeSkill.skill.description || "暂无描述"}</p>
                </div>
              </div>

              <div className="skill-detail-head-actions">
                {activeSkillFolder ? (
                  <button
                    className="ghost-icon"
                    onClick={() => void workspaceClient.openFolder(activeSkillFolder)}
                    title="打开技能所在文件夹"
                    type="button"
                  >
                    <FolderOpen size={16} />
                  </button>
                ) : null}
                <button className="ghost-icon" onClick={() => setActiveSkill(null)} title="关闭" type="button">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="skill-detail-body">
              {modalLoading ? (
                <div className="skill-detail-loading">
                  <LoaderCircle size={18} className="spin" />
                  <span>正在读取技能内容...</span>
                </div>
              ) : (
                <RichMarkdown className="skill-detail-markdown preview-markdown" content={modalMarkdown} />
              )}
            </div>

            <div className="skill-detail-footer">
              <button
                className={clsx("toggle-button", activeSkill.skill.enabled && "active")}
                onClick={() =>
                  onUpdateInstalledSkill(activeSkill.skill.id, {
                    enabled: !activeSkill.skill.enabled,
                  })
                }
                type="button"
              >
                {activeSkill.skill.enabled ? "停用" : "启用"}
              </button>
              {activeSkill.skill.system ? null : (
                <button
                  className="ghost-text-button danger"
                  onClick={() => void onUninstallSkill(activeSkill.skill)}
                  type="button"
                >
                  <X size={14} />
                  卸载
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface SkillSectionProps {
  title: string;
  skills: InstalledSkillView[];
  emptyText: string;
  accentOffset: number;
  onSelectSkill: (skill: InstalledSkillView) => void;
}

function SkillSection({ title, skills, emptyText, accentOffset, onSelectSkill }: SkillSectionProps) {
  return (
    <section className="skills-section">
      <div className="skills-section-head">
        <div>
          <h3>{title}</h3>
        </div>
        <span className="section-count">{skills.length}</span>
      </div>

      {skills.length > 0 ? (
        <div className="skills-list">
          {skills.map((skill, index) => (
            <div
              key={skill.id}
              className="skill-list-row skill-tile"
              onClick={() => onSelectSkill(skill)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectSkill(skill);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className={clsx("skill-icon-shell", resolveAccent(accentOffset + index))}>
                <Boxes size={20} />
              </div>
              <div className="skill-tile-copy">
                <strong title={skill.name}>{skill.name}</strong>
                <p title={skill.description || "暂无描述"}>
                  {compactSkillDescription(skill.description, "暂无描述")}
                </p>
              </div>
              <div className="skill-tile-status">
                <span className={clsx("skill-status-chip", skill.enabled ? "enabled" : "disabled")}>
                  {skill.enabled ? "启用" : "停用"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="skills-empty-banner">
          <span>{emptyText}</span>
        </div>
      )}
    </section>
  );
}

function compactSkillDescription(description: string | undefined, fallback: string) {
  const text = (description || fallback).replace(/\s+/g, " ").trim();
  return text.length > 68 ? `${text.slice(0, 68).trim()}...` : text;
}

function resolveAccent(seed: number) {
  return SKILL_ACCENTS[Math.abs(seed) % SKILL_ACCENTS.length];
}

function appendSkillFilePath(sourcePath: string) {
  return `${sourcePath.replace(/[\\/]+$/, "")}/SKILL.md`;
}

function resolveSkillFolderPath(activeSkill: SkillModalState) {
  return activeSkill.skill.sourcePath?.trim() || "";
}

async function resolveSkillMarkdown(activeSkill: SkillModalState) {
  if (activeSkill.skill.sourcePath) {
    const preview = await workspaceClient.readPreview({
      path: appendSkillFilePath(activeSkill.skill.sourcePath),
      title: `${activeSkill.skill.name} 技能`,
    });

    return cleanSkillMarkdown(
      preview.content || fallbackMarkdown(activeSkill),
      activeSkill.skill.name,
    );
  }

  if (activeSkill.skill.kind === "command" && activeSkill.skill.command) {
    return cleanSkillMarkdown(
      [
      `# ${activeSkill.skill.name}`,
      "",
      activeSkill.skill.description || "暂无描述",
      "",
      "## 命令",
      "",
      "```text",
      activeSkill.skill.command,
      "```",
      ].join("\n"),
      activeSkill.skill.name,
    );
  }

  return cleanSkillMarkdown(fallbackMarkdown(activeSkill), activeSkill.skill.name);
}

function fallbackMarkdown(activeSkill: SkillModalState) {
  return [
    `# ${activeSkill.skill.name}`,
    "",
    activeSkill.skill.description || "暂无描述",
    "",
    "## 位置",
    "",
    `\`${activeSkill.skill.location}\``,
  ].join("\n");
}

function cleanSkillMarkdown(content: string, skillName: string) {
  let next = content.replace(/\r\n/g, "\n").trimStart();

  if (next.startsWith("---\n")) {
    const frontmatterEnd = next.indexOf("\n---\n", 4);
    if (frontmatterEnd >= 0) {
      next = next.slice(frontmatterEnd + 5).trimStart();
    }
  } else {
    const lines = next.split("\n");
    const metadataLines: string[] = [];

    for (const line of lines) {
      if (!line.trim()) break;
      if (/^[A-Za-z][\w-]*:\s*/.test(line)) {
        metadataLines.push(line);
      } else {
        metadataLines.length = 0;
        break;
      }
    }

    if (metadataLines.length >= 2) {
      next = lines.slice(metadataLines.length).join("\n").trimStart();
    }
  }

  const escapedName = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  next = next.replace(new RegExp(`^#\\s+${escapedName}\\s*\\n+`, "i"), "");

  return next.trimStart();
}
