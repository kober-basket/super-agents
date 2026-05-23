import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const sourcePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(sourcePath, "utf8");
}

test("chat sending uses a synchronous in-flight guard before invoking the desktop turn", () => {
  const appSource = readSource("src/App.tsx");

  assert.match(appSource, /chatTurnStartInFlightRef\s*=\s*useRef\(false\)/);
  assert.match(
    appSource,
    /if\s*\(\s*chatTurnStartInFlightRef\.current\s*\|\|\s*activeConversationBusy\s*\)\s*{\s*return;\s*}/s,
  );
  assert.match(
    appSource,
    /chatTurnStartInFlightRef\.current\s*=\s*true;[\s\S]*finally\s*{[\s\S]*chatTurnStartInFlightRef\.current\s*=\s*false;/,
  );
});

test("chat sending treats backend already-running errors as active conversation state", () => {
  const appSource = readSource("src/App.tsx");

  assert.match(appSource, /function\s+isConversationAlreadyRunningError\(error:\s*unknown\)/);
  assert.match(appSource, /const\s+alreadyRunning\s*=\s*isConversationAlreadyRunningError\(error\)/);
  assert.match(appSource, /if\s*\(\s*alreadyRunning\s*&&\s*previousConversationId\s*\)/);
  assert.match(appSource, /status:\s*"running"/);
});
