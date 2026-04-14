import type * as acp from "@agentclientprotocol/sdk";

import { readWorkspaceTextFile, writeWorkspaceTextFile } from "./file-access";
import { chooseAutoPermissionResponse } from "./permission-policy";

export interface DesktopAcpTerminalManager {
  createTerminal(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse>;
  terminalOutput(params: acp.TerminalOutputRequest): Promise<acp.TerminalOutputResponse>;
  waitForTerminalExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse>;
  killTerminal(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse>;
  releaseTerminal(params: acp.ReleaseTerminalRequest): Promise<acp.ReleaseTerminalResponse | void>;
}

export interface DesktopAcpPermissionDecision {
  response: acp.RequestPermissionResponse;
  selectedOption: acp.PermissionOption | null;
  sessionId: string;
  toolCall: acp.RequestPermissionRequest["toolCall"];
}

export interface DesktopAcpClientOptions {
  resolveWorkspaceRoot(sessionId: string): string;
  terminalManager: DesktopAcpTerminalManager;
  onPermissionDecision?: (event: DesktopAcpPermissionDecision) => Promise<void> | void;
  onSessionUpdate?: (payload: acp.SessionNotification) => Promise<void> | void;
}

export function createDesktopAcpClient(options: DesktopAcpClientOptions): acp.Client {
  return {
    requestPermission: async (params) => {
      const decision = chooseAutoPermissionResponse(params.options);
      await options.onPermissionDecision?.({
        response: decision.response,
        selectedOption: decision.selectedOption,
        sessionId: params.sessionId,
        toolCall: params.toolCall,
      });
      return decision.response;
    },
    readTextFile: async (params) => {
      return await readWorkspaceTextFile(options.resolveWorkspaceRoot(params.sessionId), params);
    },
    writeTextFile: async (params) => {
      return await writeWorkspaceTextFile(options.resolveWorkspaceRoot(params.sessionId), params);
    },
    createTerminal: async (params) => {
      return await options.terminalManager.createTerminal(params);
    },
    terminalOutput: async (params) => {
      return await options.terminalManager.terminalOutput(params);
    },
    waitForTerminalExit: async (params) => {
      return await options.terminalManager.waitForTerminalExit(params);
    },
    killTerminal: async (params) => {
      return await options.terminalManager.killTerminal(params);
    },
    releaseTerminal: async (params) => {
      return await options.terminalManager.releaseTerminal(params);
    },
    sessionUpdate: async (payload) => {
      await options.onSessionUpdate?.(payload);
    },
  };
}
