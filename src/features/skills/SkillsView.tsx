import clsx from "clsx";
import {
  Boxes,
  BrainCircuit,
  Braces,
  Code,
  Command,
  Compass,
  FilePlus2,
  FileSearch,
  FolderOpen,
  Import as ImportIcon,
  Library,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  PenTool,
  PlugZap,
  Plus,
  Puzzle,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
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

type SkillListEntry =
  | { kind: "skill"; id: string; skill: InstalledSkillView }
  | {
      kind: "suite";
      id: string;
      name: string;
      displayName: string;
      description: string;
      enabled: boolean;
      system: boolean;
      skills: InstalledSkillView[];
      items: SkillSuiteElementView[];
      representativeSkill: InstalledSkillView;
    };

type SkillModalState = SkillListEntry;

interface SkillSuiteElementView {
  id: string;
  name: string;
  displayName: string;
  description: string;
  typeLabel: string;
}

const SKILL_ACCENTS = [
  "skill-accent-sky",
  "skill-accent-amber",
  "skill-accent-violet",
  "skill-accent-mint",
  "skill-accent-rose",
  "skill-accent-indigo",
] as const;

type SkillAccent = (typeof SKILL_ACCENTS)[number];

const SKILL_ICON_RULES: Array<{ keywords: string[]; icon: LucideIcon }> = [
  { keywords: ["browser", "web", "search", "crawl"], icon: Compass },
  { keywords: ["code", "coding", "developer", "repo", "typescript"], icon: Code },
  { keywords: ["debug", "test", "verify", "tdd"], icon: TestTube },
  { keywords: ["design", "frontend", "ui", "ux", "image"], icon: PenTool },
  { keywords: ["doc", "markdown", "pdf", "write"], icon: ScrollText },
  { keywords: ["git", "review", "security", "permission"], icon: ShieldCheck },
  { keywords: ["mcp", "plugin", "tool", "connector"], icon: PlugZap },
  { keywords: ["plan", "workflow", "dispatch", "parallel"], icon: Workflow },
  { keywords: ["agent", "bot", "assistant", "model"], icon: BrainCircuit },
  { keywords: ["prompt", "chat", "conversation"], icon: MessageSquareText },
  { keywords: ["command", "shell", "terminal"], icon: Command },
  { keywords: ["json", "schema", "config"], icon: Braces },
  { keywords: ["knowledge", "memory", "reference"], icon: Library },
  { keywords: ["install", "creator"], icon: PackageCheck },
  { keywords: ["file", "read"], icon: FileSearch },
  { keywords: ["puzzle", "extension"], icon: Puzzle },
];

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
    if (activeSkill.kind === "suite") {
      setModalMarkdown("");
      setModalLoading(false);
      return undefined;
    }

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
              onSelectSkill={setActiveSkill}
              onUpdateInstalledSkill={onUpdateInstalledSkill}
            />
            <SkillSection
              title="用户安装"
              skills={userSkills}
              emptyText="没有匹配的用户安装技能。"
              accentOffset={builtinSkills.length}
              onSelectSkill={setActiveSkill}
              onUpdateInstalledSkill={onUpdateInstalledSkill}
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
                <SkillIcon
                  accent={resolveAccent(resolveEntryDisplayName(activeSkill).length)}
                  large
                  skill={resolveEntryIconSkill(activeSkill)}
                />
                <div className="skill-detail-title-copy">
                  <div className="skill-detail-title-row">
                    <h3>{resolveEntryDisplayName(activeSkill)}</h3>
                    <div className="skill-detail-badges">
                      <span>{resolveEntryScopeLabel(activeSkill)}</span>
                    </div>
                  </div>
                  <p>{resolveEntryDescription(activeSkill)}</p>
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
              {activeSkill.kind === "suite" ? (
                <div className="skill-suite-elements">
                  <h4>包含内容</h4>
                  <div className="skill-suite-element-list">
                    {activeSkill.items.map((item) => (
                      <div className="skill-suite-element-row" key={item.id}>
                        <span className="skill-suite-element-type">{item.typeLabel}</span>
                        <div className="skill-suite-element-copy">
                          <strong>{item.displayName}</strong>
                          {item.description ? <p>{item.description}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : modalLoading ? (
                <div className="skill-detail-loading">
                  <LoaderCircle size={18} className="spin" />
                  <span>正在读取技能内容...</span>
                </div>
              ) : (
                <RichMarkdown className="skill-detail-markdown preview-markdown" content={modalMarkdown} />
              )}
            </div>

            {activeSkill.kind === "skill" && !activeSkill.skill.system ? (
              <div className="skill-detail-footer">
                <button
                  className="ghost-text-button danger"
                  onClick={() => void onUninstallSkill(activeSkill.skill)}
                  type="button"
                >
                  <X size={14} />
                  卸载
                </button>
              </div>
            ) : null}
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
  onSelectSkill: (entry: SkillListEntry) => void;
  onUpdateInstalledSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
}

function SkillSection({ title, skills, emptyText, accentOffset, onSelectSkill, onUpdateInstalledSkill }: SkillSectionProps) {
  const entries = buildSkillListEntries(skills);

  return (
    <section className="skills-section">
      <div className="skills-section-head">
        <div>
          <h3>{title}</h3>
        </div>
        <span className="section-count">{entries.length}</span>
      </div>

      {entries.length > 0 ? (
        <div className="skills-list">
          {entries.map((entry, index) => {
            const displayName = resolveEntryDisplayName(entry);
            const description = resolveEntryDescription(entry);
            const enabled = resolveEntryEnabled(entry);
            return (
              <div key={entry.id} className={clsx("skill-list-row skill-tile", entry.kind === "suite" && "suite")}>
                <button className="skill-row-open" onClick={() => onSelectSkill(entry)} type="button">
                  <SkillIcon accent={resolveAccent(accentOffset + index)} skill={resolveEntryIconSkill(entry)} />
                  <span className="skill-tile-copy">
                    <span className="skill-entry-title-line">
                      <strong title={displayName}>{displayName}</strong>
                      {entry.kind === "suite" ? <span className="skill-entry-title-badge">套件</span> : null}
                    </span>
                    <span className="skill-tile-description" title={description}>
                      {compactSkillDescription(description, "暂无描述")}
                    </span>
                  </span>
                </button>
                <div className="skill-tile-status">
                  <button
                    aria-checked={enabled}
                    aria-label={`${enabled ? "停用" : "启用"} ${displayName}`}
                    className={clsx("skill-enable-switch", enabled && "active")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onUpdateInstalledSkill(entry.id, { enabled: !enabled });
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    role="switch"
                    title={`${enabled ? "停用" : "启用"} ${displayName}`}
                    type="button"
                  >
                    <span aria-hidden="true" className="skill-enable-switch-track">
                      <span className="skill-enable-switch-thumb" />
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="skills-empty-banner">
          <span>{emptyText}</span>
        </div>
      )}
    </section>
  );
}

function buildSkillListEntries(skills: InstalledSkillView[]): SkillListEntry[] {
  const entries: SkillListEntry[] = [];
  const suiteEntries = new Map<string, Extract<SkillListEntry, { kind: "suite" }>>();

  for (const skill of skills) {
    if (!skill.suiteId) {
      entries.push({ kind: "skill", id: skill.id, skill });
      continue;
    }

    const existing = suiteEntries.get(skill.suiteId);
    if (existing) {
      existing.skills.push(skill);
      existing.enabled = existing.skills.every((item) => item.enabled);
      existing.items = resolveSuiteItems(existing.skills);
      continue;
    }

    const suiteEntry: Extract<SkillListEntry, { kind: "suite" }> = {
      kind: "suite",
      id: skill.suiteId,
      name: skill.suiteName || skill.suiteId,
      displayName: skill.suiteDisplayName || skill.suiteName || skill.suiteId,
      description: skill.suiteDescription || skill.description || "套件",
      enabled: skill.enabled,
      system: skill.system === true,
      skills: [skill],
      items: resolveSuiteItems([skill]),
      representativeSkill: skill,
    };
    suiteEntries.set(skill.suiteId, suiteEntry);
    entries.push(suiteEntry);
  }

  return entries;
}

function resolveSuiteItems(skills: InstalledSkillView[]): SkillSuiteElementView[] {
  const metadataItems = skills.find((skill) => skill.suiteItems?.length)?.suiteItems;
  if (metadataItems?.length) {
    return metadataItems.map((item) => ({
      id: item.id,
      name: item.name,
      displayName: item.displayName || item.name,
      description: item.shortDescription || item.description || "",
      typeLabel: item.typeLabel || (item.type === "skill" ? "技能" : "元素"),
    }));
  }

  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    displayName: resolveSkillDisplayName(skill),
    description: resolveSkillShortDescription(skill, ""),
    typeLabel: "技能",
  }));
}

function resolveEntryDisplayName(entry: SkillListEntry) {
  return entry.kind === "suite" ? entry.displayName : resolveSkillDisplayName(entry.skill);
}

function resolveEntryDescription(entry: SkillListEntry) {
  return entry.kind === "suite"
    ? entry.description
    : resolveSkillShortDescription(entry.skill, "暂无描述");
}

function resolveEntryEnabled(entry: SkillListEntry) {
  return entry.kind === "suite" ? entry.enabled : entry.skill.enabled;
}

function resolveEntryScopeLabel(entry: SkillListEntry) {
  const system = entry.kind === "suite" ? entry.system : entry.skill.system === true;
  return system ? "内置" : "用户";
}

function resolveEntryIconSkill(entry: SkillListEntry) {
  return entry.kind === "suite" ? entry.representativeSkill : entry.skill;
}

function SkillIcon({ accent, large = false, skill }: { accent: SkillAccent; large?: boolean; skill: SkillConfig }) {
  if (skill.iconDataUrl) {
    return (
      <div
        className={clsx("skill-icon-shell", "skill-icon-asset", large && "large")}
        title={resolveSkillDisplayName(skill)}
      >
        <img alt="" aria-hidden="true" src={skill.iconDataUrl} />
      </div>
    );
  }

  const Icon = resolveSkillIcon(skill);

  return (
    <div className={clsx("skill-icon-shell", "skill-icon-premium", large && "large", accent)} title={resolveSkillDisplayName(skill)}>
      <Icon size={large ? 28 : 20} strokeWidth={2.1} />
      <span aria-hidden="true" className="skill-icon-orbit" />
    </div>
  );
}

function resolveSkillIcon(skill: SkillConfig): LucideIcon {
  const haystack = [
    skill.name,
    skill.displayName,
    skill.shortDescription,
    skill.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const match = SKILL_ICON_RULES.find((rule) => rule.keywords.some((keyword) => haystack.includes(keyword)));
  if (match) return match.icon;
  return skill.system ? Boxes : Sparkles;
}

function compactSkillDescription(description: string | undefined, fallback: string) {
  const text = (description || fallback).replace(/\s+/g, " ").trim();
  return text.length > 68 ? `${text.slice(0, 68).trim()}...` : text;
}

function resolveSkillDisplayName(skill: SkillConfig) {
  return skill.displayName?.trim() || skill.name;
}

function resolveSkillShortDescription(skill: SkillConfig, fallback: string) {
  return skill.shortDescription?.trim() || skill.description || fallback;
}

function resolveAccent(seed: number) {
  return SKILL_ACCENTS[Math.abs(seed) % SKILL_ACCENTS.length];
}

function appendSkillFilePath(sourcePath: string) {
  return `${sourcePath.replace(/[\\/]+$/, "")}/SKILL.md`;
}

function resolveSkillFolderPath(activeSkill: SkillModalState) {
  return activeSkill.kind === "skill" ? activeSkill.skill.sourcePath?.trim() || "" : "";
}

async function resolveSkillMarkdown(activeSkill: SkillModalState) {
  if (activeSkill.kind === "suite") {
    return "";
  }

  if (activeSkill.skill.sourcePath) {
    const preview = await workspaceClient.readPreview({
      path: appendSkillFilePath(activeSkill.skill.sourcePath),
      title: `${resolveSkillDisplayName(activeSkill.skill)} 技能`,
    });

    return cleanSkillMarkdown(
      preview.content || fallbackMarkdown(activeSkill),
      activeSkill.skill.name,
    );
  }

  if (activeSkill.skill.kind === "command" && activeSkill.skill.command) {
    return cleanSkillMarkdown(
      [
      `# ${resolveSkillDisplayName(activeSkill.skill)}`,
      "",
      resolveSkillShortDescription(activeSkill.skill, "暂无描述"),
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
  if (activeSkill.kind === "suite") {
    return "";
  }

  return [
    `# ${resolveSkillDisplayName(activeSkill.skill)}`,
    "",
    resolveSkillShortDescription(activeSkill.skill, "暂无描述"),
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
