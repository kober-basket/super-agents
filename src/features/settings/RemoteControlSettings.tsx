import type { ReactNode } from "react";
import clsx from "clsx";
import { LoaderCircle, QrCode, RefreshCw, Unplug } from "lucide-react";

import type {
  RemoteChannelRuntimeStatus,
  RemoteControlConfig,
  RemoteControlStatus,
  WechatRemoteRuntimeStatus,
} from "../../types";

interface RemoteControlSettingsProps {
  remoteControl: RemoteControlConfig;
  remoteStatus: RemoteControlStatus | null;
  refreshing: boolean;
  wechatConnecting: boolean;
  onRefresh: (options?: { silent?: boolean }) => Promise<void>;
  onToggleWechatEnabled: (enabled: boolean) => void;
  onStartWechatLogin: () => Promise<void>;
  onDisconnectWechat: () => Promise<void>;
  onUpdateDingtalk?: (
    patch: Partial<RemoteControlConfig["dingtalk"]>,
    options?: { immediate?: boolean },
  ) => void;
  onUpdateFeishu?: (
    patch: Partial<RemoteControlConfig["feishu"]>,
    options?: { immediate?: boolean },
  ) => void;
  onUpdateWecom?: (
    patch: Partial<RemoteControlConfig["wecom"]>,
    options?: { immediate?: boolean },
  ) => void;
}

function formatTime(timestamp?: number | null) {
  if (!timestamp) return "Not available";

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  } catch {
    return "Not available";
  }
}

function maskValue(value: string, keep = 4) {
  const trimmed = value.trim();
  if (!trimmed) return "Not configured";
  if (trimmed.length <= keep * 2) return trimmed;
  return `${trimmed.slice(0, keep)}...${trimmed.slice(-keep)}`;
}

function statusLabel(status: RemoteChannelRuntimeStatus | null) {
  if (!status) return "Unknown";
  if (!status.enabled) return "Disabled";
  if (!status.configured) return "Needs configuration";
  if (status.connected) return "Connected";
  if (status.running) return "Running";
  if (status.lastError) return "Error";
  return "Ready";
}

function statusTone(status: RemoteChannelRuntimeStatus | null) {
  if (!status) return "muted";
  if (status.lastError) return "danger";
  if (status.connected) return "success";
  if (status.running) return "active";
  if (!status.enabled || !status.configured) return "muted";
  return "active";
}

function StatusPill({ status }: { status: RemoteChannelRuntimeStatus | null }) {
  const tone = statusTone(status);
  return (
    <span className={clsx("stack-badge", tone === "success" && "active", tone === "danger" && "danger")}>
      {statusLabel(status)}
    </span>
  );
}

function StatusMeta({
  status,
  configuredLabel,
  activePeerLabel = "Active peers",
}: {
  status: RemoteChannelRuntimeStatus | null;
  configuredLabel: string;
  activePeerLabel?: string;
}) {
  return (
    <div className="settings-stage-grid two">
      <label>
        <span>Configuration</span>
        <input readOnly value={status?.configured ? configuredLabel : "Not configured"} />
      </label>
      <label>
        <span>{activePeerLabel}</span>
        <input readOnly value={String(status?.activePeerCount ?? 0)} />
      </label>
      <label>
        <span>Last inbound</span>
        <input readOnly value={formatTime(status?.lastInboundAt)} />
      </label>
      <label>
        <span>Last outbound</span>
        <input readOnly value={formatTime(status?.lastOutboundAt)} />
      </label>
    </div>
  );
}

function ChannelCard({
  title,
  subtitle,
  status,
  children,
}: {
  title: string;
  subtitle: string;
  status: RemoteChannelRuntimeStatus | null;
  children?: ReactNode;
}) {
  return (
    <article className="panel-card form-card settings-surface">
      <div className="provider-detail-head">
        <div className="provider-detail-copy">
          <h3>{title}</h3>
          <p className="field-note">{subtitle}</p>
        </div>
        <StatusPill status={status} />
      </div>
      {children}
      {status?.lastError ? (
        <div className="empty-panel compact">
          <strong>Error</strong>
          <span>{status.lastError}</span>
        </div>
      ) : null}
    </article>
  );
}

function WechatCard({
  config,
  status,
  refreshing,
  connecting,
  onRefresh,
  onToggleEnabled,
  onStartLogin,
  onDisconnect,
}: {
  config: RemoteControlConfig["wechat"];
  status: WechatRemoteRuntimeStatus | null;
  refreshing: boolean;
  connecting: boolean;
  onRefresh: (options?: { silent?: boolean }) => Promise<void>;
  onToggleEnabled: (enabled: boolean) => void;
  onStartLogin: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const canStartLogin = config.enabled && !connecting && !status?.pendingLogin;
  const canDisconnect = Boolean(status?.connected || config.botToken || config.accountId);

  return (
    <ChannelCard
      title="WeChat"
      subtitle="Use QR login to bind a WeChat bot session, then keep message relay running in the desktop app."
      status={status}
    >
      <div className="settings-stage-grid two">
        <label>
          <span>Enabled</span>
          <select
            value={config.enabled ? "enabled" : "disabled"}
            onChange={(event) => onToggleEnabled(event.target.value === "enabled")}
          >
            <option value="disabled">Disabled</option>
            <option value="enabled">Enabled</option>
          </select>
        </label>
        <label>
          <span>Connection</span>
          <input readOnly value={status?.connected ? "Connected" : "Not connected"} />
        </label>
      </div>

      <StatusMeta
        status={status}
        configuredLabel={`${maskValue(config.accountId || status?.accountId || "")} / ${maskValue(config.botToken)}`}
      />

      <div className="settings-stage-grid two">
        <label>
          <span>Base URL</span>
          <input readOnly value={config.baseUrl || "Not configured"} />
        </label>
        <label>
          <span>CDN Base URL</span>
          <input readOnly value={config.cdnBaseUrl || "Not configured"} />
        </label>
      </div>

      {status?.pendingLoginQrCodeUrl ? (
        <div className="empty-panel compact">
          <strong>QR login pending</strong>
          <span>Scan the QR code shown by the backend flow to complete the bind.</span>
          <a href={status.pendingLoginQrCodeUrl} rel="noreferrer" target="_blank">
            Open QR Code
          </a>
        </div>
      ) : null}

      <div className="mcp-card-actions">
        <button className="secondary-button" disabled={refreshing} onClick={() => void onRefresh()}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
        <button className="secondary-button" disabled={!canStartLogin} onClick={() => void onStartLogin()}>
          {connecting ? <LoaderCircle size={14} className="spin" /> : <QrCode size={14} />}
          {status?.pendingLogin ? "Waiting for scan" : "Start QR Login"}
        </button>
        <button className="ghost-text-button danger" disabled={!canDisconnect} onClick={() => void onDisconnect()}>
          <Unplug size={14} />
          Disconnect
        </button>
      </div>

      <p className="field-note">
        Connected at: {formatTime(config.connectedAt)}. Account: {maskValue(status?.accountId || config.accountId)}.
      </p>
    </ChannelCard>
  );
}

export function RemoteControlSettings({
  remoteControl,
  remoteStatus,
  refreshing,
  wechatConnecting,
  onRefresh,
  onToggleWechatEnabled,
  onStartWechatLogin,
  onDisconnectWechat,
  onUpdateDingtalk,
  onUpdateFeishu,
  onUpdateWecom,
}: RemoteControlSettingsProps) {
  return (
    <section className="settings-stage assistant-settings-stage">
      <header className="settings-stage-header">
        <div className="settings-stage-heading">
          <h1>Remote Control</h1>
          <p className="field-note">
            Let external chat channels send work into the current desktop agent, while keeping session state and approvals in one place.
          </p>
        </div>
        <button className="secondary-button" disabled={refreshing} onClick={() => void onRefresh()}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          Refresh status
        </button>
      </header>

      <div className="settings-block">
        <WechatCard
          config={remoteControl.wechat}
          status={remoteStatus?.wechat ?? null}
          refreshing={refreshing}
          connecting={wechatConnecting}
          onRefresh={onRefresh}
          onToggleEnabled={onToggleWechatEnabled}
          onStartLogin={onStartWechatLogin}
          onDisconnect={onDisconnectWechat}
        />
      </div>

      <div className="settings-block">
        <div className="settings-stage-grid">
          <ChannelCard
            title="DingTalk"
            subtitle="Inbound monitor is wired in the Electron backend. The current UI exposes runtime status first, config editing can stay in your existing config flow."
            status={remoteStatus?.dingtalk ?? null}
          >
            <div className="settings-stage-grid two">
              <label>
                <span>Enabled</span>
                <select
                  value={remoteControl.dingtalk.enabled ? "enabled" : "disabled"}
                  onChange={(event) =>
                    onUpdateDingtalk?.(
                      { enabled: event.target.value === "enabled" },
                      { immediate: true },
                    )
                  }
                >
                  <option value="disabled">Disabled</option>
                  <option value="enabled">Enabled</option>
                </select>
              </label>
              <label>
                <span>Client ID</span>
                <input
                  value={remoteControl.dingtalk.clientId}
                  onChange={(event) => onUpdateDingtalk?.({ clientId: event.target.value })}
                  onBlur={(event) =>
                    onUpdateDingtalk?.({ clientId: event.target.value }, { immediate: true })
                  }
                  placeholder="dingtalk client id"
                />
              </label>
              <label className="span-two">
                <span>Client Secret</span>
                <input
                  type="password"
                  value={remoteControl.dingtalk.clientSecret}
                  onChange={(event) => onUpdateDingtalk?.({ clientSecret: event.target.value })}
                  onBlur={(event) =>
                    onUpdateDingtalk?.({ clientSecret: event.target.value }, { immediate: true })
                  }
                  placeholder="dingtalk client secret"
                />
              </label>
            </div>
            <StatusMeta
              status={remoteStatus?.dingtalk ?? null}
              configuredLabel={maskValue(remoteControl.dingtalk.clientId)}
            />
          </ChannelCard>

          <ChannelCard
            title="Feishu"
            subtitle="Feishu relay is available in the main process. This panel keeps the health signal visible without forcing a second config surface."
            status={remoteStatus?.feishu ?? null}
          >
            <div className="settings-stage-grid two">
              <label>
                <span>Enabled</span>
                <select
                  value={remoteControl.feishu.enabled ? "enabled" : "disabled"}
                  onChange={(event) =>
                    onUpdateFeishu?.(
                      { enabled: event.target.value === "enabled" },
                      { immediate: true },
                    )
                  }
                >
                  <option value="disabled">Disabled</option>
                  <option value="enabled">Enabled</option>
                </select>
              </label>
              <label>
                <span>Domain</span>
                <select
                  value={remoteControl.feishu.domain}
                  onChange={(event) =>
                    onUpdateFeishu?.(
                      { domain: event.target.value as RemoteControlConfig["feishu"]["domain"] },
                      { immediate: true },
                    )
                  }
                >
                  <option value="feishu">Feishu</option>
                  <option value="lark">Lark</option>
                </select>
              </label>
              <label>
                <span>App ID</span>
                <input
                  value={remoteControl.feishu.appId}
                  onChange={(event) => onUpdateFeishu?.({ appId: event.target.value })}
                  onBlur={(event) =>
                    onUpdateFeishu?.({ appId: event.target.value }, { immediate: true })
                  }
                  placeholder="feishu app id"
                />
              </label>
              <label>
                <span>App Secret</span>
                <input
                  type="password"
                  value={remoteControl.feishu.appSecret}
                  onChange={(event) => onUpdateFeishu?.({ appSecret: event.target.value })}
                  onBlur={(event) =>
                    onUpdateFeishu?.({ appSecret: event.target.value }, { immediate: true })
                  }
                  placeholder="feishu app secret"
                />
              </label>
            </div>
            <StatusMeta
              status={remoteStatus?.feishu ?? null}
              configuredLabel={`${maskValue(remoteControl.feishu.appId)} / ${remoteControl.feishu.domain}`}
            />
          </ChannelCard>

          <ChannelCard
            title="WeCom"
            subtitle="WeCom bot relay can run alongside WeChat. Status is surfaced here so channel health is visible during ACP sessions."
            status={remoteStatus?.wecom ?? null}
          >
            <div className="settings-stage-grid two">
              <label>
                <span>Enabled</span>
                <select
                  value={remoteControl.wecom.enabled ? "enabled" : "disabled"}
                  onChange={(event) =>
                    onUpdateWecom?.(
                      { enabled: event.target.value === "enabled" },
                      { immediate: true },
                    )
                  }
                >
                  <option value="disabled">Disabled</option>
                  <option value="enabled">Enabled</option>
                </select>
              </label>
              <label>
                <span>Bot ID</span>
                <input
                  value={remoteControl.wecom.botId}
                  onChange={(event) => onUpdateWecom?.({ botId: event.target.value })}
                  onBlur={(event) =>
                    onUpdateWecom?.({ botId: event.target.value }, { immediate: true })
                  }
                  placeholder="wecom bot id"
                />
              </label>
              <label>
                <span>Secret</span>
                <input
                  type="password"
                  value={remoteControl.wecom.secret}
                  onChange={(event) => onUpdateWecom?.({ secret: event.target.value })}
                  onBlur={(event) =>
                    onUpdateWecom?.({ secret: event.target.value }, { immediate: true })
                  }
                  placeholder="wecom secret"
                />
              </label>
              <label>
                <span>WebSocket URL</span>
                <input
                  value={remoteControl.wecom.websocketUrl}
                  onChange={(event) => onUpdateWecom?.({ websocketUrl: event.target.value })}
                  onBlur={(event) =>
                    onUpdateWecom?.({ websocketUrl: event.target.value }, { immediate: true })
                  }
                  placeholder="wss://openws.work.weixin.qq.com"
                />
              </label>
            </div>
            <StatusMeta
              status={remoteStatus?.wecom ?? null}
              configuredLabel={`${maskValue(remoteControl.wecom.botId)} / ${maskValue(remoteControl.wecom.websocketUrl, 10)}`}
            />
          </ChannelCard>
        </div>
      </div>

      <div className="settings-block">
        <div className="empty-panel compact">
          <strong>What happens here</strong>
          <span>Incoming channel messages are bound to agent threads, attachments are imported into the workspace, and replies are sent back after the thread completes or pauses for approval.</span>
        </div>
      </div>
    </section>
  );
}
