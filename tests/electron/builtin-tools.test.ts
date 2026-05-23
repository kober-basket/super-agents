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
