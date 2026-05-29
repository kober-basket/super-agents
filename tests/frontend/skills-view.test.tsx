import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

test("skills view labels system skills as built-in skills", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "skill-creator",
          name: "skill-creator",
          description: "Create or update a skill",
          kind: "command",
          command: "Skill creator instructions",
          enabled: true,
          system: true,
          location: "内置技能",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.match(html, /内置技能/);
});

test("skills view separates built-in and user installed skills", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "skill-creator",
          name: "skill-creator",
          description: "Create or update a skill",
          kind: "command",
          command: "Skill creator instructions",
          enabled: true,
          system: true,
          sourcePath: "/app/electron/builtin-skills/skill-creator",
          location: "内置技能",
        },
        {
          id: "local-helper",
          name: "local-helper",
          description: "Local helper",
          kind: "command",
          command: "Local helper instructions",
          enabled: true,
          sourcePath: "/workspace/.super-agents/skills/local-helper",
          location: "/workspace/.super-agents/skills/local-helper",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.match(html, /内置技能/);
  assert.match(html, /用户安装/);
  assert.match(html, /class="skills-list"/);
  assert.match(html, /class="skill-list-row/);
  assert.ok(html.indexOf("skill-creator") < html.indexOf("local-helper"));
});

test("skills view merges suite members into one labeled suite row", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");
  const source = readSource("src/features/skills/SkillsView.tsx");

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "docx",
          name: "docx",
          description: "Create Word documents",
          displayName: "Word 文档处理",
          shortDescription: "创建、读取、编辑 Word 文档",
          kind: "command",
          command: "Docx instructions",
          enabled: true,
          system: true,
          suiteId: "document-skills",
          suiteName: "document-skills",
          suiteDisplayName: "文档能力",
          suiteDescription: "Word、Excel、PowerPoint 与 PDF 的内置文档处理能力集合",
          suiteItems: [
            { id: "docx", name: "docx", displayName: "Word 文档处理", typeLabel: "技能" },
            { id: "xlsx", name: "xlsx", displayName: "Excel 表格处理", typeLabel: "技能" },
          ],
          sourcePath: "/app/electron/builtin-skills/document-skills/skills/docx",
          location: "内置技能",
        },
        {
          id: "xlsx",
          name: "xlsx",
          description: "Create spreadsheets",
          displayName: "Excel 表格处理",
          shortDescription: "创建、清洗、编辑 Excel 表格",
          kind: "command",
          command: "Xlsx instructions",
          enabled: false,
          system: true,
          suiteId: "document-skills",
          suiteName: "document-skills",
          suiteDisplayName: "文档能力",
          suiteDescription: "Word、Excel、PowerPoint 与 PDF 的内置文档处理能力集合",
          suiteItems: [
            { id: "docx", name: "docx", displayName: "Word 文档处理", typeLabel: "技能" },
            { id: "xlsx", name: "xlsx", displayName: "Excel 表格处理", typeLabel: "技能" },
          ],
          sourcePath: "/app/electron/builtin-skills/document-skills/skills/xlsx",
          location: "内置技能",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.equal((html.match(/class="skill-list-row skill-tile/g) ?? []).length, 1);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1);
  assert.match(html, /文档能力/);
  assert.match(html, /套件/);
  assert.doesNotMatch(html, /个内容/);
  assert.match(html, /aria-checked="false"/);
  assert.doesNotMatch(html, />Word 文档处理<\/strong>/);
  assert.doesNotMatch(html, />Excel 表格处理<\/strong>/);
  assert.match(source, /className="skill-entry-title-line"/);
  assert.match(source, /className="skill-entry-title-badge"/);
  assert.doesNotMatch(source, /skill-suite-inline-meta/);
});

test("skills view prefers openai interface metadata for skill labels", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "skill-creator",
          name: "skill-creator",
          description: "Create or update a skill",
          displayName: "Skill Creator",
          shortDescription: "Create and validate agent skills",
          kind: "command",
          command: "Skill creator instructions",
          enabled: true,
          system: true,
          location: "Built-in skill",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.match(html, /Skill Creator/);
  assert.match(html, /Create and validate agent skills/);
  assert.doesNotMatch(html, />skill-creator<\/strong>/);
  assert.doesNotMatch(html, /Create or update a skill/);
});

test("skills view prefers bundled asset icons when a skill provides one", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");
  const iconDataUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIC8+";

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "asset-skill",
          name: "asset-skill",
          description: "Uses a bundled icon asset",
          iconDataUrl,
          kind: "command",
          command: "Asset skill instructions",
          enabled: true,
          sourcePath: "/workspace/.super-agents/skills/asset-skill",
          location: "/workspace/.super-agents/skills/asset-skill",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.match(html, /class="skill-icon-shell skill-icon-asset/);
  assert.match(html, /<img alt="" aria-hidden="true" src="data:image\/svg\+xml;base64,/);
  assert.ok(html.includes(`src="${iconDataUrl}"`));
  assert.doesNotMatch(html, /skill-icon-orbit/);
});

test("skills view uses row switches for enable state and keeps details free of enable controls", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");
  const source = readSource("src/features/skills/SkillsView.tsx");
  const css = readSource("src/styles.css");

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "skill-creator",
          name: "skill-creator",
          description: "Create or update a skill",
          kind: "command",
          command: "Skill creator instructions",
          enabled: true,
          system: true,
          sourcePath: "/app/electron/builtin-skills/skill-creator",
          location: "内置技能",
        },
        {
          id: "local-helper",
          name: "local-helper",
          description: "Local helper",
          kind: "command",
          command: "Local helper instructions",
          enabled: false,
          sourcePath: "/workspace/.super-agents/skills/local-helper",
          location: "/workspace/.super-agents/skills/local-helper",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.equal((html.match(/role="switch"/g) ?? []).length, 2);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /aria-label="停用 skill-creator"/);
  assert.match(html, /aria-label="启用 local-helper"/);
  assert.match(html, /class="skill-enable-switch active"/);
  assert.match(html, /class="skill-enable-switch"/);
  assert.doesNotMatch(html, /skill-enable-switch-label/);
  assert.match(css, /\.skill-enable-switch\s*{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.skill-enable-switch:focus-visible\s+\.skill-enable-switch-track\s*{[^}]*outline:\s*3px/s);
  assert.doesNotMatch(html, /<span class="skill-status-chip/);
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*onUpdateInstalledSkill\(entry\.id/);
  assert.doesNotMatch(source, /skill-enable-switch-label/);
  assert.doesNotMatch(source, /className=\{clsx\("toggle-button"/);
  assert.match(source, /resolveEntryScopeLabel\(activeSkill\)/);
  assert.doesNotMatch(source, /activeSkill\.items\.length/);
  assert.doesNotMatch(html, /skill-status-chip subtle/);
  assert.doesNotMatch(html, /skill-tile-folder/);
});

test("skills toolbar keeps creation actions behind one add menu trigger", async () => {
  (globalThis as any).window = {};
  const { SkillsView } = await import("../../src/features/skills/SkillsView.js");
  const css = readSource("src/styles.css");

  const html = renderToStaticMarkup(
    <SkillsView
      filteredInstalledSkills={[
        {
          id: "skill-creator",
          name: "skill-creator",
          description: "Create or update a skill",
          kind: "command",
          command: "Skill creator instructions",
          enabled: true,
          system: true,
          sourcePath: "/app/electron/builtin-skills/skill-creator",
          location: "内置技能",
        },
      ]}
      hasResults={true}
      skillQuery=""
      skillsImporting={false}
      skillsRefreshing={false}
      onImportLocalSkill={() => undefined}
      onPrepareSkillDraft={() => undefined}
      onRefresh={() => undefined}
      onSkillQueryChange={() => undefined}
      onUninstallSkill={() => undefined}
      onUpdateInstalledSkill={() => undefined}
    />,
  );

  assert.match(html, /placeholder="搜索技能"/);
  assert.match(html, /aria-label="刷新技能"/);
  assert.match(html, /aria-label="添加技能"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(
    css,
    /\.skills-toolbar-actions\s*{[^}]*--skill-toolbar-control-size:\s*var\(--module-toolbar-title-row-height\);[^}]*--skill-toolbar-control-radius:\s*14px;[^}]*flex-wrap:\s*nowrap;/s,
  );
  assert.match(css, /\.skill-search-field\s*{[^}]*min-width:\s*0;[^}]*flex:\s*1\s+1\s+320px;/s);
  assert.match(
    css,
    /\.skills-toolbar-actions\s+\.search-field input\s*{[^}]*min-height:\s*var\(--skill-toolbar-control-size\);[^}]*border-radius:\s*var\(--skill-toolbar-control-radius\);/s,
  );
  assert.match(
    css,
    /\.skills-toolbar-actions\s+\.search-field input\s*{[^}]*padding:\s*0\s+16px\s+0\s+44px;[^}]*font-size:\s*13px;/s,
  );
  assert.match(
    css,
    /\.skills-toolbar-actions\s+\.skill-toolbar-icon-button\s*{[^}]*width:\s*var\(--skill-toolbar-control-size\);[^}]*height:\s*var\(--skill-toolbar-control-size\);[^}]*border-radius:\s*var\(--skill-toolbar-control-radius\);/s,
  );
  assert.equal((html.match(/class="secondary-button skill-toolbar-icon-button"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /导入本地技能/);
  assert.doesNotMatch(html, />刷新</);
  assert.doesNotMatch(html, />新建技能</);
});

test("skills view uses a two-column skill list and silent refresh success", () => {
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");

  assert.doesNotMatch(appSource, /refreshWorkspaceSnapshot\("技能列表已刷新"\)/);
  assert.match(
    css,
    /\.skills-list\s*{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
  );
  assert.match(css, /\.skill-list-row\.skill-tile\s*{[^}]*align-items:\s*center;/s);
  assert.match(css, /\.skill-list-row\s+\.skill-icon-shell\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(css, /\.skill-list-row\s+\.skill-tile-copy\s*{[^}]*gap:\s*4px;/s);
  assert.doesNotMatch(css, /\.skill-list-row\s+\.skill-tile-copy\s*{[^}]*min-height:\s*36px/s);
  assert.doesNotMatch(css, /\.skill-list-row\s+\.skill-tile-copy p\s*{[^}]*line-height:\s*17px/s);
});

test("skills view fallback icons use a lighter matte treatment", () => {
  const css = readSource("src/styles.css");

  assert.match(
    css,
    /\.skills-page:not\(\.tools-page\)\s+\.skill-icon-shell\.skill-icon-premium\s*{[^}]*linear-gradient\([^}]*color-mix\(in srgb,\s*var\(--icon-end\)\s+74%,\s*#ffffff\)/s,
  );
  assert.match(
    css,
    /\.skills-page:not\(\.tools-page\)\s+\.skill-icon-shell\.skill-icon-premium::before,[^}]*\.skills-page:not\(\.tools-page\)\s+\.skill-icon-orbit\s*{[^}]*display:\s*none;/s,
  );
  assert.match(
    css,
    /\.skills-page:not\(\.tools-page\)\s+\.skill-icon-shell\.skill-accent-sky\s*{[^}]*--icon-end:\s*#93c5fd;[^}]*--icon-ink:\s*#1d4ed8;/s,
  );
  assert.match(
    css,
    /\.skills-page:not\(\.tools-page\)\s+\.skill-icon-shell\.skill-accent-violet\s*{[^}]*--icon-end:\s*#c4b5fd;[^}]*--icon-ink:\s*#6d28d9;/s,
  );
});
