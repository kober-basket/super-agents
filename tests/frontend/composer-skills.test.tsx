import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildComposerSkillMention,
  getComposerSkillTrigger,
  insertComposerSkillMention,
  renderComposerValueHtml,
  splitComposerSkillMentions,
  stripComposerSkillMentions,
} from "../../src/lib/composer-skills";
import type { SkillConfig } from "../../src/types";

const skill: SkillConfig = {
  id: "skill-creator",
  name: "skill-creator",
  description: "Create skills",
  kind: "command",
  command: "Skill instructions",
  enabled: true,
};

const browserSkill: SkillConfig = {
  id: "browser",
  name: "Browser",
  description: "Control browser",
  kind: "command",
  command: "Browser instructions",
  enabled: true,
};

test("composer inserts multiple skill mentions directly into the draft body", () => {
  const firstTrigger = getComposerSkillTrigger("$skill");
  assert.ok(firstTrigger);
  const firstDraft = insertComposerSkillMention("$skill", firstTrigger, skill);

  const secondTrigger = getComposerSkillTrigger(`${firstDraft}帮我设计一个技能 $bro`);
  assert.ok(secondTrigger);
  const secondDraft = insertComposerSkillMention(`${firstDraft}帮我设计一个技能 $bro`, secondTrigger, browserSkill);

  assert.equal(
    secondDraft,
    "[$skill-creator](skill://skill-creator) 帮我设计一个技能 [$Browser](skill://browser) ",
  );
  assert.equal(stripComposerSkillMentions(secondDraft), "帮我设计一个技能");
});

test("composer skill mentions split into inline body tokens", () => {
  const content = `${buildComposerSkillMention(skill)} 对照 ${buildComposerSkillMention(browserSkill)} 做一下`;
  const segments = splitComposerSkillMentions(content);

  assert.deepEqual(
    segments.map((segment) => segment.type === "mention" ? segment.name : segment.text),
    ["skill-creator", " 对照 ", "Browser", " 做一下"],
  );
});

test("composer renders skill mentions as inline tokens instead of raw markdown text", () => {
  const html = renderComposerValueHtml(`${buildComposerSkillMention(skill)} 帮我设计一个技能`);
  const visibleHtml = html.replace(/data-composer-skill-(?:mention|remove)="[^"]*"/g, "");

  assert.match(html, /composer-inline-skill-token/);
  assert.match(html, /skill-creator/);
  assert.doesNotMatch(visibleHtml, /\[\$skill-creator\]/);
  assert.match(renderToStaticMarkup(<span dangerouslySetInnerHTML={{ __html: html }} />), /帮我设计一个技能/);
});
