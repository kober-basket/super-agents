import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildComposerSlashCommandSuggestions,
  getComposerSlashCommandTrigger,
  removeComposerSlashCommandTrigger,
} from "../../src/lib/composer-slash-commands";
import type { SkillConfig } from "../../src/types";

function readRepoFile(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

const brainstormingSkill: SkillConfig = {
  id: "brainstorming",
  name: "Brainstorming",
  description: "Explore intent before implementation",
  shortDescription: "Explore intent, requirements, and design before implementation",
  kind: "command",
  command: "Skill instructions",
  enabled: true,
};

const disabledSkill: SkillConfig = {
  id: "disabled",
  name: "Disabled",
  description: "Hidden skill",
  kind: "command",
  command: "Skill instructions",
  enabled: false,
};

test("composer slash command detects the active trailing slash token", () => {
  assert.deepEqual(getComposerSlashCommandTrigger("/"), { query: "", start: 0, end: 1 });
  assert.deepEqual(getComposerSlashCommandTrigger("请帮我 /sta"), { query: "sta", start: 4, end: 8 });
  assert.equal(getComposerSlashCommandTrigger("https://example.com/path"), null);
  assert.equal(getComposerSlashCommandTrigger("/status done"), null);
});

test("composer slash command suggestions include only supported commands and enabled skills", () => {
  const trigger = getComposerSlashCommandTrigger("/");
  assert.ok(trigger);

  const suggestions = buildComposerSlashCommandSuggestions({
    skills: [brainstormingSkill, disabledSkill],
    trigger,
  });
  const commandIds = suggestions.filter((item) => item.kind === "command").map((item) => item.id);

  assert.equal(suggestions[0]?.section, "快捷");
  assert.deepEqual(commandIds, ["model", "skills"]);
  assert.ok(suggestions.some((item) => item.kind === "skill" && item.id === "brainstorming"));
  assert.equal(suggestions.some((item) => item.id === "disabled"), false);
  assert.equal(suggestions.some((item) => item.id === "status"), false);
  assert.equal(suggestions.some((item) => item.id === "quick"), false);
  assert.equal(suggestions.some((item) => item.id === "reasoning"), false);
  assert.equal(suggestions.some((item) => item.id === "plan"), false);
  assert.equal(suggestions.some((item) => item.id === "memory"), false);
});

test("composer slash command suggestions filter commands and skills by query", () => {
  const trigger = getComposerSlashCommandTrigger("/brain");
  assert.ok(trigger);

  const suggestions = buildComposerSlashCommandSuggestions({
    skills: [brainstormingSkill],
    trigger,
  });

  assert.deepEqual(
    suggestions.map((item) => item.id),
    ["brainstorming"],
  );
});

test("composer slash command suggestions do not surface unsupported command queries", () => {
  const trigger = getComposerSlashCommandTrigger("/sta");
  assert.ok(trigger);

  const suggestions = buildComposerSlashCommandSuggestions({
    skills: [brainstormingSkill],
    trigger,
  });

  assert.deepEqual(suggestions, []);
});

test("composer slash command trigger can be removed", () => {
  const trigger = getComposerSlashCommandTrigger("请帮我 /sta");
  assert.ok(trigger);

  assert.equal(removeComposerSlashCommandTrigger("请帮我 /sta", trigger), "请帮我 ");
});

test("chat workspace wires slash command suggestions into the composer shell", () => {
  const workspaceSource = readRepoFile("src/features/chat/ChatWorkspace.tsx");
  const css = readRepoFile("src/styles.css");

  assert.match(workspaceSource, /renderSlashCommandSuggestions/);
  assert.match(workspaceSource, /chat-slash-suggestions/);
  assert.match(workspaceSource, /aria-label="\/ 命令"/);
  assert.match(css, /\.chat-slash-suggestions\s*{/);
  assert.match(css, /\.chat-slash-suggestion-icon\s*{/);
  assert.match(css, /\.chat-slash-suggestion-source\s*{/);
});
