import assert from "node:assert/strict";
import test from "node:test";

import { createSkillToolDefinition } from "../../electron/chat/skill-tool";
import type { AppConfig } from "../../src/types";
import type { WorkspaceService } from "../../electron/workspace-service";

function createConfig(): AppConfig {
  return {
    workspaceRoot: "/tmp/super-agents-test",
    bridgeUrl: "",
    environment: "local",
    defaultAgentMode: "general",
    activeModelId: "",
    contextTier: "medium",
    appearance: { theme: "porcelain" },
    proxy: { http: "", https: "", bypass: "" },
    modelProviders: [],
    mcpServers: [],
    skills: [
      {
        id: "spec-writer",
        name: "spec-writer",
        description: "Write concise specs",
        kind: "command",
        command: "Focus on acceptance criteria:\n$ARGUMENTS",
        enabled: true,
        sourcePath: "/tmp/super-agents-test/.super-agents/skills/spec-writer",
      },
      {
        id: "disabled-skill",
        name: "disabled-skill",
        description: "Should not load",
        kind: "command",
        command: "Do not use",
        enabled: false,
      },
    ],
    knowledgeBase: {
      enabled: false,
      embeddingProviderId: "",
      embeddingModel: "",
      selectedBaseIds: [],
      documentCount: 0,
      chunkSize: 800,
      chunkOverlap: 120,
    },
    remoteControl: {
      dingtalk: { enabled: false, clientId: "", clientSecret: "" },
      feishu: { enabled: false, appId: "", appSecret: "", domain: "feishu" },
      wechat: {
        enabled: false,
        baseUrl: "",
        cdnBaseUrl: "",
        botToken: "",
        accountId: "",
        userId: "",
        connectedAt: null,
      },
      wecom: { enabled: false, botId: "", secret: "", websocketUrl: "" },
    },
    security: { fullFileSystemAccess: false },
  };
}

function createWorkspaceService() {
  return {
    async getConfigSnapshot() {
      return createConfig();
    },
  } as unknown as WorkspaceService;
}

test("skill tool loads enabled skill content with arguments", async () => {
  const tool = createSkillToolDefinition(createWorkspaceService());

  const result = await tool.execute(
    { name: "spec-writer", args: "payment retry flow" },
    {
      sessionId: "session",
      agentId: "agent",
      workspaceRoot: "/tmp/super-agents-test",
    },
  );

  assert.match(result.content, /Loaded skill: spec-writer/);
  assert.match(result.content, /Base directory for this skill:/);
  assert.match(result.content, /Focus on acceptance criteria:\npayment retry flow/);
  assert.equal(result.metadata?.skillId, "spec-writer");
});

test("skill tool rejects disabled or unknown skills", async () => {
  const tool = createSkillToolDefinition(createWorkspaceService());

  await assert.rejects(
    () =>
      tool.execute(
        { name: "disabled-skill" },
        {
          sessionId: "session",
          agentId: "agent",
          workspaceRoot: "/tmp/super-agents-test",
        },
      ),
    /Skill "disabled-skill" is not enabled or does not exist/,
  );
});
