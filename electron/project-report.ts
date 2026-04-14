import path from "node:path";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from "docx";

import type {
  KnowledgeSearchResultItem,
  McpToolDebugResult,
  ProjectReportInput,
} from "../src/types";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeReportFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project-report"
  );
}

export function createDefaultReportFileName(input: ProjectReportInput) {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = sanitizeReportFileName(input.projectName || "project-report");
  return `${prefix}-环评分析-${date}.docx`;
}

export function mergeKnowledgeResults(items: KnowledgeSearchResultItem[][], limit = 12) {
  const seen = new Set<string>();
  const merged = items
    .flat()
    .filter((item) => {
      const key = `${item.knowledgeBaseId}::${compact(item.pageContent)}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.score - left.score);

  return merged.slice(0, limit);
}

export function summarizeMapToolResult(result: McpToolDebugResult) {
  const blocks = [result.content, result.structuredContentJson, result.rawJson]
    .map((item) => item?.trim())
    .filter(Boolean);

  return compact(blocks.join("\n\n")).slice(0, 1800);
}

export function buildProjectReportPrompt(
  input: ProjectReportInput,
  references: KnowledgeSearchResultItem[],
  mapSummary?: string,
) {
  const referenceText =
    references.length > 0
      ? references
          .map((item, index) =>
            [
              `[参考 ${index + 1}]`,
              `知识库: ${item.knowledgeBaseName || item.knowledgeBaseId}`,
              `相关度: ${item.score.toFixed(3)}`,
              typeof item.metadata.title === "string" ? `标题: ${item.metadata.title}` : "",
              typeof item.metadata.source === "string" ? `来源: ${item.metadata.source}` : "",
              item.pageContent.trim(),
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "未检索到有效知识库材料。请明确说明依据不足，并仅做谨慎推断。";

  return [
    "你是一名环评咨询顾问，请根据提供的项目基础信息、地图定位结果和知识库材料，输出一份可直接写入环评文件的中文专业文本。",
    "",
    "输出要求：",
    "1. 使用正式、审慎、可落地的中文书面表达。",
    "2. 仅输出正文，不要写前言、结束语、解释说明。",
    "3. 必须按以下一级标题输出：",
    "一、编制依据",
    "二、评价等级",
    "三、选址符合性分析",
    "四、政策符合性分析",
    "4. 每一部分至少 2 段，必要时可列出小点。",
    "5. 如果知识库材料不足，请明确写出“根据现有资料暂作如下判断”之类的风险提示，但不要胡乱编造法规名称。",
    "",
    "项目基础信息：",
    `项目名称：${input.projectName || "未提供"}`,
    `项目类型：${input.projectType || "未提供"}`,
    `项目位置：${input.projectLocation || "未提供"}`,
    `经度：${input.longitude || "未提供"}`,
    `纬度：${input.latitude || "未提供"}`,
    `项目概况：${input.projectOverview || "未提供"}`,
    `政策关注点：${input.policyFocus || "未提供"}`,
    "",
    "地图定位结果：",
    mapSummary || "未获取到地图工具结果，请结合用户输入的位置与坐标谨慎分析。",
    "",
    "知识库参考材料：",
    referenceText,
  ].join("\n");
}

function parseMarkdownLikeDocument(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const children: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      children.push(new Paragraph({ spacing: { after: 160 } }));
      continue;
    }

    if (/^[一二三四五六七八九十]+、/.test(line)) {
      children.push(
        new Paragraph({
          text: line,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 220, after: 120 },
        }),
      );
      continue;
    }

    if (/^[（(][一二三四五六七八九十\d]+[)）]/.test(line) || /^\d+\./.test(line)) {
      children.push(
        new Paragraph({
          children: [new TextRun(line)],
          bullet: { level: 0 },
          spacing: { after: 100 },
        }),
      );
      continue;
    }

    children.push(
      new Paragraph({
        children: [new TextRun(line)],
        spacing: { after: 120 },
      }),
    );
  }

  return children;
}

export async function createProjectReportDocBuffer(payload: {
  title: string;
  content: string;
  meta: string[];
}) {
  const sections: ISectionOptions[] = [
    {
      properties: {},
      children: [
        new Paragraph({
          text: payload.title,
          heading: HeadingLevel.TITLE,
          spacing: { after: 240 },
        }),
        ...payload.meta
          .filter(Boolean)
          .map(
            (line) =>
              new Paragraph({
                children: [new TextRun({ text: line, color: "6B665E" })],
                spacing: { after: 80 },
              }),
          ),
        new Paragraph({ spacing: { after: 220 } }),
        ...parseMarkdownLikeDocument(payload.content),
      ],
    },
  ];

  const document = new Document({ sections });
  return await Packer.toBuffer(document);
}

export function resolveReportOutputPath(outputDirectory: string, fileName: string) {
  return path.join(outputDirectory, fileName);
}
