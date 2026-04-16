import clsx from "clsx";
import { Boxes, Compass, FolderOpen, LoaderCircle, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { markdownToHtml } from "../../lib/format";
import { workspaceClient } from "../../services/workspace-client";
import type { RuntimeSkill, SkillConfig } from "../../types";

export type InstalledSkillView = SkillConfig & { location: string };

interface SkillsViewProps {
  filteredInstalledSkills: InstalledSkillView[];
  filteredReferenceSkills: RuntimeSkill[];
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
  onUseReferenceSkill: (skill: RuntimeSkill) => void;
}

type SkillModalState =
  | { kind: "installed"; skill: InstalledSkillView }
  | { kind: "reference"; skill: RuntimeSkill };

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
  filteredReferenceSkills,
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
  onUseReferenceSkill,
}: SkillsViewProps) {
  const [activeSkill, setActiveSkill] = useState<SkillModalState | null>(null);
  const [modalHtml, setModalHtml] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const activeSkillFolder = activeSkill ? resolveSkillFolderPath(activeSkill) : "";

  useEffect(() => {
    if (!activeSkill) return undefined;

    let cancelled = false;

    async function loadSkillContent() {
      const currentSkill = activeSkill;
      if (!currentSkill) return;
      setModalLoading(true);
      try {
        const markdown = await resolveSkillMarkdown(currentSkill);
        if (!cancelled) setModalHtml(markdownToHtml(markdown));
      } catch {
        if (!cancelled) setModalHtml(markdownToHtml(fallbackMarkdown(currentSkill)));
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

  return (
    <section className="skills-page">
      <div className="skills-inner">
        <header className="skills-toolbar">
          <div className="skills-toolbar-copy">
            <h2>技能</h2>
            <p>把常用能力整理成技能，方便重复使用和快速调用。</p>
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

            <button className="secondary-button" onClick={() => void onRefresh()} disabled={skillsRefreshing}>
              <RefreshCw size={14} className={skillsRefreshing ? "spin" : undefined} />
              刷新
            </button>

            <button
              className="secondary-button"
              onClick={() => void onImportLocalSkill()}
              disabled={skillsImporting}
            >
              <Plus size={16} />
              {skillsImporting ? "导入中..." : "导入本地技能"}
            </button>

            <button className="primary-button" onClick={() => onPrepareSkillDraft()}>
              <Plus size={16} />
              新建技能
            </button>
          </div>
        </header>

        <section className="skills-section">
          <div className="skills-section-head">
            <div>
              <span className="section-kicker muted">已安装</span>
              <h3>已安装技能</h3>
            </div>
            <span className="section-count">{filteredInstalledSkills.length}</span>
          </div>

          {filteredInstalledSkills.length > 0 ? (
            <div className="skills-gallery">
              {filteredInstalledSkills.map((skill, index) => (
                <button
                  key={skill.id}
                  className="skill-tile"
                  onClick={() => setActiveSkill({ kind: "installed", skill })}
                  type="button"
                >
                  <div className={clsx("skill-icon-shell", resolveAccent(index))}>
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
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <strong>还没有已安装技能</strong>
              <p>可以先新建一个，或者先从下方可用技能里挑一个试用。</p>
              <button className="secondary-button" onClick={() => onPrepareSkillDraft()}>
                <Plus size={14} />
                创建第一个技能
              </button>
            </div>
          )}
        </section>

        {filteredReferenceSkills.length > 0 ? (
          <section className="skills-section">
            <div className="skills-section-head">
              <div>
                <span className="section-kicker muted">发现</span>
                <h3>可用技能</h3>
              </div>
              <span className="section-count">{filteredReferenceSkills.length}</span>
            </div>

            <div className="skills-gallery">
              {filteredReferenceSkills.map((skill, index) => (
                <button
                  key={skill.id}
                  className="skill-tile"
                  onClick={() => setActiveSkill({ kind: "reference", skill })}
                  type="button"
                >
                  <div className={clsx("skill-icon-shell", resolveAccent(index + 2))}>
                    <Boxes size={20} />
                  </div>
                  <div className="skill-tile-copy">
                    <strong title={skill.name}>{skill.name}</strong>
                    <p title={skill.description || "运行时发现的技能"}>
                      {compactSkillDescription(skill.description, "运行时发现的技能")}
                    </p>
                  </div>
                  <div className="skill-tile-status skill-tile-status-empty" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {hasResults ? null : (
          <div className="skills-empty-banner">
            <Compass size={18} />
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
                      <span className={clsx("skill-status-chip", activeSkill.skill.enabled ? "enabled" : "disabled")}>
                        {activeSkill.skill.enabled ? "启用" : "停用"}
                      </span>
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
                <div className="skill-detail-markdown preview-markdown" dangerouslySetInnerHTML={{ __html: modalHtml }} />
              )}
            </div>

            <div className="skill-detail-footer">
              {activeSkill.kind === "installed" ? (
                <>
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
                  <button
                    className="ghost-text-button danger"
                    onClick={() => void onUninstallSkill(activeSkill.skill)}
                    type="button"
                  >
                    <X size={14} />
                    卸载
                  </button>
                </>
              ) : (
                <button className="primary-button" onClick={() => onUseReferenceSkill(activeSkill.skill)} type="button">
                  <Sparkles size={14} />
                  试用
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
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
  return `${sourcePath.replace(/[\\/]+$/, "")}\\SKILL.md`;
}

function resolveSkillFolderPath(activeSkill: SkillModalState) {
  if (activeSkill.kind === "installed") {
    return activeSkill.skill.sourcePath?.trim() || "";
  }

  return folderPathFromLocation(activeSkill.skill.location);
}

function folderPathFromLocation(location: string) {
  const trimmed = location.trim();
  if (!trimmed) return "";
  if (/^(https?:)?\/\//i.test(trimmed)) return "";

  const normalized = trimmed.replace(/[\\/]+$/, "");
  if (/[/\\]SKILL\.md$/i.test(normalized)) {
    return normalized.replace(/[/\\]SKILL\.md$/i, "");
  }

  return normalized;
}

async function resolveSkillMarkdown(activeSkill: SkillModalState) {
  if (activeSkill.kind === "reference") {
    return cleanSkillMarkdown(
      activeSkill.skill.content || fallbackMarkdown(activeSkill),
      activeSkill.skill.name,
    );
  }

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
  if (activeSkill.kind === "reference") {
    return [
      `# ${activeSkill.skill.name}`,
      "",
      activeSkill.skill.description || "运行时发现的技能",
      "",
      "## 位置",
      "",
      `\`${activeSkill.skill.location}\``,
    ].join("\n");
  }

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
