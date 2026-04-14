import assert from "node:assert/strict";
import test from "node:test";

import { getDesktopSessionMode } from "../../../electron/acp/session-mode";

test("desktop chat prefers build mode even when the UI default mode is general", () => {
  const selected = getDesktopSessionMode(
    {
      defaultAgentMode: "general",
    },
    {
      currentModeId: "plan",
      availableModes: [
        { id: "plan", name: "Plan" },
        { id: "build", name: "Build" },
      ],
    },
  );

  assert.equal(selected, "build");
});
