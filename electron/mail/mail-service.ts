import { randomUUID } from "node:crypto";
import { connect as connectTls, type TLSSocket } from "node:tls";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "../store";
import { EncryptedCredentialStore } from "./credential-store";
import { getOAuthScopes, inferMailSetup } from "./provider-presets";
import type {
  MailAccountCreateInput,
  MailAccountSummary,
  MailCredential,
  MailDraft,
  MailDraftCreateInput,
  MailMessage,
  MailMessageSummary,
  MailOAuthAuthorization,
  MailOAuthAuthorizationInput,
  MailOAuthCodeExchangeInput,
  MailOAuthCredentialsInput,
  MailPasswordCredentialsInput,
  MailProviderSetup,
  MailReadInput,
  MailSearchInput,
  MailSendDraftInput,
  MailSendResult,
  MailServerConfig,
} from "./types";

interface MailServiceOptions {
  fetch?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const MESSAGE_BODY_LIMIT = 20_000;
const MESSAGE_SNIPPET_LIMIT = 500;
const DRAFT_PREVIEW_LIMIT = 600;

function now() {
  return Date.now();
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function trimText(value: string, limit = MESSAGE_BODY_LIMIT) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}\n\n[truncated ${normalized.length - limit} characters]`;
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

function mergeServer(base: MailServerConfig, override?: Partial<MailServerConfig>): MailServerConfig {
  return {
    host: String(override?.host ?? base.host).trim(),
    port: typeof override?.port === "number" && Number.isFinite(override.port) ? override.port : base.port,
    secure: typeof override?.secure === "boolean" ? override.secure : base.secure,
  };
}

function requireAddressList(value: string[], label: string) {
  const addresses = value.map((item) => item.trim()).filter(Boolean);
  if (addresses.length === 0) {
    throw new Error(`${label} must contain at least one address.`);
  }
  return addresses;
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function base64Url(value: string | Buffer) {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeSubject(value: string) {
  const clean = sanitizeHeader(value);
  return /^[\x00-\x7F]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function buildRawMessage(account: MailAccountSummary, draft: MailDraft) {
  const lines = [
    `From: ${sanitizeHeader(account.email)}`,
    `To: ${draft.to.map(sanitizeHeader).join(", ")}`,
    draft.cc.length > 0 ? `Cc: ${draft.cc.map(sanitizeHeader).join(", ")}` : "",
    draft.bcc.length > 0 ? `Bcc: ${draft.bcc.map(sanitizeHeader).join(", ")}` : "",
    `Subject: ${encodeSubject(draft.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    draft.body.replace(/\r?\n/g, "\r\n"),
  ].filter((line) => line !== "");
  return lines.join("\r\n");
}

function createSetupMetadata(input: MailAccountCreateInput): MailProviderSetup {
  const setup = inferMailSetup(input.email);
  return input.authType && input.authType !== setup.authType
    ? { ...setup, authType: input.authType, oauthProvider: input.authType === "password" ? undefined : setup.oauthProvider }
    : setup;
}

function pickFirstAccount(accounts: MailAccountSummary[], accountId?: string) {
  if (accountId?.trim()) {
    return accounts.find((account) => account.id === accountId.trim()) ?? null;
  }
  return accounts[0] ?? null;
}

async function jsonFetch<T>(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T : ({} as T);
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message =
      typeof record.error_description === "string"
        ? record.error_description
        : typeof record.error === "string"
          ? record.error
          : `Mail API request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  const match = headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return match?.value ?? "";
}

function collectGmailBody(payload: any): { text: string; html: string } {
  const mimeType = String(payload?.mimeType ?? "");
  const bodyData = typeof payload?.body?.data === "string" ? payload.body.data : "";
  if (bodyData && mimeType.includes("text/plain")) {
    return { text: base64UrlDecode(bodyData), html: "" };
  }
  if (bodyData && mimeType.includes("text/html")) {
    const html = base64UrlDecode(bodyData);
    return { text: stripHtml(html), html };
  }

  const parts = Array.isArray(payload?.parts) ? payload.parts : [];
  let text = "";
  let html = "";
  for (const part of parts) {
    const nested = collectGmailBody(part);
    text ||= nested.text;
    html ||= nested.html;
  }
  return { text, html };
}

function normalizeGraphMessage(accountId: string, item: any): MailMessageSummary {
  const to = Array.isArray(item?.toRecipients)
    ? item.toRecipients.map((recipient: any) => String(recipient?.emailAddress?.address ?? "")).filter(Boolean)
    : [];
  const cc = Array.isArray(item?.ccRecipients)
    ? item.ccRecipients.map((recipient: any) => String(recipient?.emailAddress?.address ?? "")).filter(Boolean)
    : [];
  return {
    id: String(item?.id ?? ""),
    accountId,
    subject: String(item?.subject ?? "(no subject)"),
    from: String(item?.from?.emailAddress?.address ?? item?.sender?.emailAddress?.address ?? ""),
    to,
    cc,
    date: typeof item?.receivedDateTime === "string" ? item.receivedDateTime : undefined,
    snippet: trimText(String(item?.bodyPreview ?? ""), MESSAGE_SNIPPET_LIMIT),
    unread: item?.isRead === false,
  };
}

export class MailService {
  private readonly accountsPath: string;
  private readonly draftsPath: string;
  private readonly credentials: EncryptedCredentialStore;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly rootPath: string, options: MailServiceOptions = {}) {
    this.accountsPath = path.join(rootPath, "accounts.json");
    this.draftsPath = path.join(rootPath, "drafts.json");
    this.credentials = new EncryptedCredentialStore(rootPath);
    this.fetchImpl = options.fetch ?? fetch;
  }

  inferSetup(email: string) {
    return inferMailSetup(email);
  }

  async listAccounts(): Promise<MailAccountSummary[]> {
    return await this.loadAccounts();
  }

  async createAccount(input: MailAccountCreateInput): Promise<MailAccountSummary> {
    const email = normalizeEmail(input.email);
    if (!email || !email.includes("@")) {
      throw new Error("email is required.");
    }
    const setup = createSetupMetadata({ ...input, email });
    const timestamp = now();
    const account: MailAccountSummary = {
      id: randomUUID(),
      email,
      displayName: input.displayName?.trim() || email,
      providerId: setup.providerId,
      providerName: setup.providerName,
      authType: setup.authType,
      oauthProvider: setup.oauthProvider,
      incoming: mergeServer(setup.incoming, input.incoming),
      outgoing: mergeServer(setup.outgoing, input.outgoing),
      username: input.username?.trim() || email,
      status: "needs_auth",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const accounts = await this.loadAccounts();
    accounts.push(account);
    await this.saveAccounts(accounts);
    return account;
  }

  async savePasswordCredentials(input: MailPasswordCredentialsInput): Promise<MailAccountSummary> {
    const password = input.password.trim();
    if (!password) {
      throw new Error("password is required.");
    }
    const account = await this.requireAccount(input.accountId);
    const username = input.username?.trim() || account.username || account.email;
    await this.credentials.set(account.id, { kind: "password", username, password });
    return await this.patchAccount(account.id, {
      username,
      status: "connected",
      connectedAt: now(),
      lastError: undefined,
    });
  }

  async saveOAuthCredentials(input: MailOAuthCredentialsInput): Promise<MailAccountSummary> {
    if (!input.accessToken.trim()) {
      throw new Error("accessToken is required.");
    }
    const account = await this.requireAccount(input.accountId);
    if (account.authType !== "oauth") {
      throw new Error("Account is not configured for OAuth.");
    }
    await this.credentials.set(account.id, {
      kind: "oauth",
      accessToken: input.accessToken.trim(),
      refreshToken: input.refreshToken?.trim() || undefined,
      expiresAt: input.expiresAt,
      tokenType: input.tokenType,
      scope: input.scope,
      clientId: input.clientId?.trim() || undefined,
      clientSecret: input.clientSecret?.trim() || undefined,
    });
    return await this.patchAccount(account.id, {
      status: "connected",
      connectedAt: now(),
      lastError: undefined,
    });
  }

  async createOAuthAuthorization(input: MailOAuthAuthorizationInput): Promise<MailOAuthAuthorization> {
    const account = await this.requireAccount(input.accountId);
    if (!account.oauthProvider) {
      throw new Error("Account is not configured for OAuth.");
    }
    const scopes = getOAuthScopes(account.oauthProvider);
    const url =
      account.oauthProvider === "google"
        ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
        : new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.searchParams.set("client_id", input.clientId.trim());
    url.searchParams.set("redirect_uri", input.redirectUri.trim());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (input.state?.trim()) {
      url.searchParams.set("state", input.state.trim());
    }
    if (input.codeChallenge?.trim()) {
      url.searchParams.set("code_challenge", input.codeChallenge.trim());
      url.searchParams.set("code_challenge_method", input.codeChallengeMethod ?? "S256");
    }
    return {
      accountId: account.id,
      provider: account.oauthProvider,
      authorizationUrl: url.toString(),
      redirectUri: input.redirectUri,
      scopes,
    };
  }

  async exchangeOAuthCode(input: MailOAuthCodeExchangeInput): Promise<MailAccountSummary> {
    const account = await this.requireAccount(input.accountId);
    if (!account.oauthProvider) {
      throw new Error("Account is not configured for OAuth.");
    }
    const body = new URLSearchParams({
      client_id: input.clientId.trim(),
      code: input.code.trim(),
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri.trim(),
    });
    if (input.clientSecret?.trim()) {
      body.set("client_secret", input.clientSecret.trim());
    }
    const endpoint =
      account.oauthProvider === "google"
        ? "https://oauth2.googleapis.com/token"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    if (account.oauthProvider === "microsoft") {
      body.set("scope", getOAuthScopes("microsoft").join(" "));
    }
    const token = await jsonFetch<TokenResponse>(this.fetchImpl, endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!token.access_token) {
      throw new Error("OAuth provider did not return an access token.");
    }
    return await this.saveOAuthCredentials({
      accountId: account.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? now() + token.expires_in * 1000 : undefined,
      tokenType: token.token_type,
      scope: token.scope,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });
  }

  async disconnectAccount(accountId: string): Promise<MailAccountSummary[]> {
    await this.requireAccount(accountId);
    await this.credentials.remove(accountId);
    await this.patchAccount(accountId, {
      status: "needs_auth",
      connectedAt: undefined,
      lastError: undefined,
    });
    return await this.listAccounts();
  }

  async removeAccount(accountId: string): Promise<MailAccountSummary[]> {
    await this.credentials.remove(accountId);
    const accounts = (await this.loadAccounts()).filter((account) => account.id !== accountId);
    await this.saveAccounts(accounts);
    const drafts = (await this.loadDrafts()).filter((draft) => draft.accountId !== accountId);
    await this.saveDrafts(drafts);
    return accounts;
  }

  async createDraft(input: MailDraftCreateInput): Promise<MailDraft> {
    await this.requireAccount(input.accountId);
    const timestamp = now();
    const body = input.body.trim();
    if (!body) {
      throw new Error("body is required.");
    }
    const draft: MailDraft = {
      id: randomUUID(),
      accountId: input.accountId,
      to: requireAddressList(input.to, "to"),
      cc: (input.cc ?? []).map((item) => item.trim()).filter(Boolean),
      bcc: (input.bcc ?? []).map((item) => item.trim()).filter(Boolean),
      subject: input.subject.trim() || "(no subject)",
      body,
      preview: trimText(body, DRAFT_PREVIEW_LIMIT),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const drafts = await this.loadDrafts();
    drafts.unshift(draft);
    await this.saveDrafts(drafts);
    return draft;
  }

  async searchMessages(input: MailSearchInput): Promise<MailMessageSummary[]> {
    const account = await this.requireSelectedAccount(input.accountId);
    const credential = await this.requireCredential(account);
    const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT);
    if (credential.kind !== "oauth") {
      throw new Error("Searching password mailboxes is not available yet. OAuth Gmail and Outlook accounts are supported.");
    }
    const accessToken = await this.getAccessToken(account, credential);
    if (account.oauthProvider === "google") {
      return await this.searchGmail(account, accessToken, input.query ?? "", limit);
    }
    if (account.oauthProvider === "microsoft") {
      return await this.searchMicrosoft(account, accessToken, input.query ?? "", limit);
    }
    throw new Error("Unsupported OAuth provider.");
  }

  async readMessage(input: MailReadInput): Promise<MailMessage> {
    const account = await this.requireSelectedAccount(input.accountId);
    const credential = await this.requireCredential(account);
    if (credential.kind !== "oauth") {
      throw new Error("Reading password mailboxes is not available yet. OAuth Gmail and Outlook accounts are supported.");
    }
    const accessToken = await this.getAccessToken(account, credential);
    if (account.oauthProvider === "google") {
      return await this.readGmail(account, accessToken, input.messageId);
    }
    if (account.oauthProvider === "microsoft") {
      return await this.readMicrosoft(account, accessToken, input.messageId);
    }
    throw new Error("Unsupported OAuth provider.");
  }

  async sendDraft(input: MailSendDraftInput): Promise<MailSendResult> {
    const drafts = await this.loadDrafts();
    const draft = drafts.find((item) => item.id === input.draftId);
    if (!draft) {
      throw new Error("Draft not found.");
    }
    const account = await this.requireAccount(input.accountId?.trim() || draft.accountId);
    const credential = await this.requireCredential(account);
    const raw = buildRawMessage(account, draft);
    let messageId: string | undefined;

    if (credential.kind === "oauth") {
      const accessToken = await this.getAccessToken(account, credential);
      if (account.oauthProvider === "google") {
        messageId = await this.sendGmail(account, accessToken, raw);
      } else if (account.oauthProvider === "microsoft") {
        messageId = await this.sendMicrosoft(account, accessToken, draft);
      } else {
        throw new Error("Unsupported OAuth provider.");
      }
    } else {
      await this.sendSmtp(account, credential, raw, [...draft.to, ...draft.cc, ...draft.bcc]);
    }

    await this.saveDrafts(drafts.filter((item) => item.id !== draft.id));
    return {
      sent: true,
      accountId: account.id,
      draftId: draft.id,
      providerId: account.providerId,
      messageId,
    };
  }

  private async loadAccounts(): Promise<MailAccountSummary[]> {
    const accounts = await readJsonFile<MailAccountSummary[]>(this.accountsPath, []);
    return Array.isArray(accounts) ? accounts : [];
  }

  private async saveAccounts(accounts: MailAccountSummary[]) {
    await writeJsonFile(this.accountsPath, accounts);
  }

  private async loadDrafts(): Promise<MailDraft[]> {
    const drafts = await readJsonFile<MailDraft[]>(this.draftsPath, []);
    return Array.isArray(drafts) ? drafts : [];
  }

  private async saveDrafts(drafts: MailDraft[]) {
    await writeJsonFile(this.draftsPath, drafts);
  }

  private async requireAccount(accountId: string): Promise<MailAccountSummary> {
    const id = accountId.trim();
    const account = (await this.loadAccounts()).find((item) => item.id === id);
    if (!account) {
      throw new Error("Mail account not found.");
    }
    return account;
  }

  private async requireSelectedAccount(accountId?: string): Promise<MailAccountSummary> {
    const account = pickFirstAccount(await this.loadAccounts(), accountId);
    if (!account) {
      throw new Error("No mail account is configured.");
    }
    return account;
  }

  private async patchAccount(accountId: string, patch: Partial<MailAccountSummary>): Promise<MailAccountSummary> {
    const accounts = await this.loadAccounts();
    const index = accounts.findIndex((account) => account.id === accountId);
    if (index < 0) {
      throw new Error("Mail account not found.");
    }
    const next = {
      ...accounts[index],
      ...patch,
      updatedAt: now(),
    };
    accounts[index] = next;
    await this.saveAccounts(accounts);
    return next;
  }

  private async requireCredential(account: MailAccountSummary): Promise<MailCredential> {
    const credential = await this.credentials.get(account.id);
    if (!credential) {
      throw new Error(`Mail account ${account.email} is not authorized.`);
    }
    return credential;
  }

  private async getAccessToken(account: MailAccountSummary, credential: Extract<MailCredential, { kind: "oauth" }>) {
    if (!credential.expiresAt || credential.expiresAt > now() + 60_000) {
      return credential.accessToken;
    }
    if (!credential.refreshToken) {
      return credential.accessToken;
    }
    if (!account.oauthProvider) {
      return credential.accessToken;
    }
    const clientId = credential.clientId || process.env.SUPER_AGENTS_MAIL_OAUTH_CLIENT_ID || "";
    if (!clientId) {
      return credential.accessToken;
    }

    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token",
    });
    const clientSecret = credential.clientSecret || process.env.SUPER_AGENTS_MAIL_OAUTH_CLIENT_SECRET || "";
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }
    if (account.oauthProvider === "microsoft") {
      body.set("scope", getOAuthScopes("microsoft").join(" "));
    }
    const endpoint =
      account.oauthProvider === "google"
        ? "https://oauth2.googleapis.com/token"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    const token = await jsonFetch<TokenResponse>(this.fetchImpl, endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!token.access_token) {
      return credential.accessToken;
    }
    await this.credentials.set(account.id, {
      ...credential,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || credential.refreshToken,
      expiresAt: token.expires_in ? now() + token.expires_in * 1000 : credential.expiresAt,
      tokenType: token.token_type || credential.tokenType,
      scope: token.scope || credential.scope,
    });
    return token.access_token;
  }

  private async searchGmail(account: MailAccountSummary, accessToken: string, query: string, limit: number) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("maxResults", String(limit));
    if (query.trim()) {
      url.searchParams.set("q", query.trim());
    }
    const payload = await jsonFetch<{ messages?: Array<{ id?: string }> }>(this.fetchImpl, url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const messages = payload.messages ?? [];
    const summaries: MailMessageSummary[] = [];
    for (const item of messages.slice(0, limit)) {
      if (!item.id) continue;
      const message = await jsonFetch<any>(
        this.fetchImpl,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
      summaries.push({
        id: String(message.id ?? item.id),
        accountId: account.id,
        subject: headerValue(headers, "Subject") || "(no subject)",
        from: headerValue(headers, "From"),
        to: headerValue(headers, "To").split(",").map((address) => address.trim()).filter(Boolean),
        date: headerValue(headers, "Date") || undefined,
        snippet: trimText(String(message.snippet ?? ""), MESSAGE_SNIPPET_LIMIT),
        unread: Array.isArray(message.labelIds) ? message.labelIds.includes("UNREAD") : undefined,
      });
    }
    return summaries;
  }

  private async readGmail(account: MailAccountSummary, accessToken: string, messageId: string): Promise<MailMessage> {
    const message = await jsonFetch<any>(
      this.fetchImpl,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
    const body = collectGmailBody(message?.payload);
    return {
      id: String(message.id ?? messageId),
      accountId: account.id,
      subject: headerValue(headers, "Subject") || "(no subject)",
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To").split(",").map((address) => address.trim()).filter(Boolean),
      cc: headerValue(headers, "Cc").split(",").map((address) => address.trim()).filter(Boolean),
      date: headerValue(headers, "Date") || undefined,
      snippet: trimText(String(message.snippet ?? ""), MESSAGE_SNIPPET_LIMIT),
      unread: Array.isArray(message.labelIds) ? message.labelIds.includes("UNREAD") : undefined,
      body: trimText(body.text || stripHtml(body.html || "")),
      html: body.html || undefined,
    };
  }

  private async sendGmail(_account: MailAccountSummary, accessToken: string, raw: string) {
    const payload = await jsonFetch<{ id?: string }>(this.fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(raw) }),
    });
    return payload.id;
  }

  private async searchMicrosoft(account: MailAccountSummary, accessToken: string, query: string, limit: number) {
    const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    url.searchParams.set("$top", String(limit));
    url.searchParams.set("$select", "id,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead");
    url.searchParams.set("$orderby", "receivedDateTime desc");
    if (query.trim()) {
      url.searchParams.set("$search", `"${query.trim().replace(/"/g, '\\"')}"`);
    }
    const payload = await jsonFetch<{ value?: any[] }>(this.fetchImpl, url.toString(), {
      headers: {
        authorization: `Bearer ${accessToken}`,
        consistencyLevel: "eventual",
      },
    });
    return (payload.value ?? []).map((item) => normalizeGraphMessage(account.id, item)).filter((item) => item.id);
  }

  private async readMicrosoft(account: MailAccountSummary, accessToken: string, messageId: string): Promise<MailMessage> {
    const payload = await jsonFetch<any>(
      this.fetchImpl,
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,body`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    const summary = normalizeGraphMessage(account.id, payload);
    const html = String(payload?.body?.content ?? "");
    const isHtml = String(payload?.body?.contentType ?? "").toLowerCase() === "html";
    return {
      ...summary,
      body: trimText(isHtml ? stripHtml(html) : html),
      html: isHtml ? html : undefined,
    };
  }

  private async sendMicrosoft(_account: MailAccountSummary, accessToken: string, draft: MailDraft) {
    await jsonFetch<Record<string, never>>(this.fetchImpl, "https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: draft.subject,
          body: { contentType: "Text", content: draft.body },
          toRecipients: draft.to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: draft.cc.map((address) => ({ emailAddress: { address } })),
          bccRecipients: draft.bcc.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
    return undefined;
  }

  private async sendSmtp(
    account: MailAccountSummary,
    credential: Extract<MailCredential, { kind: "password" }>,
    raw: string,
    recipients: string[],
  ) {
    if (!account.outgoing.secure || account.outgoing.port !== 465) {
      throw new Error("SMTP sending currently requires an SSL/TLS SMTP server on port 465.");
    }
    await sendSmtpOverTls({
      host: account.outgoing.host,
      port: account.outgoing.port,
      username: credential.username,
      password: credential.password,
      from: account.email,
      recipients,
      raw,
    });
  }
}

interface SmtpSendInput {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  recipients: string[];
  raw: string;
}

async function sendSmtpOverTls(input: SmtpSendInput) {
  const socket = await new Promise<TLSSocket>((resolve, reject) => {
    const client = connectTls(input.port, input.host, { servername: input.host }, () => resolve(client));
    client.once("error", reject);
  });

  let buffer = "";
  const waitFor = (expected: number[]) =>
    new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines.at(-1);
        if (!last || !/^\d{3}\s/.test(last)) {
          return;
        }
        socket.off("data", onData);
        const code = Number(last.slice(0, 3));
        const response = buffer;
        buffer = "";
        if (expected.includes(code)) {
          resolve(response);
        } else {
          reject(new Error(`SMTP server returned ${code}: ${last}`));
        }
      };
      socket.on("data", onData);
      socket.once("error", reject);
    });

  const command = async (line: string, expected: number[]) => {
    socket.write(`${line}\r\n`);
    return await waitFor(expected);
  };

  try {
    await waitFor([220]);
    await command("EHLO super-agents.local", [250]);
    await command("AUTH LOGIN", [334]);
    await command(Buffer.from(input.username, "utf8").toString("base64"), [334]);
    await command(Buffer.from(input.password, "utf8").toString("base64"), [235]);
    await command(`MAIL FROM:<${input.from}>`, [250]);
    for (const recipient of input.recipients) {
      await command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await command("DATA", [354]);
    socket.write(`${input.raw.replace(/^\./gm, "..")}\r\n.\r\n`);
    await waitFor([250]);
    await command("QUIT", [221]);
  } finally {
    socket.end();
  }
}
