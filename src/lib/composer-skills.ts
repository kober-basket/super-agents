export interface ComposerSkillMention {
  raw: string;
  name: string;
  href?: string;
  start: number;
  end: number;
}

export type ComposerSkillSegment =
  | { type: "text"; text: string }
  | (ComposerSkillMention & { type: "mention" });

interface ComposerSkillLike {
  id: string;
  name: string;
}

export interface ComposerSkillTrigger {
  query: string;
  start: number;
  end: number;
}

const markdownSkillMentionPattern = /\[\$([^\]\r\n]+)\]\(([^)\r\n]+)\)/g;

function cleanSkillMentionName(value: string) {
  return value.trim().replace(/[\]\r\n]/g, " ");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildComposerSkillMention(skill: ComposerSkillLike) {
  const name = cleanSkillMentionName(skill.name);
  const href = `skill://${encodeURIComponent(skill.id || skill.name)}`;
  return `[$${name}](${href})`;
}

export function getComposerSkillTrigger(value: string): ComposerSkillTrigger | null {
  const match = value.match(/(^|[\s\n])\$([^\s$]*)$/);
  if (!match) {
    return null;
  }

  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const start = (match.index ?? 0) + prefix.length;
  return {
    query,
    start,
    end: value.length,
  };
}

export function insertComposerSkillMention(
  value: string,
  trigger: ComposerSkillTrigger,
  skill: ComposerSkillLike,
) {
  const mention = buildComposerSkillMention(skill);
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end).replace(/^\s+/, "");
  const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const spaceBefore = needsSpaceBefore ? " " : "";
  const spaceAfter = after.length > 0 ? " " : " ";
  return `${before}${spaceBefore}${mention}${spaceAfter}${after}`;
}

export function splitComposerSkillMentions(content: string): ComposerSkillSegment[] {
  const segments: ComposerSkillSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(markdownSkillMentionPattern)) {
    const raw = match[0] ?? "";
    const name = match[1]?.trim() ?? "";
    const href = match[2]?.trim();
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (!raw || !name) {
      continue;
    }

    if (start > lastIndex) {
      segments.push({ type: "text", text: content.slice(lastIndex, start) });
    }

    segments.push({
      type: "mention",
      raw,
      name,
      href,
      start,
      end,
    });
    lastIndex = end;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", text: content.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text: content }];
}

export function parseComposerSkillMentions(content: string) {
  return splitComposerSkillMentions(content).filter(
    (segment): segment is ComposerSkillMention & { type: "mention" } => segment.type === "mention",
  );
}

export function stripComposerSkillMentions(content: string) {
  const withoutMentions = content
    .replace(markdownSkillMentionPattern, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();

  const plainMention = withoutMentions.match(/^\$([^\s]+)\s*([\s\S]*)$/);
  if (plainMention?.[1]) {
    return plainMention[2]?.trim() ?? "";
  }

  return withoutMentions;
}

export function renderComposerValueHtml(content: string) {
  return splitComposerSkillMentions(content)
    .map((segment) => {
      if (segment.type === "text") {
        return escapeHtml(segment.text);
      }

      const raw = escapeHtml(segment.raw);
      const name = escapeHtml(segment.name);
      return [
        `<span class="composer-inline-skill-token" contenteditable="false" data-composer-skill-mention="${raw}">`,
        `<span class="composer-inline-skill-token-name">$${name}</span>`,
        `<button class="composer-inline-skill-token-remove" data-composer-skill-remove="${raw}" tabindex="-1" type="button" aria-label="移除技能 ${name}">×</button>`,
        "</span>",
      ].join("");
    })
    .join("");
}
