export type MailAuthType = "oauth" | "password";
export type MailOAuthProvider = "google" | "microsoft";
export type MailAccountStatus = "needs_auth" | "connected" | "error";

export interface MailServerConfig {
  host: string;
  port: number;
  secure: boolean;
}

export interface MailProviderSetup {
  email: string;
  domain: string;
  providerId: string;
  providerName: string;
  authType: MailAuthType;
  oauthProvider?: MailOAuthProvider;
  incoming: MailServerConfig;
  outgoing: MailServerConfig;
  advancedRequired: boolean;
  helpText?: string;
}

export interface MailAccountSummary {
  id: string;
  email: string;
  displayName: string;
  providerId: string;
  providerName: string;
  authType: MailAuthType;
  oauthProvider?: MailOAuthProvider;
  incoming: MailServerConfig;
  outgoing: MailServerConfig;
  username: string;
  status: MailAccountStatus;
  createdAt: number;
  updatedAt: number;
  connectedAt?: number;
  lastError?: string;
}

export interface MailAccountCreateInput {
  email: string;
  displayName?: string;
  authType?: MailAuthType;
  incoming?: Partial<MailServerConfig>;
  outgoing?: Partial<MailServerConfig>;
  username?: string;
}

export interface MailPasswordCredentialsInput {
  accountId: string;
  username?: string;
  password: string;
}

export interface MailOAuthCredentialsInput {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  clientId?: string;
  clientSecret?: string;
}

export type MailCredential =
  | {
      kind: "password";
      username: string;
      password: string;
    }
  | {
      kind: "oauth";
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      tokenType?: string;
      scope?: string;
      clientId?: string;
      clientSecret?: string;
    };

export interface MailOAuthAuthorizationInput {
  accountId: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "plain" | "S256";
}

export interface MailOAuthAuthorization {
  accountId: string;
  provider: MailOAuthProvider;
  authorizationUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface MailOAuthCodeExchangeInput extends MailOAuthAuthorizationInput {
  code: string;
}

export interface MailMessageSummary {
  id: string;
  accountId: string;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  date?: string;
  snippet: string;
  unread?: boolean;
}

export interface MailMessage extends MailMessageSummary {
  body: string;
  html?: string;
}

export interface MailSearchInput {
  accountId?: string;
  query?: string;
  limit?: number;
}

export interface MailReadInput {
  accountId?: string;
  messageId: string;
}

export interface MailDraftCreateInput {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

export interface MailDraft {
  id: string;
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

export interface MailSendDraftInput {
  draftId: string;
  accountId?: string;
}

export interface MailSendResult {
  sent: boolean;
  accountId: string;
  draftId: string;
  providerId: string;
  messageId?: string;
}
