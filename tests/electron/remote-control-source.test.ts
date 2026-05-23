import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

test("stopping WeChat remote control clears stale runtime errors", () => {
  const source = readSource("electron/remote-control-service.ts");
  const stopWechatMonitor = source.match(/private async stopWechatMonitor\(\) \{(?<body>[\s\S]*?)\n  \}/)
    ?.groups?.body;

  assert.ok(stopWechatMonitor, "stopWechatMonitor should exist");
  assert.match(stopWechatMonitor, /this\.runtimes\.wechat\.lastError\s*=\s*""/);
});
