export const DEFAULT_THREAD_TITLE = "\u65b0\u4f1a\u8bdd";

const GENERATED_THREAD_TITLE_PATTERN = /^new\s+(?:thread|session)(?:\s*[-:]\s*.+)?$/i;
const CHINESE_DEFAULT_THREAD_TITLE_PATTERN = /^\u65b0(?:\u4f1a\u8bdd|\u5bf9\u8bdd)$/u;
const GENERIC_THREAD_TITLE_ALIASES = new Set([
  "\u65b0\u4f1a\u8bdd",
  "\u65b0\u5bf9\u8bdd",
  "\u93c2\u98a4\u7d30\u7487?",
  "\u00e6\u0096\u00b0\u00e4\u00bc\u009a\u00e8\u00af\u009d",
]);
const LEADING_FILLER_PATTERNS = [
  /^(?:\u4f60\u597d|\u60a8\u597d|hi|hello|hey|\u55e8|\u54c8\u55bd|\u5728\u5417|\u5728\u561b)\s*[-,，。!！?？:：]*/iu,
  /^(?:\u8bf7\u5e2e\u6211|\u5e2e\u6211|\u9ebb\u70e6(?:\u4f60)?|\u8bf7\u4f60|\u8bf7|\u5e2e\u5fd9|\u9ebb\u70e6\u5e2e\u6211|\u53ef\u4ee5\u5e2e\u6211|\u80fd\u4e0d\u80fd\u5e2e\u6211|\u80fd\u5426\u5e2e\u6211|\u6211\u60f3\u8ba9\u4f60|\u6211\u60f3\u8bf7\u4f60)\s*/u,
  /^(?:\u628a|\u5c06|\u7ed9\u6211)\s*/u,
  /^(?:\u770b\u4e0b|\u770b\u4e00\u4e0b|\u5e2e\u6211\u770b\u4e0b|\u5e2e\u6211\u770b\u4e00\u4e0b)\s*/u,
];
const WEAK_THREAD_PROMPT_PATTERNS = [
  /^(?:hi|hello|hey|yo|ok|okay|test|testing|ping|thanks?|thank you)$/i,
  /^(?:\u4f60\u597d|\u60a8\u597d|\u55e8|\u54c8\u55bd|\u5728\u5417|\u5728\u561b|\u8c22\u8c22|\u6536\u5230|\u597d\u7684|\u884c|\u6069|\u54e6|\u6d4b\u8bd5|\u8bd5\u8bd5|\u7ee7\u7eed|\u5f00\u59cb)$/u,
  /^[?？!！.。]+$/u,
];
const SENTENCE_BREAK_PATTERN = /[\r\n。！？!?，,:：；;]+/u;
const MAX_EXPLICIT_TITLE_LENGTH = 48;
const MAX_GENERATED_TITLE_LENGTH = 18;

export type ThreadTitleMessageLike = {
  role?: string | null;
  text?: string | null;
};

function cleanThreadText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function truncateThreadText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(maxLength - 3, 1))}...` : value;
}

function stripTrailingNoise(value: string) {
  return value.replace(/[-,，。!！?？:：；;~～]+$/u, "").trim();
}

function stripLeadingFillers(value: string) {
  let normalized = value;
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of LEADING_FILLER_PATTERNS) {
      const candidate = normalized.replace(pattern, "").trim();
      if (candidate !== normalized) {
        normalized = candidate;
        changed = true;
      }
    }
  }

  return normalized;
}

function isWeakThreadPromptCandidate(value: string) {
  if (!value) return true;

  const compact = value.replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:\\|,.<>/?，。！？；：“”‘’、（）【】]/gu, "");
  if (!compact) return true;
  if (compact.length <= 1) return true;
  if (/^[a-z0-9_-]{1,4}$/i.test(compact)) return true;

  return WEAK_THREAD_PROMPT_PATTERNS.some((pattern) => pattern.test(value));
}

function extractMeaningfulSegment(value: string) {
  const segments = value
    .split(SENTENCE_BREAK_PATTERN)
    .map((segment) => stripTrailingNoise(cleanThreadText(segment)))
    .filter(Boolean);

  return segments.find((segment) => !isWeakThreadPromptCandidate(segment)) ?? segments[0] ?? "";
}

function normalizeThreadPromptCandidate(value?: string | null) {
  let normalized = cleanThreadText(value);
  if (!normalized) return "";

  normalized = normalized
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  normalized = cleanThreadText(normalized).replace(/^\/[^\s]+\s*/u, "");
  normalized = stripLeadingFillers(normalized);
  normalized = normalized.replace(
    /^(?:\u8bf7)?(?:\u6839\u636e|\u6309\u7167|based on).{0,18}?(\u8d77\u8349|\u64b0\u5199|\u7f16\u5199|\u5199(?:\u4e00\u4efd)?|\u6574\u7406|\u603b\u7ed3|\u63d0\u70bc|\u5f52\u7eb3|\u751f\u6210|\u8f93\u51fa|\u5206\u6790|\u6392\u67e5|\u4fee\u590d)/iu,
    "$1",
  );
  normalized = extractMeaningfulSegment(normalized);
  normalized = stripTrailingNoise(cleanThreadText(normalized));

  return normalized;
}

export function isGenericThreadTitle(title?: string | null) {
  const normalized = cleanThreadText(title);
  if (!normalized) return true;

  return (
    GENERIC_THREAD_TITLE_ALIASES.has(normalized) ||
    normalized === "New Thread" ||
    GENERATED_THREAD_TITLE_PATTERN.test(normalized) ||
    CHINESE_DEFAULT_THREAD_TITLE_PATTERN.test(normalized)
  );
}

export function deriveThreadTitleFromPrompt(value?: string | null) {
  const normalized = normalizeThreadPromptCandidate(value);
  if (!normalized || isWeakThreadPromptCandidate(normalized)) {
    return null;
  }

  return truncateThreadText(normalized, MAX_GENERATED_TITLE_LENGTH);
}

export function deriveThreadTitleFromMessages(messages: Iterable<ThreadTitleMessageLike>) {
  for (const message of messages) {
    if ((message.role ?? "") !== "user") continue;

    const derived = deriveThreadTitleFromPrompt(message.text);
    if (derived) {
      return derived;
    }
  }

  return null;
}

export function formatThreadTitle(title?: string | null, fallbackText?: string | null) {
  const normalizedTitle = cleanThreadText(title);
  if (!isGenericThreadTitle(normalizedTitle)) {
    return truncateThreadText(normalizedTitle, MAX_EXPLICIT_TITLE_LENGTH);
  }

  const derived = deriveThreadTitleFromPrompt(fallbackText);
  if (derived) {
    return derived;
  }

  return DEFAULT_THREAD_TITLE;
}
