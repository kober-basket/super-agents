import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBuiltinToolDefinitions } from "../../electron/agent-core/builtin-tools";
import type { ToolDefinition } from "../../electron/agent-core";

function toolByName(name: string): ToolDefinition {
  const tool = createBuiltinToolDefinitions().find((item) => item.name === name);
  assert.ok(tool, `Expected built-in tool ${name} to exist`);
  return tool;
}

function createContext(workspaceRoot: string, sessionId = "session-1") {
  return {
    sessionId,
    agentId: "agent-1",
    workspaceRoot,
    toolCall: { id: `${sessionId}-call`, name: "test", input: {} },
  };
}

async function waitForCondition(check: () => boolean, label: string, timeoutMs = 1_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("question asks for user input through approval handler and returns answers", async () => {
  const question = toolByName("question");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-question-"));

  try {
    let requestedKind = "";
    const result = await question.execute(
      {
        questions: [
          {
            id: "approach",
            header: "Approach",
            question: "Which approach should we use?",
            options: [
              { label: "Focused", description: "Implement the narrow path first." },
              { label: "Broad", description: "Implement every adjacent tool now." },
            ],
          },
        ],
      },
      {
        ...createContext(tempDir),
        requestApproval: async (request) => {
          requestedKind = request.kind ?? "";
          return {
            type: "allow",
            metadata: {
              answers: [{ id: "approach", question: "Which approach should we use?", answer: "Focused" }],
            },
          };
        },
      },
    );

    assert.equal(requestedKind, "question");
    assert.match(result.content, /Which approach should we use\?/);
    assert.match(result.content, /Focused/);
    assert.deepEqual(result.metadata?.answers, [
      { id: "approach", question: "Which approach should we use?", answer: "Focused" },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("question supports open-ended answers without predefined options", async () => {
  const question = toolByName("question");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-question-open-"));

  try {
    const result = await question.execute(
      {
        questions: [
          {
            id: "goal",
            question: "What should we optimize for?",
          },
        ],
      },
      {
        ...createContext(tempDir, "question-open-session"),
        requestApproval: async (request) => {
          assert.equal(request.kind, "question");
          assert.deepEqual(request.metadata?.questions, [
            {
              id: "goal",
              header: "",
              question: "What should we optimize for?",
              options: [],
              multiple: false,
            },
          ]);
          return {
            type: "allow",
            metadata: {
              answers: [{ id: "goal", question: "What should we optimize for?", answer: "Fast iteration" }],
            },
          };
        },
      },
    );

    assert.match(result.content, /Fast iteration/);
    assert.deepEqual(result.metadata?.answers, [
      { id: "goal", question: "What should we optimize for?", answer: "Fast iteration" },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("question cancellation returns a cancelled tool result", async () => {
  const question = toolByName("question");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-question-cancel-"));

  try {
    const result = await question.execute(
      {
        questions: [
          {
            id: "next",
            question: "What should happen next?",
            options: [{ label: "Ship it", description: "" }],
          },
        ],
      },
      {
        ...createContext(tempDir, "question-cancel-session"),
        requestApproval: async () => ({
          type: "deny",
          reason: "User cancelled question.",
        }),
      },
    );

    assert.match(result.content, /cancelled/i);
    assert.equal(result.metadata?.cancelled, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mail_auth opens a private mail authorization request and returns sanitized account metadata", async () => {
  const mailAuth = toolByName("mail_auth");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-mail-auth-"));

  try {
    let requestedKind = "";
    const result = await mailAuth.execute(
      {
        provider: "qq",
      },
      {
        ...createContext(tempDir, "mail-auth-session"),
        toolCall: { id: "mail-auth-call", name: "mail_auth", input: { provider: "qq" } },
        requestApproval: async (request) => {
          requestedKind = request.kind ?? "";
          assert.equal(request.metadata?.provider, "qq");
          assert.equal(request.metadata?.authType, "password");
          assert.doesNotMatch(JSON.stringify(request.metadata), /secret|authorization-code/i);
          return {
            type: "allow",
            metadata: {
              accountId: "account-1",
              email: "owner@qq.com",
              providerName: "QQ Mail",
              status: "connected",
            },
          };
        },
      },
    );

    assert.equal(requestedKind, "mail_auth");
    assert.match(result.content, /owner@qq\.com/);
    assert.match(result.content, /QQ Mail/);
    assert.doesNotMatch(result.content, /secret|authorization-code/i);
    assert.deepEqual(result.metadata, {
      accountId: "account-1",
      email: "owner@qq.com",
      providerName: "QQ Mail",
      status: "connected",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mail_auth reports cancellation without exposing credential fields", async () => {
  const mailAuth = toolByName("mail_auth");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-mail-auth-cancel-"));

  try {
    const result = await mailAuth.execute(
      {
        email: "owner@qq.com",
      },
      {
        ...createContext(tempDir, "mail-auth-cancel-session"),
        toolCall: { id: "mail-auth-cancel-call", name: "mail_auth", input: { email: "owner@qq.com" } },
        requestApproval: async () => ({
          type: "deny",
          reason: "User cancelled mail authorization.",
        }),
      },
    );

    assert.match(result.content, /cancelled/i);
    assert.equal(result.metadata?.cancelled, true);
    assert.doesNotMatch(JSON.stringify(result), /password|authorizationCode|accessToken|refreshToken/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("todo_write stores session todos and todo_read returns them", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-todos-"));

  try {
    const write = toolByName("todo_write");
    const read = toolByName("todo_read");
    const context = createContext(tempDir, "todo-session");

    await write.execute(
      {
        items: [
          { id: "one", content: "Add question tool", status: "completed" },
          { id: "two", content: "Add todo tools", status: "in_progress" },
        ],
      },
      context,
    );

    const result = await read.execute({}, context);

    assert.match(result.content, /completed\s+one\s+Add question tool/);
    assert.match(result.content, /in_progress\s+two\s+Add todo tools/);
    assert.deepEqual(result.metadata?.items, [
      { id: "one", content: "Add question tool", status: "completed" },
      { id: "two", content: "Add todo tools", status: "in_progress" },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test(
  "bash tool decodes Windows shell output from the local code page",
  { skip: process.platform !== "win32" ? "Windows shell output code pages are platform-specific" : false },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-shell-encoding-"));

    try {
      const bash = toolByName("bash");
      const result = await bash.execute(
        {
          command: 'node -e "process.stdout.write(Buffer.from([0xb5,0xb1,0xc7,0xb0]))"',
        },
        createContext(tempDir),
      );

      assert.equal(result.content, "当前");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test("bash tool prefers app-private runtime commands over the system PATH", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-bash-runtime-"));
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "super-agents-runtime-"));
  const platformKey = `${process.platform}-${process.arch}`;
  const runtimeBin = path.join(runtimeRoot, platformKey, "bin");
  const originalPath = process.env.PATH;
  const originalPathKey = process.env.Path;
  const originalRuntimeRoot = process.env.SUPER_AGENTS_RUNTIME_ROOT;

  try {
    await mkdir(runtimeBin, { recursive: true });
    const commandPath =
      process.platform === "win32" ? path.join(runtimeBin, "node.cmd") : path.join(runtimeBin, "node");
    await writeFile(
      commandPath,
      process.platform === "win32"
        ? "@echo off\r\necho private-runtime-node\r\n"
        : "#!/bin/sh\nprintf private-runtime-node\n",
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(commandPath, 0o755);
    }

    process.env.SUPER_AGENTS_RUNTIME_ROOT = runtimeRoot;
    process.env.PATH = "";
    if (process.env.Path !== undefined) {
      process.env.Path = "";
    }

    const bash = toolByName("bash");
    const result = await bash.execute({ command: "node" }, createContext(tempDir));

    assert.equal(result.content.trim(), "private-runtime-node");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalPathKey === undefined) {
      delete process.env.Path;
    } else {
      process.env.Path = originalPathKey;
    }
    if (originalRuntimeRoot === undefined) {
      delete process.env.SUPER_AGENTS_RUNTIME_ROOT;
    } else {
      process.env.SUPER_AGENTS_RUNTIME_ROOT = originalRuntimeRoot;
    }
    await rm(tempDir, { recursive: true, force: true });
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("bash tool emits stdout chunks before the command exits", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-bash-stream-"));

  try {
    const bash = toolByName("bash");
    const outputChunks: Array<{ stream: string; text: string }> = [];
    const resultPromise = bash.execute(
      {
        command:
          'node -e "process.stdout.write(\\"step one\\\\n\\"); setTimeout(() => { process.stdout.write(\\"step two\\\\n\\"); }, 120)"',
        timeoutMs: 5_000,
      },
      {
        ...createContext(tempDir),
        emitOutput: (output: { stream: string; text: string }) => {
          outputChunks.push(output);
        },
      },
    );

    await waitForCondition(
      () => outputChunks.some((output) => output.stream === "stdout" && output.text.includes("step one")),
      "first bash stdout chunk",
    );
    assert.equal(outputChunks.some((output) => output.text.includes("step two")), false);

    const result = await resultPromise;
    assert.match(result.content, /step one/);
    assert.match(result.content, /step two/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace mutation and search tools emit progress output", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-tool-progress-"));
  const outputChunks: Array<{ stream: string; text: string }> = [];
  const context = {
    ...createContext(tempDir, "tool-progress-session"),
    emitOutput: (output: { stream: string; text: string }) => {
      outputChunks.push(output);
    },
  };

  try {
    await toolByName("write").execute({ path: "notes.txt", content: "alpha\nbeta\n" }, context);
    await toolByName("edit").execute(
      { path: "notes.txt", oldString: "alpha", newString: "needle alpha" },
      context,
    );
    await toolByName("multi_edit").execute(
      {
        path: "notes.txt",
        edits: [{ oldString: "beta", newString: "needle beta" }],
      },
      context,
    );
    await toolByName("grep").execute({ query: "needle", path: "." }, context);
    await toolByName("glob").execute({ pattern: "**/*.txt", path: "." }, context);
    await toolByName("apply_patch").execute(
      {
        patch: [
          "*** Begin Patch",
          "*** Add File: patched.txt",
          "+patched content",
          "*** End Patch",
        ].join("\n"),
      },
      context,
    );

    const progressText = outputChunks.map((chunk) => chunk.text).join("");
    assert.match(progressText, /Writing notes\.txt/);
    assert.match(progressText, /Editing notes\.txt/);
    assert.match(progressText, /Searching/);
    assert.match(progressText, /needle alpha/);
    assert.match(progressText, /Finding files/);
    assert.match(progressText, /notes\.txt/);
    assert.match(progressText, /Applying patch/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("web_fetch emits progress before the response finishes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-web-fetch-progress-"));
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.write("first chunk\n");
    setTimeout(() => {
      response.end("second chunk\n");
    }, 120);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const outputChunks: Array<{ stream: string; text: string }> = [];
    const resultPromise = toolByName("web_fetch").execute(
      { url: `http://127.0.0.1:${address.port}/stream`, timeoutMs: 5_000 },
      {
        ...createContext(tempDir, "web-fetch-progress-session"),
        emitOutput: (output) => {
          outputChunks.push(output);
        },
      },
    );

    await waitForCondition(
      () => outputChunks.some((output) => /Fetching/.test(output.text)),
      "web_fetch start progress",
    );
    assert.equal(outputChunks.some((output) => /second chunk/.test(output.text)), false);

    const result = await resultPromise;
    assert.match(result.content, /first chunk/);
    assert.match(result.content, /second chunk/);
    assert.match(outputChunks.map((output) => output.text).join(""), /Downloaded/);
  } finally {
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("workspace tools emit progress output while they run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-tool-progress-"));

  try {
    await writeFile(path.join(tempDir, "notes.txt"), "needle here\n", "utf8");
    const outputChunks: Array<{ stream: string; text: string }> = [];
    const context = {
      ...createContext(tempDir, "workspace-progress-session"),
      emitOutput: (output: { stream: string; text: string }) => {
        outputChunks.push(output);
      },
    };

    const grep = toolByName("grep");
    const grepResult = await grep.execute({ query: "needle", path: "." }, context);
    assert.match(grepResult.content, /needle here/);
    assert.equal(outputChunks.some((output) => output.text.includes("Searching")), true);

    const writeTool = toolByName("write");
    await writeTool.execute({ path: "created.txt", content: "hello" }, context);
    assert.equal(outputChunks.some((output) => output.text.includes("Writing created.txt")), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("web_fetch emits fetch progress before returning content", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-web-fetch-progress-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.write("first chunk\n");
    setTimeout(() => {
      response.end("second chunk\n");
    }, 20);
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const outputChunks: Array<{ stream: string; text: string }> = [];
    const webFetch = toolByName("web_fetch");
    const result = await webFetch.execute(
      { url: `http://127.0.0.1:${address.port}/progress` },
      {
        ...createContext(tempDir, "web-fetch-progress-session"),
        emitOutput: (output) => {
          outputChunks.push(output);
        },
      },
    );

    assert.match(result.content, /first chunk/);
    assert.match(result.content, /second chunk/);
    assert.equal(outputChunks.some((output) => output.text.includes("Fetching URL http://127.0.0.1")), true);
    assert.equal(outputChunks.some((output) => output.text.includes("Downloaded")), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("multi_edit applies multiple replacements atomically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-multi-edit-"));
  const target = path.join(tempDir, "sample.txt");

  try {
    await writeFile(target, "alpha\nbeta\ngamma\n", "utf8");
    const multiEdit = toolByName("multi_edit");

    await multiEdit.execute(
      {
        path: "sample.txt",
        edits: [
          { oldString: "alpha", newString: "one" },
          { oldString: "gamma", newString: "three" },
        ],
      },
      createContext(tempDir),
    );

    assert.equal(await readFile(target, "utf8"), "one\nbeta\nthree\n");

    await assert.rejects(
      () =>
        multiEdit.execute(
          {
            path: "sample.txt",
            edits: [
              { oldString: "one", newString: "uno" },
              { oldString: "missing", newString: "nope" },
            ],
          },
          createContext(tempDir),
        ),
      /oldString was not found/,
    );

    assert.equal(await readFile(target, "utf8"), "one\nbeta\nthree\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("apply_patch can add, update, and delete files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-apply-patch-"));

  try {
    await writeFile(path.join(tempDir, "existing.txt"), "hello\nold\n", "utf8");
    await writeFile(path.join(tempDir, "remove.txt"), "remove me\n", "utf8");
    const applyPatch = toolByName("apply_patch");

    const result = await applyPatch.execute(
      {
        patch: [
          "*** Begin Patch",
          "*** Add File: created.txt",
          "+new file",
          "*** Update File: existing.txt",
          "@@",
          " hello",
          "-old",
          "+new",
          "*** Delete File: remove.txt",
          "*** End Patch",
        ].join("\n"),
      },
      createContext(tempDir),
    );

    assert.match(result.content, /created.txt/);
    assert.equal(await readFile(path.join(tempDir, "created.txt"), "utf8"), "new file\n");
    assert.equal(await readFile(path.join(tempDir, "existing.txt"), "utf8"), "hello\nnew\n");
    await assert.rejects(() => readFile(path.join(tempDir, "remove.txt"), "utf8"), /ENOENT/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("web_fetch reads text from a URL", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("fresh content");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const webFetch = toolByName("web_fetch");

    const result = await webFetch.execute(
      { url: `http://127.0.0.1:${address.port}/page`, format: "text" },
      createContext(os.tmpdir()),
    );

    assert.match(result.content, /fresh content/);
    assert.equal(result.metadata?.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("web_search returns query results with URLs and snippets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.match(String(input), /duckduckgo\.com\/html/);
    return new Response(
      [
        '<html><body>',
        '<a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=ads.example">Sponsored gold</a>',
        '<a class="result__snippet">Sponsored result.</a>',
        '<a class="result__a" href="https://example.com/gold">Gold outlook 2026</a>',
        '<a class="result__snippet">Market analysis and recent price drivers.</a>',
        '</body></html>',
      ].join(""),
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }) as typeof fetch;

  try {
    const webSearch = toolByName("web_search");
    const result = await webSearch.execute({ query: "gold outlook 2026", limit: 3 }, createContext(os.tmpdir()));

    assert.match(result.content, /Gold outlook 2026/);
    assert.match(result.content, /https:\/\/example\.com\/gold/);
    assert.match(result.content, /Market analysis and recent price drivers/);
    assert.match(result.content, /Search snippets are unverified/i);
    assert.doesNotMatch(result.content, /Sponsored gold/);
    assert.deepEqual(result.metadata?.query, "gold outlook 2026");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser screenshot resolves relative output paths inside the workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-browser-output-"));
  const calls: Array<{ filePath?: string }> = [];
  const tools = createBuiltinToolDefinitions({
    browserAutomation: {
      takeScreenshot: async (input: { filePath?: string }) => {
        calls.push(input);
        return { content: "screenshot saved" };
      },
    } as any,
  });
  const screenshot = tools.find((item) => item.name === "browser_screenshot");
  assert.ok(screenshot);

  try {
    await screenshot.execute({ filePath: "shots/page.png" }, createContext(tempDir));

    assert.equal(calls[0]?.filePath, path.join(tempDir, "shots", "page.png"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mail tools are registered with conservative risk boundaries", async () => {
  const tools = createBuiltinToolDefinitions({
    mailStore: {
      inferSetup: async (email: string) => ({ providerId: "custom", email }),
      listAccounts: async () => [],
      searchMessages: async () => [],
      readMessage: async () => ({
        id: "message-1",
        accountId: "account-1",
        subject: "Hello",
        from: "a@example.com",
        to: [],
        snippet: "Body",
        body: "Body",
      }),
      createDraft: async (input: any) => ({ id: "draft-1", preview: input.body, ...input }),
      sendDraft: async (input: any) => ({ sent: true, draftId: input.draftId, accountId: "account-1", providerId: "custom" }),
    },
  });

  const mail = tools.find((item) => item.name === "mail");
  const mailAuth = tools.find((item) => item.name === "mail_auth");
  const mailDraft = tools.find((item) => item.name === "mail_draft");
  const mailSend = tools.find((item) => item.name === "mail_send");

  assert.equal(mailAuth?.risk, "network");
  assert.equal(mail?.risk, "network");
  assert.equal(mailDraft?.risk, "write");
  assert.equal(mailSend?.risk, "write");

  const result = await mail?.execute({ action: "list_accounts" }, createContext(os.tmpdir()));
  assert.match(result?.content ?? "", /No mail accounts/);
});
