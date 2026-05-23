import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { BrowserAutomationService } from "../../electron/browser-automation-service";

class FakeDebugger extends EventEmitter {
  attached = false;
  commands: Array<{ method: string; params?: unknown }> = [];

  isAttached() {
    return this.attached;
  }

  attach() {
    this.attached = true;
  }

  async sendCommand<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.commands.push({ method, params });
    if (method === "Network.getResponseBody") {
      return { body: "{\"ok\":true}", base64Encoded: false } as T;
    }
    if (method === "DOM.getDocument") {
      return { root: { nodeId: 100 } } as T;
    }
    if (method === "DOM.querySelector") {
      return { nodeId: 101 } as T;
    }
    return {} as T;
  }
}

class FakeWebContents extends EventEmitter {
  id: number;
  debugger = new FakeDebugger();
  private urlValue: string;
  private titleValue: string;
  executedScripts: string[] = [];
  inputEvents: unknown[] = [];

  constructor(input: { id: number; url: string; title: string }) {
    super();
    this.id = input.id;
    this.urlValue = input.url;
    this.titleValue = input.title;
  }

  getURL() {
    return this.urlValue;
  }

  getTitle() {
    return this.titleValue;
  }

  async loadURL(url: string) {
    this.urlValue = url;
    this.emit("did-navigate", {}, url);
    this.emit("did-stop-loading");
  }

  async executeJavaScript<T = unknown>(script: string): Promise<T> {
    this.executedScripts.push(script);
    if (script.includes("__SUPER_AGENTS_BROWSER_SNAPSHOT__")) {
      return {
        title: this.titleValue,
        url: this.urlValue,
        elements: [
          {
            uid: "1_0",
            role: "button",
            name: "Search",
            tagName: "button",
            locator: [0, 1],
          },
        ],
      } as T;
    }

    if (script.includes("__SUPER_AGENTS_BROWSER_CLICK__")) {
      return { clicked: true, tagName: "button", text: "Search" } as T;
    }

    if (script.includes("__SUPER_AGENTS_BROWSER_FILL__")) {
      return { tagName: "input", value: "typed text" } as T;
    }

    if (script.includes("__SUPER_AGENTS_BROWSER_HOVER__")) {
      return { tagName: "button", text: "Search" } as T;
    }

    if (script.includes("__SUPER_AGENTS_BROWSER_DRAG__")) {
      return { fromTagName: "button", toTagName: "input" } as T;
    }

    if (script.includes("__SUPER_AGENTS_BROWSER_TYPE_TEXT__")) {
      return { tagName: "input", value: "typed text" } as T;
    }

    if (script.includes("__SUPER_AGENTS_BROWSER_UPLOAD_FILE__")) {
      return { selector: "[data-super-agents-upload-target=\"upload-token\"]" } as T;
    }

    return null as T;
  }

  sendInputEvent(event: unknown) {
    this.inputEvents.push(event);
  }

  isDestroyed() {
    return false;
  }
}

test("browser automation service tracks the active visible webview page", () => {
  const service = new BrowserAutomationService();
  const first = new FakeWebContents({ id: 11, url: "https://example.com/", title: "Example" });
  const second = new FakeWebContents({ id: 12, url: "https://openai.com/", title: "OpenAI" });

  service.registerWebContents(first);
  service.registerWebContents(second);
  service.markActivePage(11);

  assert.deepEqual(
    service.listPages().map((page) => ({ id: page.id, title: page.title, selected: page.selected })),
    [
      { id: 11, title: "Example", selected: true },
      { id: 12, title: "OpenAI", selected: false },
    ],
  );

  service.selectPage(12);

  assert.equal(service.listPages().find((page) => page.id === 12)?.selected, true);
});

test("browser automation service snapshots elements and clicks by uid", async () => {
  const service = new BrowserAutomationService();
  const page = new FakeWebContents({ id: 21, url: "https://example.com/", title: "Example" });
  service.registerWebContents(page);
  service.markActivePage(21);

  const snapshot = await service.takeSnapshot({});

  assert.match(snapshot.content, /uid=1_0 button "Search"/);
  assert.deepEqual(snapshot.metadata?.elements, 1);

  const result = await service.click({ uid: "1_0" });

  assert.match(result.content, /Clicked 1_0/);
  assert.equal(page.executedScripts.some((script) => script.includes("__SUPER_AGENTS_BROWSER_CLICK__")), true);
});

test("browser automation service marks explicitly targeted pages active", async () => {
  const service = new BrowserAutomationService();
  const first = new FakeWebContents({ id: 31, url: "https://example.com/", title: "Example" });
  const second = new FakeWebContents({ id: 32, url: "https://openai.com/", title: "OpenAI" });

  service.registerWebContents(first);
  service.registerWebContents(second);
  service.selectPage(31);

  await service.evaluate({ pageId: 32, function: "() => document.title" });

  assert.equal(service.listPages().find((page) => page.id === 32)?.selected, true);
});

test("browser automation service supports higher-level uid interactions", async () => {
  const service = new BrowserAutomationService();
  const page = new FakeWebContents({ id: 41, url: "https://example.com/", title: "Example" });
  service.registerWebContents(page);

  await service.takeSnapshot({});
  const hover = await service.hover({ uid: "1_0" });
  const fillForm = await service.fillForm({ elements: [{ uid: "1_0", value: "typed text" }] });
  const drag = await service.drag({ fromUid: "1_0", toUid: "1_0" });
  const typeText = await service.typeText({ text: "typed text", submitKey: "Enter" });

  assert.match(hover.content, /Hovered 1_0/);
  assert.match(fillForm.content, /Filled 1 form element/);
  assert.match(drag.content, /Dragged 1_0 to 1_0/);
  assert.match(typeText.content, /Typed text/);
  assert.equal(page.executedScripts.some((script) => script.includes("__SUPER_AGENTS_BROWSER_HOVER__")), true);
  assert.equal(page.executedScripts.some((script) => script.includes("__SUPER_AGENTS_BROWSER_DRAG__")), true);
  assert.equal(page.executedScripts.some((script) => script.includes("__SUPER_AGENTS_BROWSER_TYPE_TEXT__")), true);
  assert.equal(page.inputEvents.some((event) => JSON.stringify(event).includes("Enter")), true);
});

test("browser automation service uploads files through a snapshot file input uid", async () => {
  const service = new BrowserAutomationService({ uploadTokenFactory: () => "upload-token" });
  const page = new FakeWebContents({ id: 51, url: "https://example.com/", title: "Example" });
  service.registerWebContents(page);

  await service.takeSnapshot({});
  const result = await service.uploadFile({ uid: "1_0", filePath: "C:\\Users\\Administrator\\Desktop\\sample.txt" });

  assert.match(result.content, /Uploaded file/);
  assert.equal(page.debugger.commands.some((command) => command.method === "DOM.setFileInputFiles"), true);
});

test("browser automation service collects console messages", async () => {
  const service = new BrowserAutomationService();
  const page = new FakeWebContents({ id: 61, url: "https://example.com/", title: "Example" });
  service.registerWebContents(page);

  page.emit("console-message", {}, "error", "legacy console error", 12, "https://example.com/app.js");
  page.debugger.emit("message", {}, "Runtime.consoleAPICalled", {
    type: "log",
    args: [{ value: "hello" }, { description: "world" }],
    stackTrace: { callFrames: [{ url: "https://example.com/app.js", lineNumber: 3 }] },
  });

  const list = await service.listConsoleMessages({ types: ["error", "log"] });
  const detail = await service.getConsoleMessage({ msgid: 2 });

  assert.match(list.content, /1 error legacy console error/);
  assert.match(list.content, /2 log hello world/);
  assert.match(detail.content, /hello world/);
});

test("browser automation service collects network requests and response bodies", async () => {
  const service = new BrowserAutomationService();
  const page = new FakeWebContents({ id: 71, url: "https://example.com/", title: "Example" });
  service.registerWebContents(page);

  page.debugger.emit("message", {}, "Network.requestWillBeSent", {
    requestId: "req-1",
    type: "Fetch",
    request: { url: "https://example.com/api", method: "POST", headers: { accept: "application/json" }, postData: "{\"q\":1}" },
    timestamp: 10,
  });
  page.debugger.emit("message", {}, "Network.responseReceived", {
    requestId: "req-1",
    type: "Fetch",
    response: { status: 200, mimeType: "application/json", headers: { "content-type": "application/json" } },
  });
  page.debugger.emit("message", {}, "Network.loadingFinished", { requestId: "req-1", timestamp: 11 });

  const list = await service.listNetworkRequests({ resourceTypes: ["fetch"] });
  const detail = await service.getNetworkRequest({ reqid: 1 });

  assert.match(list.content, /1 POST 200 fetch https:\/\/example\.com\/api/);
  assert.match(detail.content, /Response body/);
  assert.match(detail.content, /"ok":true/);
});
