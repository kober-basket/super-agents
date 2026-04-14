import type * as acp from "@agentclientprotocol/sdk";

export function getDesktopClientCapabilities(): acp.ClientCapabilities {
  return {
    fs: {
      readTextFile: true,
      writeTextFile: true,
    },
    terminal: true,
  };
}
