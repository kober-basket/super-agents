import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { LoaderCircle, QrCode, RefreshCw, Settings2, Unplug, X } from "lucide-react";

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

type ConfigChannel = "dingtalk" | "feishu" | "wecom";

type ConfigDraft =
  | { channel: "dingtalk"; data: RemoteControlConfig["dingtalk"] }
  | { channel: "feishu"; data: RemoteControlConfig["feishu"] }
  | { channel: "wecom"; data: RemoteControlConfig["wecom"] };

function formatTime(timestamp?: number | null) {
  if (!timestamp) return "暂无";

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  } catch {
    return "暂无";
  }
}

function maskValue(value: string, keep = 4) {
  const trimmed = value.trim();
  if (!trimmed) return "未配置";
  if (trimmed.length <= keep * 2) return trimmed;
  return `${trimmed.slice(0, keep)}...${trimmed.slice(-keep)}`;
}

function latestActivityAt(status: RemoteChannelRuntimeStatus | null) {
  return Math.max(status?.lastInboundAt ?? 0, status?.lastOutboundAt ?? 0);
}

function statusLabel(status: RemoteChannelRuntimeStatus | null) {
  if (!status) return "等待状态";
  if (!status.enabled) return "已关闭";
  if (!status.configured) return "待配置";
  if (status.connected) return "已连接";
  if (status.running) return "监听中";
  if (status.lastError) return "异常";
  return "待启动";
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

function SummaryChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className={clsx("remote-summary-chip", tone === "danger" && "danger")}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="remote-card-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChannelCard({
  title,
  subtitle,
  status,
  enabled,
  onToggle,
  metrics,
  details,
  actions,
  featured = false,
}: {
  title: string;
  subtitle: string;
  status: RemoteChannelRuntimeStatus | null;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  metrics: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  featured?: boolean;
}) {
  return (
    <article className={clsx("panel-card form-card settings-surface remote-card", featured && "featured")}>
      <div className="remote-card-top">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="remote-card-metrics">{metrics}</div>

      {details ? <div className="remote-card-details">{details}</div> : null}

      {status?.lastError ? (
        <div className="remote-card-error">
          <strong>最近错误</strong>
          <span>{status.lastError}</span>
        </div>
      ) : null}

      <div className="remote-card-bottom">
        <div className="remote-card-toggle">
          <span>启用</span>
          <label className="provider-switch" aria-label={`${title}启用开关`}>
            <input checked={enabled} onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
            <span className="provider-switch-track">
              <span className="provider-switch-thumb" />
            </span>
          </label>
        </div>
        {actions ? <div className="remote-card-actions">{actions}</div> : null}
      </div>
    </article>
  );
}

function ConfigModal({
  draft,
  status,
  onClose,
  onSave,
  onChange,
}: {
  draft: ConfigDraft;
  status: RemoteChannelRuntimeStatus | null;
  onClose: () => void;
  onSave: () => void;
  onChange: (draft: ConfigDraft) => void;
}) {
  const titleMap: Record<ConfigChannel, string> = {
    dingtalk: "钉钉配置",
    feishu: "飞书配置",
    wecom: "企微配置",
  };

  const subtitleMap: Record<ConfigChannel, string> = {
    dingtalk: "只保留必要凭据，保存后立即生效。",
    feishu: "域名和应用凭据保存后立即同步到桌面端。",
    wecom: "填写 Bot 信息和 WebSocket 地址即可。",
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="knowledge-modal remote-config-modal" onClick={(event) => event.stopPropagation()}>
        <div className="knowledge-modal-head">
          <div>
            <strong>{titleMap[draft.channel]}</strong>
            <span>{subtitleMap[draft.channel]}</span>
          </div>
          <button className="ghost-icon" onClick={onClose} title="关闭" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="knowledge-modal-body remote-config-body">
          <div className="remote-config-note">
            <span>当前状态</span>
            <strong>{statusLabel(status)}</strong>
            {status?.lastError ? <p>{status.lastError}</p> : null}
          </div>

          {draft.channel === "dingtalk" ? (
            <div className="remote-config-grid">
              <label>
                <span>Client ID</span>
                <input
                  value={draft.data.clientId}
                  onChange={(event) =>
                    onChange({
                      channel: "dingtalk",
                      data: {
                        ...draft.data,
                        clientId: event.target.value,
                      },
                    })
                  }
                  placeholder="填写钉钉 Client ID"
                />
              </label>
              <label>
                <span>Client Secret</span>
                <input
                  type="password"
                  value={draft.data.clientSecret}
                  onChange={(event) =>
                    onChange({
                      channel: "dingtalk",
                      data: {
                        ...draft.data,
                        clientSecret: event.target.value,
                      },
                    })
                  }
                  placeholder="填写钉钉 Client Secret"
                />
              </label>
            </div>
          ) : null}

          {draft.channel === "feishu" ? (
            <div className="remote-config-grid">
              <label>
                <span>Domain</span>
                <select
                  value={draft.data.domain}
                  onChange={(event) =>
                    onChange({
                      channel: "feishu",
                      data: {
                        ...draft.data,
                        domain: event.target.value as RemoteControlConfig["feishu"]["domain"],
                      },
                    })
                  }
                >
                  <option value="feishu">Feishu</option>
                  <option value="lark">Lark</option>
                </select>
              </label>
              <label>
                <span>App ID</span>
                <input
                  value={draft.data.appId}
                  onChange={(event) =>
                    onChange({
                      channel: "feishu",
                      data: {
                        ...draft.data,
                        appId: event.target.value,
                      },
                    })
                  }
                  placeholder="填写飞书 App ID"
                />
              </label>
              <label className="span-two">
                <span>App Secret</span>
                <input
                  type="password"
                  value={draft.data.appSecret}
                  onChange={(event) =>
                    onChange({
                      channel: "feishu",
                      data: {
                        ...draft.data,
                        appSecret: event.target.value,
                      },
                    })
                  }
                  placeholder="填写飞书 App Secret"
                />
              </label>
            </div>
          ) : null}

          {draft.channel === "wecom" ? (
            <div className="remote-config-grid">
              <label>
                <span>Bot ID</span>
                <input
                  value={draft.data.botId}
                  onChange={(event) =>
                    onChange({
                      channel: "wecom",
                      data: {
                        ...draft.data,
                        botId: event.target.value,
                      },
                    })
                  }
                  placeholder="填写企微 Bot ID"
                />
              </label>
              <label>
                <span>Secret</span>
                <input
                  type="password"
                  value={draft.data.secret}
                  onChange={(event) =>
                    onChange({
                      channel: "wecom",
                      data: {
                        ...draft.data,
                        secret: event.target.value,
                      },
                    })
                  }
                  placeholder="填写企微 Secret"
                />
              </label>
              <label className="span-two">
                <span>WebSocket URL</span>
                <input
                  value={draft.data.websocketUrl}
                  onChange={(event) =>
                    onChange({
                      channel: "wecom",
                      data: {
                        ...draft.data,
                        websocketUrl: event.target.value,
                      },
                    })
                  }
                  placeholder="wss://openws.work.weixin.qq.com"
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="knowledge-modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" onClick={onSave} type="button">
            保存
          </button>
        </div>
      </div>
    </div>
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
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);

  const channelStatuses: Array<RemoteChannelRuntimeStatus | null> = [
    remoteStatus?.wechat ?? null,
    remoteStatus?.dingtalk ?? null,
    remoteStatus?.feishu ?? null,
    remoteStatus?.wecom ?? null,
  ];

  const enabledCount = [
    remoteControl.wechat.enabled,
    remoteControl.dingtalk.enabled,
    remoteControl.feishu.enabled,
    remoteControl.wecom.enabled,
  ].filter(Boolean).length;
  const connectedCount = channelStatuses.filter((status) => Boolean(status?.connected)).length;
  const issueCount = channelStatuses.filter((status) => Boolean(status?.lastError)).length;
  const latestActivity = channelStatuses.reduce(
    (latest, status) => Math.max(latest, latestActivityAt(status)),
    0,
  );

  const openConfig = (channel: ConfigChannel) => {
    if (channel === "dingtalk") {
      setConfigDraft({
        channel,
        data: { ...remoteControl.dingtalk },
      });
      return;
    }

    if (channel === "feishu") {
      setConfigDraft({
        channel,
        data: { ...remoteControl.feishu },
      });
      return;
    }

    setConfigDraft({
      channel,
      data: { ...remoteControl.wecom },
    });
  };

  const saveConfig = () => {
    if (!configDraft) return;

    if (configDraft.channel === "dingtalk") {
      onUpdateDingtalk?.(configDraft.data, { immediate: true });
    }

    if (configDraft.channel === "feishu") {
      onUpdateFeishu?.(configDraft.data, { immediate: true });
    }

    if (configDraft.channel === "wecom") {
      onUpdateWecom?.(configDraft.data, { immediate: true });
    }

    setConfigDraft(null);
  };

  const wechatCanStartLogin =
    remoteControl.wechat.enabled && !wechatConnecting && !remoteStatus?.wechat?.pendingLogin;
  const wechatCanDisconnect = Boolean(
    remoteStatus?.wechat?.pendingLogin ||
      remoteStatus?.wechat?.connected ||
      remoteControl.wechat.botToken ||
      remoteControl.wechat.accountId,
  );
  const wechatQrCodeUrl = remoteStatus?.wechat?.pendingLoginQrCodeUrl?.trim() || "";

  return (
    <section className="settings-stage assistant-settings-stage remote-control-stage">
      <header className="settings-stage-header remote-header">
        <div className="settings-stage-heading">
          <h1>远程控制</h1>
          <p className="field-note">开关通道，看状态，需要时点配置。</p>
        </div>
        <button className="secondary-button" disabled={refreshing} onClick={() => void onRefresh()} type="button">
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          刷新
        </button>
      </header>

      <div className="remote-summary-row">
        <SummaryChip label="已启用" value={`${enabledCount}/4`} />
        <SummaryChip label="已连接" value={String(connectedCount)} />
        <SummaryChip label="异常" tone={issueCount > 0 ? "danger" : "default"} value={String(issueCount)} />
        <SummaryChip label="最近活动" value={formatTime(latestActivity)} />
      </div>

      <div className="remote-channel-grid">
        <ChannelCard
          enabled={remoteControl.wechat.enabled}
          featured
          onToggle={onToggleWechatEnabled}
          status={remoteStatus?.wechat ?? null}
          subtitle={remoteStatus?.wechat?.connected ? maskValue(remoteStatus.wechat.accountId) : "扫码接入"}
          title="微信"
          details={
            remoteStatus?.wechat?.pendingLogin ? (
              <div className="wechat-login-panel">
                <div className="wechat-login-copy">
                  <strong>扫码登录</strong>
                  <span>使用微信扫描下方二维码完成绑定，二维码过期后会自动刷新。</span>
                  <span>如果这里没有显示图片，可以直接在浏览器打开。</span>
                </div>
                {wechatQrCodeUrl ? (
                  <div className="wechat-login-qr-shell">
                    <img
                      alt="微信登录二维码"
                      className="wechat-login-qr-image"
                      loading="lazy"
                      src={wechatQrCodeUrl}
                    />
                  </div>
                ) : (
                  <div className="wechat-login-qr-placeholder">正在生成二维码...</div>
                )}
                {wechatQrCodeUrl ? (
                  <a
                    className="ghost-text-button"
                    href={wechatQrCodeUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    浏览器打开
                  </a>
                ) : null}
              </div>
            ) : null
          }
          actions={
            <>
              <button
                className="secondary-button"
                disabled={!wechatCanStartLogin}
                onClick={() => void onStartWechatLogin()}
                type="button"
              >
                {wechatConnecting ? <LoaderCircle size={14} className="spin" /> : <QrCode size={14} />}
                {remoteStatus?.wechat?.pendingLogin ? "等待扫码" : "扫码登录"}
              </button>
              <button
                className="ghost-text-button danger"
                disabled={!wechatCanDisconnect}
                onClick={() => void onDisconnectWechat()}
                type="button"
              >
                <Unplug size={14} />
                断开
              </button>
            </>
          }
          metrics={
            <>
              <Metric
                label="账号"
                value={maskValue(remoteStatus?.wechat?.accountId || remoteControl.wechat.accountId)}
              />
              <Metric label="活跃连接" value={String(remoteStatus?.wechat?.activePeerCount ?? 0)} />
              <Metric label="最近入站" value={formatTime(remoteStatus?.wechat?.lastInboundAt)} />
              <Metric label="最近出站" value={formatTime(remoteStatus?.wechat?.lastOutboundAt)} />
            </>
          }
        />

        <ChannelCard
          enabled={remoteControl.dingtalk.enabled}
          onToggle={(enabled) => onUpdateDingtalk?.({ enabled }, { immediate: true })}
          status={remoteStatus?.dingtalk ?? null}
          subtitle="官方 Stream"
          title="钉钉"
          actions={
            <button
              className="secondary-button"
              disabled={!onUpdateDingtalk}
              onClick={() => openConfig("dingtalk")}
              type="button"
            >
              <Settings2 size={14} />
              配置
            </button>
          }
          metrics={
            <>
              <Metric
                label="凭据"
                value={remoteStatus?.dingtalk?.configured ? maskValue(remoteControl.dingtalk.clientId) : "未配置"}
              />
              <Metric label="活跃连接" value={String(remoteStatus?.dingtalk?.activePeerCount ?? 0)} />
              <Metric label="最近入站" value={formatTime(remoteStatus?.dingtalk?.lastInboundAt)} />
              <Metric label="最近出站" value={formatTime(remoteStatus?.dingtalk?.lastOutboundAt)} />
            </>
          }
        />

        <ChannelCard
          enabled={remoteControl.feishu.enabled}
          onToggle={(enabled) => onUpdateFeishu?.({ enabled }, { immediate: true })}
          status={remoteStatus?.feishu ?? null}
          subtitle={remoteControl.feishu.domain === "lark" ? "Lark" : "Feishu"}
          title="飞书"
          actions={
            <button
              className="secondary-button"
              disabled={!onUpdateFeishu}
              onClick={() => openConfig("feishu")}
              type="button"
            >
              <Settings2 size={14} />
              配置
            </button>
          }
          metrics={
            <>
              <Metric
                label="凭据"
                value={remoteStatus?.feishu?.configured ? maskValue(remoteControl.feishu.appId) : "未配置"}
              />
              <Metric label="活跃连接" value={String(remoteStatus?.feishu?.activePeerCount ?? 0)} />
              <Metric label="最近入站" value={formatTime(remoteStatus?.feishu?.lastInboundAt)} />
              <Metric label="最近出站" value={formatTime(remoteStatus?.feishu?.lastOutboundAt)} />
            </>
          }
        />

        <ChannelCard
          enabled={remoteControl.wecom.enabled}
          onToggle={(enabled) => onUpdateWecom?.({ enabled }, { immediate: true })}
          status={remoteStatus?.wecom ?? null}
          subtitle="Bot / WebSocket"
          title="企微"
          actions={
            <button
              className="secondary-button"
              disabled={!onUpdateWecom}
              onClick={() => openConfig("wecom")}
              type="button"
            >
              <Settings2 size={14} />
              配置
            </button>
          }
          metrics={
            <>
              <Metric
                label="凭据"
                value={remoteStatus?.wecom?.configured ? maskValue(remoteControl.wecom.botId) : "未配置"}
              />
              <Metric label="活跃连接" value={String(remoteStatus?.wecom?.activePeerCount ?? 0)} />
              <Metric label="最近入站" value={formatTime(remoteStatus?.wecom?.lastInboundAt)} />
              <Metric label="最近出站" value={formatTime(remoteStatus?.wecom?.lastOutboundAt)} />
            </>
          }
        />
      </div>

      {configDraft ? (
        <ConfigModal
          draft={configDraft}
          status={
            configDraft.channel === "dingtalk"
              ? remoteStatus?.dingtalk ?? null
              : configDraft.channel === "feishu"
                ? remoteStatus?.feishu ?? null
                : remoteStatus?.wecom ?? null
          }
          onChange={setConfigDraft}
          onClose={() => setConfigDraft(null)}
          onSave={saveConfig}
        />
      ) : null}
    </section>
  );
}
