import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ExternalDirectoryDesktopApprovalRequest } from "../../src/types";

function externalDirectoryRequest(): ExternalDirectoryDesktopApprovalRequest {
  return {
    approvalId: "approval-external-directory-1",
    kind: "external_directory",
    sessionId: "session-1",
    agentId: "agent-1",
    toolCallId: "tool-call-1",
    toolName: "list",
    reason: "Tool requested access outside the project root.",
    createdAt: Date.UTC(2026, 4, 30, 8, 0, 0),
    metadata: {
      directory: "C:\\Users\\Administrator\\Desktop",
      targetPath: "C:\\Users\\Administrator\\Desktop",
      workspaceRoot: "C:\\Users\\Administrator\\AppData\\Roaming\\Super Agents\\workspaces\\abc",
    },
  };
}

test("external directory approval renders as an in-chat card", async () => {
  const { ExternalDirectoryRequestCard } = await import(
    "../../src/features/chat/ExternalDirectoryRequestCard.js"
  );

  const html = renderToStaticMarkup(
    <ExternalDirectoryRequestCard request={externalDirectoryRequest()} onResolve={async () => undefined} />,
  );

  assert.match(html, /目录访问确认/);
  assert.match(html, /list/);
  assert.match(html, /C:\\Users\\Administrator\\Desktop/);
  assert.match(html, /允许一次/);
  assert.match(html, /始终允许此目录/);
  assert.match(html, /拒绝/);
  assert.doesNotMatch(html, /Tool requested access outside the project root/);
});

test("external directory approval response can allow once or remember the directory", async () => {
  const { buildExternalDirectoryApprovalResponse } = await import(
    "../../src/features/chat/ExternalDirectoryRequestCard.js"
  );
  const request = externalDirectoryRequest();

  assert.deepEqual(buildExternalDirectoryApprovalResponse(request, false), {
    approvalId: "approval-external-directory-1",
    decision: {
      type: "allow",
      metadata: { rememberDirectory: false },
    },
  });
  assert.deepEqual(buildExternalDirectoryApprovalResponse(request, true), {
    approvalId: "approval-external-directory-1",
    decision: {
      type: "allow",
      metadata: { rememberDirectory: true },
    },
  });
});
