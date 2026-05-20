import os from "node:os";
import path from "node:path";

import type { AppConfig, ChatSendInput } from "../../src/types";
import type { WorkspaceService } from "../workspace-service";
import { buildLoadedSkillContent, findEnabledSkill, parseSkillInvocations } from "./skill-invocation";

export interface PreparedPrompt {
  content: string;
  workspacePrompt: string;
  workspaceRoot: string;
  fullFileSystemAccess: boolean;
}

function uniquePaths(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => path.resolve(value)),
    ),
  );
}

function buildKnowledgeContext(search: {
  query: string;
  results: Array<{
    pageContent: string;
    metadata: Record<string, unknown>;
    knowledgeBaseName: string;
  }>;
}) {
  if (search.results.length === 0) {
    return "";
  }

  const sections = search.results.map((result, index) => {
    const title =
      typeof result.metadata.title === "string" && result.metadata.title.trim()
        ? result.metadata.title.trim()
        : typeof result.metadata.source === "string" && result.metadata.source.trim()
          ? result.metadata.source.trim()
          : `Snippet ${index + 1}`;
    const excerpt = result.pageContent.trim().slice(0, 1_400);

    return `${index + 1}. [${result.knowledgeBaseName}] ${title}\n${excerpt}`;
  });

  return `Reference knowledge base excerpts for this request:\n${sections.join("\n\n")}`;
}

function collectAdditionalDirectories(cwd: string, input: ChatSendInput) {
  const attachmentDirectories = (input.attachments ?? [])
    .map((attachment) => attachment.path?.trim())
    .filter(Boolean)
    .map((attachmentPath) => path.dirname(attachmentPath));

  return uniquePaths(attachmentDirectories).filter((directoryPath) => directoryPath !== cwd);
}

export function buildLocalDirectoryContext(homeDirectory = os.homedir()) {
  const home = path.resolve(homeDirectory);
  const directories = [
    ["Home / 家目录", home],
    ["Desktop / 桌面", path.join(home, "Desktop")],
    ["Downloads / 下载", path.join(home, "Downloads")],
    ["Documents / 文档", path.join(home, "Documents")],
  ];

  return [
    `User home directory: ${home}`,
    "Common local directories:",
    ...directories.map(([label, directoryPath]) => `- ${label}: ${directoryPath}`),
    "Path selection rule: when the user asks for a named local directory such as Desktop/桌面, Downloads/下载, Documents/文档, or provides an absolute path, call file tools with that absolute target. Use the workspace root only for project/workspace requests or when no target is specified.",
  ].join("\n");
}

function buildAttachmentContext(input: ChatSendInput) {
  const sections = (input.attachments ?? []).map((attachment, index) => {
    const header = `${index + 1}. ${attachment.name} (${attachment.mimeType || "unknown"})`;
    if (attachment.content?.trim()) {
      return `${header}\n${attachment.content.trim()}`;
    }
    return `${header}\nAttached file path: ${attachment.path}`;
  });

  if (sections.length === 0) {
    return "";
  }

  return `Attached files:\n${sections.join("\n\n")}`;
}

function normalizeKnowledgeBaseIds(value: string[] | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function shouldSuggestInlineVisual(input: ChatSendInput) {
  const content = input.content.trim();
  const attachmentSignal = (input.attachments ?? []).some((attachment) => {
    const name = attachment.name.toLowerCase();
    const mimeType = attachment.mimeType.toLowerCase();
    return (
      /\.(csv|tsv|json|xlsx?|md)$/i.test(name) ||
      mimeType.includes("csv") ||
      mimeType.includes("json") ||
      mimeType.includes("spreadsheet")
    );
  });

  if (attachmentSignal) {
    return true;
  }

  return /(?:chart|diagram|timeline|flowchart|flow diagram|graph|plot|visual(?:ize|ise|ization)?|mermaid|architecture|sequence|trend|\u53ef\u89c6\u5316|\u56fe\u8868|\u6d41\u7a0b\u56fe|\u67b6\u6784\u56fe|\u65f6\u5e8f\u56fe|\u5173\u7cfb\u56fe|\u753b\u56fe|\u6298\u7ebf\u56fe|\u67f1\u72b6\u56fe|\u8d8b\u52bf\u56fe)/i.test(
    content,
  );
}

function buildInlineVisualInstruction(input: ChatSendInput) {
  if (!shouldSuggestInlineVisual(input)) {
    return "";
  }

  return [
    "If a visual would materially improve this answer, append one or more fenced code blocks after the prose using the language `super-agents-visual`.",
    "Only emit valid JSON inside that block. Do not emit HTML, CSS, JavaScript, or SVG.",
    "Supported payloads:",
    '1. Mermaid diagram: {"type":"diagram","style":"mermaid","title":"Optional title","description":"Optional note","code":"graph TD; A-->B;"}',
    '2. Vega-Lite chart: {"type":"chart","library":"vega-lite","title":"Optional title","description":"Optional note","spec":{...}}',
    "For Vega-Lite charts, you may include inline interactive controls through standard `params` and `bind` fields inside `spec` when sliders, selects, or toggles help exploration.",
    "You may output either one object or an array of objects in the fenced block.",
    "Keep all data inline in the JSON. Do not reference remote URLs or external assets.",
    "If no visual is needed, reply normally without a visual block.",
  ].join("\n");
}

function buildTurnPromptContent(input: ChatSendInput) {
  const content = input.content.trim();
  const visualInstruction = buildInlineVisualInstruction(input);
  if (!visualInstruction) {
    return content;
  }

  return [content, "Additional reply-format instructions:", visualInstruction]
    .filter(Boolean)
    .join("\n\n");
}

async function resolveKnowledgeContext(
  workspaceService: WorkspaceService,
  config: AppConfig,
  content: string,
  selectedKnowledgeBaseIds: string[],
) {
  const effectiveKnowledgeBaseIds = normalizeKnowledgeBaseIds(selectedKnowledgeBaseIds);
  if (effectiveKnowledgeBaseIds.length === 0) {
    return "";
  }

  const query = content.trim();
  if (!query) {
    return "";
  }

  try {
    const search = await workspaceService.searchKnowledgeBases({
      query,
      knowledgeBaseIds: effectiveKnowledgeBaseIds,
      documentCount: config.knowledgeBase.documentCount,
    });

    return buildKnowledgeContext(search);
  } catch {
    return "";
  }
}

export async function prepareChatPrompt(input: {
  chatInput: ChatSendInput;
  selectedKnowledgeBaseIds: string[];
  workspaceService: WorkspaceService;
}): Promise<PreparedPrompt> {
  const config = await input.workspaceService.getConfigSnapshot();
  const cwd = path.resolve(config.workspaceRoot.trim() || process.cwd());
  const additionalDirectories = collectAdditionalDirectories(cwd, input.chatInput);
  const skillInvocations = parseSkillInvocations(input.chatInput.content);
  const invokedSkills = skillInvocations
    ? skillInvocations.invocations.map((invocation) => ({
        invocation,
        skill: findEnabledSkill(config, invocation.name),
      }))
    : [];
  const missingSkill = invokedSkills.find((entry) => !entry.skill);
  if (missingSkill) {
    throw new Error(`Skill "${missingSkill.invocation.name}" is not enabled or does not exist.`);
  }
  const effectiveChatInput = skillInvocations
    ? {
        ...input.chatInput,
        content: skillInvocations.args,
      }
    : input.chatInput;
  const [skillContext, knowledgeContext] = await Promise.all([
    input.workspaceService.getEnabledSkillPromptContext(config),
    resolveKnowledgeContext(
      input.workspaceService,
      config,
      effectiveChatInput.content,
      input.selectedKnowledgeBaseIds,
    ),
  ]);
  const attachmentContext = buildAttachmentContext(effectiveChatInput);
  const invokedSkillContext = invokedSkills
    .map((entry) =>
      entry.skill
        ? buildLoadedSkillContent(entry.skill, skillInvocations?.args ?? "", { explicit: true })
        : "",
    )
    .filter(Boolean)
    .join("\n\n");
  const workspacePrompt = [
    `Workspace root: ${cwd}`,
    buildLocalDirectoryContext(),
    additionalDirectories.length > 0
      ? `Additional attachment directories:\n${additionalDirectories.join("\n")}`
      : "",
    skillContext,
    invokedSkillContext,
    knowledgeContext,
    attachmentContext,
  ].filter(Boolean).join("\n\n");

  return {
    content: buildTurnPromptContent(effectiveChatInput),
    workspacePrompt,
    workspaceRoot: cwd,
    fullFileSystemAccess: config.security.fullFileSystemAccess === true,
  };
}
