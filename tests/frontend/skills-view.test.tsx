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

test("skills view uses a two-column skill list and silent refresh success", () => {
  const appSource = readSource("src/App.tsx");
  const css = readSource("src/styles.css");

  assert.doesNotMatch(appSource, /refreshWorkspaceSnapshot\("技能列表已刷新"\)/);
  assert.match(
    css,
    /\.skills-list\s*{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
  );
});
