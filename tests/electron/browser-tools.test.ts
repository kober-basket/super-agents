import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserToolDefinitions } from "../../electron/agent-core/builtin-tools/browser-tools";
import type { ToolDefinition } from "../../electron/agent-core";

function browserToolByName(name: string, service: Parameters<typeof createBrowserToolDefinitions>[0]): ToolDefinition {
  const tool = createBrowserToolDefinitions(service).find((item) => item.name === name);
  assert.ok(tool, `Expected browser tool ${name} to exist`);
  return tool;
}

function createContext() {
  return {
    sessionId: "browser-tool-session",
    agentId: "agent-1",
    workspaceRoot: process.cwd(),
    toolCall: { id: "browser-call", name: "browser_navigate", input: {} },
  };
}

test("browser tools emit progress output before long actions finish", async () => {
  let resolveNavigate!: () => void;
  const navigateStarted = new Promise<void>((resolve) => {
    resolveNavigate = resolve;
  });
  const service = {
    listPages: () => [],
    selectPage: () => undefined,
    async navigate() {
      await navigateStarted;
      return { content: "Navigated.", metadata: { url: "https://example.com" } };
    },
    async takeSnapshot() {
      return { content: "snapshot" };
    },
    async click() {
      return { content: "clicked" };
    },
    async fill() {
      return { content: "filled" };
    },
    async fillForm() {
      return { content: "filled form" };
    },
    async hover() {
      return { content: "hovered" };
    },
    async drag() {
      return { content: "dragged" };
    },
    async typeText() {
      return { content: "typed" };
    },
    async uploadFile() {
      return { content: "uploaded" };
    },
    async pressKey() {
      return { content: "pressed" };
    },
    async waitFor() {
      return { content: "waited" };
    },
    async evaluate() {
      return { content: "evaluated" };
    },
    async takeScreenshot() {
      return { content: "screenshot" };
    },
    async listConsoleMessages() {
      return { content: "console" };
    },
    async getConsoleMessage() {
      return { content: "message" };
    },
    async listNetworkRequests() {
      return { content: "network" };
    },
    async getNetworkRequest() {
      return { content: "request" };
    },
  };
  const outputChunks: Array<{ stream: string; text: string }> = [];

  const resultPromise = browserToolByName("browser_navigate", service).execute(
    { url: "https://example.com" },
    {
      ...createContext(),
      emitOutput: (output) => {
        outputChunks.push(output);
      },
    },
  );

  assert.match(outputChunks.map((output) => output.text).join(""), /Navigating/);
  resolveNavigate();
  const result = await resultPromise;
  assert.equal(result.content, "Navigated.");
});
