import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("chat can set a draft workspace for new conversations and persist one for existing conversations", () => {
  const appSource = readSource("src/App.tsx");

  assert.match(appSource, /draftConversationWorkspaceRoot/);
  assert.match(appSource, /function\s+resolveActiveConversationWorkspaceRoot\(/);
  assert.match(appSource, /workspaceClient\.updateConversationWorkspaceRoot\(/);
  assert.match(appSource, /setDraftConversationWorkspaceRoot\(directoryPath\)/);
  assert.match(
    appSource,
    /workspaceRoot:\s*activeConversationId\s*\?\s*undefined\s*:\s*draftConversationWorkspaceRoot\.trim\(\)\s*\|\|\s*undefined/s,
  );
});

test("desktop bridge exposes conversation workspace updates end to end", () => {
  assert.match(
    readSource("src/desktop-agent.d.ts"),
    /updateConversationWorkspaceRoot:\s*\(payload:\s*\{\s*conversationId:\s*string;\s*workspaceRoot:\s*string;\s*\}\)\s*=>\s*Promise<ChatConversation>/s,
  );
  assert.match(
    readSource("electron/preload.ts"),
    /updateConversationWorkspaceRoot:\s*\(payload:\s*\{\s*conversationId:\s*string;\s*workspaceRoot:\s*string;\s*\}\)\s*=>\s*ipcRenderer\.invoke\("desktop:update-conversation-workspace-root",\s*payload\)/s,
  );
  assert.match(
    readSource("src/services/workspace-client.ts"),
    /updateConversationWorkspaceRoot:\s*\(payload:\s*Parameters<typeof desktopAgent\.updateConversationWorkspaceRoot>\[0\]\)\s*=>\s*desktopAgent\.updateConversationWorkspaceRoot\(payload\)/s,
  );
  assert.match(
    readSource("electron/main.ts"),
    /ipcMain\.handle\(\s*"desktop:update-conversation-workspace-root"/,
  );
  assert.match(
    readSource("src/services/browser-desktop-agent.ts"),
    /updateConversationWorkspaceRoot:\s*async\s*\(payload:\s*\{\s*conversationId:\s*string;\s*workspaceRoot:\s*string;\s*\}\)/s,
  );
});
