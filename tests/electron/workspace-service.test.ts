import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeModelId } from "../../src/lib/model-config";
import { getAudioTranscriptionModelCandidates, WorkspaceService } from "../../electron/workspace-service";

test("audio transcription candidates prefer configured speech models before fallbacks", () => {
  const candidates = getAudioTranscriptionModelCandidates({
    id: "openai",
    name: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    temperature: 0.2,
    maxTokens: 4096,
    enabled: true,
    models: [
      { id: "gpt-5", label: "GPT-5", enabled: true },
      { id: "whisper-large-v3", label: "Whisper Large V3", enabled: true },
    ],
  });

  assert.equal(candidates[0], "whisper-large-v3");
  assert.deepEqual(candidates.slice(1, 4), [
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe",
    "whisper-1",
  ]);
});

test("audio transcription uses a speech-capable provider when the active provider does not support it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; model: string }> = [];

  globalThis.fetch = (async (url, init) => {
    const body = init?.body instanceof FormData ? init.body : null;
    calls.push({
      url: String(url),
      model: String(body?.get("model") ?? ""),
    });

    if (String(url).startsWith("https://api.deepseek.com")) {
      return new Response(JSON.stringify({ error: { message: "model not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ text: "你好" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await service.updateConfig({
      activeModelId: createRuntimeModelId("deepseek", "deepseek-chat"),
      modelProviders: [
        {
          id: "deepseek",
          name: "DeepSeek",
          kind: "openai-compatible",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-deepseek",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [{ id: "deepseek-chat", label: "DeepSeek Chat", enabled: true }],
        },
        {
          id: "openai",
          name: "OpenAI",
          kind: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-openai",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [{ id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", enabled: true }],
        },
      ],
    });

    const result = await service.transcribeAudio({
      providerId: "deepseek",
      fileName: "voice-input.webm",
      mimeType: "audio/webm",
      audioBase64: Buffer.from("fake audio").toString("base64"),
      language: "zh",
    });

    assert.equal(result.text, "你好");
    assert.equal(result.providerId, "openai");
    assert.equal(result.modelId, "gpt-4o-mini-transcribe");
    assert.deepEqual(calls, [
      {
        url: "https://api.openai.com/v1/audio/transcriptions",
        model: "gpt-4o-mini-transcribe",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audio transcription retries fallback models when a distributor has no channel for the first model", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);
  const originalFetch = globalThis.fetch;
  const models: string[] = [];

  globalThis.fetch = (async (_url, init) => {
    const body = init?.body instanceof FormData ? init.body : null;
    const model = String(body?.get("model") ?? "");
    models.push(model);

    if (model === "gpt-4o-mini-transcribe") {
      return new Response(
        JSON.stringify({
          error: {
            message:
              "No available channel for model gpt-4o-mini-transcribe under group default (distributor)",
          },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ text: "你好" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await service.updateConfig({
      activeModelId: createRuntimeModelId("openai", "gpt-5-mini"),
      modelProviders: [
        {
          id: "openai",
          name: "OpenAI",
          kind: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-openai",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [
            { id: "gpt-5-mini", label: "GPT-5 Mini", enabled: true },
            { id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", enabled: true },
          ],
        },
      ],
    });

    const result = await service.transcribeAudio({
      providerId: "openai",
      fileName: "voice-input.webm",
      mimeType: "audio/webm",
      audioBase64: Buffer.from("fake audio").toString("base64"),
      language: "zh",
    });

    assert.equal(result.text, "你好");
    assert.equal(result.modelId, "gpt-4o-transcribe");
    assert.deepEqual(models, ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"]);
  } finally {
    globalThis.fetch = originalFetch;
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audio transcription prefers speech providers over the active chat provider", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (url) => {
    urls.push(String(url));
    if (String(url).startsWith("https://api.anthropic.com")) {
      throw new TypeError("fetch failed");
    }

    return new Response(JSON.stringify({ text: "你好" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await service.updateConfig({
      activeModelId: createRuntimeModelId("anthropic", "claude-4.6-sonnet"),
      modelProviders: [
        {
          id: "anthropic",
          name: "Anthropic",
          kind: "openai-compatible",
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: "sk-anthropic",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [{ id: "claude-4.6-sonnet", label: "Claude Sonnet 4.6", enabled: true }],
        },
        {
          id: "openai",
          name: "OpenAI",
          kind: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-openai",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [{ id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", enabled: true }],
        },
      ],
    });

    const result = await service.transcribeAudio({
      providerId: "anthropic",
      fileName: "voice-input.webm",
      mimeType: "audio/webm",
      audioBase64: Buffer.from("fake audio").toString("base64"),
      language: "zh",
    });

    assert.equal(result.providerId, "openai");
    assert.deepEqual(urls, ["https://api.openai.com/v1/audio/transcriptions"]);
  } finally {
    globalThis.fetch = originalFetch;
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audio transcription tries the next speech provider after a connection failure", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (url) => {
    urls.push(String(url));
    if (String(url).startsWith("http://127.0.0.1:8787")) {
      throw new TypeError("fetch failed");
    }

    return new Response(JSON.stringify({ text: "你好" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await service.updateConfig({
      activeModelId: createRuntimeModelId("local-speech", "gpt-4o-mini-transcribe"),
      modelProviders: [
        {
          id: "local-speech",
          name: "Local Speech",
          kind: "openai-compatible",
          baseUrl: "http://127.0.0.1:8787/v1",
          apiKey: "sk-local",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [{ id: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", enabled: true }],
        },
        {
          id: "remote-speech",
          name: "Remote Speech",
          kind: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-remote",
          temperature: 0.2,
          maxTokens: 4096,
          enabled: true,
          models: [{ id: "whisper-1", label: "Whisper", enabled: true }],
        },
      ],
    });

    const result = await service.transcribeAudio({
      providerId: "local-speech",
      fileName: "voice-input.webm",
      mimeType: "audio/webm",
      audioBase64: Buffer.from("fake audio").toString("base64"),
      language: "zh",
    });

    assert.equal(result.providerId, "remote-speech");
    assert.deepEqual(urls, [
      "http://127.0.0.1:8787/v1/audio/transcriptions",
      "https://api.example.com/v1/audio/transcriptions",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service keeps full filesystem access disabled by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    const bootstrap = await service.bootstrap();
    assert.equal(bootstrap.config.security.fullFileSystemAccess, false);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service bootstraps copied built-in skills without legacy sample skills", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    const bootstrap = await service.bootstrap();
    const skillNames = bootstrap.config.skills.map((skill) => skill.name).sort();
    const skillCreator = bootstrap.config.skills.find((skill) => skill.id === "skill-creator");
    const wxCli = bootstrap.config.skills.find((skill) => skill.id === "wx-cli");

    assert.deepEqual(skillNames, ["skill-creator", "wx-cli"]);
    assert.ok(skillCreator);
    assert.equal(skillCreator?.system, true);
    assert.equal(skillCreator?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "skill-creator"));
    await access(path.join(skillCreator?.sourcePath ?? "", "SKILL.md"));
    assert.match(skillCreator?.command ?? "", /Anatomy of a Skill/);
    assert.ok(wxCli);
    assert.equal(wxCli?.system, true);
    assert.equal(wxCli?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "wx-cli"));
    await access(path.join(wxCli?.sourcePath ?? "", "SKILL.md"));
    assert.match(wxCli?.command ?? "", /wx history/);
    assert.equal(bootstrap.config.skills.some((skill) => skill.id === "meeting-minutes"), false);

    const context = await service.getEnabledSkillPromptContext();
    assert.match(context, /Available workspace skills for this turn:/);
    assert.match(context, /- skill-creator:/);
    assert.match(context, /- wx-cli:/);
    assert.doesNotMatch(context, /Anatomy of a Skill/);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service persists full filesystem access setting", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    await service.updateConfig({
      security: {
        fullFileSystemAccess: true,
      },
    });

    const nextService = new WorkspaceService(statePath);
    const bootstrap = await nextService.bootstrap();
    assert.equal(bootstrap.config.security.fullFileSystemAccess, true);
    await nextService.shutdown();
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service imports a local skill into the workspace skill directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const sourceSkillDir = path.join(tempDir, "local-skill");
  const workspaceRoot = path.join(tempDir, "workspace");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  await mkdir(sourceSkillDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    path.join(sourceSkillDir, "SKILL.md"),
    ["---", "name: local-helper", "description: Imported from disk", "---", "", "# local-helper"].join("\n"),
    "utf8",
  );

  try {
    await service.updateConfig({ workspaceRoot });

    const result = await service.importLocalSkill(sourceSkillDir);
    const importedPath = path.join(workspaceRoot, ".super-agents", "skills", "local-skill", "SKILL.md");

    await access(importedPath);
    assert.equal(result.importedSkillName, "local-helper");
    assert.equal(result.importedTo, path.dirname(importedPath));
    assert.equal(
      result.bootstrap.config.skills.some(
        (skill) => skill.kind === "command" && skill.name === "local-helper" && skill.sourcePath === path.dirname(importedPath),
      ),
      true,
    );
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service bootstrap exposes discovered runtime skills", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const skillRoot = path.join(workspaceRoot, ".super-agents", "skills", "doc-helper");
  const service = new WorkspaceService(statePath);

  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    ["---", "name: doc-helper", "description: Helps draft docs", "---", "", "# doc-helper", "", "Document carefully."].join("\n"),
    "utf8",
  );

  try {
    await service.updateConfig({ workspaceRoot });

    const bootstrap = await service.bootstrap();
    const skill = bootstrap.availableSkills.find((item) => item.name === "doc-helper");

    assert.ok(skill);
    assert.equal(skill?.description, "Helps draft docs");
    assert.match(skill?.content ?? "", /Document carefully\./);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service lists built-in agent tools instead of runtime tools", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    const catalog = await service.listBuiltinTools();
    const names = catalog.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      "apply_patch",
      "bash",
      "edit",
      "glob",
      "grep",
      "list",
      "multi_edit",
      "question",
      "read",
      "todo_read",
      "todo_write",
      "web_fetch",
      "web_search",
      "write",
    ]);
    assert.equal(catalog.tools.every((tool) => tool.source === "builtin"), true);
    assert.equal(catalog.tools.some((tool) => String(tool.source) === "runtime"), false);
    assert.match(catalog.tools.find((tool) => tool.name === "read")?.description ?? "", /UTF-8 text file/i);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service builds a skill index from enabled skills only", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const localSkillRoot = path.join(workspaceRoot, ".super-agents", "skills", "spec-writer");
  const service = new WorkspaceService(statePath);

  await mkdir(localSkillRoot, { recursive: true });
  await writeFile(
    path.join(localSkillRoot, "SKILL.md"),
    ["---", "name: spec-writer", "description: Write concise specs", "---", "", "# spec-writer", "", "Focus on acceptance criteria."].join("\n"),
    "utf8",
  );

  try {
    await service.updateConfig({
      workspaceRoot,
      skills: [
        {
          id: "spec-writer",
          name: "spec-writer",
          description: "Write concise specs",
          kind: "command",
          command: "Focus on acceptance criteria.",
          enabled: true,
          sourcePath: localSkillRoot,
        },
        {
          id: "brief-writer",
          name: "brief-writer",
          description: "Turn notes into a brief",
          kind: "command",
          command: "Summarize notes:\n$ARGUMENTS",
          enabled: true,
        },
        {
          id: "disabled-skill",
          name: "disabled-skill",
          description: "Should not appear",
          kind: "command",
          command: "Ignore this:\n$ARGUMENTS",
          enabled: false,
        },
      ],
    });

    const context = await service.getEnabledSkillPromptContext();

    assert.match(context, /Available workspace skills for this turn:/);
    assert.match(context, /call the `skill` tool/i);
    assert.match(context, /- spec-writer: Write concise specs/);
    assert.ok(context.includes(`Skill directory: ${localSkillRoot}`));
    assert.doesNotMatch(context, /Focus on acceptance criteria\./);
    assert.match(context, /- brief-writer: Turn notes into a brief/);
    assert.doesNotMatch(context, /Summarize notes/);
    assert.doesNotMatch(context, /disabled-skill/);
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service rejects local skill directories without SKILL.md", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const sourceSkillDir = path.join(tempDir, "invalid-skill");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  await mkdir(sourceSkillDir, { recursive: true });
  await writeFile(path.join(sourceSkillDir, "README.md"), "# not a skill", "utf8");

  try {
    await assert.rejects(
      service.importLocalSkill(sourceSkillDir),
      /SKILL\.md/,
    );
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});
