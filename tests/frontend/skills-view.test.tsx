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
          shortDescription: "Create and validate Codex skills",
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
  assert.match(html, /Create and validate Codex skills/);
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

test("skills view keeps skill rows simple with status only", async () => {
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

  assert.match(html, /启用/);
  assert.match(html, /停用/);
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
  assert.match(css, /\.skills-toolbar-actions\s*{[^}]*--skill-toolbar-control-size:\s*56px;[^}]*flex-wrap:\s*nowrap;/s);
  assert.match(css, /\.skill-search-field\s*{[^}]*min-width:\s*0;[^}]*flex:\s*1\s+1\s+390px;/s);
  assert.match(
    css,
    /\.skills-toolbar-actions\s+\.search-field input\s*{[^}]*min-height:\s*var\(--skill-toolbar-control-size\);[^}]*border-radius:\s*var\(--skill-toolbar-control-radius\);/s,
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
