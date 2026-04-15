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
  FileDropEntry,
} from "../src/types";

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_message_at: number;
  preview: string | null;
  message_count: number;
}

interface MessageRow {
  id: string;
  role: ChatMessage["role"];
  content: string;
  attachments_json: string | null;
  created_at: number;
  updated_at: number;
}

type SqliteModule = typeof import("node:sqlite");
const runtimeRequire = createRequire(__filename);

function loadSqliteModule(): SqliteModule {
  // Keep the built-in module specifier intact after bundling.
  return runtimeRequire("node:sqlite") as SqliteModule;
}

function normalizeAttachments(value: FileDropEntry[] | undefined): FileDropEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  return value.map((attachment) => ({ ...attachment }));
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

function buildConversationTitle(content: string, attachments: FileDropEntry[]) {
  const attachmentSummary = attachments.map((attachment) => attachment.name).join(", ");
  const base = (content || (attachmentSummary ? `附件：${attachmentSummary}` : "新对话")).replace(/\s+/g, " ").trim();
  return base.length > 32 ? `${base.slice(0, 32)}...` : base;
}

function buildAssistantReply(content: string, attachments: FileDropEntry[]) {
  const attachmentSummary = attachments.map((attachment) => attachment.name).join(", ");
  const replySource = content || (attachmentSummary ? `附件：${attachmentSummary}` : "空消息");
  return `好的，你发送的是：${replySource}`;
}

function mapConversationSummary(row: ConversationRow): ChatConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    preview: row.preview ?? "",
    messageCount: row.message_count,
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
      ON conversations(last_message_at DESC, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
      ON messages(conversation_id, created_at ASC);
    `);

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

  async sendMessage(input: ChatSendInput): Promise<ChatSendResult> {
    const content = input.content.trim();
    const attachments = normalizeAttachments(input.attachments);
    if (!content && attachments.length === 0) {
      throw new Error("Message content or attachments are required");
    }

    const database = this.getDatabase();
    const now = Date.now();
    const conversationId = input.conversationId?.trim() || randomUUID();
    const createdConversation = !input.conversationId;
    const title = buildConversationTitle(content, attachments);
    const assistantContent = buildAssistantReply(content, attachments);
    const preview = assistantContent;
    const attachmentsJson = JSON.stringify(attachments);
    let transactionStarted = false;

    try {
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      if (createdConversation) {
        database
          .prepare(`
            INSERT INTO conversations (id, title, created_at, updated_at, last_message_at, preview)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(conversationId, title, now, now, now, preview);
      } else {
        const existing = this.getConversationSummary(conversationId);
        if (!existing) {
          throw new Error("Conversation not found");
        }

        database
          .prepare(`
            UPDATE conversations
            SET updated_at = ?, last_message_at = ?, preview = ?
            WHERE id = ?
          `)
          .run(now, now, preview, conversationId);
      }

      database
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, content, attachments_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), conversationId, "user", content, attachmentsJson, now, now);

      database
        .prepare(`
          INSERT INTO messages (id, conversation_id, role, content, attachments_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(randomUUID(), conversationId, "assistant", assistantContent, "[]", now + 1, now + 1);

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
          COUNT(messages.id) AS message_count
        FROM conversations
        LEFT JOIN messages ON messages.conversation_id = conversations.id
        WHERE conversations.id = ?
        GROUP BY conversations.id
      `)
      .get(conversationId) as unknown as ConversationRow | undefined;

    return row ? mapConversationSummary(row) : null;
  }

  private getDatabase() {
    if (!this.database) {
      throw new Error("Conversation service has not been initialized");
    }
    return this.database;
  }
}
