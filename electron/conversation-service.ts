import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type {
  ChatConversation,
  ChatConversationListPayload,
  ChatConversationSummary,
  ChatMessage,
  ChatSendInput,
  ChatSendResult,
  ChatVisual,
  FileDropEntry,
} from "../src/types";
import {
  normalizeChatVisualPayload,
  parseChatMessageContent,
} from "../src/lib/chat-visuals";

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_message_at: number;
  preview: string | null;
  message_count: number;
  selected_knowledge_base_ids_json: string | null;
  agent_core: string | null;
  agent_session_id: string | null;
}

interface MessageRow {
  id: string;
  role: ChatMessage["role"];
  content: string;
  attachments_json: string | null;
  visuals_json: string | null;
  created_at: number;
  updated_at: number;
}

interface StartTurnResult {
  createdConversation: boolean;
  conversation: ChatConversation;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

type SqliteModule = typeof import("node:sqlite");
const runtimeRequire = createRequire(__filename);

function loadSqliteModule(): SqliteModule {
  return runtimeRequire("node:sqlite") as SqliteModule;
}

function normalizeAttachments(value: FileDropEntry[] | undefined): FileDropEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  return value.map((attachment) => ({ ...attachment }));
}

function normalizeKnowledgeBaseIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function parseAttachments(value: string | null): FileDropEntry[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as FileDropEntry[] | null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseKnowledgeBaseIds(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeKnowledgeBaseIds(Array.isArray(parsed) ? parsed.map((item) => String(item)) : []);
  } catch {
    return [];
  }
}

function parseVisuals(value: string | null): ChatVisual[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeChatVisualPayload(parsed).visuals;
  } catch {
    return [];
  }
}

function summarizeAttachments(attachments: FileDropEntry[]) {
  return attachments.map((attachment) => attachment.name).join(", ");
}

function buildConversationTitle(content: string, attachments: FileDropEntry[]) {
  const attachmentSummary = summarizeAttachments(attachments);
  const base = (content || (attachmentSummary ? `Attachments: ${attachmentSummary}` : "New conversation"))
    .replace(/\s+/g, " ")
    .trim();
  return base.length > 32 ? `${base.slice(0, 32)}...` : base;
}

function buildConversationPreview(content: string, attachments: FileDropEntry[]) {
  const attachmentSummary = summarizeAttachments(attachments);
  const base = (content || attachmentSummary || "").replace(/\s+/g, " ").trim();
  return base.length > 120 ? `${base.slice(0, 120)}...` : base;
}

function buildVisualPreview(visuals: ChatVisual[]) {
  const firstVisual = visuals[0];
  if (!firstVisual) {
    return "";
  }

  const base =
    firstVisual.title?.trim() ||
    firstVisual.description?.trim() ||
    (firstVisual.type === "chart" ? "Data chart" : "Diagram");
  return base.length > 120 ? `${base.slice(0, 120)}...` : base;
}

function buildAssistantPreview(content: string, visuals: ChatVisual[]) {
  const base = buildConversationPreview(content, []);
  return base || buildVisualPreview(visuals);
}

function buildAssistantReply(content: string, attachments: FileDropEntry[]) {
  const attachmentSummary = summarizeAttachments(attachments);
  const replySource = content || (attachmentSummary ? `Attachments: ${attachmentSummary}` : "Empty message");
  return `Received: ${replySource}`;
}

function mapConversationSummary(row: ConversationRow): ChatConversationSummary {
  const parsedPreview = parseChatMessageContent(row.preview ?? "");
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    preview: buildAssistantPreview(parsedPreview.text, parsedPreview.visuals),
    messageCount: row.message_count,
    selectedKnowledgeBaseIds: parseKnowledgeBaseIds(row.selected_knowledge_base_ids_json),
    agentCore: row.agent_core?.trim() || undefined,
    agentSessionId: row.agent_session_id?.trim() || undefined,
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  const visuals = parseVisuals(row.visuals_json);
  const parsedAssistantMessage =
    row.role === "assistant"
      ? parseChatMessageContent(row.content, visuals)
      : null;

  return {
    id: row.id,
    role: row.role,
    content: parsedAssistantMessage?.text ?? row.content,
    visuals: parsedAssistantMessage?.visuals.length
      ? parsedAssistantMessage.visuals
      : visuals.length
        ? visuals
        : undefined,
    attachments: parseAttachments(row.attachments_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationService {
  private database: DatabaseSync | null = null;

  constructor(private readonly databasePath: string) {}

  async initialize() {
    await mkdir(path.dirname(this.databasePath), { recursive: true });

    const { DatabaseSync } = loadSqliteModule();
    const database = new DatabaseSync(this.databasePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_message_at INTEGER NOT NULL,
        preview TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments_json TEXT,
        visuals_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
      ON conversations(last_message_at DESC, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
      ON messages(conversation_id, created_at ASC);
    `);

    this.ensureConversationColumn(database, "agent_core", "TEXT NOT NULL DEFAULT ''");
    this.ensureConversationColumn(database, "agent_session_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureConversationColumn(database, "selected_knowledge_base_ids_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureMessageColumn(database, "visuals_json", "TEXT NOT NULL DEFAULT '[]'");

    this.database = database;
  }

  async shutdown() {
    this.database?.close();
    this.database = null;
  }

  async listConversations(): Promise<ChatConversationListPayload> {
    const rows = this.getDatabase()
      .prepare(`
        SELECT
          conversations.id,
          conversations.title,
          conversations.created_at,
          conversations.updated_at,
          conversations.last_message_at,
          conversations.preview,
          conversations.selected_knowledge_base_ids_json,
          conversations.agent_core,
          conversations.agent_session_id,
          COUNT(messages.id) AS message_count
        FROM conversations
        LEFT JOIN messages ON messages.conversation_id = conversations.id
        GROUP BY conversations.id
        ORDER BY conversations.last_message_at DESC, conversations.created_at DESC
      `)
      .all() as unknown as ConversationRow[];

    return {
      fetchedAt: Date.now(),
      conversations: rows.map(mapConversationSummary),
    };
  }

  async getConversation(conversationId: string): Promise<ChatConversation> {
    const summary = this.getConversationSummary(conversationId);
    if (!summary) {
      throw new Error("Conversation not found");
    }

    const messageRows = this.getDatabase()
      .prepare(`
        SELECT
          id,
          role,
          content,
          attachments_json,
          visuals_json,
          created_at,
          updated_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC, id ASC
      `)
      .all(conversationId) as unknown as MessageRow[];

    return {
      ...summary,
      messages: messageRows.map(mapMessage),
    };
  }

  async deleteConversation(conversationId: string): Promise<ChatConversationListPayload> {
    this.getDatabase().prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    return await this.listConversations();
  }

  async startTurn(
    input: ChatSendInput,
    options: { agentCore: string },
  ): Promise<StartTurnResult> {
    const content = input.content.trim();
    const attachments = normalizeAttachments(input.attachments);
    const selectedKnowledgeBaseIds = normalizeKnowledgeBaseIds(input.selectedKnowledgeBaseIds);
    const selectedKnowledgeBaseIdsJson = JSON.stringify(selectedKnowledgeBaseIds);
    const shouldUpdateKnowledgeBaseIds = input.selectedKnowledgeBaseIds !== undefined;
    if (!content && attachments.length === 0) {
      throw new Error("Message content or attachments are required");
    }

    const database = this.getDatabase();
    const now = Date.now();
    const conversationId = input.conversationId?.trim() || randomUUID();
    const createdConversation = !input.conversationId;
    const title = buildConversationTitle(content, attachments);
    const preview = buildConversationPreview(content, attachments);
      const attachmentsJson = JSON.stringify(attachments);
      const emptyVisualsJson = "[]";
      const userMessageId = randomUUID();
      const assistantMessageId = randomUUID();
    let transactionStarted = false;

    try {
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      if (createdConversation) {
        database
          .prepare(`
            INSERT INTO conversations (
              id,
              title,
              created_at,
              updated_at,
              last_message_at,
              preview,
              selected_knowledge_base_ids_json,
              agent_core,
              agent_session_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
          `)
          .run(
            conversationId,
            title,
            now,
            now,
            now,
            preview,
            selectedKnowledgeBaseIdsJson,
            options.agentCore,
          );
      } else {
        const existing = this.getConversationSummary(conversationId);
        if (!existing) {
          throw new Error("Conversation not found");
        }

        const nextKnowledgeBaseIdsJson = shouldUpdateKnowledgeBaseIds
          ? selectedKnowledgeBaseIdsJson
          : JSON.stringify(existing.selectedKnowledgeBaseIds);

        database
          .prepare(`
            UPDATE conversations
            SET updated_at = ?, last_message_at = ?, preview = ?, selected_knowledge_base_ids_json = ?
            WHERE id = ?
          `)
          .run(now, now, preview, nextKnowledgeBaseIdsJson, conversationId);
      }

      database
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, content, attachments_json, visuals_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(userMessageId, conversationId, "user", content, attachmentsJson, emptyVisualsJson, now, now);

      database
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, content, attachments_json, visuals_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(assistantMessageId, conversationId, "assistant", "", "[]", emptyVisualsJson, now + 1, now + 1);

      database
        .prepare(`
          UPDATE conversations
          SET updated_at = ?, last_message_at = ?
          WHERE id = ?
        `)
        .run(now + 1, now + 1, conversationId);

      database.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        database.exec("ROLLBACK");
      }
      throw error;
    }

    const conversation = await this.getConversation(conversationId);
    const userMessage = conversation.messages.find((message) => message.id === userMessageId);
    const assistantMessage = conversation.messages.find((message) => message.id === assistantMessageId);

    if (!userMessage || !assistantMessage) {
      throw new Error("Failed to prepare conversation turn");
    }

    return {
      createdConversation,
      conversation,
      userMessage,
      assistantMessage,
    };
  }

  async updateAssistantMessage(
    conversationId: string,
    messageId: string,
    content: string,
    visuals: ChatVisual[] = [],
  ): Promise<void> {
    const database = this.getDatabase();
    const now = Date.now();
    const preview = buildAssistantPreview(content, visuals);
    const visualsJson = JSON.stringify(visuals);

    database
      .prepare(`
        UPDATE messages
        SET content = ?, visuals_json = ?, updated_at = ?
        WHERE id = ? AND conversation_id = ? AND role = 'assistant'
      `)
      .run(content, visualsJson, now, messageId, conversationId);

    database
      .prepare(`
        UPDATE conversations
        SET updated_at = ?, last_message_at = ?, preview = ?
        WHERE id = ?
      `)
      .run(now, now, preview, conversationId);
  }

  async setConversationAgentSession(
    conversationId: string,
    payload: { agentCore?: string; agentSessionId?: string },
  ): Promise<void> {
    const summary = this.getConversationSummary(conversationId);
    if (!summary) {
      throw new Error("Conversation not found");
    }

    const nextAgentCore = payload.agentCore ?? summary.agentCore ?? "";
    const nextAgentSessionId = payload.agentSessionId ?? summary.agentSessionId ?? "";

    this.getDatabase()
      .prepare(`
        UPDATE conversations
        SET agent_core = ?, agent_session_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(nextAgentCore, nextAgentSessionId, Date.now(), conversationId);
  }

  async sendMessage(input: ChatSendInput): Promise<ChatSendResult> {
    const content = input.content.trim();
    const attachments = normalizeAttachments(input.attachments);
    const selectedKnowledgeBaseIds = normalizeKnowledgeBaseIds(input.selectedKnowledgeBaseIds);
    const selectedKnowledgeBaseIdsJson = JSON.stringify(selectedKnowledgeBaseIds);
    const shouldUpdateKnowledgeBaseIds = input.selectedKnowledgeBaseIds !== undefined;
    if (!content && attachments.length === 0) {
      throw new Error("Message content or attachments are required");
    }

    const database = this.getDatabase();
    const now = Date.now();
    const conversationId = input.conversationId?.trim() || randomUUID();
    const createdConversation = !input.conversationId;
    const title = buildConversationTitle(content, attachments);
    const assistantContent = buildAssistantReply(content, attachments);
    const preview = buildAssistantPreview(assistantContent, []);
    const attachmentsJson = JSON.stringify(attachments);
    const emptyVisualsJson = "[]";
    let transactionStarted = false;

    try {
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      if (createdConversation) {
        database
          .prepare(`
            INSERT INTO conversations (
              id,
              title,
              created_at,
              updated_at,
              last_message_at,
              preview,
              selected_knowledge_base_ids_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(conversationId, title, now, now, now, preview, selectedKnowledgeBaseIdsJson);
      } else {
        const existing = this.getConversationSummary(conversationId);
        if (!existing) {
          throw new Error("Conversation not found");
        }

        const nextKnowledgeBaseIdsJson = shouldUpdateKnowledgeBaseIds
          ? selectedKnowledgeBaseIdsJson
          : JSON.stringify(existing.selectedKnowledgeBaseIds);

        database
          .prepare(`
            UPDATE conversations
            SET updated_at = ?, last_message_at = ?, preview = ?, selected_knowledge_base_ids_json = ?
            WHERE id = ?
          `)
          .run(now, now, preview, nextKnowledgeBaseIdsJson, conversationId);
      }

      database
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, content, attachments_json, visuals_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), conversationId, "user", content, attachmentsJson, emptyVisualsJson, now, now);

      database
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, content, attachments_json, visuals_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), conversationId, "assistant", assistantContent, "[]", emptyVisualsJson, now + 1, now + 1);

      database
        .prepare(`
          UPDATE conversations
          SET updated_at = ?, last_message_at = ?, preview = ?
          WHERE id = ?
        `)
        .run(now + 1, now + 1, preview, conversationId);

      database.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        database.exec("ROLLBACK");
      }
      throw error;
    }

    return {
      createdConversation,
      conversation: await this.getConversation(conversationId),
    };
  }

  private getConversationSummary(conversationId: string): ChatConversationSummary | null {
    const row = this.getDatabase()
      .prepare(`
        SELECT
          conversations.id,
          conversations.title,
          conversations.created_at,
          conversations.updated_at,
          conversations.last_message_at,
          conversations.preview,
          conversations.selected_knowledge_base_ids_json,
          conversations.agent_core,
          conversations.agent_session_id,
          COUNT(messages.id) AS message_count
        FROM conversations
        LEFT JOIN messages ON messages.conversation_id = conversations.id
        WHERE conversations.id = ?
        GROUP BY conversations.id
      `)
      .get(conversationId) as unknown as ConversationRow | undefined;

    return row ? mapConversationSummary(row) : null;
  }

  private ensureConversationColumn(database: DatabaseSync, columnName: string, columnDefinition: string) {
    const columns = database
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name?: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    database.exec(`ALTER TABLE conversations ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureMessageColumn(database: DatabaseSync, columnName: string, columnDefinition: string) {
    const columns = database
      .prepare("PRAGMA table_info(messages)")
      .all() as Array<{ name?: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    database.exec(`ALTER TABLE messages ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private getDatabase() {
    if (!this.database) {
      throw new Error("Conversation service has not been initialized");
    }
    return this.database;
  }
}
