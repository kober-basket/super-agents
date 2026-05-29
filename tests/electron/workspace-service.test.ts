import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeModelId } from "../../src/lib/model-config";
import { findEnabledSkill } from "../../electron/chat/skill-invocation";
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

test("workspace service uses smart review permissions by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    const bootstrap = await service.bootstrap();
    assert.equal(bootstrap.config.security.permissionMode, "smart-review");
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
    const browserAutomation = bootstrap.config.skills.find((skill) => skill.id === "browser-automation");
    const emailAssistant = bootstrap.config.skills.find((skill) => skill.id === "email-assistant");
    const skillCreator = bootstrap.config.skills.find((skill) => skill.id === "skill-creator");
    const docxSkill = bootstrap.config.skills.find((skill) => skill.id === "docx");
    const xlsxSkill = bootstrap.config.skills.find((skill) => skill.id === "xlsx");
    const pptxSkill = bootstrap.config.skills.find((skill) => skill.id === "pptx");
    const pdfSkill = bootstrap.config.skills.find((skill) => skill.id === "pdf");
    const pdfkitSkill = bootstrap.config.skills.find((skill) => skill.id === "pdfkit-py");
    const superpowersTdd = bootstrap.config.skills.find((skill) => skill.id === "test-driven-development");
    const superAgentsAdmin = bootstrap.config.skills.find((skill) => skill.id === "super-agents-admin");
    const wxCli = bootstrap.config.skills.find((skill) => skill.id === "wx-cli");
    const stockResearch = bootstrap.config.skills.find((skill) => skill.id === "stock-market-research-expert");

    const expectedBuiltinSkillNames = [
      "browser-automation",
      "docx",
      "email-assistant",
      "pdf",
      "pdfkit-py",
      "pptx",
      "skill-creator",
      "stock-market-research-expert",
      "super-agents-admin",
      "test-driven-development",
      "wx-cli",
      "xlsx",
    ];
    assert.deepEqual(skillNames.filter((name) => expectedBuiltinSkillNames.includes(name)), expectedBuiltinSkillNames);
    for (const skill of bootstrap.config.skills.filter((item) => item.system)) {
      await access(path.join(skill?.sourcePath ?? "", "assets", "icon.svg"));
      assert.match(skill?.iconDataUrl ?? "", /^data:image\/svg\+xml;base64,/, `${skill.name} should expose a custom SVG icon`);
    }
    assert.ok(browserAutomation);
    assert.equal(browserAutomation?.system, true);
    assert.equal(browserAutomation?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "browser-automation"));
    await access(path.join(browserAutomation?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(browserAutomation?.sourcePath ?? "", "agents", "openai.yaml"));
    assert.equal(browserAutomation?.displayName, "内置浏览器自动化");
    assert.match(browserAutomation?.command ?? "", /browser_snapshot/);
    assert.match(browserAutomation?.defaultPrompt ?? "", /\$browser-automation/);
    assert.ok(emailAssistant);
    assert.equal(emailAssistant?.system, true);
    assert.equal(emailAssistant?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "email-assistant"));
    await access(path.join(emailAssistant?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(emailAssistant?.sourcePath ?? "", "agents", "openai.yaml"));
    assert.equal(emailAssistant?.displayName, "邮件助手");
    assert.match(emailAssistant?.defaultPrompt ?? "", /\$email-assistant/);
    assert.ok(skillCreator);
    assert.equal(skillCreator?.system, true);
    assert.equal(skillCreator?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "skill-creator"));
    await access(path.join(skillCreator?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(skillCreator?.sourcePath ?? "", "agents", "openai.yaml"));
    await access(path.join(skillCreator?.sourcePath ?? "", "assets", "icon.svg"));
    assert.match(skillCreator?.iconDataUrl ?? "", /^data:image\/svg\+xml;base64,/);
    assert.match(skillCreator?.command ?? "", /Anatomy of a Skill/);
    assert.equal(skillCreator?.displayName, "技能创建器");
    assert.equal(skillCreator?.shortDescription, "创建、更新和验证智能体技能结构、资源与触发说明");
    assert.match(skillCreator?.defaultPrompt ?? "", /\$skill-creator/);
    assert.ok(docxSkill);
    assert.equal(docxSkill?.system, true);
    assert.equal(docxSkill?.suiteId, "document-skills");
    assert.equal(docxSkill?.suiteDisplayName, "文档能力");
    assert.equal(docxSkill?.suiteDescription, "Word、Excel、PowerPoint 与 PDF 的内置文档处理能力集合");
    assert.deepEqual(
      docxSkill?.suiteItems?.map((item) => ({ id: item.id, typeLabel: item.typeLabel })),
      [
        { id: "docx", typeLabel: "技能" },
        { id: "xlsx", typeLabel: "技能" },
        { id: "pptx", typeLabel: "技能" },
        { id: "pdf", typeLabel: "技能" },
        { id: "pdfkit-py", typeLabel: "技能" },
      ],
    );
    assert.equal(docxSkill?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "docx"));
    await access(path.join(docxSkill?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(docxSkill?.sourcePath ?? "", "scripts", "accept_changes.py"));
    assert.equal(docxSkill?.displayName, "Word 文档处理");
    assert.match(docxSkill?.defaultPrompt ?? "", /\$docx/);
    assert.ok(xlsxSkill);
    assert.equal(xlsxSkill?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "xlsx"));
    await access(path.join(xlsxSkill?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(xlsxSkill?.sourcePath ?? "", "scripts", "recalc.py"));
    assert.equal(xlsxSkill?.displayName, "Excel 表格处理");
    assert.ok(pptxSkill);
    assert.equal(pptxSkill?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "pptx"));
    await access(path.join(pptxSkill?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(pptxSkill?.sourcePath ?? "", "editing.md"));
    await access(path.join(pptxSkill?.sourcePath ?? "", "scripts", "thumbnail.py"));
    assert.equal(pptxSkill?.displayName, "PowerPoint 演示处理");
    assert.ok(pdfSkill);
    assert.equal(pdfSkill?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "pdf"));
    await access(path.join(pdfSkill?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(pdfSkill?.sourcePath ?? "", "forms.md"));
    await access(path.join(pdfSkill?.sourcePath ?? "", "scripts", "fill_pdf_form_with_annotations.py"));
    assert.equal(pdfSkill?.displayName, "PDF 基础处理");
    assert.ok(pdfkitSkill);
    assert.equal(pdfkitSkill?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "pdfkit-py"));
    await access(path.join(pdfkitSkill?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(pdfkitSkill?.sourcePath ?? "", "scripts", "pdfkit.py"));
    await access(path.join(pdfkitSkill?.sourcePath ?? "", "scripts", "pdfkit", "commands", "smart_edit.py"));
    assert.equal(pdfkitSkill?.displayName, "PDF 高级工具箱");
    assert.ok(superpowersTdd);
    assert.equal(superpowersTdd?.system, true);
    assert.equal(superpowersTdd?.suiteId, "superpowers");
    assert.equal(superpowersTdd?.suiteDisplayName, "Superpowers");
    assert.equal(superpowersTdd?.suiteDescription, "系统化规划、调试、测试、评审与交付流程技能集合");
    assert.equal(superpowersTdd?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "test-driven-development"));
    await access(path.join(superpowersTdd?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(superpowersTdd?.sourcePath ?? "", "agents", "openai.yaml"));
    assert.equal(superpowersTdd?.displayName, "Superpowers：测试驱动开发");
    assert.match(superpowersTdd?.defaultPrompt ?? "", /\$test-driven-development/);
    assert.ok(superAgentsAdmin);
    assert.equal(superAgentsAdmin?.system, true);
    assert.equal(superAgentsAdmin?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "super-agents-admin"));
    await access(path.join(superAgentsAdmin?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(superAgentsAdmin?.sourcePath ?? "", "agents", "openai.yaml"));
    assert.equal(superAgentsAdmin?.displayName, "Super Agents 管理");
    assert.match(superAgentsAdmin?.command ?? "", /super-agents-admin/);
    assert.match(superAgentsAdmin?.defaultPrompt ?? "", /\$super-agents-admin/);
    assert.ok(wxCli);
    assert.equal(wxCli?.system, true);
    assert.equal(wxCli?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "wx-cli"));
    await access(path.join(wxCli?.sourcePath ?? "", "SKILL.md"));
    await access(path.join(wxCli?.sourcePath ?? "", "agents", "openai.yaml"));
    await access(path.join(wxCli?.sourcePath ?? "", "assets", "icon.svg"));
    assert.match(wxCli?.iconDataUrl ?? "", /^data:image\/svg\+xml;base64,/);
    assert.match(wxCli?.command ?? "", /wx history/);
    assert.equal(wxCli?.displayName, "微信本地检索");
    assert.match(wxCli?.defaultPrompt ?? "", /\$wx-cli/);
    assert.ok(stockResearch);
    assert.equal(stockResearch?.system, true);
    assert.equal(stockResearch?.sourcePath, path.join(tempDir, "data", "skills", "builtin", "stock-expert"));
    await access(path.join(stockResearch?.sourcePath ?? "", "agents", "openai.yaml"));
    await access(path.join(stockResearch?.sourcePath ?? "", "assets", "icon.svg"));
    assert.match(stockResearch?.iconDataUrl ?? "", /^data:image\/svg\+xml;base64,/);
    assert.equal(stockResearch?.displayName, "股市调研专家");
    assert.match(stockResearch?.defaultPrompt ?? "", /\$stock-market-research-expert/);
    assert.equal(bootstrap.config.skills.some((skill) => skill.id === "meeting-minutes"), false);

    const context = await service.getEnabledSkillPromptContext();
    assert.match(context, /Available workspace skills for this turn:/);
    assert.match(context, /- document-skills \(suite\): Word、Excel、PowerPoint 与 PDF 的内置文档处理能力集合/);
    assert.match(context, /- superpowers \(suite\): 系统化规划、调试、测试、评审与交付流程技能集合/);
    assert.match(context, /- browser-automation:/);
    assert.match(context, /- docx:/);
    assert.match(context, /- email-assistant:/);
    assert.match(context, /- pdf:/);
    assert.match(context, /- pdfkit-py:/);
    assert.match(context, /- pptx:/);
    assert.match(context, /- skill-creator:/);
    assert.match(context, /- stock-market-research-expert:/);
    assert.match(context, /- test-driven-development:/);
    assert.match(context, /- super-agents-admin:/);
    assert.match(context, /- wx-cli:/);
    assert.match(context, /- xlsx:/);
    assert.doesNotMatch(context, /Anatomy of a Skill/);
    const loadedSuite = findEnabledSkill(bootstrap.config, "document-skills");
    assert.ok(loadedSuite);
    assert.equal(loadedSuite?.name, "document-skills");
    assert.equal(loadedSuite?.displayName, "文档能力");
    assert.match(loadedSuite?.command ?? "", /# Skill: docx/);
    assert.match(loadedSuite?.command ?? "", /# Skill: xlsx/);
    assert.match(loadedSuite?.command ?? "", /Base directory for this skill:/);
    const loadedSuperpowers = findEnabledSkill(bootstrap.config, "Superpowers");
    assert.ok(loadedSuperpowers);
    assert.equal(loadedSuperpowers?.name, "superpowers");
    assert.equal(loadedSuperpowers?.displayName, "Superpowers");
    assert.match(loadedSuperpowers?.command ?? "", /# Skill: test-driven-development/);
    assert.match(loadedSuperpowers?.command ?? "", /# Skill: verification-before-completion/);
    for (const skill of bootstrap.config.skills.filter((item) => item.system)) {
      const visibleName = skill.displayName || skill.name;
      const visibleDescription = skill.shortDescription || skill.description;
      if (skill.id !== "cli-anything") {
        assert.match(visibleName, /[\u4e00-\u9fff]/, `${skill.id} should expose a Chinese UI name`);
      }
      assert.match(visibleDescription, /[\u4e00-\u9fff]/, `${skill.id} should expose a Chinese UI description`);
      const visibleText = [
        skill.description,
        skill.displayName,
        skill.shortDescription,
        skill.defaultPrompt,
        skill.command,
      ].join("\n");
      if (skill.suiteId !== "superpowers") {
        assert.doesNotMatch(visibleText, /\bCodex\b/i, `${skill.id} should use product-neutral wording`);
      }
    }
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service serializes concurrent bootstrap skill syncs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.bootstrap()));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => String(result.reason?.message ?? result.reason));

    assert.deepEqual(failures, []);
    for (const result of results) {
      assert.equal(result.status, "fulfilled");
      assert.deepEqual(
        result.value.config.skills
          .map((skill) => skill.name)
          .sort()
          .filter((name) =>
            [
              "browser-automation",
              "docx",
              "email-assistant",
              "pdf",
              "pdfkit-py",
              "pptx",
              "skill-creator",
              "stock-market-research-expert",
              "super-agents-admin",
              "wx-cli",
              "xlsx",
            ].includes(name),
          ),
        [
          "browser-automation",
          "docx",
          "email-assistant",
          "pdf",
          "pdfkit-py",
          "pptx",
          "skill-creator",
          "stock-market-research-expert",
          "super-agents-admin",
          "wx-cli",
          "xlsx",
        ],
      );
    }
  } finally {
    await service.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace service persists permission mode setting", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const statePath = path.join(tempDir, "data", "workspace.json");
  const service = new WorkspaceService(statePath);

  try {
    await service.updateConfig({
      security: {
        permissionMode: "full-access",
        fullFileSystemAccess: true,
      },
    });

    const nextService = new WorkspaceService(statePath);
    const bootstrap = await nextService.bootstrap();
    assert.equal(bootstrap.config.security.permissionMode, "full-access");
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
      "browser_click",
      "browser_drag",
      "browser_evaluate",
      "browser_fill",
      "browser_fill_form",
      "browser_get_console_message",
      "browser_get_network_request",
      "browser_hover",
      "browser_list_console_messages",
      "browser_list_network_requests",
      "browser_list_pages",
      "browser_navigate",
      "browser_press_key",
      "browser_screenshot",
      "browser_select_page",
      "browser_snapshot",
      "browser_type_text",
      "browser_upload_file",
      "browser_wait_for",
      "edit",
      "glob",
      "grep",
      "list",
      "mail",
      "mail_auth",
      "mail_draft",
      "mail_send",
      "memory",
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
    assert.match(catalog.tools.find((tool) => tool.name === "read")?.description ?? "", /读取 UTF-8 文本文件/);
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

test("workspace service reads openai skill metadata and implicit invocation policy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-workspace-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const statePath = path.join(tempDir, "data", "workspace.json");
  const localSkillRoot = path.join(workspaceRoot, ".super-agents", "skills", "doc-helper");
  const service = new WorkspaceService(statePath);

  await mkdir(path.join(localSkillRoot, "agents"), { recursive: true });
  await writeFile(
    path.join(localSkillRoot, "SKILL.md"),
    ["---", "name: doc-helper", "description: Helps draft docs", "---", "", "# doc-helper", "", "Document carefully."].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(localSkillRoot, "agents", "openai.yaml"),
    [
      "interface:",
      '  display_name: "Docs Helper"',
      '  short_description: "Draft concise project docs"',
      '  default_prompt: "Use $doc-helper to draft a concise project document."',
      "",
      "policy:",
      "  allow_implicit_invocation: false",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    await service.updateConfig({ workspaceRoot });

    const bootstrap = await service.bootstrap();
    const skill = bootstrap.config.skills.find((item) => item.id === "doc-helper");

    assert.ok(skill);
    assert.equal(skill?.displayName, "Docs Helper");
    assert.equal(skill?.shortDescription, "Draft concise project docs");
    assert.equal(skill?.defaultPrompt, "Use $doc-helper to draft a concise project document.");
    assert.equal(skill?.allowImplicitInvocation, false);
    assert.equal(findEnabledSkill(bootstrap.config, "doc-helper")?.id, "doc-helper");

    const context = await service.getEnabledSkillPromptContext();
    assert.doesNotMatch(context, /doc-helper/);
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
