import type * as acp from "@agentclientprotocol/sdk";

import type { AppConfig } from "../../src/types";

export function getDesktopSessionMode(
  config: Pick<AppConfig, "defaultAgentMode">,
  modeState: acp.SessionModeState | null,
) {
  if (!modeState) {
    return null;
  }

  const available = new Set(modeState.availableModes.map((mode) => mode.id));
  if (available.has("build")) {
    return "build";
  }
  if (config.defaultAgentMode === "build") {
    return modeState.currentModeId;
  }
  if (available.has("plan")) {
    return "plan";
  }
  return modeState.currentModeId;
}
