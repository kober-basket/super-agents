import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Mail, Plus, Trash2, Unplug } from "lucide-react";

import type { MailAccountSummary, MailProviderSetup, MailServerConfig } from "../../types";
import { workspaceClient } from "../../services/workspace-client";

interface ServerDraft {
  incomingHost: string;
  incomingPort: string;
  incomingSecure: boolean;
  outgoingHost: string;
  outgoingPort: string;
  outgoingSecure: boolean;
}

function statusLabel(status: MailAccountSummary["status"]) {
  if (status === "connected") return "已连接";
  if (status === "error") return "异常";
  return "待授权";
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

export function MailSettings() {
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<MailProviderSetup | null>(null);
  const [serverDraft, setServerDraft] = useState<ServerDraft>(() => serverDraftFromSetup(null));
  const [moreOpen, setMoreOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://localhost");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthAccountId, setOauthAccountId] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const emailReady = email.trim().includes("@");
  const currentAuthType = setup?.authType ?? "password";
  const showMoreSettings = moreOpen || Boolean(setup?.advancedRequired);
  const showServerSettings = Boolean(setup?.advancedRequired);

  useEffect(() => {
    void refreshAccounts();
  }, []);

  useEffect(() => {
    if (!emailReady) {
      setSetup(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const nextSetup = await workspaceClient.inferMailSetup(email);
        if (cancelled) return;
        setSetup(nextSetup);
        setUsername(nextSetup.email);
        setServerDraft(serverDraftFromSetup(nextSetup));
        setMoreOpen(nextSetup.advancedRequired);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [email, emailReady]);

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const oauthAccount = oauthAccountId ? accountById.get(oauthAccountId) ?? null : null;

  async function refreshAccounts() {
    setAccounts(await workspaceClient.listMailAccounts());
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function savePasswordAccount() {
    await runAction(async () => {
      if (!setup) throw new Error("请先填写邮箱地址");
      const accountUsername = showMoreSettings && username.trim() ? username.trim() : setup.email;
      const account = await workspaceClient.createMailAccount({
        email,
        displayName: showMoreSettings && displayName.trim() ? displayName.trim() : undefined,
        authType: "password",
        username: accountUsername,
        incoming: setup.advancedRequired ? serverFromDraft("incoming", serverDraft) : undefined,
        outgoing: setup.advancedRequired ? serverFromDraft("outgoing", serverDraft) : undefined,
      });
      await workspaceClient.saveMailPasswordCredentials({
        accountId: account.id,
        username: accountUsername || account.email,
        password,
      });
      setMessage("邮箱账号已保存");
      setPassword("");
      await refreshAccounts();
    });
  }

  async function startOAuth() {
    await runAction(async () => {
      if (!setup) throw new Error("请先填写邮箱地址");
      if (!clientId.trim()) throw new Error("请填写 OAuth Client ID");
      const account = await workspaceClient.createMailAccount({
        email,
        displayName: showMoreSettings && displayName.trim() ? displayName.trim() : undefined,
        authType: "oauth",
        username: showMoreSettings && username.trim() ? username.trim() : setup.email,
      });
      const authorization = await workspaceClient.createMailOAuthAuthorization({
        accountId: account.id,
        clientId,
        clientSecret,
        redirectUri,
      });
      setOauthAccountId(account.id);
      setOauthUrl(authorization.authorizationUrl);
      setMessage("已生成授权链接");
      await workspaceClient.openPreviewTarget({ url: authorization.authorizationUrl });
      await refreshAccounts();
    });
  }

  async function finishOAuth() {
    await runAction(async () => {
      if (!oauthAccountId) throw new Error("请先生成授权链接");
      if (!oauthCode.trim()) throw new Error("请粘贴回调中的 code");
      await workspaceClient.exchangeMailOAuthCode({
        accountId: oauthAccountId,
        clientId,
        clientSecret,
        redirectUri,
        code: oauthCode,
      });
      setOauthCode("");
      setOauthUrl("");
      setOauthAccountId("");
      setMessage("OAuth 授权已保存");
      await refreshAccounts();
    });
  }

  async function disconnect(accountId: string) {
    await runAction(async () => {
      setAccounts(await workspaceClient.disconnectMailAccount(accountId));
      setMessage("账号已断开");
    });
  }

  async function remove(accountId: string) {
    await runAction(async () => {
      setAccounts(await workspaceClient.removeMailAccount(accountId));
      setMessage("账号已移除");
    });
  }

  return (
    <section className="settings-stage mail-settings-stage">
      <header className="settings-stage-header">
        <div className="settings-stage-heading">
          <h1>邮件</h1>
        </div>
      </header>

      <div className="mail-settings-layout">
        <article className="panel-card form-card mail-account-list">
          <div className="settings-block-head">
            <h3>已连接账号</h3>
          </div>
          {accounts.length === 0 ? (
            <p className="field-note">还没有邮箱账号。</p>
          ) : (
            <div className="mail-account-stack">
              {accounts.map((account) => (
                <div className="mail-account-row" key={account.id}>
                  <div className="mail-account-icon">
                    <Mail size={18} />
                  </div>
                  <div className="mail-account-copy">
                    <strong>{account.displayName}</strong>
                    <span>{account.email}</span>
                    <small>{account.providerName} · {account.authType === "oauth" ? "OAuth" : "密码/授权码"}</small>
                  </div>
                  <span className={`mail-status-pill tone-${account.status}`}>{statusLabel(account.status)}</span>
                  <div className="mail-account-actions">
                    <button className="secondary-button" disabled={busy} onClick={() => void disconnect(account.id)} type="button">
                      <Unplug size={15} />
                      断开
                    </button>
                    <button className="secondary-button danger" disabled={busy} onClick={() => void remove(account.id)} type="button">
                      <Trash2 size={15} />
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel-card form-card mail-auth-card">
          <div className="settings-block-head">
            <h3>添加邮箱</h3>
          </div>

          <div className="provider-form-grid mail-form-grid">
            <label>
              <span>邮箱地址</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
            </label>
          </div>

          {currentAuthType === "oauth" ? (
            <div className="mail-auth-section">
              <div className="provider-form-grid mail-form-grid">
                <label>
                  <span>OAuth Client ID</span>
                  <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="来自 Google/Microsoft 应用" />
                </label>
                <label>
                  <span>Client Secret</span>
                  <input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="可选，按应用类型填写" type="password" />
                </label>
                <label>
                  <span>Redirect URI</span>
                  <input value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} />
                </label>
              </div>
              <div className="mail-action-row">
                <button className="primary-button" disabled={busy || !emailReady} onClick={() => void startOAuth()} type="button">
                  <ExternalLink size={16} />
                  生成并打开授权链接
                </button>
              </div>
              {oauthUrl ? (
                <div className="mail-oauth-callback">
                  <label>
                    <span>授权 code</span>
                    <input value={oauthCode} onChange={(event) => setOauthCode(event.target.value)} placeholder={oauthAccount?.email ?? oauthAccountId} />
                  </label>
                  <button className="primary-button" disabled={busy || !oauthCode.trim()} onClick={() => void finishOAuth()} type="button">
                    保存 OAuth 授权
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mail-auth-section">
              <div className="provider-form-grid mail-form-grid">
                <label>
                  <span>密码 / 授权码</span>
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
                </label>
              </div>

              {!showServerSettings ? (
                <button className="ghost-text-button mail-advanced-toggle" onClick={() => setMoreOpen((value) => !value)} type="button">
                  {showMoreSettings ? "收起更多设置" : "更多设置"}
                </button>
              ) : null}

              {showMoreSettings ? (
                <div className="provider-form-grid mail-form-grid mail-optional-grid">
                  <label>
                    <span>显示名</span>
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="可选" />
                  </label>
                  <label>
                    <span>登录名</span>
                    <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="默认同邮箱" />
                  </label>
                </div>
              ) : null}

              {showServerSettings ? (
                <div className="mail-server-grid">
                  <label>
                    <span>IMAP Host</span>
                    <input value={serverDraft.incomingHost} onChange={(event) => setServerDraft({ ...serverDraft, incomingHost: event.target.value })} />
                  </label>
                  <label>
                    <span>IMAP Port</span>
                    <input value={serverDraft.incomingPort} onChange={(event) => setServerDraft({ ...serverDraft, incomingPort: event.target.value })} />
                  </label>
                  <label className="mail-checkbox-label">
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
                  <label className="mail-checkbox-label">
                    <input checked={serverDraft.outgoingSecure} onChange={(event) => setServerDraft({ ...serverDraft, outgoingSecure: event.target.checked })} type="checkbox" />
                    SSL/TLS
                  </label>
                </div>
              ) : null}

              <div className="mail-action-row">
                <button className="primary-button" disabled={busy || !emailReady || !password.trim()} onClick={() => void savePasswordAccount()} type="button">
                  <Plus size={16} />
                  保存账号
                </button>
              </div>
            </div>
          )}

          {error ? <p className="provider-inline-error">{error}</p> : null}
          {message ? <p className="mail-inline-success">{message}</p> : null}
        </article>
      </div>
    </section>
  );
}
