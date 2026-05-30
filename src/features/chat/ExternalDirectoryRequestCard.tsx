import { Check, FolderOpen, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import type {
  DesktopApprovalResponse,
  ExternalDirectoryDesktopApprovalRequest,
  ExternalDirectoryDesktopApprovalResponse,
} from "../../types";

interface ExternalDirectoryRequestCardProps {
  request: ExternalDirectoryDesktopApprovalRequest;
  onResolve: (response: DesktopApprovalResponse) => void | Promise<void>;
}

function displayPath(pathValue: string | undefined) {
  return pathValue?.trim() || "未知目录";
}

export function buildExternalDirectoryApprovalResponse(
  request: ExternalDirectoryDesktopApprovalRequest,
  rememberDirectory: boolean,
): ExternalDirectoryDesktopApprovalResponse {
  return {
    approvalId: request.approvalId,
    decision: {
      type: "allow",
      metadata: { rememberDirectory },
    },
  };
}

export function ExternalDirectoryRequestCard({ request, onResolve }: ExternalDirectoryRequestCardProps) {
  const [busyAction, setBusyAction] = useState<"once" | "remember" | "deny" | null>(null);
  const directory = displayPath(request.metadata.directory);
  const targetPath = request.metadata.targetPath?.trim();
  const workspaceRoot = request.metadata.workspaceRoot?.trim();

  async function resolve(response: ExternalDirectoryDesktopApprovalResponse, action: "once" | "remember" | "deny") {
    setBusyAction(action);
    try {
      await onResolve(response);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <article className="question-card external-directory-card" data-approval-id={request.approvalId}>
      <header className="question-card-head">
        <div className="question-card-title">
          <ShieldCheck size={15} />
          <strong>目录访问确认</strong>
        </div>
      </header>

      <div className="external-directory-body">
        <div className="external-directory-icon" aria-hidden="true">
          <FolderOpen size={18} />
        </div>
        <div className="external-directory-copy">
          <p>
            <strong>{request.toolName}</strong> 请求访问项目外目录
          </p>
          <code title={directory}>{directory}</code>
          {targetPath && targetPath !== directory ? <span>目标：{targetPath}</span> : null}
          {workspaceRoot ? <span>当前项目：{workspaceRoot}</span> : null}
        </div>
      </div>

      <div className="question-card-actions">
        <button
          className="question-action stop"
          disabled={Boolean(busyAction)}
          onClick={() =>
            void resolve(
              {
                approvalId: request.approvalId,
                decision: { type: "deny", reason: "User denied external directory access." },
              },
              "deny",
            )
          }
          type="button"
        >
          {busyAction === "deny" ? <LoaderCircle className="spin" size={15} /> : <X size={15} />}
          拒绝
        </button>
        <button
          className="question-action secondary"
          disabled={Boolean(busyAction)}
          onClick={() => void resolve(buildExternalDirectoryApprovalResponse(request, false), "once")}
          type="button"
        >
          {busyAction === "once" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          允许一次
        </button>
        <button
          className="question-action primary"
          disabled={Boolean(busyAction)}
          onClick={() => void resolve(buildExternalDirectoryApprovalResponse(request, true), "remember")}
          type="button"
        >
          {busyAction === "remember" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          始终允许此目录
        </button>
      </div>
    </article>
  );
}
