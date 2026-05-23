export type ToastTone = "info" | "warning" | "error";

export interface ToastFeedback {
  message: string;
  tone: ToastTone;
}

const LOW_PRIORITY_EXACT_MESSAGES = new Set([
  "设置已保存",
  "已添加提供方",
  "默认模型已更新",
  "知识库已刷新",
  "远程控制状态已刷新",
  "已复制",
  "已复制 Markdown",
  "语音已转成文字",
  "正在录音，点击麦克风结束",
  "远程控制配置已更新",
  "微信已连接",
  "微信已断开连接",
]);

const LOW_PRIORITY_PATTERNS = [
  /^已添加 \d+ 个附件$/,
  /^已创建知识库/,
  /^已为 .+ 准备技能草稿/,
  /^已载入技能/,
  /^已导入技能/,
  /^已移除技能/,
  /^已添加 MCP 服务$/,
  /^微信远程控制已(启用|停用)$/,
  /^(知识库|知识项|笔记|目录|链接|网站)已(添加|删除)$/,
  /已刷新$/,
  /已更新$/,
];

function isLowPrioritySuccess(message: string) {
  if (LOW_PRIORITY_EXACT_MESSAGES.has(message)) {
    return true;
  }

  if (LOW_PRIORITY_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  return message.startsWith("已") && !isImportantCompletion(message);
}

function isImportantCompletion(message: string) {
  return /^已导出[:：]/.test(message) || /^已导入 \d+ 个文件$/.test(message);
}

function isErrorMessage(message: string) {
  return /(失败|错误|异常|error)/i.test(message);
}

function isWarningMessage(message: string) {
  return /^(请|请输入|请先)/.test(message) || /(没有|未完成|未配置|不存在|不可|不能|无法|不支持|缺少)/.test(message);
}

export function resolveToastFeedback(message: string | null | undefined): ToastFeedback | null {
  const trimmed = message?.trim();
  if (!trimmed) {
    return null;
  }

  if (isImportantCompletion(trimmed)) {
    return { message: trimmed, tone: "info" };
  }

  if (isErrorMessage(trimmed)) {
    return { message: trimmed, tone: "error" };
  }

  if (isWarningMessage(trimmed)) {
    return { message: trimmed, tone: "warning" };
  }

  if (isLowPrioritySuccess(trimmed)) {
    return null;
  }

  return { message: trimmed, tone: "info" };
}
