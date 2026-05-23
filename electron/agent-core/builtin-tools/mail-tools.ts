import { inferMailSetup } from "../../mail/provider-presets";
import type {
  MailAccountSummary,
  MailAuthType,
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

function mailAuthHint(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "qq" || normalized === "qq-mail" || normalized === "qqmail") {
    return {
      provider: "qq",
      providerName: "QQ Mail",
      authType: "password" as MailAuthType,
      helpText: "Use the IMAP/SMTP authorization code generated in QQ Mail settings, not the QQ login password.",
    };
  }
  if (normalized === "gmail" || normalized === "google") {
    return {
      provider: "gmail",
      providerName: "Gmail",
      authType: "oauth" as MailAuthType,
      helpText: "Use Google OAuth when possible.",
    };
  }
  if (normalized === "outlook" || normalized === "microsoft" || normalized === "hotmail") {
    return {
      provider: "microsoft",
      providerName: "Microsoft Outlook",
      authType: "oauth" as MailAuthType,
      helpText: "Use Microsoft OAuth for Outlook, Hotmail, Live, and Microsoft 365 accounts.",
    };
  }
  return {
    provider: normalized || "auto",
    providerName: provider.trim() || "Mail",
    authType: "password" as MailAuthType,
  };
}

function createMailAuthMetadata(input: unknown) {
  const email = stringInput(input, "email").trim();
  const provider = stringInput(input, "provider").trim();
  const setup = email.includes("@") ? inferMailSetup(email) : null;
  const hint = setup
    ? {
        provider: setup.providerId,
        providerName: setup.providerName,
        authType: setup.authType,
        helpText: setup.helpText,
      }
    : mailAuthHint(provider);

  return {
    email: setup?.email ?? email,
    provider: hint.provider,
    providerName: hint.providerName,
    authType: hint.authType,
    helpText: hint.helpText,
    setup: setup ?? undefined,
  };
}

function sanitizeMailAuthDecisionMetadata(metadata: Record<string, unknown> | undefined) {
  if (!isRecord(metadata)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of ["accountId", "email", "providerId", "providerName", "authType", "status"] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      sanitized[key] = value.trim();
    }
  }
  return sanitized;
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
      name: "mail_auth",
      description:
        "打开私密的会话内邮箱授权表单，用于添加或连接邮箱账号。用户要求登录、连接、添加或授权邮箱时使用；模型不会收到密码、授权码、OAuth code 或 token。",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Optional email address to prefill and infer provider settings." },
          provider: {
            type: "string",
            description: "Optional provider hint such as qq, gmail, outlook, microsoft, 163, icloud, or custom.",
          },
        },
        additionalProperties: false,
      },
      execute: async (input, context) => {
        if (!context.requestApproval || !context.toolCall) {
          throw new Error("mail_auth requires an interactive desktop approval handler.");
        }

        const metadata = createMailAuthMetadata(input);
        const approval = await context.requestApproval({
          sessionId: context.sessionId,
          agentId: context.agentId,
          toolCall: context.toolCall,
          kind: "mail_auth",
          reason:
            "Open a private mail authorization form. Secrets typed in the form are saved locally and are not returned to the model.",
          metadata,
        });

        if (approval.type === "deny") {
          return {
            content: `Mail authorization cancelled: ${approval.reason}`,
            metadata: { cancelled: true },
          };
        }

        const account = sanitizeMailAuthDecisionMetadata(approval.metadata);
        const email = typeof account.email === "string" ? account.email : "mail account";
        const providerName = typeof account.providerName === "string" ? account.providerName : "Mail";
        return {
          content: `Mail account connected: ${providerName} <${email}>. Credentials were saved locally and were not shared with the model.`,
          metadata: account,
        };
      },
    },
    {
      name: "mail",
      description:
        "查看已配置的邮箱账号并读取邮件。支持 infer_setup、list_accounts、search、read；发送前请先使用 mail_draft。",
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
      description: "创建本地邮件草稿，不会直接发送。只有用户明确要求发送后才使用 mail_send。",
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
      description: "发送已有的本地邮件草稿。这是写入/发送动作，只能在用户明确表达发送意图后使用。",
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
