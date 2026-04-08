import type {
  AppConfig,
  ChatMessage,
  FileDropEntry,
  ThreadRecord,
  ThreadSummary,
} from "../../types"
import { fileKind } from "../shared/utils"
import type { SkillPromptMeta } from "./types"

export const WORKSPACE_SNAPSHOT_KEY = "super-agents-workspace-snapshot-v1"
export const LEGACY_WORKSPACE_SNAPSHOT_KEYS = ["kober-workspace-snapshot-v1"]
export const SKILL_MESSAGE_MARKERS_KEY = "super-agents-skill-message-markers-v1"
export const LEGACY_SKILL_MESSAGE_MARKER_KEYS = ["kober-skill-message-markers-v1"]

export function emptyConfig(): AppConfig {
  return {
    opencodeRoot: "",
    bridgeUrl: "",
    environment: "local",
    activeModelId: "ifly-azure-gpt-5-mini",
    contextTier: "high",
    proxy: {
      http: "",
      https: "",
      bypass: "localhost,127.0.0.1",
    },
    modelProviders: [],
    mcpServers: [],
    skills: [],
    hiddenCodexSkillIds: [],
    knowledgeBase: {
      enabled: false,
      embeddingProviderId: "",
      embeddingModel: "text-embedding-3-small",
      selectedBaseIds: [],
      documentCount: 5,
      chunkSize: 1200,
      chunkOverlap: 160,
    },
  }
}

export function cloneConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config)) as AppConfig
}

export function normalizeConfig(config?: Partial<AppConfig> | null): AppConfig {
  const fallback = emptyConfig()
  if (!config) return fallback

  return {
    ...fallback,
    ...config,
    proxy: {
      ...fallback.proxy,
      ...(config.proxy ?? {}),
    },
    modelProviders: Array.isArray(config.modelProviders) ? config.modelProviders : fallback.modelProviders,
    mcpServers: Array.isArray(config.mcpServers) ? config.mcpServers : fallback.mcpServers,
    skills: Array.isArray(config.skills) ? config.skills : fallback.skills,
    hiddenCodexSkillIds: Array.isArray(config.hiddenCodexSkillIds)
      ? config.hiddenCodexSkillIds
      : fallback.hiddenCodexSkillIds,
    knowledgeBase: {
      ...fallback.knowledgeBase,
      ...(config.knowledgeBase ?? {}),
      selectedBaseIds: Array.isArray(config.knowledgeBase?.selectedBaseIds)
        ? config.knowledgeBase.selectedBaseIds
        : fallback.knowledgeBase.selectedBaseIds,
      documentCount:
        typeof config.knowledgeBase?.documentCount === "number"
          ? config.knowledgeBase.documentCount
          : fallback.knowledgeBase.documentCount,
      chunkSize:
        typeof config.knowledgeBase?.chunkSize === "number"
          ? config.knowledgeBase.chunkSize
          : fallback.knowledgeBase.chunkSize,
      chunkOverlap:
        typeof config.knowledgeBase?.chunkOverlap === "number"
          ? config.knowledgeBase.chunkOverlap
          : fallback.knowledgeBase.chunkOverlap,
    },
  }
}

export function createSessionId() {
  return Math.random().toString(36).slice(2)
}

export function matchQuery(query: string, values: Array<string | undefined>) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values.some((value) => value?.toLowerCase().includes(normalized))
}

export function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

export function normalizeSkillToken(value: string) {
  return value.trim().toLowerCase()
}

export function workspaceLabel(value: string) {
  const trimmed = value.trim().replace(/[\\/]+$/, "")
  if (!trimmed) return "未选择工作区"
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? trimmed
}

export function parseSlashSkillCommand(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null

  return {
    skillToken: normalizeSkillToken(match[1] ?? ""),
    prompt: (match[2] ?? "").trim(),
  }
}

export function readJsonStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function readJsonStorageFromKeys<T>(keys: string[]) {
  for (const key of keys) {
    const value = readJsonStorage<T>(key)
    if (value !== null) {
      return value
    }
  }

  return null
}

export function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors and keep the live session responsive.
  }
}

export function sortThreadSummaries(items: ThreadSummary[]) {
  return [...items].sort((left, right) => {
    if (left.archived !== right.archived) {
      return Number(left.archived) - Number(right.archived)
    }
    return right.updatedAt - left.updatedAt
  })
}

export function summarizeThreadLastMessage(messages: ChatMessage[]) {
  const lastText =
    [...messages]
      .reverse()
      .map((message) => message.text.trim())
      .find(Boolean) ?? ""
  return lastText.slice(0, 120)
}

export function summarizeThreadRecord(thread: ThreadRecord): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    lastMessage: summarizeThreadLastMessage(thread.messages),
    messageCount: thread.messages.length,
    archived: thread.archived,
    workspaceRoot: thread.workspaceRoot,
  }
}

function extractJsonObject(raw: string) {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return raw.slice(start, end + 1)
}

export function extractErrorText(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ""

  const candidates = [trimmed]
  const embeddedJson = extractJsonObject(trimmed)
  if (embeddedJson && embeddedJson !== trimmed) {
    candidates.push(embeddedJson)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        name?: string
        message?: string
        data?: {
          message?: string
          issues?: Array<{ path?: Array<string | number>; message?: string }>
        }
        error?:
          | {
              message?: string
              code?: string
            }
          | Array<{ message?: string }>
        errors?: Array<{ message?: string }>
      }

      if (parsed.name === "ConfigInvalidError") {
        const firstIssue = parsed.data?.issues?.[0]
        const issuePath = Array.isArray(firstIssue?.path) ? firstIssue.path.join(".") : ""
        if (issuePath.includes(".status")) {
          return "当前默认模型状态无效，请刷新模型列表或移除异常模型后重试。"
        }
        return firstIssue?.message || "当前运行时配置无效，请检查模型、MCP 或代理设置。"
      }

      if (Array.isArray(parsed.error) && parsed.error[0]?.message) {
        return parsed.error[0].message
      }

      return (
        (typeof parsed.error === "object" && !Array.isArray(parsed.error) ? parsed.error?.message : undefined) ??
        parsed.data?.message ??
        parsed.errors?.[0]?.message ??
        parsed.message ??
        candidate
      )
    } catch {
      // Try the next candidate or fall back to the original text.
    }
  }

  return trimmed
}

export function formatErrorMessage(error: unknown, fallback: string) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  const text = extractErrorText(raw)
  const normalized = text.toLowerCase()

  if (
    (normalized.includes("invalid input: expected object, received null") && normalized.includes("model")) ||
    normalized.includes("no available model configured")
  ) {
    return "当前没有可用模型，请先在设置里配置并启用模型。"
  }
  if (
    normalized.includes("unsupported_country_region_territory") ||
    normalized.includes("country, region, or territory not supported")
  ) {
    return "当前账号或网络所在地区不被支持，请切换网络或代理后重试。"
  }
  if (normalized.includes("failed to refresh token")) {
    return "登录状态刷新失败，请重新登录后再试。"
  }
  if (normalized.includes("configinvaliderror")) {
    return "当前运行时配置无效，请检查模型、MCP 或代理设置。"
  }
  if (normalized.includes("timed out starting opencode server")) {
    return "启动运行时服务超时，请检查本地环境或代理配置后重试。"
  }
  if (normalized.includes("opencode server exited early")) {
    return "运行时服务启动后很快退出，请检查本地环境或代理配置后重试。"
  }

  return text || fallback
}

export function threadProgressScore(thread: ThreadRecord) {
  return thread.messages.reduce((score, message) => {
    const textScore = message.text.trim().length
    const attachmentScore = message.attachments?.length ?? 0
    const statusScore = message.status === "error" ? 40 : message.status === "loading" ? 20 : 0
    return score + 1000 + textScore + attachmentScore * 10 + statusScore
  }, 0)
}

export function shouldKeepLocalThreadOverride(localThread: ThreadRecord, incomingThread: ThreadRecord) {
  const lastMessage = localThread.messages.at(-1)
  const keepsLocalState =
    lastMessage?.role === "assistant" && (lastMessage.status === "loading" || lastMessage.status === "error")
  if (!keepsLocalState) {
    return false
  }

  return threadProgressScore(localThread) > threadProgressScore(incomingThread)
}

export function markThreadRequestFailed(thread: ThreadRecord, errorMessage: string) {
  const messages = [...thread.messages]
  const errorText = `发送失败：${errorMessage}`
  let loadingIndex = -1

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === "assistant" && message.status === "loading") {
      loadingIndex = index
      break
    }
  }

  if (loadingIndex >= 0) {
    messages[loadingIndex] = {
      ...messages[loadingIndex],
      text: errorText,
      status: "error",
    }
  } else {
    messages.push({
      id: createSessionId(),
      role: "assistant",
      text: errorText,
      createdAt: Date.now(),
      status: "error",
    })
  }

  return {
    ...thread,
    updatedAt: Date.now(),
    lastMessage: errorText,
    messageCount: messages.length,
    messages,
  }
}

export function buildSkillPrompt(name: string, description: string | undefined, prompt: string) {
  return [
    `请你以技能“${name}”的身份继续处理下面这条请求。`,
    prompt.trim() || description || "请根据技能说明继续完成任务。",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function createOptimisticThread(input: {
  activeThread: ThreadRecord | null
  activeThreadId: string
  activeSummary: ThreadSummary | null
  message: string
  attachments: FileDropEntry[]
  skillMeta?: SkillPromptMeta
}) {
  const messages = [
    ...(input.activeThread?.messages ?? []),
    {
      id: createSessionId(),
      role: "user" as const,
      text: input.skillMeta?.displayText ?? input.message,
      createdAt: Date.now(),
      skillName: input.skillMeta?.skillName,
      attachments: input.attachments.map((file) => ({
        ...file,
        kind: fileKind(file),
      })),
    },
    {
      id: createSessionId(),
      role: "assistant" as const,
      text: "",
      createdAt: Date.now(),
      status: "loading" as const,
    },
  ]

  return {
    ...(input.activeThread ?? {
      id: input.activeThreadId,
      title: input.activeSummary?.title || "新会话",
      updatedAt: Date.now(),
      lastMessage: "",
      messageCount: 0,
      archived: input.activeSummary?.archived ?? false,
      messages: [],
    }),
    updatedAt: Date.now(),
    lastMessage: input.skillMeta?.displayText ?? input.message,
    messageCount: messages.length,
    messages,
  } satisfies ThreadRecord
}
