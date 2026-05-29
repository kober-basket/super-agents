import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConversationService } from "../../electron/conversation-service";

const repositoryRoot = path.resolve(__dirname, "..", "..", "..");

function runCli(args: string[], input?: string) {
  const scriptPath = path.join(repositoryRoot, "scripts", "super-agents.mjs");
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
  });
}

function runAdminCli(args: string[]) {
  const scriptPath = path.join(repositoryRoot, "scripts", "super-agents-admin.mjs");
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function parseStdout(result: ReturnType<typeof spawnSync>) {
  assert.equal(result.status, 0, String(result.stderr));
  return JSON.parse(String(result.stdout));
}

async function readState(statePath: string) {
  return JSON.parse(await readFile(statePath, "utf8")) as any;
}

test("super-agents CLI reports status and runs config mutations through session undo/redo", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-cli-"));
  const statePath = path.join(tempDir, "workspace.json");

  try {
    const status = parseStdout(runCli(["--user-data", tempDir, "--json", "status"]));
    assert.equal(status.ok, true);
    assert.equal(status.command, "status");
    assert.equal(status.paths.userData, tempDir);
    assert.equal(status.paths.statePath, statePath);
    assert.ok(status.capabilities.includes("sessions"));
    assert.ok(status.capabilities.includes("undo"));

    const created = parseStdout(runCli(["--user-data", tempDir, "--json", "session", "new", "--name", "work"]));
    assert.equal(created.result.session.name, "work");
    assert.equal(existsSync(created.result.session.path), true);

    const patched = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--session",
      "work",
      "--json",
      "config",
      "patch",
      "--set",
      "contextTier=low",
      "--set",
      "security.fullFileSystemAccess=false",
    ]));
    assert.deepEqual(patched.result.changedPaths, ["contextTier", "security.fullFileSystemAccess"]);

    let state = await readState(statePath);
    assert.equal(state.config.contextTier, "low");
    assert.equal(state.config.security.fullFileSystemAccess, false);

    const history = parseStdout(runCli(["--user-data", tempDir, "--session", "work", "--json", "session", "history"]));
    assert.equal(history.result.history.length, 1);
    assert.equal(history.result.history[0].command, "config patch");

    const undo = parseStdout(runCli(["--user-data", tempDir, "--session", "work", "--json", "session", "undo"]));
    assert.equal(undo.result.undone.command, "config patch");
    state = await readState(statePath);
    assert.equal(state.config.contextTier, "high");
    assert.equal(state.config.security.permissionMode, "smart-review");
    assert.equal(state.config.security.fullFileSystemAccess, false);

    const redo = parseStdout(runCli(["--user-data", tempDir, "--session", "work", "--json", "session", "redo"]));
    assert.equal(redo.result.redone.command, "config patch");
    state = await readState(statePath);
    assert.equal(state.config.contextTier, "low");
    assert.equal(state.config.security.fullFileSystemAccess, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("super-agents CLI manages providers, models, permissions, and MCP servers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-cli-"));
  const statePath = path.join(tempDir, "workspace.json");

  try {
    const provider = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "model",
      "provider",
      "add",
      "--id",
      "Acme AI",
      "--name",
      "Acme AI",
      "--base-url",
      "https://api.acme.test/v1/",
      "--api-key",
      "sk-acme",
      "--model",
      "acme-chat:Acme Chat",
      "--set-active",
    ]));
    assert.equal(provider.result.provider.id, "acme-ai");
    assert.equal(provider.result.activeModelId, "acme-ai::acme-chat");
    assert.doesNotMatch(provider.resultText ?? JSON.stringify(provider), /sk-acme/);

    const addedModel = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "model",
      "add",
      "--provider",
      "acme-ai",
      "--id",
      "acme-embed",
      "--label",
      "Acme Embed",
    ]));
    assert.equal(addedModel.result.model.id, "acme-embed");

    const active = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "model",
      "set-active",
      "--provider",
      "acme-ai",
      "--model",
      "acme-embed",
    ]));
    assert.equal(active.result.activeModelId, "acme-ai::acme-embed");

    const permission = parseStdout(runCli(["--user-data", tempDir, "--json", "permission", "full-access", "on"]));
    assert.equal(permission.result.permissionMode, "full-access");
    assert.equal(permission.result.fullFileSystemAccess, true);

    const mcp = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "mcp",
      "add",
      "--id",
      "filesystem",
      "--name",
      "Files",
      "--command",
      "node",
      "--arg",
      "server.js",
      "--env",
      "FOO=bar",
      "--env",
      "OPENAI_API_KEY=sk-mcp-secret-token-1234567890",
    ]));
    assert.equal(mcp.result.server.id, "filesystem");
    assert.doesNotMatch(JSON.stringify(mcp), /sk-mcp-secret-token/);

    const disabled = parseStdout(runCli(["--user-data", tempDir, "--json", "mcp", "disable", "--id", "filesystem"]));
    assert.equal(disabled.result.server.enabled, false);

    const state = await readState(statePath);
    assert.equal(state.config.activeModelId, "acme-ai::acme-embed");
    assert.equal(state.config.security.permissionMode, "full-access");
    assert.equal(state.config.security.fullFileSystemAccess, true);
    assert.deepEqual(state.config.mcpServers[0].args, ["server.js"]);
    assert.deepEqual(JSON.parse(state.config.mcpServers[0].envJson), {
      FOO: "bar",
      OPENAI_API_KEY: "sk-mcp-secret-token-1234567890",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("super-agents CLI preserves builtin provider names and refuses removal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-cli-"));
  const statePath = path.join(tempDir, "workspace.json");

  try {
    const provider = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "model",
      "provider",
      "add",
      "--id",
      "openai",
      "--name",
      "Renamed OpenAI",
      "--base-url",
      "https://proxy.example.com/v1",
      "--model",
      "gpt-local:GPT Local",
    ]));

    assert.equal(provider.result.provider.id, "openai");
    assert.equal(provider.result.provider.name, "OpenAI");
    assert.equal(provider.result.provider.system, true);

    const remove = runCli([
      "--user-data",
      tempDir,
      "--json",
      "--yes",
      "model",
      "provider",
      "remove",
      "--provider",
      "openai",
    ]);

    assert.notEqual(remove.status, 0);
    const errorPayload = JSON.parse(String(remove.stdout));
    assert.equal(errorPayload.ok, false);
    assert.match(errorPayload.error.message, /内置模型提供商不可删除/);

    const state = await readState(statePath);
    assert.equal(state.config.modelProviders.find((item: any) => item.id === "openai")?.name, "OpenAI");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("super-agents CLI manages memory, knowledge bases, skills, and tool discovery", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-cli-"));

  try {
    const added = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "memory",
      "add",
      "--type",
      "project_context",
      "--title",
      "CLI policy",
      "--content",
      "Prefer JSON output when another agent invokes the harness.",
      "--tag",
      "cli",
    ]));
    const memoryId = added.result.entry.id;
    assert.equal(added.result.entry.title, "CLI policy");

    const searched = parseStdout(runCli(["--user-data", tempDir, "--json", "memory", "search", "--query", "JSON"]));
    assert.equal(searched.result.total, 1);
    assert.equal(searched.result.entries[0].id, memoryId);

    const updated = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "memory",
      "update",
      "--id",
      memoryId,
      "--title",
      "Agent CLI policy",
    ]));
    assert.equal(updated.result.entry.title, "Agent CLI policy");

    const knowledge = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "knowledge",
      "base",
      "create",
      "--id",
      "product",
      "--name",
      "Product Notes",
    ]));
    assert.equal(knowledge.result.base.id, "product");

    const skills = parseStdout(runCli(["--user-data", tempDir, "--json", "skill", "list"]));
    assert.ok(skills.result.skills.some((skill: any) => skill.id === "super-agents-admin" && skill.source === "builtin"));

    const tools = parseStdout(runCli(["--user-data", tempDir, "--json", "tools", "list"]));
    assert.ok(tools.result.tools.some((tool: any) => tool.name === "memory"));
    assert.ok(tools.result.tools.some((tool: any) => tool.name === "web_search"));

    const removed = parseStdout(runCli(["--user-data", tempDir, "--json", "memory", "delete", "--id", memoryId, "--yes"]));
    assert.equal(removed.result.deleted, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("super-agents CLI can inspect, rename, export, and delete conversations", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-cli-"));
  const databasePath = path.join(tempDir, "data", "app.db");
  const exportPath = path.join(tempDir, "conversation.md");
  const service = new ConversationService(databasePath);
  await service.initialize();

  try {
    const created = await service.sendMessage({ content: "export this conversation" });
    const conversationId = created.conversation.id;

    const listed = parseStdout(runCli(["--user-data", tempDir, "--json", "conversation", "list"]));
    assert.equal(listed.result.conversations.length, 1);
    assert.equal(listed.result.conversations[0].id, conversationId);

    const shown = parseStdout(runCli(["--user-data", tempDir, "--json", "conversation", "show", "--id", conversationId]));
    assert.equal(shown.result.conversation.messages.length, 2);

    const renamed = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "conversation",
      "rename",
      "--id",
      conversationId,
      "--title",
      "CLI export flow",
    ]));
    assert.equal(renamed.result.conversation.title, "CLI export flow");

    const exported = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "conversation",
      "export",
      "--id",
      conversationId,
      "--format",
      "markdown",
      "--out",
      exportPath,
    ]));
    assert.equal(exported.result.path, exportPath);
    assert.match(await readFile(exportPath, "utf8"), /export this conversation/);

    const deleted = parseStdout(runCli([
      "--user-data",
      tempDir,
      "--json",
      "conversation",
      "delete",
      "--id",
      conversationId,
      "--yes",
    ]));
    assert.equal(deleted.result.deleted, true);
    assert.equal((await service.listConversations()).conversations.length, 0);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("super-agents admin remains compatible and the main CLI can run stdin commands as a REPL", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-cli-"));

  try {
    const adminHelp = runAdminCli(["--help"]);
    assert.equal(adminHelp.status, 0, String(adminHelp.stderr));
    assert.match(adminHelp.stdout, /Usage: super-agents/);

    const repl = runCli(["--user-data", tempDir], "status --json\nexit\n");
    assert.equal(repl.status, 0, String(repl.stderr));
    assert.match(repl.stdout, /Super Agents CLI/);
    assert.match(repl.stdout, /"command": "status"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
