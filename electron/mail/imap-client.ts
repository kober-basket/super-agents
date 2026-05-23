import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

import type { MailAccountSummary, MailCredential, MailMessage, MailMessageSummary } from "./types";

type PasswordCredential = Extract<MailCredential, { kind: "password" }>;

export interface MailImapSearchRequest {
  account: MailAccountSummary;
  credential: PasswordCredential;
  query: string;
  limit: number;
}

export interface MailImapReadRequest {
  account: MailAccountSummary;
  credential: PasswordCredential;
  messageId: string;
}

export interface MailImapClient {
  searchMessages(input: MailImapSearchRequest): Promise<MailMessageSummary[]>;
  readMessage(input: MailImapReadRequest): Promise<MailMessage>;
}

const DEFAULT_MAILBOX = "INBOX";
const SEARCH_FETCH_MULTIPLIER = 3;

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function addressText(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as { text?: unknown };
  return textValue(record.text);
}

function addressList(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const records = Array.isArray(value) ? value : [value];
  return records
    .flatMap((item) => {
      const addresses = (item as { value?: Array<{ address?: string }> }).value;
      return Array.isArray(addresses) ? addresses.map((address) => address.address ?? "") : [];
    })
    .map((address) => address.trim())
    .filter(Boolean);
}

function dateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : undefined;
}

function isUnread(flags: unknown) {
  if (!flags || typeof (flags as { has?: unknown }).has !== "function") {
    return undefined;
  }
  return !(flags as Set<string>).has("\\Seen");
}

function toSummary(account: MailAccountSummary, uid: number | string, parsed: ParsedMail, flags?: unknown): MailMessageSummary {
  const text = parsed.text || "";
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const snippet = (text || html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500);
  return {
    id: String(uid),
    accountId: account.id,
    subject: parsed.subject || "(no subject)",
    from: addressText(parsed.from),
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    date: dateString(parsed.date),
    snippet,
    unread: isUnread(flags),
  };
}

function toMessage(account: MailAccountSummary, uid: number | string, parsed: ParsedMail, flags?: unknown): MailMessage {
  const summary = toSummary(account, uid, parsed, flags);
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const body = (parsed.text || html.replace(/<[^>]+>/g, " ")).replace(/\r\n/g, "\n").trim();
  return {
    ...summary,
    body,
    html: html || undefined,
  };
}

async function parseSource(source: unknown) {
  if (!source) {
    return await simpleParser(Buffer.alloc(0));
  }
  return await simpleParser(source as Buffer);
}

export function createDefaultImapClient(): MailImapClient {
  return {
    async searchMessages({ account, credential, query, limit }) {
      return await withImapClient(account, credential, async (client) => {
        const searchCriteria = query.trim() ? { text: query.trim() } : { all: true };
        const result = await client.search(searchCriteria, { uid: true });
        const uids = Array.isArray(result) ? result : [];
        const fetchLimit = Math.max(limit, limit * SEARCH_FETCH_MULTIPLIER);
        const newest = uids.slice(-fetchLimit).reverse();
        if (newest.length === 0) {
          return [];
        }

        const messages: MailMessageSummary[] = [];
        for await (const item of client.fetch(newest, { uid: true, flags: true, source: true }, { uid: true })) {
          const parsed = await parseSource(item.source);
          messages.push(toSummary(account, item.uid, parsed, item.flags));
          if (messages.length >= limit) {
            break;
          }
        }
        return messages;
      });
    },

    async readMessage({ account, credential, messageId }) {
      const uid = Number(messageId);
      if (!Number.isSafeInteger(uid) || uid <= 0) {
        throw new Error("IMAP messageId must be a numeric UID returned by search.");
      }

      return await withImapClient(account, credential, async (client) => {
        const item = await client.fetchOne(String(uid), { uid: true, flags: true, source: true }, { uid: true });
        if (!item) {
          throw new Error("Mail message not found.");
        }
        const parsed = await parseSource(item.source);
        return toMessage(account, item.uid, parsed, item.flags);
      });
    },
  };
}

async function withImapClient<T>(
  account: MailAccountSummary,
  credential: PasswordCredential,
  callback: (client: ImapFlow) => Promise<T>,
) {
  const client = new ImapFlow({
    host: account.incoming.host,
    port: account.incoming.port,
    secure: account.incoming.secure,
    auth: {
      user: credential.username,
      pass: credential.password,
    },
    clientInfo: {
      name: "super-agents",
      version: "0.1.0",
      vendor: "super-agents",
    },
    disableAutoIdle: true,
    logger: false,
    tls: {
      servername: account.incoming.host,
      rejectUnauthorized: true,
    },
  });

  await client.connect();
  try {
    await client.mailboxOpen(DEFAULT_MAILBOX, { readOnly: true });
    return await callback(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}
