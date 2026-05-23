import type { MailAuthType, MailOAuthProvider, MailProviderSetup, MailServerConfig } from "./types";

interface ProviderPreset {
  providerId: string;
  providerName: string;
  domains: string[];
  authType: MailAuthType;
  oauthProvider?: MailOAuthProvider;
  incoming: MailServerConfig;
  outgoing: MailServerConfig;
  helpText?: string;
}

const PRESETS: ProviderPreset[] = [
  {
    providerId: "gmail",
    providerName: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    authType: "oauth",
    oauthProvider: "google",
    incoming: { host: "imap.gmail.com", port: 993, secure: true },
    outgoing: { host: "smtp.gmail.com", port: 465, secure: true },
    helpText: "Use Google OAuth when possible. App passwords are not used by default.",
  },
  {
    providerId: "microsoft",
    providerName: "Microsoft Outlook",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com", "office365.com", "microsoft.com"],
    authType: "oauth",
    oauthProvider: "microsoft",
    incoming: { host: "outlook.office365.com", port: 993, secure: true },
    outgoing: { host: "smtp.office365.com", port: 587, secure: true },
    helpText: "Use Microsoft OAuth for Outlook, Hotmail, Live, and Microsoft 365 accounts.",
  },
  {
    providerId: "qq",
    providerName: "QQ Mail",
    domains: ["qq.com"],
    authType: "password",
    incoming: { host: "imap.qq.com", port: 993, secure: true },
    outgoing: { host: "smtp.qq.com", port: 465, secure: true },
    helpText: "Use an app password or authorization code from QQ Mail settings.",
  },
  {
    providerId: "netease-163",
    providerName: "NetEase 163",
    domains: ["163.com"],
    authType: "password",
    incoming: { host: "imap.163.com", port: 993, secure: true },
    outgoing: { host: "smtp.163.com", port: 465, secure: true },
    helpText: "Use a mailbox authorization code instead of the login password.",
  },
  {
    providerId: "netease-126",
    providerName: "NetEase 126",
    domains: ["126.com"],
    authType: "password",
    incoming: { host: "imap.126.com", port: 993, secure: true },
    outgoing: { host: "smtp.126.com", port: 465, secure: true },
    helpText: "Use a mailbox authorization code instead of the login password.",
  },
  {
    providerId: "netease-yeah",
    providerName: "NetEase Yeah",
    domains: ["yeah.net"],
    authType: "password",
    incoming: { host: "imap.yeah.net", port: 993, secure: true },
    outgoing: { host: "smtp.yeah.net", port: 465, secure: true },
  },
  {
    providerId: "icloud",
    providerName: "iCloud Mail",
    domains: ["icloud.com", "me.com", "mac.com"],
    authType: "password",
    incoming: { host: "imap.mail.me.com", port: 993, secure: true },
    outgoing: { host: "smtp.mail.me.com", port: 587, secure: true },
    helpText: "Use an app-specific password from Apple ID settings.",
  },
  {
    providerId: "yahoo",
    providerName: "Yahoo Mail",
    domains: ["yahoo.com", "ymail.com"],
    authType: "password",
    incoming: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    outgoing: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    helpText: "Use an app password from Yahoo account security settings.",
  },
  {
    providerId: "fastmail",
    providerName: "Fastmail",
    domains: ["fastmail.com", "fastmail.fm"],
    authType: "password",
    incoming: { host: "imap.fastmail.com", port: 993, secure: true },
    outgoing: { host: "smtp.fastmail.com", port: 465, secure: true },
    helpText: "Use an app password from Fastmail settings.",
  },
  {
    providerId: "sina",
    providerName: "Sina Mail",
    domains: ["sina.com", "sina.cn"],
    authType: "password",
    incoming: { host: "imap.sina.com", port: 993, secure: true },
    outgoing: { host: "smtp.sina.com", port: 465, secure: true },
  },
  {
    providerId: "sohu",
    providerName: "Sohu Mail",
    domains: ["sohu.com"],
    authType: "password",
    incoming: { host: "imap.sohu.com", port: 993, secure: true },
    outgoing: { host: "smtp.sohu.com", port: 465, secure: true },
  },
];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function domainFromEmail(email: string) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
}

function cloneServer(server: MailServerConfig): MailServerConfig {
  return { host: server.host, port: server.port, secure: server.secure };
}

export function inferMailSetup(email: string): MailProviderSetup {
  const normalizedEmail = normalizeEmail(email);
  const domain = domainFromEmail(normalizedEmail);
  const preset = PRESETS.find((item) => item.domains.includes(domain));
  if (preset) {
    return {
      email: normalizedEmail,
      domain,
      providerId: preset.providerId,
      providerName: preset.providerName,
      authType: preset.authType,
      oauthProvider: preset.oauthProvider,
      incoming: cloneServer(preset.incoming),
      outgoing: cloneServer(preset.outgoing),
      advancedRequired: false,
      helpText: preset.helpText,
    };
  }

  const safeDomain = domain || "example.com";
  return {
    email: normalizedEmail,
    domain,
    providerId: "custom",
    providerName: "Custom IMAP/SMTP",
    authType: "password",
    incoming: { host: `imap.${safeDomain}`, port: 993, secure: true },
    outgoing: { host: `smtp.${safeDomain}`, port: 465, secure: true },
    advancedRequired: true,
    helpText: "Review the inferred host names before saving a custom mailbox.",
  };
}

export function getOAuthScopes(provider: MailOAuthProvider) {
  if (provider === "google") {
    return [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/userinfo.email",
    ];
  }

  return ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"];
}
