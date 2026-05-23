import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, LoaderCircle, QrCode, Unplug } from "lucide-react";

import type {
  RemoteChannelRuntimeStatus,
  RemoteControlConfig,
  RemoteControlStatus,
} from "../../types";
import { SurfaceSelect } from "../shared/SurfaceSelect";

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
type RemoteChannel = "wechat" | ConfigChannel;
type StatusTone = "active" | "danger" | "muted" | "success";

type ConfigDraft =
  | { channel: "dingtalk"; data: RemoteControlConfig["dingtalk"] }
  | { channel: "feishu"; data: RemoteControlConfig["feishu"] }
  | { channel: "wecom"; data: RemoteControlConfig["wecom"] };

type ChannelMeta = {
  id: RemoteChannel;
  title: string;
  detail: string | null;
  status: RemoteChannelRuntimeStatus | null;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
};

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

function isSessionTimeoutError(message: string) {
  return /session\s*timeout|会话.*过期|登录.*过期/i.test(message);
}

function formatRuntimeError(status: RemoteChannelRuntimeStatus | null, title: string) {
  const rawMessage = status?.lastError?.trim();
  if (!rawMessage) return null;
  if (!status?.enabled && !status?.configured && !status?.connected && !status?.running) return null;

  if (title === "微信" && isSessionTimeoutError(rawMessage)) {
    return {
      title: "微信登录已过期",
      message: "请重新扫码绑定。",
    };
  }

  return {
    title: `${title}连接异常`,
    message: rawMessage,
  };
}

function statusLabel(status: RemoteChannelRuntimeStatus | null, title = "") {
  if (!status) return "未就绪";
  const runtimeError = formatRuntimeError(status, title);
  if (runtimeError) return title === "微信" && runtimeError.title === "微信登录已过期" ? "需重新绑定" : "异常";
  if (!status.enabled) return "已关闭";
  if (!status.configured) return "待配置";
  if (status.connected) return "已连接";
  if (status.running) return "监听中";
  return "待启动";
}

function statusTone(status: RemoteChannelRuntimeStatus | null, title = ""): StatusTone {
  if (!status) return "muted";
  if (formatRuntimeError(status, title)) return "danger";
  if (status.connected) return "success";
  if (status.running) return "active";
  if (!status.enabled || !status.configured) return "muted";
  return "active";
}

function credentialValue(status: RemoteChannelRuntimeStatus | null, value: string) {
  return status?.configured ? maskValue(value) : "未配置";
}

function StatusPill({ status, title }: { status: RemoteChannelRuntimeStatus | null; title: string }) {
  const tone = statusTone(status, title);
  return <span className={clsx("remote-status-pill", `tone-${tone}`)}>{statusLabel(status, title)}</span>;
}

function ChannelSwitch({
  enabled,
  onToggle,
  title,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  title: string;
}) {
  return (
    <label className="provider-switch remote-title-switch" aria-label={`${title}启用开关`}>
      <span className="remote-title-switch-label">启用</span>
      <input checked={enabled} onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
      <span className="provider-switch-track">
        <span className="provider-switch-thumb" />
      </span>
    </label>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const empty = value === "暂无" || value === "未配置";
  return (
    <div className={clsx("remote-detail-row", empty && "empty")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusRows({
  credentialLabel,
  credentialValue: configuredCredentialValue,
  status,
}: {
  credentialLabel?: string;
  credentialValue?: string;
  status: RemoteChannelRuntimeStatus | null;
}) {
  return (
    <div className="remote-detail-list">
      {credentialLabel ? <DetailRow label={credentialLabel} value={configuredCredentialValue ?? "未配置"} /> : null}
      <DetailRow label="会话" value={String(status?.activePeerCount ?? 0)} />
      <DetailRow label="入站" value={formatTime(status?.lastInboundAt)} />
      <DetailRow label="出站" value={formatTime(status?.lastOutboundAt)} />
    </div>
  );
}

function RuntimeErrorBlock({
  status,
  title,
}: {
  status: RemoteChannelRuntimeStatus | null;
  title: string;
}) {
  const runtimeError = formatRuntimeError(status, title);
  if (!runtimeError) return null;

  return (
    <div className="remote-inline-error">
      <AlertCircle size={16} />
      <strong>{runtimeError.title}</strong>
      <span>{runtimeError.message}</span>
    </div>
  );
}

function ChannelListItem({
  channel,
  active,
  onSelect,
}: {
  channel: ChannelMeta;
  active: boolean;
  onSelect: (channel: RemoteChannel) => void;
}) {
  const tone = statusTone(channel.status, channel.title);
  return (
    <button
      className={clsx("remote-channel-select", active && "active", `tone-${tone}`)}
      onClick={() => onSelect(channel.id)}
      type="button"
    >
      <span className="remote-channel-rail" />
      <span className="remote-channel-select-copy">
        <strong>{channel.title}</strong>
        {channel.detail ? <small>{channel.detail}</small> : null}
      </span>
      <StatusPill status={channel.status} title={channel.title} />
    </button>
  );
}

function Section({
  actions,
  children,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="remote-detail-section">
      <div className="remote-section-heading">
        <h3>{title}</h3>
        {actions ? <div className="remote-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SaveConfigButton({
  disabled,
  onSave,
}: {
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <button className="primary-button remote-save-button" disabled={disabled} onClick={onSave} type="button">
      <CheckCircle2 size={14} />
      保存
    </button>
  );
}

export function RemoteControlSettings({
  remoteControl,
  remoteStatus,
  wechatConnecting,
  onToggleWechatEnabled,
  onStartWechatLogin,
  onDisconnectWechat,
  onUpdateDingtalk,
  onUpdateFeishu,
  onUpdateWecom,
}: RemoteControlSettingsProps) {
  const [selectedChannel, setSelectedChannel] = useState<RemoteChannel>("wechat");
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);

  const channels: ChannelMeta[] = [
    {
      id: "wechat",
      title: "微信",
      detail: remoteStatus?.wechat?.connected ? maskValue(remoteStatus.wechat.accountId) : null,
      status: remoteStatus?.wechat ?? null,
      enabled: remoteControl.wechat.enabled,
      onToggle: onToggleWechatEnabled,
    },
    {
      id: "dingtalk",
      title: "钉钉",
      detail: remoteStatus?.dingtalk?.configured ? maskValue(remoteControl.dingtalk.clientId) : null,
      status: remoteStatus?.dingtalk ?? null,
      enabled: remoteControl.dingtalk.enabled,
      onToggle: (enabled) => onUpdateDingtalk?.({ enabled }, { immediate: true }),
    },
    {
      id: "feishu",
      title: "飞书",
      detail: remoteStatus?.feishu?.configured ? maskValue(remoteControl.feishu.appId) : null,
      status: remoteStatus?.feishu ?? null,
      enabled: remoteControl.feishu.enabled,
      onToggle: (enabled) => onUpdateFeishu?.({ enabled }, { immediate: true }),
    },
    {
      id: "wecom",
      title: "企微",
      detail: remoteStatus?.wecom?.configured ? maskValue(remoteControl.wecom.botId) : null,
      status: remoteStatus?.wecom ?? null,
      enabled: remoteControl.wecom.enabled,
      onToggle: (enabled) => onUpdateWecom?.({ enabled }, { immediate: true }),
    },
  ];

  const selected = channels.find((item) => item.id === selectedChannel) ?? channels[0];
  const wechatCanStartLogin =
    remoteControl.wechat.enabled && !wechatConnecting && !remoteStatus?.wechat?.pendingLogin;
  const wechatCanDisconnect = Boolean(
    remoteStatus?.wechat?.pendingLogin ||
      remoteStatus?.wechat?.connected ||
      remoteControl.wechat.botToken ||
      remoteControl.wechat.accountId,
  );
  const wechatQrCodeUrl = remoteStatus?.wechat?.pendingLoginQrCodeUrl?.trim() || "";
  const wechatError = formatRuntimeError(remoteStatus?.wechat ?? null, "微信");
  const wechatPrimaryLabel = !remoteControl.wechat.enabled
    ? "开启后扫码"
    : remoteStatus?.wechat?.pendingLogin
      ? "等待扫码"
      : wechatError?.title === "微信登录已过期"
        ? "重新扫码"
        : remoteStatus?.wechat?.connected
          ? "重新绑定"
          : "扫码绑定";

  const dingtalkDraft =
    configDraft?.channel === "dingtalk" ? configDraft.data : remoteControl.dingtalk;
  const feishuDraft = configDraft?.channel === "feishu" ? configDraft.data : remoteControl.feishu;
  const wecomDraft = configDraft?.channel === "wecom" ? configDraft.data : remoteControl.wecom;
  const draftDirty = Boolean(
    configDraft && JSON.stringify(configDraft.data) !== JSON.stringify(remoteControl[configDraft.channel]),
  );

  function selectChannel(channel: RemoteChannel) {
    setSelectedChannel(channel);
    if (channel === "dingtalk") {
      setConfigDraft({ channel, data: { ...remoteControl.dingtalk } });
      return;
    }
    if (channel === "feishu") {
      setConfigDraft({ channel, data: { ...remoteControl.feishu } });
      return;
    }
    if (channel === "wecom") {
      setConfigDraft({ channel, data: { ...remoteControl.wecom } });
      return;
    }
    setConfigDraft(null);
  }

  function saveConfig() {
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
  }

  function renderWechatDetail() {
    return (
      <>
        <Section
          actions={
            <>
              <button
                className="primary-button remote-action-button"
                disabled={!wechatCanStartLogin}
                onClick={() => void onStartWechatLogin()}
                type="button"
              >
                {wechatConnecting ? <LoaderCircle size={14} className="spin" /> : <QrCode size={14} />}
                {wechatPrimaryLabel}
              </button>
              {wechatCanDisconnect ? (
                <button className="ghost-text-button danger" onClick={() => void onDisconnectWechat()} type="button">
                  <Unplug size={14} />
                  断开
                </button>
              ) : null}
            </>
          }
          title="连接"
        >
          <div className="remote-detail-list">
            <DetailRow label="账号" value={maskValue(remoteStatus?.wechat?.accountId || remoteControl.wechat.accountId)} />
            <DetailRow label="User ID" value={maskValue(remoteStatus?.wechat?.userId || remoteControl.wechat.userId)} />
          </div>

          {remoteStatus?.wechat?.pendingLogin ? (
            <div className="wechat-login-panel">
              <strong>扫码绑定</strong>
              {wechatQrCodeUrl ? (
                <div className="wechat-login-qr-shell">
                  <img alt="微信登录二维码" className="wechat-login-qr-image" loading="lazy" src={wechatQrCodeUrl} />
                </div>
              ) : (
                <div className="wechat-login-qr-placeholder">生成中...</div>
              )}
              {wechatQrCodeUrl ? (
                <a className="ghost-text-button" href={wechatQrCodeUrl} rel="noreferrer" target="_blank">
                  浏览器打开
                </a>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title="状态">
          <StatusRows status={remoteStatus?.wechat ?? null} />
        </Section>
      </>
    );
  }

  function renderDingtalkDetail() {
    return (
      <>
        <Section
          actions={<SaveConfigButton disabled={!draftDirty || !onUpdateDingtalk} onSave={saveConfig} />}
          title="凭据"
        >
          <div className="remote-detail-fields">
            <label>
              <span>客户端 ID</span>
              <input
                value={dingtalkDraft.clientId}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "dingtalk",
                    data: { ...dingtalkDraft, clientId: event.target.value },
                  })
                }
                placeholder="Client ID"
              />
            </label>
            <label>
              <span>客户端密钥</span>
              <input
                type="password"
                value={dingtalkDraft.clientSecret}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "dingtalk",
                    data: { ...dingtalkDraft, clientSecret: event.target.value },
                  })
                }
                placeholder="Client Secret"
              />
            </label>
          </div>
        </Section>

        <Section title="状态">
          <StatusRows
            credentialLabel="凭据"
            credentialValue={credentialValue(remoteStatus?.dingtalk ?? null, remoteControl.dingtalk.clientId)}
            status={remoteStatus?.dingtalk ?? null}
          />
        </Section>
      </>
    );
  }

  function renderFeishuDetail() {
    return (
      <>
        <Section
          actions={<SaveConfigButton disabled={!draftDirty || !onUpdateFeishu} onSave={saveConfig} />}
          title="凭据"
        >
          <div className="remote-detail-fields">
            <label>
              <span>域名</span>
              <SurfaceSelect
                ariaLabel="选择飞书域名"
                className="field-select"
                fullWidth
                onChange={(value) =>
                  setConfigDraft({
                    channel: "feishu",
                    data: { ...feishuDraft, domain: value as RemoteControlConfig["feishu"]["domain"] },
                  })
                }
                options={[
                  { value: "feishu", label: "飞书" },
                  { value: "lark", label: "国际版" },
                ]}
                value={feishuDraft.domain}
              />
            </label>
            <label>
              <span>应用 ID</span>
              <input
                value={feishuDraft.appId}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "feishu",
                    data: { ...feishuDraft, appId: event.target.value },
                  })
                }
                placeholder="App ID"
              />
            </label>
            <label className="span-two">
              <span>应用密钥</span>
              <input
                type="password"
                value={feishuDraft.appSecret}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "feishu",
                    data: { ...feishuDraft, appSecret: event.target.value },
                  })
                }
                placeholder="App Secret"
              />
            </label>
          </div>
        </Section>

        <Section title="状态">
          <StatusRows
            credentialLabel="凭据"
            credentialValue={credentialValue(remoteStatus?.feishu ?? null, remoteControl.feishu.appId)}
            status={remoteStatus?.feishu ?? null}
          />
        </Section>
      </>
    );
  }

  function renderWecomDetail() {
    return (
      <>
        <Section
          actions={<SaveConfigButton disabled={!draftDirty || !onUpdateWecom} onSave={saveConfig} />}
          title="凭据"
        >
          <div className="remote-detail-fields">
            <label>
              <span>机器人 ID</span>
              <input
                value={wecomDraft.botId}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "wecom",
                    data: { ...wecomDraft, botId: event.target.value },
                  })
                }
                placeholder="Bot ID"
              />
            </label>
            <label>
              <span>密钥</span>
              <input
                type="password"
                value={wecomDraft.secret}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "wecom",
                    data: { ...wecomDraft, secret: event.target.value },
                  })
                }
                placeholder="Secret"
              />
            </label>
            <label className="span-two">
              <span>长连接地址</span>
              <input
                value={wecomDraft.websocketUrl}
                onChange={(event) =>
                  setConfigDraft({
                    channel: "wecom",
                    data: { ...wecomDraft, websocketUrl: event.target.value },
                  })
                }
                placeholder="wss://openws.work.weixin.qq.com"
              />
            </label>
          </div>
        </Section>

        <Section title="状态">
          <StatusRows
            credentialLabel="凭据"
            credentialValue={credentialValue(remoteStatus?.wecom ?? null, remoteControl.wecom.botId)}
            status={remoteStatus?.wecom ?? null}
          />
        </Section>
      </>
    );
  }

  function renderSelectedDetail() {
    if (selectedChannel === "wechat") return renderWechatDetail();
    if (selectedChannel === "dingtalk") return renderDingtalkDetail();
    if (selectedChannel === "feishu") return renderFeishuDetail();
    return renderWecomDetail();
  }

  return (
    <section className="settings-stage assistant-settings-stage remote-control-stage">
      <header className="settings-stage-header remote-header">
        <div className="settings-stage-heading">
          <h1>远程控制</h1>
        </div>
      </header>

      <div className="remote-control-shell">
        <aside className="remote-channel-list" aria-label="远程控制通道">
          {channels.map((channel) => (
            <ChannelListItem
              active={selected.id === channel.id}
              channel={channel}
              key={channel.id}
              onSelect={selectChannel}
            />
          ))}
        </aside>

        <article className="remote-channel-detail">
          <div className="remote-detail-head">
            <div>
              <h2>{selected.title}配置</h2>
            </div>
            <div className="remote-detail-controls">
              <StatusPill status={selected.status} title={selected.title} />
              <ChannelSwitch enabled={selected.enabled} onToggle={selected.onToggle} title={selected.title} />
            </div>
          </div>

          <RuntimeErrorBlock status={selected.status} title={selected.title} />
          <div className="remote-detail-grid">{renderSelectedDetail()}</div>
        </article>
      </div>
    </section>
  );
}
