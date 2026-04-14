import type {
  AppConfig,
  McpServerStatus,
  PendingQuestion,
  RuntimeSkill,
  SkillConfig,
  ThreadRecord,
  ThreadSummary,
} from "../../types"

export type ComposerSkill = {
  id: string
  name: string
  description?: string
  kind: SkillConfig["kind"] | "reference"
  source: "installed" | "reference"
  enabled: boolean
}

export type SkillMessageMarker = {
  displayText: string
  skillName: string
}

export type SkillPromptMeta = {
  displayText: string
  skillName: string
}

export type DraftThreadState = {
  workspaceRoot: string
  thread: ThreadRecord | null
}

export type SessionStatus = {
  bootstrapping: boolean
  creatingThread: boolean
  refreshingThreads: boolean
  openingThreadId: string | null
  mutatingThreadId: string | null
  sending: boolean
}

export type WorkspaceSnapshot = {
  config: AppConfig
  threads: ThreadSummary[]
  activeThreadId: string
  currentThread: ThreadRecord | null
  availableSkills: RuntimeSkill[]
  mcpStatuses: McpServerStatus[]
  pendingQuestions: PendingQuestion[]
}
