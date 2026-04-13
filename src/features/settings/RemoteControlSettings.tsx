import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Building2,
  LoaderCircle,
  MessageCircleMore,
  RefreshCw,
  ShieldEllipsis,
  Smartphone,
  QrCode,
  Unplug,
} from "lucide-react";
import QRCode from "qrcode";

import type { AppConfig, RemoteControlStatus } from "../../types";

interface RemoteControlSettingsProps {
  remoteControl: AppConfig["remoteControl"];
  remoteStatus: RemoteControlStatus | null;
  refreshing: boolean;
  wechatConnecting: boolean;
  onRefresh: () => void | Promise<void>;
  onToggleWechatEnabled: (enabled: boolean) => void;
  onStartWechatLogin: () => void | Promise<void>;
  onDisconnectWechat: () => void | Promise<void>;
}

const PLACEHOLDER_CHANNELS = [
  {
    id: "dingtalk",
    title: "\u9489\u9489",
    description:
      "\u4e00\u671f\u5148\u9884\u7559\u5165\u53e3\uff0c\u540e\u7eed\u63a5\u5165\u4f01\u4e1a\u6d88\u606f\u6536\u53d1\u3001\u626b\u7801\u767b\u5f55\u548c\u4f1a\u8bdd\u8def\u7531\u3002",
    icon: Smartphone,
  },
  {
    id: "feishu",
    title: "\u98de\u4e66",
    description:
      "\u4e00\u671f\u5148\u9884\u7559\u5165\u53e3\uff0c\u540e\u7eed\u8865\u98de\u4e66 Bot \u4e0e\u5de5\u4f5c\u53f0\u4fa7\u80fd\u529b\u3002",
    icon: MessageCircleMore,
  },
  {
    id: "wecom",
    title: "\u4f01\u5fae",
    description:
      "\u4e00\u671f\u5148\u9884\u7559\u5165\u53e3\uff0c\u540e\u7eed\u8865\u4f01\u5fae\u4f1a\u8bdd\u3001\u7d20\u6750\u4e0e\u7ec4\u7ec7\u5185\u6388\u6743\u3002",
    icon: Building2,
  },
] as const;

export function RemoteControlSettings({
  remoteControl,
  remoteStatus,
  refreshing,
  wechatConnecting,
  onRefresh,
  onToggleWechatEnabled,
  onStartWechatLogin,
  onDisconnectWechat,
}: RemoteControlSettingsProps) {
  const wechat = remoteStatus?.wechat;
  const wechatConnected = Boolean(wechat?.connected);
  const wechatRunning = Boolean(wechat?.running);
  const wechatPending = Boolean(wechat?.pendingLogin);
  const [qrImageUrl, setQrImageUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    const qrPayload = wechat?.pendingLoginQrCodeUrl?.trim();
    if (!qrPayload) {
      setQrImageUrl("");
      return undefined;
    }

    void QRCode.toDataURL(qrPayload, {
      margin: 1,
      width: 320,
      color: {
        dark: "#111827",
        light: "#FFFFFFFF",
      },
    })
      .then((value) => {
        if (!cancelled) {
          setQrImageUrl(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrImageUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wechat?.pendingLoginQrCodeUrl]);

  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div className="settings-stage-heading">
          <h1>{"\u8fdc\u7a0b\u63a7\u5236"}</h1>
          <p>
            {
              "\u53c2\u8003 openclaw-weixin \u7684\u534f\u8bae\u63a5\u6cd5\uff0c\u5c06 IM \u6d88\u606f\u76f4\u63a5\u6865\u63a5\u5230\u5f53\u524d\u684c\u9762\u667a\u80fd\u4f53\u3002"
            }
          </p>
        </div>

        <button className="secondary-button" onClick={() => void onRefresh()} disabled={refreshing}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          {"\u5237\u65b0\u72b6\u6001"}
        </button>
      </header>

      <div className="settings-stage-grid two">
        <article className="panel-card form-card settings-surface remote-channel-card span-two">
          <div className="remote-channel-head">
            <div className="remote-channel-title">
              <div className="remote-channel-icon wechat">
                <MessageCircleMore size={18} />
              </div>
              <div>
                <h2>{"\u5fae\u4fe1"}</h2>
                <p>
                  {
                    "\u5df2\u63a5\u5165\u626b\u7801\u767b\u5f55\u3001\u957f\u8f6e\u8be2\u6536\u6d88\u606f\u3001\u7ebf\u7a0b\u6620\u5c04\u548c\u6587\u672c\u56de\u53d1\u3002"
                  }
                </p>
              </div>
            </div>

            <div className="remote-channel-status-row">
              <span
                className={clsx(
                  "stack-badge",
                  wechatRunning && "active",
                  !wechatRunning && wechatConnected && "warning",
                )}
              >
                {wechatPending
                  ? "\u7b49\u5f85\u626b\u7801"
                  : wechatRunning
                    ? "\u76d1\u542c\u4e2d"
                    : wechatConnected
                      ? "\u5df2\u8fde\u63a5"
                      : "\u672a\u8fde\u63a5"}
              </span>

              <label
                className="provider-switch"
                title={
                  remoteControl.wechat.enabled
                    ? "\u505c\u7528\u5fae\u4fe1\u901a\u9053"
                    : "\u542f\u7528\u5fae\u4fe1\u901a\u9053"
                }
              >
                <input
                  checked={remoteControl.wechat.enabled}
                  onChange={(event) => onToggleWechatEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span className="provider-switch-track">
                  <span className="provider-switch-thumb" />
                </span>
              </label>
            </div>
          </div>

          <div className="remote-channel-meta-grid">
            <div className="remote-meta-item">
              <span>{"\u8d26\u53f7 ID"}</span>
              <strong>{wechat?.accountId || "\u672a\u7ed1\u5b9a"}</strong>
            </div>
            <div className="remote-meta-item">
              <span>{"\u7528\u6237 ID"}</span>
              <strong>{wechat?.userId || "\u672a\u7ed1\u5b9a"}</strong>
            </div>
            <div className="remote-meta-item">
              <span>{"\u4f1a\u8bdd\u6620\u5c04"}</span>
              <strong>{`${wechat?.activePeerCount ?? 0} \u4e2a`}</strong>
            </div>
            <div className="remote-meta-item">
              <span>{"\u6700\u8fd1\u9519\u8bef"}</span>
              <strong>{wechat?.lastError || "\u65e0"}</strong>
            </div>
          </div>

          <div className="remote-channel-actions">
            <button
              className="secondary-button"
              onClick={() => void onStartWechatLogin()}
              disabled={wechatConnecting}
            >
              {wechatConnecting ? <LoaderCircle size={14} className="spin" /> : <QrCode size={14} />}
              {wechatConnected ? "\u91cd\u65b0\u8fde\u63a5" : "\u8fde\u63a5\u5fae\u4fe1"}
            </button>

            <button
              className="ghost-text-button danger"
              onClick={() => void onDisconnectWechat()}
              disabled={!wechatConnected && !wechatPending}
              type="button"
            >
              <Unplug size={16} />
              {"\u65ad\u5f00"}
            </button>
          </div>

          {wechatPending && wechat?.pendingLoginQrCodeUrl ? (
            <div className="remote-qr-panel">
              <div className="remote-qr-copy">
                <strong>{"\u4f7f\u7528\u5fae\u4fe1\u626b\u7801\u5b8c\u6210\u7ed1\u5b9a"}</strong>
                <span>
                  {
                    "\u626b\u7801\u5e76\u5728\u624b\u673a\u4e0a\u786e\u8ba4\u540e\uff0c\u5f53\u524d\u684c\u9762\u667a\u80fd\u4f53\u5c31\u4f1a\u5f00\u59cb\u63a5\u6536\u5fae\u4fe1\u6d88\u606f\u3002"
                  }
                </span>
              </div>
              {qrImageUrl ? (
                <img
                  className="remote-qr-image"
                  src={qrImageUrl}
                  alt={"\u5fae\u4fe1\u767b\u5f55\u4e8c\u7ef4\u7801"}
                />
              ) : (
                <div className="remote-qr-fallback">
                  <span>{"\u4e8c\u7ef4\u7801\u6b63\u5728\u751f\u6210\uff0c\u8bf7\u7a0d\u5019\u2026"}</span>
                </div>
              )}
            </div>
          ) : null}

          <div className="field-note remote-note">
            {
              "\u5f53\u524d\u7248\u672c\u5148\u652f\u6301\u5fae\u4fe1\u6587\u672c\u56de\u590d\uff0c\u4ee5\u53ca\u56fe\u7247/\u6587\u4ef6/\u89c6\u9891\u7684\u57fa\u7840\u5165\u7ad9\u9644\u4ef6\u6865\u63a5\u3002\u9489\u9489\u3001\u98de\u4e66\u3001\u4f01\u5fae\u5148\u4fdd\u7559\u8bbe\u7f6e\u5360\u4f4d\u3002"
            }
          </div>
        </article>

        {PLACEHOLDER_CHANNELS.map((channel) => {
          const Icon = channel.icon;

          return (
            <article key={channel.id} className="panel-card form-card settings-surface remote-channel-card placeholder">
              <div className="remote-channel-head">
                <div className="remote-channel-title">
                  <div className="remote-channel-icon placeholder">
                    <Icon size={18} />
                  </div>
                  <div>
                    <h2>{channel.title}</h2>
                    <p>{channel.description}</p>
                  </div>
                </div>

                <span className="stack-badge">{"\u9884\u7559"}</span>
              </div>

              <div className="remote-placeholder-body">
                <ShieldEllipsis size={18} />
                <span>{"\u672c\u671f\u5148\u5360\u4f4d\uff0c\u7b49\u5f85\u4e0b\u4e00\u9636\u6bb5\u63a5\u5165\u3002"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
