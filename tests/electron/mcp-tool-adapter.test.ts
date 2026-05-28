import assert from "node:assert/strict";
import test from "node:test";

import { createMcpToolDefinition } from "../../electron/agent-core/mcp-tool-adapter";

test("MCP adapter emits progress output before debugTool finishes", async () => {
  let resolveTool!: () => void;
  const toolCanFinish = new Promise<void>((resolve) => {
    resolveTool = resolve;
  });
  const outputChunks: Array<{ stream: string; text: string }> = [];
  const tool = createMcpToolDefinition({
    server: {
      id: "local-server",
      name: "Local Server",
      transport: "local",
      command: "node",
      args: [],
      url: "",
      headersJson: "",
      envJson: "{}",
      enabled: true,
      timeoutMs: 30_000,
    },
    tool: {
      name: "probe",
      title: "Probe",
      description: "Probe tool",
      serverId: "local-server",
      serverName: "Local Server",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      parameters: [],
    },
    workspaceRoot: process.cwd(),
    inspector: {
      async debugTool() {
        await toolCanFinish;
        return {
          isError: false,
          content: "probe result",
          serverId: "local-server",
          serverName: "Local Server",
          toolName: "probe",
          transport: "stdio",
          rawJson: "{}",
        };
      },
    } as never,
  });

  const resultPromise = tool.execute(
    {},
    {
      sessionId: "mcp-progress-session",
      agentId: "agent-1",
      workspaceRoot: process.cwd(),
      toolCall: { id: "mcp-call", name: tool.name, input: {} },
      emitOutput: (output) => {
        outputChunks.push(output);
      },
    },
  );

  assert.match(outputChunks.map((output) => output.text).join(""), /Calling MCP tool/);
  resolveTool();
  const result = await resultPromise;
  assert.equal(result.content, "probe result");
});
