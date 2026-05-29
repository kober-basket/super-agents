import assert from "node:assert/strict";
import test from "node:test";

import { prepareChatPrompt } from "../../electron/chat/prompt-context";
import type { AppConfig, SkillConfig } from "../../src/types";
import type { WorkspaceService } from "../../electron/workspace-service";

function createConfig(skills: SkillConfig[] = []): AppConfig {
  return {
    workspaceRoot: "/tmp/super-agents-test",
    bridgeUrl: "",
    environment: "local",
    defaultAgentMode: "general",
    activeModelId: "",
    imageRecognition: { fallbackModelId: "" },
    contextTier: "medium",
    appearance: { theme: "porcelain" },
    proxy: { http: "", https: "", bypass: "" },
    modelProviders: [],
    mcpServers: [],
    skills,
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
    security: { permissionMode: "smart-review", fullFileSystemAccess: false },
  };
}

function createWorkspaceService(config = createConfig(), skillContext = "") {
  return {
    async getConfigSnapshot() {
      return config;
    },
    async getEnabledSkillPromptContext() {
      return skillContext;
    },
    async searchKnowledgeBases() {
      return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
    },
  } as unknown as WorkspaceService;
}

test("explicit dollar skill invocation injects the requested skill and strips the command prefix", async () => {
  const skillRoot = "/tmp/super-agents-test/.super-agents/skills/spec-writer";
  const prepared = await prepareChatPrompt({
    chatInput: { content: "$spec-writer API contract notes" },
    selectedKnowledgeBaseIds: [],
    workspaceService: createWorkspaceService(
      createConfig([
        {
          id: "spec-writer",
          name: "spec-writer",
          description: "Write concise specs",
          kind: "command",
          command: "Write acceptance criteria for:\n$ARGUMENTS",
          enabled: true,
          sourcePath: skillRoot,
        },
      ]),
    ),
  });

  assert.equal(prepared.content, "API contract notes");
  assert.match(prepared.workspacePrompt, /Explicit skill invocation/i);
  assert.match(prepared.workspacePrompt, /# Skill: spec-writer/);
  assert.match(prepared.workspacePrompt, /Base directory for this skill:/);
  assert.match(prepared.workspacePrompt, /Write acceptance criteria for:\nAPI contract notes/);
});

test("markdown dollar skill mentions are treated as explicit skill invocations", async () => {
  const prepared = await prepareChatPrompt({
    chatInput: { content: "[$spec-writer](/skills/spec-writer) Draft a launch checklist" },
    selectedKnowledgeBaseIds: [],
    workspaceService: createWorkspaceService(
      createConfig([
        {
          id: "spec-writer",
          name: "spec-writer",
          description: "Write concise specs",
          kind: "command",
          command: "Checklist mode:\n$ARGUMENTS",
          enabled: true,
        },
      ]),
    ),
  });

  assert.equal(prepared.content, "Draft a launch checklist");
  assert.match(prepared.workspacePrompt, /# Skill: spec-writer/);
  assert.match(prepared.workspacePrompt, /Checklist mode:\nDraft a launch checklist/);
});

test("multiple markdown skill mentions load every requested skill and strip inline mentions", async () => {
  const prepared = await prepareChatPrompt({
    chatInput: {
      content: "[$spec-writer](skill://spec-writer) Draft with [$reviewer](skill://reviewer) please",
    },
    selectedKnowledgeBaseIds: [],
    workspaceService: createWorkspaceService(
      createConfig([
        {
          id: "spec-writer",
          name: "spec-writer",
          description: "Write concise specs",
          kind: "command",
          command: "Spec mode:\n$ARGUMENTS",
          enabled: true,
        },
        {
          id: "reviewer",
          name: "reviewer",
          description: "Review drafts",
          kind: "command",
          command: "Review mode:\n$ARGUMENTS",
          enabled: true,
        },
      ]),
    ),
  });

  assert.equal(prepared.content, "Draft with please");
  assert.match(prepared.workspacePrompt, /# Skill: spec-writer/);
  assert.match(prepared.workspacePrompt, /# Skill: reviewer/);
  assert.match(prepared.workspacePrompt, /Spec mode:\nDraft with please/);
  assert.match(prepared.workspacePrompt, /Review mode:\nDraft with please/);
});

test("market research prompts do not get a hard-coded core evidence gate", async () => {
  const prepared = await prepareChatPrompt({
    chatInput: { content: "深度分析下黄金走势" },
    selectedKnowledgeBaseIds: [],
    workspaceService: createWorkspaceService(),
  });

  assert.doesNotMatch(prepared.workspacePrompt, /Market research evidence gate/);
  assert.doesNotMatch(prepared.workspacePrompt, /GoldSilver|ProfitByFriday/);
});

test("permission mode controls whether prompt context grants full filesystem access", async () => {
  const smartReview = await prepareChatPrompt({
    chatInput: { content: "check the project" },
    selectedKnowledgeBaseIds: [],
    workspaceService: createWorkspaceService({
      ...createConfig(),
      security: { permissionMode: "smart-review", fullFileSystemAccess: true },
    }),
  });

  assert.equal(smartReview.fullFileSystemAccess, false);

  const fullAccess = await prepareChatPrompt({
    chatInput: { content: "check the project" },
    selectedKnowledgeBaseIds: [],
    workspaceService: createWorkspaceService({
      ...createConfig(),
      security: { permissionMode: "full-access", fullFileSystemAccess: false },
    }),
  });

  assert.equal(fullAccess.fullFileSystemAccess, true);
});
