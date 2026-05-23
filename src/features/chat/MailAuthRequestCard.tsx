import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, LoaderCircle, Mail, ShieldCheck, X } from "lucide-react";

import { workspaceClient } from "../../services/workspace-client";
import type {
  DesktopApprovalRequest,
  DesktopApprovalResponse,
  MailAccountSummary,
  MailProviderSetup,
  MailServerConfig,
} from "../../types";

interface ServerDraft {
  incomingHost: string;
  incomingPort: string;
  incomingSecure: boolean;
  outgoingHost: string;
  outgoingPort: string;
  outgoingSecure: boolean;
}

interface MailAuthRequestCardProps {
  request: DesktopApprovalRequest;
  onResolve: (response: DesktopApprovalResponse) => void | Promise<void>;
  onToast: (message: string) => void;
}

function serverDraftFromSetup(setup: MailProviderSetup | null): ServerDraft {
  return {
    incomingHost: setup?.incoming.host ?? "",
    incomingPort: String(setup?.incoming.port ?? 993),
    incomingSecure: setup?.incoming.secure ?? true,
    outgoingHost: setup?.outgoing.host ?? "",
    outgoingPort: String(setup?.outgoing.port ?? 465),
    outgoingSecure: setup?.outgoing.secure ?? true,
  };
}

function serverFromDraft(kind: "incoming" | "outgoing", draft: ServerDraft): Partial<MailServerConfig> {
  const host = kind === "incoming" ? draft.incomingHost : draft.outgoingHost;
  const port = Number.parseInt(kind === "incoming" ? draft.incomingPort : draft.outgoingPort, 10);
  const secure = kind === "incoming" ? draft.incomingSecure : draft.outgoingSecure;
  return {
    host: host.trim(),
    port: Number.isFinite(port) ? port : kind === "incoming" ? 993 : 465,
    secure,
  };
}

function providerPlaceholder(provider?: string) {
  if (provider === "qq") return "name@qq.com";
  if (provider === "gmail") return "name@gmail.com";
  if (provider === "microsoft") return "name@outlook.com";
  return "name@example.com";
}

function connectedMetadata(account: MailAccountSummary): DesktopApprovalResponse["decision"] {
  return {
    type: "allow",
    metadata: {
      accountId: account.id,
      email: account.email,
      providerId: account.providerId,
      providerName: account.providerName,
      authType: account.authType,
      status: account.status,
    },
  };
}

export function MailAuthRequestCard({ request, onResolve, onToast }: MailAuthRequestCardProps) {
  const initialSetup = request.metadata.setup ?? null;
  const [email, setEmail] = useState(request.metadata.email ?? "");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState(request.metadata.email ?? "");
  const [secret, setSecret] = useState("");
  const [secretVisible, setSecretVisible] = useState(false);
  const [setup, setSetup] = useState<MailProviderSetup | null>(initialSetup);
  const [serverDraft, setServerDraft] = useState<ServerDraft>(() => serverDraftFromSetup(initialSetup));
  const [moreOpen, setMoreOpen] = useState(Boolean(initialSetup?.advancedRequired));
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://localhost");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthAccountId, setOauthAccountId] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const emailReady = email.trim().includes("@");
  const currentAuthType = setup?.authType ?? request.metadata.authType ?? "password";
  const providerName = setup?.providerName ?? request.metadata.providerName ?? "邮箱";
  const showMoreSettings = moreOpen || Boolean(setup?.advancedRequired);
  const showServerSettings = Boolean(setup?.advancedRequired);
  const isQqMail = (setup?.providerId ?? request.metadata.provider) === "qq" || email.trim().toLowerCase().endsWith("@qq.com");
  const placeholder = providerPlaceholder(request.metadata.provider);
  const secretLabel = isQqMail ? "授权码" : "授权码 / 应用专用密码";

  useEffect(() => {
    if (!emailReady) {
      setSetup(null);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const nextSetup = await workspaceClient.inferMailSetup(email);
        if (cancelled) return;
        setSetup(nextSetup);
        setServerDraft(serverDraftFromSetup(nextSetup));
        setMoreOpen(nextSetup.advancedRequired);
        setUsername(nextSetup.email);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "邮箱配置识别失败");
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [email, emailReady]);

  async function resolve(response: DesktopApprovalResponse) {
    await onResolve(response);
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function requireSetup() {
    if (!emailReady) {
      throw new Error("请先填写邮箱地址");
    }
    if (setup) {
      return setup;
    }
    const nextSetup = await workspaceClient.inferMailSetup(email);
    setSetup(nextSetup);
    setServerDraft(serverDraftFromSetup(nextSetup));
    setMoreOpen(nextSetup.advancedRequired);
    return nextSetup;
  }

  async function savePasswordAccount() {
    await runAction(async () => {
      const activeSetup = await requireSetup();
      if (activeSetup.authType === "oauth") {
        throw new Error("这个邮箱服务商建议使用 OAuth 授权");
      }
      if (!secret.trim()) {
        throw new Error("请填写授权码或应用专用密码");
      }

      const accountUsername = showMoreSettings && username.trim() ? username.trim() : activeSetup.email;
      const account = await workspaceClient.createMailAccount({
        email,
        displayName: showMoreSettings && displayName.trim() ? displayName.trim() : undefined,
        authType: "password",
        username: accountUsername,
        incoming: activeSetup.advancedRequired ? serverFromDraft("incoming", serverDraft) : undefined,
        outgoing: activeSetup.advancedRequired ? serverFromDraft("outgoing", serverDraft) : undefined,
      });
      const connected = await workspaceClient.saveMailPasswordCredentials({
        accountId: account.id,
        username: accountUsername || account.email,
        password: secret,
      });

      setSecret("");
      await resolve({
        approvalId: request.approvalId,
        decision: connectedMetadata(connected),
      });
      onToast(`${connected.providerName} 已连接`);
    });
  }

  async function startOAuth() {
    await runAction(async () => {
      const activeSetup = await requireSetup();
      if (activeSetup.authType !== "oauth") {
        throw new Error("这个邮箱服务商不需要 OAuth");
      }
      if (!clientId.trim()) {
        throw new Error("请填写 OAuth Client ID");
      }

      const account = await workspaceClient.createMailAccount({
        email,
        displayName: showMoreSettings && displayName.trim() ? displayName.trim() : undefined,
        authType: "oauth",
        username: showMoreSettings && username.trim() ? username.trim() : activeSetup.email,
      });
      const authorization = await workspaceClient.createMailOAuthAuthorization({
        accountId: account.id,
        clientId,
        clientSecret,
        redirectUri,
      });

      setOauthAccountId(account.id);
      setOauthUrl(authorization.authorizationUrl);
      await workspaceClient.openPreviewTarget({ url: authorization.authorizationUrl });
    });
  }

  async function finishOAuth() {
    await runAction(async () => {
      if (!oauthAccountId) {
        throw new Error("请先生成授权链接");
      }
      if (!oauthCode.trim()) {
        throw new Error("请填写回调地址中的 code");
      }
      const connected = await workspaceClient.exchangeMailOAuthCode({
        accountId: oauthAccountId,
        clientId,
        clientSecret,
        redirectUri,
        code: oauthCode,
      });

      setClientSecret("");
      setOauthCode("");
      await resolve({
        approvalId: request.approvalId,
        decision: connectedMetadata(connected),
      });
      onToast(`${connected.providerName} 已连接`);
    });
  }

  async function cancel() {
    setSecret("");
    setClientSecret("");
    setOauthCode("");
    await resolve({
      approvalId: request.approvalId,
      decision: { type: "deny", reason: "User cancelled mail authorization." },
    });
  }

  return (
    <article className="mail-auth-request-card" data-approval-id={request.approvalId}>
      <header className="mail-auth-request-head">
        <div className="mail-auth-request-icon">
          <Mail size={18} />
        </div>
        <div className="mail-auth-request-title">
          <strong>连接 {providerName}</strong>
          <span>{currentAuthType === "oauth" ? "OAuth" : "IMAP/SMTP"}</span>
        </div>
        <button className="mail-auth-request-close" disabled={busy} onClick={() => void cancel()} title="取消" type="button">
          <X size={16} />
        </button>
      </header>

      {currentAuthType === "oauth" ? (
        <div className="mail-auth-request-section">
          <div className="mail-auth-request-grid">
            <label>
              <span>邮箱地址</span>
              <input
                autoComplete="email"
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={placeholder}
                value={email}
              />
            </label>
            <label>
              <span>OAuth Client ID</span>
              <input disabled={busy} onChange={(event) => setClientId(event.target.value)} value={clientId} />
            </label>
            <label>
              <span>Client Secret</span>
              <input
                disabled={busy}
                onChange={(event) => setClientSecret(event.target.value)}
                type="password"
                value={clientSecret}
              />
            </label>
            <label>
              <span>Redirect URI</span>
              <input disabled={busy} onChange={(event) => setRedirectUri(event.target.value)} value={redirectUri} />
            </label>
          </div>
          <button className="mail-auth-secondary-action" disabled={busy || !emailReady} onClick={() => void startOAuth()} type="button">
            {busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
            打开 OAuth 授权
          </button>
          {oauthUrl ? (
            <div className="mail-auth-oauth-finish">
              <label>
                <span>回调 code</span>
                <input disabled={busy} onChange={(event) => setOauthCode(event.target.value)} value={oauthCode} />
              </label>
              <button className="mail-auth-primary-action" disabled={busy || !oauthCode.trim()} onClick={() => void finishOAuth()} type="button">
                {busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
                保存 OAuth 授权
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <form
          className="mail-auth-request-section"
          onSubmit={(event) => {
            event.preventDefault();
            void savePasswordAccount();
          }}
        >
          <div className="mail-auth-request-grid">
            <label>
              <span>邮箱地址</span>
              <input
                autoComplete="email"
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={placeholder}
                value={email}
              />
            </label>
            <label>
              <span>{secretLabel}</span>
              <div className="mail-auth-secret-field">
                <input
                  autoComplete="current-password"
                  disabled={busy}
                  onChange={(event) => setSecret(event.target.value)}
                  type={secretVisible ? "text" : "password"}
                  value={secret}
                />
                <button
                  aria-label={secretVisible ? "隐藏授权码" : "显示授权码"}
                  disabled={busy}
                  onClick={() => setSecretVisible((value) => !value)}
                  type="button"
                >
                  {secretVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
          </div>

          {!showServerSettings ? (
            <button className="mail-auth-advanced-toggle" onClick={() => setMoreOpen((value) => !value)} type="button">
              {showMoreSettings ? "收起更多设置" : "更多设置"}
            </button>
          ) : null}

          {showMoreSettings ? (
            <div className="mail-auth-request-grid mail-auth-optional-grid">
              <label>
                <span>显示名</span>
                <input
                  disabled={busy}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="可选"
                  value={displayName}
                />
              </label>
              <label>
                <span>登录名</span>
                <input
                  autoComplete="username"
                  disabled={busy}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="默认同邮箱"
                  value={username}
                />
              </label>
            </div>
          ) : null}

          {showServerSettings ? (
            <div className="mail-auth-server-grid">
              <label>
                <span>IMAP Host</span>
                <input value={serverDraft.incomingHost} onChange={(event) => setServerDraft({ ...serverDraft, incomingHost: event.target.value })} />
              </label>
              <label>
                <span>IMAP Port</span>
                <input value={serverDraft.incomingPort} onChange={(event) => setServerDraft({ ...serverDraft, incomingPort: event.target.value })} />
              </label>
              <label className="mail-auth-checkbox">
                <input checked={serverDraft.incomingSecure} onChange={(event) => setServerDraft({ ...serverDraft, incomingSecure: event.target.checked })} type="checkbox" />
                SSL/TLS
              </label>
              <label>
                <span>SMTP Host</span>
                <input value={serverDraft.outgoingHost} onChange={(event) => setServerDraft({ ...serverDraft, outgoingHost: event.target.value })} />
              </label>
              <label>
                <span>SMTP Port</span>
                <input value={serverDraft.outgoingPort} onChange={(event) => setServerDraft({ ...serverDraft, outgoingPort: event.target.value })} />
              </label>
              <label className="mail-auth-checkbox">
                <input checked={serverDraft.outgoingSecure} onChange={(event) => setServerDraft({ ...serverDraft, outgoingSecure: event.target.checked })} type="checkbox" />
                SSL/TLS
              </label>
            </div>
          ) : null}

          <div className="mail-auth-request-actions">
            <button className="mail-auth-secondary-action" disabled={busy} onClick={() => void cancel()} type="button">
              取消
            </button>
            <button className="mail-auth-primary-action" disabled={busy || !emailReady || !secret.trim()} type="submit">
              {busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
              保存并连接
            </button>
          </div>
        </form>
      )}

      {error ? <p className="mail-auth-request-error">{error}</p> : null}
    </article>
  );
}
