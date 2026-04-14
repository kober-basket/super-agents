import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppTitleBar, describeRuntimeEngineStatus } from "../../src/features/navigation/AppTitleBar";

test("runtime engine status helper describes busy opencode sessions", () => {
  const summary = describeRuntimeEngineStatus({
    engineLabel: "OpenCode",
    hasSession: true,
    busy: true,
    blockedOnQuestion: false,
  });

  assert.equal(summary.label, "运行中");
  assert.equal(summary.detail, "会话正在执行");
  assert.equal(summary.tone, "active");
});

test("AppTitleBar renders runtime engine status in the center slot", () => {
  const markup = renderToStaticMarkup(
    <AppTitleBar
      runtimeStatus={describeRuntimeEngineStatus({
        engineLabel: "OpenCode",
        hasSession: true,
        busy: false,
        blockedOnQuestion: true,
      })}
      view="tools"
      windowState={{ platform: "win32", maximized: false }}
      onClose={() => undefined}
      onMinimize={() => undefined}
      onToggleMaximize={() => undefined}
    />,
  );

  assert.match(markup, /运行引擎/);
  assert.match(markup, /OpenCode/);
  assert.match(markup, /待处理/);
  assert.match(markup, /需要继续答复/);
});
