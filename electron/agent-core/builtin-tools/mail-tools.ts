import { inferMailSetup } from "../../mail/provider-presets";
import type {
  MailAccountSummary,
  MailDraft,
  MailDraftCreateInput,
  MailMessage,
  MailMessageSummary,
  MailProviderSetup,
  MailReadInput,
  MailSearchInput,
  MailSendDraftInput,
  MailSendResult,
} from "../../mail/types";
import type { ToolDefinition } from "../types";

export interface MailToolStore {
  inferSetup?(email: string): MailProviderSetup | Promise<MailProviderSetup | Record<string, unknown>>;
  listAccounts(): Promise<MailAccountSummary[]>;
  searchMessages(input: MailSearchInput): Promise<MailMessageSummary[]>;
  readMessage(input: MailReadInput): Promise<MailMessage>;
  createDraft(input: MailDraftCreateInput): Promise<MailDraft>;
  sendDraft(input: MailSendDraftInput): Promise<MailSendResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringInput(input: unknown, key: string, fallback = "") {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "string" ? value : fallback;
}

function numberInput(input: unknown, key: string, fallback: number) {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArrayInput(input: unknown, key: string): string[] {
  if (!isRecord(input)) return [];
  const value = input[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function requireStore(store: MailToolStore | null | undefined) {
  if (!store) {
    throw new Error("Mail store is not configured.");
  }
  return store;
}

function formatSetup(setup: MailProviderSetup | Record<string, unknown>) {
  const providerName = String(setup.providerName ?? setup.providerId ?? "unknown");
  const authType = String(setup.authType ?? "unknown");
  const incoming = isRecord(setup.incoming) ? `${setup.incoming.host ?? ""}:${setup.incoming.port ?? ""}` : "";
  const outgoing = isRecord(setup.outgoing) ? `${setup.outgoing.host ?? ""}:${setup.outgoing.port ?? ""}` : "";
  return [
    `Provider: ${providerName}`,
    `Auth: ${authType}`,
    incoming ? `Incoming: ${incoming}` : "",
    outgoing ? `Outgoing: ${outgoing}` : "",
    setup.advancedRequired ? "Advanced settings are required." : "",
  ].filter(Boolean).join("\n");
}

function formatAccounts(accounts: MailAccountSummary[]) {
  if (accounts.length === 0) {
    return "No mail accounts configured. Add one in Settings > Mail.";
  }
  return accounts
    .map((account, index) =>
      [
        `${index + 1}. ${account.displayName} <${account.email}>`,
        `ID: ${account.id}`,
        `Provider: ${account.providerName}`,
        `Auth: ${account.authType}`,
        `Status: ${account.status}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function formatMessages(messages: MailMessageSummary[]) {
  if (messages.length === 0) {
    return "No mail messages found.";
  }
  return messages
    .map((message, index) =>
      [
        `${index + 1}. ${message.subject}`,
        `ID: ${message.id}`,
        `From: ${message.from}`,
        message.date ? `Date: ${message.date}` : "",
        message.unread === true ? "Unread: yes" : "",
        message.snippet ? `Snippet: ${message.snippet}` : "",
      ].filter(Boolean).join("\n"),
    )
    .join("\n\n");
}

function formatMessage(message: MailMessage) {
  return [
    `Subject: ${message.subject}`,
    `From: ${message.from}`,
    message.to.length > 0 ? `To: ${message.to.join(", ")}` : "",
    message.date ? `Date: ${message.date}` : "",
    "",
    message.body || message.snippet || "(empty message)",
  ].filter((line) => line !== "").join("\n");
}

function formatDraft(draft: MailDraft) {
  return [
    `Created draft ${draft.id}`,
    `Account ID: ${draft.accountId}`,
    `To: ${draft.to.join(", ")}`,
    draft.cc.length > 0 ? `Cc: ${draft.cc.join(", ")}` : "",
    draft.bcc.length > 0 ? `Bcc: ${draft.bcc.join(", ")}` : "",
    `Subject: ${draft.subject}`,
    "",
    draft.preview,
  ].filter((line) => line !== "").join("\n");
}

export function createMailToolDefinitions(store?: MailToolStore | null): ToolDefinition[] {
  return [
    {
      name: "mail",
      description:
        "Inspect configured mail accounts and read mail. Actions: infer_setup, list_accounts, search, read. Use mail_draft before sending.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["infer_setup", "list_accounts", "search", "read"],
            description: "Mail action to perform.",
          },
          email: { type: "string", description: "Email address for infer_setup." },
          accountId: { type: "string", description: "Mail account id. Defaults to the first account when omitted." },
          query: { type: "string", description: "Provider search query." },
          messageId: { type: "string", description: "Message id for read." },
          limit: { type: "number", description: "Maximum messages to return. Defaults to 10." },
        },
        required: ["action"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const action = stringInput(input, "action");
        if (action === "infer_setup") {
          const email = stringInput(input, "email").trim();
          if (!email) {
            throw new Error("email is required for infer_setup.");
          }
          const setup = store?.inferSetup ? await store.inferSetup(email) : inferMailSetup(email);
          return {
            content: formatSetup(setup),
            metadata: { action, setup },
          };
        }

        const mailStore = requireStore(store);
        if (action === "list_accounts") {
          const accounts = await mailStore.listAccounts();
          return {
            content: formatAccounts(accounts),
            metadata: { action, accounts },
          };
        }
        if (action === "search") {
          const messages = await mailStore.searchMessages({
            accountId: stringInput(input, "accountId") || undefined,
            query: stringInput(input, "query") || undefined,
            limit: numberInput(input, "limit", 10),
          });
          return {
            content: formatMessages(messages),
            metadata: { action, messages },
          };
        }
        if (action === "read") {
          const messageId = stringInput(input, "messageId").trim();
          if (!messageId) {
            throw new Error("messageId is required for read.");
          }
          const message = await mailStore.readMessage({
            accountId: stringInput(input, "accountId") || undefined,
            messageId,
          });
          return {
            content: formatMessage(message),
            metadata: { action, message },
          };
        }
        throw new Error('action must be one of "infer_setup", "list_accounts", "search", or "read".');
      },
    },
    {
      name: "mail_draft",
      description: "Create a local mail draft. This does not send mail. Use mail_send only after the user asks to send.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Mail account id." },
          to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
          cc: { type: "array", items: { type: "string" }, description: "Optional CC addresses." },
          bcc: { type: "array", items: { type: "string" }, description: "Optional BCC addresses." },
          subject: { type: "string", description: "Draft subject." },
          body: { type: "string", description: "Plain text draft body." },
        },
        required: ["accountId", "to", "subject", "body"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const mailStore = requireStore(store);
        const draft = await mailStore.createDraft({
          accountId: stringInput(input, "accountId").trim(),
          to: stringArrayInput(input, "to"),
          cc: stringArrayInput(input, "cc"),
          bcc: stringArrayInput(input, "bcc"),
          subject: stringInput(input, "subject"),
          body: stringInput(input, "body"),
        });
        return {
          content: formatDraft(draft),
          metadata: { draft },
        };
      },
    },
    {
      name: "mail_send",
      description: "Send an existing local mail draft. This is a write action and should only be used after explicit user intent.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          draftId: { type: "string", description: "Draft id returned by mail_draft." },
          accountId: { type: "string", description: "Optional account id override." },
        },
        required: ["draftId"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const mailStore = requireStore(store);
        const result = await mailStore.sendDraft({
          draftId: stringInput(input, "draftId").trim(),
          accountId: stringInput(input, "accountId") || undefined,
        });
        return {
          content: `Sent draft ${result.draftId} from account ${result.accountId}.`,
          metadata: { ...result },
        };
      },
    },
  ];
}
