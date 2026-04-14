import path from "node:path";
import { readFile } from "node:fs/promises";

import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import WordExtractor from "word-extractor";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from "docx";

import type { EmergencyPlanInput, FileDropEntry } from "../src/types";

export interface RecognizedTemplate {
  name: string;
  path: string;
  kind: string;
  excerpt: string;
  content: string;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function templateKind(file: FileDropEntry) {
  const extension = path.extname(file.path || file.name).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  if (extension === ".doc") return "doc";
  return extension.replace(/^\./, "") || "file";
}

export function sanitizeEmergencyPlanFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "emergency-plan"
  );
}

export function createDefaultEmergencyPlanFileName(input: EmergencyPlanInput) {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = sanitizeEmergencyPlanFileName(input.projectName || input.companyName || "emergency-plan");
  return `${prefix}-应急预案-${date}.docx`;
}

async function readPdfText(filePath: string) {
  const buffer = await readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text || "";
}

async function readDocxText(filePath: string) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || "";
}

async function readDocText(filePath: string) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(filePath);
  return document.getBody() || "";
}

export async function recognizeEmergencyTemplate(file: FileDropEntry): Promise<RecognizedTemplate> {
  const kind = templateKind(file);
  let content = "";

  if (kind === "pdf") {
    content = await readPdfText(file.path);
  } else if (kind === "docx") {
    content = await readDocxText(file.path);
  } else if (kind === "doc") {
    content = await readDocText(file.path);
  } else {
    throw new Error(`暂不支持解析模板文件：${file.name}`);
  }

  const normalized = compact(content);
  if (!normalized) {
    throw new Error(`模板未识别到有效文本：${file.name}`);
  }

  return {
    name: file.name,
    path: file.path,
    kind,
    excerpt: normalized.slice(0, 240),
    content: normalized,
  };
}

export function buildEmergencyPlanPrompt(input: EmergencyPlanInput, templates: RecognizedTemplate[]) {
  const templateText = templates
    .map((template, index) =>
      [
        `[模板 ${index + 1}]`,
        `名称：${template.name}`,
        `类型：${template.kind}`,
        `摘要：${template.excerpt}`,
        template.content.slice(0, 16000),
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "你是一名应急预案编制顾问。请根据用户提供的模板内容和新项目要求，生成一份可直接用于交付的中文《突发环境事件应急预案》完整正文。",
    "",
    "编写要求：",
    "1. 参考模板的结构、表达方式和常见章节，但不要机械照抄。",
    "2. 输出完整正文，不要写解释说明、前言提示或额外备注。",
    "3. 若基础信息不足，可以做审慎补全，但必须避免虚构过于具体的法规编号、监测数据和联系人。",
    "4. 语言要正式、可落地，适合企业项目申报或备案场景。",
    "5. 请至少包含以下一级标题：",
    "一、总则",
    "二、企业基本情况",
    "三、环境风险源与事故情景分析",
    "四、应急组织机构与职责",
    "五、预防与预警机制",
    "六、信息报告程序",
    "七、应急响应与处置措施",
    "八、后期处置",
    "九、应急保障",
    "十、培训、演练与预案管理",
    "十一、附则",
    "",
    "项目要求：",
    `项目名称：${input.projectName || "未提供"}`,
    `企业名称：${input.companyName || "未提供"}`,
    `项目类型：${input.projectType || "未提供"}`,
    `行业类别：${input.industryCategory || "未提供"}`,
    `项目位置：${input.projectLocation || "未提供"}`,
    `项目概况：${input.projectOverview || "未提供"}`,
    `风险源信息：${input.riskSources || "未提供"}`,
    `应急资源：${input.emergencyResources || "未提供"}`,
    `特殊要求：${input.specialRequirements || "未提供"}`,
    "",
    "模板材料：",
    templateText,
  ].join("\n");
}

function parseDocument(content: string) {
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

export async function createEmergencyPlanDocBuffer(payload: {
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
        ...parseDocument(payload.content),
      ],
    },
  ];

  return await Packer.toBuffer(new Document({ sections }));
}
