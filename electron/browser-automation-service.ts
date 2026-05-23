import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { EventEmitter } from "node:events";

export interface BrowserAutomationWebContents extends Pick<EventEmitter, "on" | "off" | "once"> {
  id: number;
  debugger?: BrowserAutomationDebugger;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void>;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  sendInputEvent?: (event: Record<string, unknown>) => void;
  capturePage?: () => Promise<{ toPNG(): Buffer; toJPEG(quality?: number): Buffer }>;
  isDestroyed?: () => boolean;
}

export interface BrowserAutomationDebugger extends Pick<EventEmitter, "on" | "off"> {
  attach(protocolVersion?: string): void;
  detach?: () => void;
  isAttached(): boolean;
  sendCommand<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface BrowserAutomationPageSummary {
  id: number;
  url: string;
  title: string;
  selected: boolean;
}

export interface BrowserAutomationToolResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BrowserAutomationServiceOptions {
  uploadTokenFactory?: () => string;
}

interface BrowserConsoleMessage {
  id: number;
  type: string;
  text: string;
  url?: string;
  line?: number;
  timestamp: number;
}

interface BrowserNetworkRequest {
  id: number;
  cdpRequestId: string;
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  mimeType?: string;
  requestHeaders?: Record<string, unknown>;
  responseHeaders?: Record<string, unknown>;
  requestBody?: string;
  responseBody?: string;
  failed?: boolean;
  errorText?: string;
  startedAt: number;
  finishedAt?: number;
}

interface BrowserAutomationPageRecord {
  webContents: BrowserAutomationWebContents;
  attachedAt: number;
  lastActiveAt: number;
  snapshotLocators: Map<string, number[]>;
  consoleMessages: BrowserConsoleMessage[];
  preservedConsoleMessages: BrowserConsoleMessage[];
  networkRequests: BrowserNetworkRequest[];
  preservedNetworkRequests: BrowserNetworkRequest[];
  networkRequestsByCdpId: Map<string, BrowserNetworkRequest>;
  nextConsoleMessageId: number;
  nextNetworkRequestId: number;
  ownsDebuggerAttachment: boolean;
  cleanup: Array<() => void>;
}

interface BrowserSnapshotElement {
  uid: string;
  role: string;
  name: string;
  value?: string;
  tagName: string;
  locator: number[];
}

interface BrowserSnapshotPayload {
  title: string;
  url: string;
  elements: BrowserSnapshotElement[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_SNAPSHOT_ELEMENTS = 200;
const MAX_COLLECTED_ITEMS = 500;
const MAX_PRESERVED_ITEMS = 1500;
const MAX_INLINE_BODY_LENGTH = 20_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function trimItems<T>(items: T[], maxItems: number) {
  if (items.length > maxItems) {
    items.splice(0, items.length - maxItems);
  }
}

function pageSlice<T>(items: T[], pageSize?: number, pageIdx?: number) {
  const normalizedSize = pageSize && pageSize > 0 ? Math.floor(pageSize) : items.length || 1;
  const normalizedPage = pageIdx && pageIdx > 0 ? Math.floor(pageIdx) : 0;
  const start = normalizedPage * normalizedSize;
  return {
    items: items.slice(start, start + normalizedSize),
    pageIdx: normalizedPage,
    pageSize: normalizedSize,
    total: items.length,
  };
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function truncateBody(body: string) {
  if (body.length <= MAX_INLINE_BODY_LENGTH) {
    return body;
  }
  return `${body.slice(0, MAX_INLINE_BODY_LENGTH)}\n...[truncated ${body.length - MAX_INLINE_BODY_LENGTH} characters]`;
}

function consoleArgText(arg: unknown) {
  if (!isRecord(arg)) {
    return String(arg);
  }
  if (arg.value !== undefined) {
    return String(arg.value);
  }
  if (typeof arg.description === "string") {
    return arg.description;
  }
  if (typeof arg.type === "string") {
    return arg.type;
  }
  return JSON.stringify(arg);
}

function consoleLocation(params: Record<string, unknown>) {
  const stackTrace = optionalRecord(params.stackTrace);
  const callFrames = stackTrace?.callFrames;
  const firstFrame = Array.isArray(callFrames) ? optionalRecord(callFrames[0]) : undefined;
  return {
    url: typeof firstFrame?.url === "string" ? firstFrame.url : undefined,
    line: typeof firstFrame?.lineNumber === "number" ? firstFrame.lineNumber + 1 : undefined,
  };
}

function normalizeResourceType(value: unknown) {
  return typeof value === "string" && value ? value.toLowerCase() : "other";
}

function normalizeBrowserTarget(value: string) {
  const input = value.trim();
  if (!input) {
    return "https://www.bing.com/";
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    return input;
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(input)) {
    return `http://${input}`;
  }
  if (/^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/i.test(input)) {
    return `https://${input}`;
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
}

function normalizeKey(input: string) {
  const parts = input
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const keyCode = parts.at(-1) || input.trim();
  const modifiers = parts
    .slice(0, -1)
    .map((part) => part.toLowerCase())
    .map((part) => (part === "ctrl" ? "control" : part))
    .filter((part) => ["control", "shift", "alt", "meta", "command"].includes(part));
  return { keyCode, modifiers };
}

function formatSnapshot(payload: BrowserSnapshotPayload) {
  const lines = [
    `Page "${payload.title || payload.url}" url="${payload.url}"`,
    ...payload.elements.map((element) => {
      const name = element.name ? ` "${element.name.replace(/\s+/g, " ").trim()}"` : "";
      const value = element.value ? ` value="${element.value.replace(/\s+/g, " ").trim()}"` : "";
      return `  uid=${element.uid} ${element.role}${name}${value}`;
    }),
  ];
  return lines.join("\n");
}

function browserSnapshotScript(maxElements: number) {
  return `
(() => {
  const marker = "__SUPER_AGENTS_BROWSER_SNAPSHOT__";
  const maxElements = ${JSON.stringify(maxElements)};
  const interestingSelector = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role]",
    "[aria-label]",
    "[title]",
    "[contenteditable='true']",
    "summary",
    "h1",
    "h2",
    "h3"
  ].join(",");

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(element) {
    return String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function roleOf(element) {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "summary") return "button";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = String(element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit") return "button";
      return "textbox";
    }
    return tag;
  }

  function nameOf(element) {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim();
      if (label) return label;
    }
    return (
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder") ||
      element.value ||
      textOf(element) ||
      element.getAttribute("href") ||
      ""
    ).slice(0, 160);
  }

  function locatorOf(element) {
    const locator = [];
    let current = element;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      locator.unshift(Array.prototype.indexOf.call(parent.children, current));
      current = parent;
    }
    return locator;
  }

  const elements = Array.from(document.querySelectorAll(interestingSelector))
    .filter(isVisible)
    .slice(0, maxElements)
    .map((element, index) => ({
      uid: "1_" + index,
      role: roleOf(element),
      name: nameOf(element),
      value: "value" in element && element.value ? String(element.value).slice(0, 160) : undefined,
      tagName: element.tagName.toLowerCase(),
      locator: locatorOf(element)
    }));

  return {
    marker,
    title: document.title,
    url: location.href,
    elements
  };
})()
`;
}

function elementLookupScript(locator: number[], body: string) {
  return `
(() => {
  const locator = ${JSON.stringify(locator)};
  function findElement() {
    let current = document.body;
    for (const index of locator) {
      current = current?.children?.[index];
      if (!current) return null;
    }
    return current;
  }
  const element = findElement();
  if (!element) {
    throw new Error("Element from the last browser_snapshot no longer exists.");
  }
  ${body}
})()
`;
}

function clickScript(locator: number[], dblClick: boolean) {
  return elementLookupScript(
    locator,
    `
  const marker = "__SUPER_AGENTS_BROWSER_CLICK__";
  element.scrollIntoView({ block: "center", inline: "center" });
  if (typeof element.focus === "function") element.focus();
  element.click();
  if (${JSON.stringify(dblClick)}) {
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
  }
  return {
    marker,
    tagName: element.tagName.toLowerCase(),
    text: String(element.innerText || element.textContent || element.value || "").replace(/\\s+/g, " ").trim().slice(0, 160)
  };
`,
  );
}

function fillScript(locator: number[], value: string) {
  return elementLookupScript(
    locator,
    `
  const marker = "__SUPER_AGENTS_BROWSER_FILL__";
  const value = ${JSON.stringify(value)};
  element.scrollIntoView({ block: "center", inline: "center" });
  if (typeof element.focus === "function") element.focus();
  const tag = element.tagName.toLowerCase();
  const type = String(element.getAttribute("type") || "").toLowerCase();
  if (type === "checkbox" || type === "radio" || element.getAttribute("role") === "switch") {
    element.checked = value === "true";
  } else if (tag === "select") {
    const option = Array.from(element.options).find((item) => item.value === value || item.textContent.trim() === value);
    if (!option) throw new Error("No matching select option for value: " + value);
    element.value = option.value;
  } else if (element.isContentEditable) {
    element.textContent = value;
  } else if ("value" in element) {
    element.value = value;
  } else {
    element.textContent = value;
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    marker,
    tagName: tag,
    value: "value" in element ? element.value : element.textContent
  };
`,
  );
}

function hoverScript(locator: number[]) {
  return elementLookupScript(
    locator,
    `
  const marker = "__SUPER_AGENTS_BROWSER_HOVER__";
  element.scrollIntoView({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
  element.dispatchEvent(new MouseEvent("mouseover", eventInit));
  element.dispatchEvent(new MouseEvent("mouseenter", eventInit));
  element.dispatchEvent(new MouseEvent("mousemove", eventInit));
  return {
    marker,
    tagName: element.tagName.toLowerCase(),
    text: String(element.innerText || element.textContent || element.value || "").replace(/\\s+/g, " ").trim().slice(0, 160)
  };
`,
  );
}

function findElementFunction(name: string, locator: number[]) {
  return `
  const ${name}Locator = ${JSON.stringify(locator)};
  function find${name}Element() {
    let current = document.body;
    for (const index of ${name}Locator) {
      current = current?.children?.[index];
      if (!current) return null;
    }
    return current;
  }
`;
}

function dragScript(fromLocator: number[], toLocator: number[]) {
  return `
(() => {
  const marker = "__SUPER_AGENTS_BROWSER_DRAG__";
  ${findElementFunction("From", fromLocator)}
  ${findElementFunction("To", toLocator)}
  const fromElement = findFromElement();
  const toElement = findToElement();
  if (!fromElement || !toElement) {
    throw new Error("Element from the last browser_snapshot no longer exists.");
  }
  fromElement.scrollIntoView({ block: "center", inline: "center" });
  toElement.scrollIntoView({ block: "center", inline: "center" });
  const dataTransfer = typeof DataTransfer === "function" ? new DataTransfer() : undefined;
  const eventInit = { bubbles: true, cancelable: true, dataTransfer };
  fromElement.dispatchEvent(new DragEvent("dragstart", eventInit));
  toElement.dispatchEvent(new DragEvent("dragenter", eventInit));
  toElement.dispatchEvent(new DragEvent("dragover", eventInit));
  toElement.dispatchEvent(new DragEvent("drop", eventInit));
  fromElement.dispatchEvent(new DragEvent("dragend", eventInit));
  return {
    marker,
    fromTagName: fromElement.tagName.toLowerCase(),
    toTagName: toElement.tagName.toLowerCase()
  };
})()
`;
}

function typeTextScript(text: string) {
  return `
(() => {
  const marker = "__SUPER_AGENTS_BROWSER_TYPE_TEXT__";
  const text = ${JSON.stringify(text)};
  const element = document.activeElement;
  if (!element || !(element instanceof HTMLElement)) {
    throw new Error("No focused editable element is available.");
  }
  const tag = element.tagName.toLowerCase();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    element.value = element.value.slice(0, start) + text + element.value.slice(end);
    const nextPosition = start + text.length;
    element.setSelectionRange(nextPosition, nextPosition);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { marker, tagName: tag, value: element.value };
  }
  if (element.isContentEditable) {
    document.execCommand("insertText", false, text);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return { marker, tagName: tag, value: element.textContent };
  }
  throw new Error("Focused element is not editable.");
})()
`;
}

function uploadFileTargetScript(locator: number[], token: string) {
  return elementLookupScript(
    locator,
    `
  const marker = "__SUPER_AGENTS_BROWSER_UPLOAD_FILE__";
  const token = ${JSON.stringify(token)};
  if (!(element instanceof HTMLInputElement) || String(element.type).toLowerCase() !== "file") {
    throw new Error("browser_upload_file requires a file input element uid.");
  }
  element.setAttribute("data-super-agents-upload-target", token);
  return {
    marker,
    selector: '[data-super-agents-upload-target="' + token + '"]'
  };
`,
  );
}

function waitForTextScript(text: string[], timeoutMs: number) {
  return `
new Promise((resolve, reject) => {
  const marker = "__SUPER_AGENTS_BROWSER_WAIT_FOR__";
  const expected = ${JSON.stringify(text)};
  const timeoutMs = ${JSON.stringify(timeoutMs)};
  const deadline = Date.now() + timeoutMs;
  const check = () => {
    const pageText = String(document.body?.innerText || document.documentElement?.textContent || "");
    const found = expected.find((item) => pageText.includes(item));
    if (found) {
      resolve({ marker, found });
      return;
    }
    if (Date.now() >= deadline) {
      reject(new Error("Timed out waiting for text: " + expected.join(", ")));
      return;
    }
    window.setTimeout(check, 100);
  };
  check();
})
`;
}

function evaluateScript(functionSource: string, args: unknown[]) {
  return `
(async () => {
  const fn = (${functionSource});
  if (typeof fn !== "function") {
    throw new Error("function must be a JavaScript function declaration.");
  }
  return await fn(...${JSON.stringify(args)});
})()
`;
}

export class BrowserAutomationService {
  private readonly pages = new Map<number, BrowserAutomationPageRecord>();
  private readonly uploadTokenFactory: () => string;
  private selectedPageId: number | null = null;

  constructor(options: BrowserAutomationServiceOptions = {}) {
    this.uploadTokenFactory =
      options.uploadTokenFactory ??
      (() => `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  registerWebContents(webContents: BrowserAutomationWebContents) {
    const existing = this.pages.get(webContents.id);
    if (existing) {
      existing.cleanup.forEach((cleanup) => cleanup());
    }

    const record: BrowserAutomationPageRecord = {
      webContents,
      attachedAt: Date.now(),
      lastActiveAt: Date.now(),
      snapshotLocators: new Map(),
      consoleMessages: [],
      preservedConsoleMessages: [],
      networkRequests: [],
      preservedNetworkRequests: [],
      networkRequestsByCdpId: new Map(),
      nextConsoleMessageId: 1,
      nextNetworkRequestId: 1,
      ownsDebuggerAttachment: false,
      cleanup: [],
    };
    this.pages.set(webContents.id, record);
    this.selectedPageId ??= webContents.id;

    const remove = () => {
      this.pages.delete(webContents.id);
      if (this.selectedPageId === webContents.id) {
        this.selectedPageId = this.sortedRecords()[0]?.webContents.id ?? null;
      }
    };
    webContents.once("destroyed", remove);
    record.cleanup.push(() => webContents.off("destroyed", remove));

    const handleConsoleMessage = (_event: unknown, level: unknown, message: unknown, line: unknown, sourceId: unknown) => {
      this.addConsoleMessage(record, {
        type: typeof level === "string" ? level : String(level || "log"),
        text: stringValue(message),
        line: typeof line === "number" ? line : undefined,
        url: typeof sourceId === "string" ? sourceId : undefined,
      });
    };
    webContents.on("console-message", handleConsoleMessage);
    record.cleanup.push(() => webContents.off("console-message", handleConsoleMessage));

    const preserveOnNavigation = () => this.preserveCollectedData(record);
    webContents.on("did-start-navigation", preserveOnNavigation);
    record.cleanup.push(() => webContents.off("did-start-navigation", preserveOnNavigation));

    this.attachDevToolsCollectors(record);
  }

  markActivePage(pageId: number) {
    const record = this.pages.get(pageId);
    if (!record) {
      return;
    }
    record.lastActiveAt = Date.now();
    this.selectedPageId = pageId;
  }

  selectPage(pageId: number) {
    if (!this.pages.has(pageId)) {
      throw new Error(`Browser page ${pageId} is not available.`);
    }
    this.markActivePage(pageId);
  }

  listPages(): BrowserAutomationPageSummary[] {
    this.pruneDestroyedPages();
    return this.sortedRecords().map((record) => ({
      id: record.webContents.id,
      url: record.webContents.getURL(),
      title: record.webContents.getTitle() || record.webContents.getURL(),
      selected: record.webContents.id === this.selectedPageId,
    }));
  }

  async navigate(input: { pageId?: number; url?: string; type?: string; timeoutMs?: number }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const type = input.type || (input.url ? "url" : "");
    const timeoutMs = numberValue(input.timeoutMs, DEFAULT_TIMEOUT_MS);
    if (!type) {
      throw new Error("browser_navigate requires either url or type.");
    }

    const waitForLoad = this.waitForLoad(page.webContents, timeoutMs);
    if (type === "url") {
      await page.webContents.loadURL(normalizeBrowserTarget(stringValue(input.url)));
    } else if (type === "back") {
      page.webContents.goBack?.();
    } else if (type === "forward") {
      page.webContents.goForward?.();
    } else if (type === "reload") {
      page.webContents.reload?.();
    } else {
      throw new Error("type must be url, back, forward, or reload.");
    }
    await waitForLoad;
    this.markActivePage(page.webContents.id);
    return {
      content: `Browser page ${page.webContents.id} navigated to ${page.webContents.getURL()}.`,
      metadata: { pageId: page.webContents.id, url: page.webContents.getURL() },
    };
  }

  async takeSnapshot(input: { pageId?: number; verbose?: boolean }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const payload = await page.webContents.executeJavaScript<BrowserSnapshotPayload>(
      browserSnapshotScript(input.verbose ? MAX_SNAPSHOT_ELEMENTS * 2 : MAX_SNAPSHOT_ELEMENTS),
      true,
    );
    page.snapshotLocators = new Map(payload.elements.map((element) => [element.uid, element.locator]));
    this.markActivePage(page.webContents.id);
    return {
      content: formatSnapshot(payload),
      metadata: {
        pageId: page.webContents.id,
        url: payload.url,
        title: payload.title,
        elements: payload.elements.length,
      },
    };
  }

  async click(input: { pageId?: number; uid: string; dblClick?: boolean }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const locator = this.getLocator(page, input.uid);
    const result = await page.webContents.executeJavaScript<{ tagName?: string; text?: string }>(
      clickScript(locator, input.dblClick === true),
      true,
    );
    await wait(75);
    this.markActivePage(page.webContents.id);
    return {
      content: `Clicked ${input.uid}${result.text ? ` (${result.text})` : ""}.`,
      metadata: { pageId: page.webContents.id, uid: input.uid, tagName: result.tagName },
    };
  }

  async fill(input: { pageId?: number; uid: string; value: string }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const locator = this.getLocator(page, input.uid);
    const result = await page.webContents.executeJavaScript<{ tagName?: string; value?: string }>(
      fillScript(locator, input.value),
      true,
    );
    await wait(75);
    this.markActivePage(page.webContents.id);
    return {
      content: `Filled ${input.uid}.`,
      metadata: { pageId: page.webContents.id, uid: input.uid, tagName: result.tagName, value: result.value },
    };
  }

  async fillForm(input: { pageId?: number; elements: Array<{ uid: string; value: string }> }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    if (!Array.isArray(input.elements) || input.elements.length === 0) {
      throw new Error("browser_fill_form requires at least one element.");
    }
    const filled: Array<{ uid: string; tagName?: string; value?: string }> = [];
    for (const element of input.elements) {
      const locator = this.getLocator(page, element.uid);
      const result = await page.webContents.executeJavaScript<{ tagName?: string; value?: string }>(
        fillScript(locator, element.value),
        true,
      );
      filled.push({ uid: element.uid, tagName: result.tagName, value: result.value });
    }
    await wait(75);
    this.markActivePage(page.webContents.id);
    return {
      content: `Filled ${filled.length} form element${filled.length === 1 ? "" : "s"}.`,
      metadata: { pageId: page.webContents.id, filled },
    };
  }

  async hover(input: { pageId?: number; uid: string }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const locator = this.getLocator(page, input.uid);
    const result = await page.webContents.executeJavaScript<{ tagName?: string; text?: string }>(
      hoverScript(locator),
      true,
    );
    this.markActivePage(page.webContents.id);
    return {
      content: `Hovered ${input.uid}${result.text ? ` (${result.text})` : ""}.`,
      metadata: { pageId: page.webContents.id, uid: input.uid, tagName: result.tagName },
    };
  }

  async drag(input: { pageId?: number; fromUid: string; toUid: string }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const fromLocator = this.getLocator(page, input.fromUid);
    const toLocator = this.getLocator(page, input.toUid);
    const result = await page.webContents.executeJavaScript<{ fromTagName?: string; toTagName?: string }>(
      dragScript(fromLocator, toLocator),
      true,
    );
    await wait(75);
    this.markActivePage(page.webContents.id);
    return {
      content: `Dragged ${input.fromUid} to ${input.toUid}.`,
      metadata: {
        pageId: page.webContents.id,
        fromUid: input.fromUid,
        toUid: input.toUid,
        fromTagName: result.fromTagName,
        toTagName: result.toTagName,
      },
    };
  }

  async typeText(input: { pageId?: number; text: string; submitKey?: string }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const result = await page.webContents.executeJavaScript<{ tagName?: string; value?: string }>(
      typeTextScript(input.text),
      true,
    );
    if (input.submitKey) {
      await this.pressKey({ pageId: page.webContents.id, key: input.submitKey });
    } else {
      this.markActivePage(page.webContents.id);
    }
    return {
      content: `Typed text${input.submitKey ? ` and pressed ${input.submitKey}` : ""}.`,
      metadata: { pageId: page.webContents.id, tagName: result.tagName, value: result.value },
    };
  }

  async uploadFile(input: { pageId?: number; uid: string; filePath: string }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const debuggerApi = page.webContents.debugger;
    if (!debuggerApi || !debuggerApi.isAttached()) {
      throw new Error("browser_upload_file requires DevTools automation for this browser page.");
    }
    const locator = this.getLocator(page, input.uid);
    const token = this.uploadTokenFactory();
    const { selector } = await page.webContents.executeJavaScript<{ selector: string }>(
      uploadFileTargetScript(locator, token),
      true,
    );
    const resolvedPath = path.resolve(input.filePath);
    await debuggerApi.sendCommand("DOM.enable");
    const documentResult = await debuggerApi.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
    const root = optionalRecord(optionalRecord(documentResult)?.root);
    const nodeId = typeof root?.nodeId === "number" ? root.nodeId : undefined;
    if (nodeId === undefined) {
      throw new Error("Unable to locate the document root for file upload.");
    }
    const queryResult = await debuggerApi.sendCommand("DOM.querySelector", { nodeId, selector });
    const targetNodeId = optionalRecord(queryResult)?.nodeId;
    if (typeof targetNodeId !== "number" || targetNodeId <= 0) {
      throw new Error("Unable to locate the file input for upload.");
    }
    await debuggerApi.sendCommand("DOM.setFileInputFiles", { nodeId: targetNodeId, files: [resolvedPath] });
    this.markActivePage(page.webContents.id);
    return {
      content: `Uploaded file to ${input.uid}.`,
      metadata: { pageId: page.webContents.id, uid: input.uid, filePath: resolvedPath },
    };
  }

  async pressKey(input: { pageId?: number; key: string }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const key = normalizeKey(input.key);
    if (!page.webContents.sendInputEvent) {
      throw new Error("Keyboard input is not available for this browser page.");
    }
    page.webContents.sendInputEvent({ type: "keyDown", keyCode: key.keyCode, modifiers: key.modifiers });
    page.webContents.sendInputEvent({ type: "keyUp", keyCode: key.keyCode, modifiers: key.modifiers });
    this.markActivePage(page.webContents.id);
    return {
      content: `Pressed key ${input.key}.`,
      metadata: { pageId: page.webContents.id, key: input.key },
    };
  }

  async waitFor(input: { pageId?: number; text: string[]; timeoutMs?: number }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const timeoutMs = numberValue(input.timeoutMs, DEFAULT_TIMEOUT_MS);
    const result = await page.webContents.executeJavaScript<{ found: string }>(
      waitForTextScript(input.text, timeoutMs),
      true,
    );
    this.markActivePage(page.webContents.id);
    return {
      content: `Found text: ${result.found}.`,
      metadata: { pageId: page.webContents.id, found: result.found },
    };
  }

  async evaluate(input: { pageId?: number; function: string; args?: unknown[] }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const result = await page.webContents.executeJavaScript(
      evaluateScript(input.function, Array.isArray(input.args) ? input.args : []),
      true,
    );
    this.markActivePage(page.webContents.id);
    return {
      content: JSON.stringify(result, null, 2) ?? String(result),
      metadata: { pageId: page.webContents.id },
    };
  }

  async takeScreenshot(input: {
    pageId?: number;
    filePath?: string;
    format?: "png" | "jpeg";
    quality?: number;
  }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    if (!page.webContents.capturePage) {
      throw new Error("Screenshot capture is not available for this browser page.");
    }
    const image = await page.webContents.capturePage();
    this.markActivePage(page.webContents.id);
    const format = input.format === "jpeg" ? "jpeg" : "png";
    const buffer = format === "jpeg" ? image.toJPEG(input.quality) : image.toPNG();
    const filePath = input.filePath?.trim();
    if (filePath) {
      const resolved = path.resolve(filePath);
      await writeFile(resolved, buffer);
      return {
        content: `Saved browser screenshot to ${resolved}.`,
        metadata: { pageId: page.webContents.id, filePath: resolved, bytes: buffer.byteLength, format },
      };
    }
    return {
      content: `Captured browser screenshot (${buffer.byteLength} bytes). Provide filePath to save it.`,
      metadata: { pageId: page.webContents.id, bytes: buffer.byteLength, format },
    };
  }

  async listConsoleMessages(input: {
    pageId?: number;
    pageSize?: number;
    pageIdx?: number;
    types?: string[];
    includePreservedMessages?: boolean;
  }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const allowedTypes = new Set((input.types ?? []).map((type) => type.toLowerCase()));
    const messages = [
      ...(input.includePreservedMessages ? page.preservedConsoleMessages : []),
      ...page.consoleMessages,
    ].filter((message) => allowedTypes.size === 0 || allowedTypes.has(message.type.toLowerCase()));
    const paged = pageSlice(messages, input.pageSize, input.pageIdx);
    const content =
      paged.items.length === 0
        ? "No console messages captured for the selected internal browser page."
        : paged.items
            .map((message) => {
              const location = message.url ? ` ${message.url}${message.line ? `:${message.line}` : ""}` : "";
              return `${message.id} ${message.type} ${message.text}${location}`;
            })
            .join("\n");
    this.markActivePage(page.webContents.id);
    return {
      content,
      metadata: { pageId: page.webContents.id, total: paged.total, pageIdx: paged.pageIdx, pageSize: paged.pageSize },
    };
  }

  async getConsoleMessage(input: { pageId?: number; msgid: number }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const message = [...page.preservedConsoleMessages, ...page.consoleMessages].find((item) => item.id === input.msgid);
    if (!message) {
      throw new Error(`Console message ${input.msgid} was not found.`);
    }
    this.markActivePage(page.webContents.id);
    return {
      content: [
        `Message ${message.id}`,
        `type: ${message.type}`,
        `text: ${message.text}`,
        message.url ? `url: ${message.url}` : undefined,
        message.line ? `line: ${message.line}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { pageId: page.webContents.id, message },
    };
  }

  async listNetworkRequests(input: {
    pageId?: number;
    pageSize?: number;
    pageIdx?: number;
    resourceTypes?: string[];
    includePreservedRequests?: boolean;
  }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const allowedTypes = new Set((input.resourceTypes ?? []).map((type) => type.toLowerCase()));
    const requests = [
      ...(input.includePreservedRequests ? page.preservedNetworkRequests : []),
      ...page.networkRequests,
    ].filter((request) => allowedTypes.size === 0 || allowedTypes.has(request.resourceType));
    const paged = pageSlice(requests, input.pageSize, input.pageIdx);
    const content =
      paged.items.length === 0
        ? "No network requests captured for the selected internal browser page."
        : paged.items
            .map((request) => {
              const status = request.failed ? `failed ${request.errorText ?? ""}`.trim() : request.status ?? "pending";
              return `${request.id} ${request.method} ${status} ${request.resourceType} ${request.url}`;
            })
            .join("\n");
    this.markActivePage(page.webContents.id);
    return {
      content,
      metadata: { pageId: page.webContents.id, total: paged.total, pageIdx: paged.pageIdx, pageSize: paged.pageSize },
    };
  }

  async getNetworkRequest(input: {
    pageId?: number;
    reqid?: number;
    requestFilePath?: string;
    responseFilePath?: string;
  }): Promise<BrowserAutomationToolResult> {
    const page = this.getPage(input.pageId);
    const request =
      input.reqid === undefined
        ? page.networkRequests.at(-1)
        : [...page.preservedNetworkRequests, ...page.networkRequests].find((item) => item.id === input.reqid);
    if (!request) {
      throw new Error(input.reqid === undefined ? "No network request is available." : `Network request ${input.reqid} was not found.`);
    }

    if (request.responseBody === undefined && page.webContents.debugger?.isAttached()) {
      try {
        const bodyResult = await page.webContents.debugger.sendCommand("Network.getResponseBody", {
          requestId: request.cdpRequestId,
        });
        const body = optionalRecord(bodyResult)?.body;
        if (typeof body === "string") {
          request.responseBody = body;
        }
      } catch {
        // Some requests have no readable body. Keep the summary available.
      }
    }

    if (input.requestFilePath?.trim()) {
      await writeFile(path.resolve(input.requestFilePath), request.requestBody ?? "");
    }
    if (input.responseFilePath?.trim()) {
      await writeFile(path.resolve(input.responseFilePath), request.responseBody ?? "");
    }

    this.markActivePage(page.webContents.id);
    const lines = [
      `${request.id} ${request.method} ${request.status ?? (request.failed ? "failed" : "pending")} ${request.resourceType} ${request.url}`,
      `Request headers:\n${formatJson(request.requestHeaders)}`,
      request.requestBody ? `Request body:\n${truncateBody(request.requestBody)}` : undefined,
      request.responseHeaders ? `Response headers:\n${formatJson(request.responseHeaders)}` : undefined,
      request.responseBody !== undefined ? `Response body:\n${truncateBody(request.responseBody)}` : undefined,
      request.errorText ? `Error: ${request.errorText}` : undefined,
    ];
    return {
      content: lines.filter(Boolean).join("\n\n"),
      metadata: { pageId: page.webContents.id, request },
    };
  }

  private sortedRecords() {
    return Array.from(this.pages.values()).sort((left, right) => left.attachedAt - right.attachedAt);
  }

  private attachDevToolsCollectors(record: BrowserAutomationPageRecord) {
    const debuggerApi = record.webContents.debugger;
    if (!debuggerApi) {
      return;
    }

    let wasAttached = false;
    try {
      wasAttached = debuggerApi.isAttached();
      if (!wasAttached) {
        debuggerApi.attach("1.3");
        record.ownsDebuggerAttachment = true;
      }
    } catch {
      return;
    }

    const handleDebuggerMessage = (_event: unknown, method: unknown, params: unknown) => {
      if (typeof method !== "string") {
        return;
      }
      this.handleDebuggerMessage(record, method, optionalRecord(params) ?? {});
    };
    debuggerApi.on("message", handleDebuggerMessage);
    record.cleanup.push(() => {
      debuggerApi.off("message", handleDebuggerMessage);
      if (record.ownsDebuggerAttachment) {
        try {
          debuggerApi.detach?.();
        } catch {
          // Ignore detach failures during cleanup.
        }
      }
    });

    void debuggerApi.sendCommand("Runtime.enable").catch(() => undefined);
    void debuggerApi.sendCommand("Network.enable").catch(() => undefined);
    void debuggerApi.sendCommand("DOM.enable").catch(() => undefined);
  }

  private handleDebuggerMessage(record: BrowserAutomationPageRecord, method: string, params: Record<string, unknown>) {
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(params.args) ? params.args : [];
      const location = consoleLocation(params);
      this.addConsoleMessage(record, {
        type: typeof params.type === "string" ? params.type : "log",
        text: args.map(consoleArgText).join(" "),
        url: location.url,
        line: location.line,
      });
      return;
    }

    if (method === "Runtime.exceptionThrown") {
      const exceptionDetails = optionalRecord(params.exceptionDetails);
      const exception = optionalRecord(exceptionDetails?.exception);
      this.addConsoleMessage(record, {
        type: "error",
        text:
          stringValue(exception?.description) ||
          stringValue(exceptionDetails?.text) ||
          "Uncaught exception",
        url: typeof exceptionDetails?.url === "string" ? exceptionDetails.url : undefined,
        line: typeof exceptionDetails?.lineNumber === "number" ? exceptionDetails.lineNumber + 1 : undefined,
      });
      return;
    }

    if (method === "Network.requestWillBeSent") {
      const requestId = stringValue(params.requestId);
      const request = optionalRecord(params.request);
      if (!requestId || !request) {
        return;
      }
      let recordItem = record.networkRequestsByCdpId.get(requestId);
      if (!recordItem) {
        recordItem = {
          id: record.nextNetworkRequestId,
          cdpRequestId: requestId,
          url: stringValue(request.url),
          method: stringValue(request.method, "GET"),
          resourceType: normalizeResourceType(params.type),
          requestHeaders: optionalRecord(request.headers),
          requestBody: stringValue(request.postData),
          startedAt: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
        };
        record.nextNetworkRequestId += 1;
        record.networkRequests.push(recordItem);
        record.networkRequestsByCdpId.set(requestId, recordItem);
        trimItems(record.networkRequests, MAX_COLLECTED_ITEMS);
      } else {
        recordItem.url = stringValue(request.url, recordItem.url);
        recordItem.method = stringValue(request.method, recordItem.method);
        recordItem.resourceType = normalizeResourceType(params.type) || recordItem.resourceType;
        recordItem.requestHeaders = optionalRecord(request.headers) ?? recordItem.requestHeaders;
        recordItem.requestBody = stringValue(request.postData, recordItem.requestBody ?? "");
      }
      return;
    }

    if (method === "Network.responseReceived") {
      const requestId = stringValue(params.requestId);
      const request = record.networkRequestsByCdpId.get(requestId);
      const response = optionalRecord(params.response);
      if (!request || !response) {
        return;
      }
      request.resourceType = normalizeResourceType(params.type) || request.resourceType;
      request.status = typeof response.status === "number" ? response.status : request.status;
      request.mimeType = stringValue(response.mimeType, request.mimeType ?? "");
      request.responseHeaders = optionalRecord(response.headers) ?? request.responseHeaders;
      return;
    }

    if (method === "Network.loadingFinished") {
      const request = record.networkRequestsByCdpId.get(stringValue(params.requestId));
      if (request) {
        request.finishedAt = typeof params.timestamp === "number" ? params.timestamp : Date.now();
      }
      return;
    }

    if (method === "Network.loadingFailed") {
      const request = record.networkRequestsByCdpId.get(stringValue(params.requestId));
      if (request) {
        request.failed = true;
        request.errorText = stringValue(params.errorText, "Network request failed.");
        request.finishedAt = typeof params.timestamp === "number" ? params.timestamp : Date.now();
      }
    }
  }

  private addConsoleMessage(record: BrowserAutomationPageRecord, input: Omit<BrowserConsoleMessage, "id" | "timestamp">) {
    if (!input.text) {
      return;
    }
    record.consoleMessages.push({
      id: record.nextConsoleMessageId,
      timestamp: Date.now(),
      ...input,
    });
    record.nextConsoleMessageId += 1;
    trimItems(record.consoleMessages, MAX_COLLECTED_ITEMS);
  }

  private preserveCollectedData(record: BrowserAutomationPageRecord) {
    if (record.consoleMessages.length > 0) {
      record.preservedConsoleMessages.push(...record.consoleMessages);
      trimItems(record.preservedConsoleMessages, MAX_PRESERVED_ITEMS);
      record.consoleMessages = [];
    }
    if (record.networkRequests.length > 0) {
      record.preservedNetworkRequests.push(...record.networkRequests);
      trimItems(record.preservedNetworkRequests, MAX_PRESERVED_ITEMS);
      record.networkRequests = [];
      record.networkRequestsByCdpId = new Map();
    }
  }

  private pruneDestroyedPages() {
    for (const [pageId, record] of this.pages) {
      if (record.webContents.isDestroyed?.() === true) {
        this.pages.delete(pageId);
      }
    }
    if (this.selectedPageId !== null && !this.pages.has(this.selectedPageId)) {
      this.selectedPageId = this.sortedRecords()[0]?.webContents.id ?? null;
    }
  }

  private getPage(pageId?: number) {
    this.pruneDestroyedPages();
    const targetId = pageId ?? this.selectedPageId ?? this.sortedRecords()[0]?.webContents.id;
    const page = targetId === undefined ? undefined : this.pages.get(targetId);
    if (!page) {
      throw new Error("No internal browser page is available. Open the right-side Browser workspace first.");
    }
    if (page.webContents.isDestroyed?.() === true) {
      this.pages.delete(page.webContents.id);
      throw new Error("The selected internal browser page has been closed.");
    }
    return page;
  }

  private getLocator(page: BrowserAutomationPageRecord, uid: string) {
    const locator = page.snapshotLocators.get(uid);
    if (!locator) {
      throw new Error(`Element uid "${uid}" was not found. Call browser_snapshot again and use a fresh uid.`);
    }
    return locator;
  }

  private async waitForLoad(webContents: BrowserAutomationWebContents, timeoutMs: number) {
    await Promise.race([
      new Promise<void>((resolve) => webContents.once("did-stop-loading", () => resolve())),
      wait(timeoutMs),
    ]);
  }
}
