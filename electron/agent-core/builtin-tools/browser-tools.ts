import path from "node:path";

import type { ToolDefinition } from "../types";
import type { BrowserAutomationService, BrowserAutomationToolResult } from "../../browser-automation-service";

export type BrowserAutomationController = Pick<
  BrowserAutomationService,
  | "listPages"
  | "selectPage"
  | "navigate"
  | "takeSnapshot"
  | "click"
  | "fill"
  | "fillForm"
  | "hover"
  | "drag"
  | "typeText"
  | "uploadFile"
  | "pressKey"
  | "waitFor"
  | "evaluate"
  | "takeScreenshot"
  | "listConsoleMessages"
  | "getConsoleMessage"
  | "listNetworkRequests"
  | "getNetworkRequest"
>;

function unavailable(): never {
  throw new Error("Internal browser automation is not available in this window.");
}

function serviceOrThrow(service?: BrowserAutomationController) {
  if (!service) {
    unavailable();
  }
  return service;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringInput(input: unknown, key: string, fallback = "") {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "string" ? value : fallback;
}

function numberInput(input: unknown, key: string): number | undefined {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanInput(input: unknown, key: string, fallback = false) {
  if (!isRecord(input)) return fallback;
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringArrayInput(input: unknown, key: string) {
  if (!isRecord(input) || !Array.isArray(input[key])) return [];
  return input[key]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function unknownArrayInput(input: unknown, key: string) {
  if (!isRecord(input) || !Array.isArray(input[key])) return [];
  return input[key];
}

function formElementsInput(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.elements)) return [];
  return input.elements
    .filter((item): item is { uid: string; value: string } => isRecord(item) && typeof item.uid === "string" && typeof item.value === "string")
    .map((item) => ({ uid: item.uid.trim(), value: item.value }));
}

function workspaceResolvedPath(input: unknown, key: string, workspaceRoot: string) {
  const value = stringInput(input, key).trim();
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function formatListPages(result: ReturnType<BrowserAutomationController["listPages"]>) {
  if (result.length === 0) {
    return "No internal browser pages are open. Open the right-side Browser workspace first.";
  }
  return result
    .map((page) => `${page.id}: ${page.url}${page.selected ? " [selected]" : ""}${page.title ? ` title="${page.title}"` : ""}`)
    .join("\n");
}

function toToolResult(result: BrowserAutomationToolResult) {
  return result;
}

export function createBrowserToolDefinitions(service?: BrowserAutomationController): ToolDefinition[] {
  return [
    {
      name: "browser_list_pages",
      description: "List the visible internal browser webview pages registered in the right-side Browser workspace.",
      risk: "read",
      isConcurrencySafe: true,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const pages = serviceOrThrow(service).listPages();
        return {
          content: formatListPages(pages),
          metadata: { pages },
        };
      },
    },
    {
      name: "browser_select_page",
      description: "Select an internal browser page by id for subsequent browser_* tool calls.",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Browser page id from browser_list_pages." },
        },
        required: ["pageId"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const pageId = numberInput(input, "pageId");
        if (pageId === undefined) throw new Error("pageId is required.");
        serviceOrThrow(service).selectPage(pageId);
        return { content: `Selected browser page ${pageId}.`, metadata: { pageId } };
      },
    },
    {
      name: "browser_navigate",
      description: "Navigate the selected internal browser page to a URL, or use back, forward, or reload.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          url: { type: "string", description: "Target URL, localhost address, domain, or search text." },
          type: { type: "string", enum: ["url", "back", "forward", "reload"], description: "Navigation action." },
          timeoutMs: { type: "number", description: "Maximum wait time for loading." },
        },
        additionalProperties: false,
      },
      execute: async (input) =>
        toToolResult(
          await serviceOrThrow(service).navigate({
            pageId: numberInput(input, "pageId"),
            url: stringInput(input, "url"),
            type: stringInput(input, "type"),
            timeoutMs: numberInput(input, "timeoutMs"),
          }),
        ),
    },
    {
      name: "browser_snapshot",
      description:
        "Take a text snapshot of the selected internal browser page. Use fresh uid values from this output for browser_click and browser_fill.",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          verbose: { type: "boolean", description: "Return more elements when true." },
        },
        additionalProperties: false,
      },
      execute: async (input) =>
        toToolResult(
          await serviceOrThrow(service).takeSnapshot({
            pageId: numberInput(input, "pageId"),
            verbose: booleanInput(input, "verbose"),
          }),
        ),
    },
    {
      name: "browser_click",
      description: "Click an element in the selected internal browser page using a uid from browser_snapshot.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          uid: { type: "string", description: "Element uid from browser_snapshot." },
          dblClick: { type: "boolean", description: "Double click when true." },
        },
        required: ["uid"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const uid = stringInput(input, "uid").trim();
        if (!uid) throw new Error("uid is required.");
        return toToolResult(
          await serviceOrThrow(service).click({
            pageId: numberInput(input, "pageId"),
            uid,
            dblClick: booleanInput(input, "dblClick"),
          }),
        );
      },
    },
    {
      name: "browser_fill",
      description: "Fill an input, textarea, select, checkbox, radio, or editable element using a uid from browser_snapshot.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          uid: { type: "string", description: "Element uid from browser_snapshot." },
          value: { type: "string", description: "Text value, or true/false for checkboxes, radios, and switches." },
        },
        required: ["uid", "value"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const uid = stringInput(input, "uid").trim();
        if (!uid) throw new Error("uid is required.");
        return toToolResult(
          await serviceOrThrow(service).fill({
            pageId: numberInput(input, "pageId"),
            uid,
            value: stringInput(input, "value"),
          }),
        );
      },
    },
    {
      name: "browser_fill_form",
      description:
        "Fill multiple inputs, selects, checkboxes, radios, or editable elements using fresh uid values from browser_snapshot.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          elements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                uid: { type: "string", description: "Element uid from browser_snapshot." },
                value: { type: "string", description: "Text value, or true/false for checkboxes, radios, and switches." },
              },
              required: ["uid", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["elements"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const elements = formElementsInput(input).filter((element) => element.uid);
        if (elements.length === 0) throw new Error("elements must contain at least one uid/value pair.");
        return toToolResult(
          await serviceOrThrow(service).fillForm({
            pageId: numberInput(input, "pageId"),
            elements,
          }),
        );
      },
    },
    {
      name: "browser_hover",
      description: "Hover over an element in the selected internal browser page using a uid from browser_snapshot.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          uid: { type: "string", description: "Element uid from browser_snapshot." },
        },
        required: ["uid"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const uid = stringInput(input, "uid").trim();
        if (!uid) throw new Error("uid is required.");
        return toToolResult(await serviceOrThrow(service).hover({ pageId: numberInput(input, "pageId"), uid }));
      },
    },
    {
      name: "browser_drag",
      description: "Drag one element onto another in the selected internal browser page using uid values from browser_snapshot.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          fromUid: { type: "string", description: "Source element uid from browser_snapshot." },
          toUid: { type: "string", description: "Target element uid from browser_snapshot." },
        },
        required: ["fromUid", "toUid"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const fromUid = stringInput(input, "fromUid").trim();
        const toUid = stringInput(input, "toUid").trim();
        if (!fromUid || !toUid) throw new Error("fromUid and toUid are required.");
        return toToolResult(
          await serviceOrThrow(service).drag({ pageId: numberInput(input, "pageId"), fromUid, toUid }),
        );
      },
    },
    {
      name: "browser_type_text",
      description: "Type text into the currently focused editable element in the selected internal browser page.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          text: { type: "string", description: "Text to type." },
          submitKey: { type: "string", description: "Optional key to press after typing, such as Enter or Tab." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const text = stringInput(input, "text");
        return toToolResult(
          await serviceOrThrow(service).typeText({
            pageId: numberInput(input, "pageId"),
            text,
            submitKey: stringInput(input, "submitKey").trim() || undefined,
          }),
        );
      },
    },
    {
      name: "browser_upload_file",
      description: "Upload a local file through a file input element using a uid from browser_snapshot.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          uid: { type: "string", description: "File input element uid from browser_snapshot." },
          filePath: { type: "string", description: "Local file path to upload. Relative paths resolve inside the workspace." },
        },
        required: ["uid", "filePath"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const uid = stringInput(input, "uid").trim();
        const filePath = workspaceResolvedPath(input, "filePath", context.workspaceRoot);
        if (!uid) throw new Error("uid is required.");
        if (!filePath) throw new Error("filePath is required.");
        return toToolResult(
          await serviceOrThrow(service).uploadFile({
            pageId: numberInput(input, "pageId"),
            uid,
            filePath,
          }),
        );
      },
    },
    {
      name: "browser_press_key",
      description: "Press a key or key combination in the selected internal browser page, such as Enter or Control+L.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          key: { type: "string", description: "Key or key combination." },
        },
        required: ["key"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const key = stringInput(input, "key").trim();
        if (!key) throw new Error("key is required.");
        return toToolResult(await serviceOrThrow(service).pressKey({ pageId: numberInput(input, "pageId"), key }));
      },
    },
    {
      name: "browser_wait_for",
      description: "Wait until any of the requested text appears in the selected internal browser page.",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          text: { type: "array", items: { type: "string" }, description: "Non-empty list of text snippets." },
          timeoutMs: { type: "number", description: "Maximum wait time in milliseconds." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const text = stringArrayInput(input, "text");
        if (text.length === 0) throw new Error("text must contain at least one string.");
        return toToolResult(
          await serviceOrThrow(service).waitFor({
            pageId: numberInput(input, "pageId"),
            text,
            timeoutMs: numberInput(input, "timeoutMs"),
          }),
        );
      },
    },
    {
      name: "browser_evaluate",
      description:
        "Evaluate a JavaScript function in the selected internal browser page. Use for inspection data that browser_snapshot cannot expose.",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          function: { type: "string", description: "JavaScript function declaration, for example () => document.title." },
          args: { type: "array", description: "Optional JSON-serializable arguments." },
        },
        required: ["function"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const functionSource = stringInput(input, "function").trim();
        if (!functionSource) throw new Error("function is required.");
        return toToolResult(
          await serviceOrThrow(service).evaluate({
            pageId: numberInput(input, "pageId"),
            function: functionSource,
            args: unknownArrayInput(input, "args"),
          }),
        );
      },
    },
    {
      name: "browser_list_console_messages",
      description: "List console messages captured from the selected internal browser page since the last navigation.",
      risk: "read",
      isConcurrencySafe: true,
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          pageSize: { type: "number", description: "Maximum number of messages to return." },
          pageIdx: { type: "number", description: "Zero-based page index." },
          types: { type: "array", items: { type: "string" }, description: "Optional console type filter." },
          includePreservedMessages: { type: "boolean", description: "Include messages preserved over recent navigations." },
        },
        additionalProperties: false,
      },
      execute: async (input) =>
        toToolResult(
          await serviceOrThrow(service).listConsoleMessages({
            pageId: numberInput(input, "pageId"),
            pageSize: numberInput(input, "pageSize"),
            pageIdx: numberInput(input, "pageIdx"),
            types: stringArrayInput(input, "types"),
            includePreservedMessages: booleanInput(input, "includePreservedMessages"),
          }),
        ),
    },
    {
      name: "browser_get_console_message",
      description: "Get one console message by msgid from browser_list_console_messages.",
      risk: "read",
      isConcurrencySafe: true,
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          msgid: { type: "number", description: "Console message id." },
        },
        required: ["msgid"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const msgid = numberInput(input, "msgid");
        if (msgid === undefined) throw new Error("msgid is required.");
        return toToolResult(
          await serviceOrThrow(service).getConsoleMessage({
            pageId: numberInput(input, "pageId"),
            msgid,
          }),
        );
      },
    },
    {
      name: "browser_list_network_requests",
      description: "List network requests captured from the selected internal browser page since the last navigation.",
      risk: "read",
      isConcurrencySafe: true,
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          pageSize: { type: "number", description: "Maximum number of requests to return." },
          pageIdx: { type: "number", description: "Zero-based page index." },
          resourceTypes: { type: "array", items: { type: "string" }, description: "Optional resource type filter." },
          includePreservedRequests: { type: "boolean", description: "Include requests preserved over recent navigations." },
        },
        additionalProperties: false,
      },
      execute: async (input) =>
        toToolResult(
          await serviceOrThrow(service).listNetworkRequests({
            pageId: numberInput(input, "pageId"),
            pageSize: numberInput(input, "pageSize"),
            pageIdx: numberInput(input, "pageIdx"),
            resourceTypes: stringArrayInput(input, "resourceTypes"),
            includePreservedRequests: booleanInput(input, "includePreservedRequests"),
          }),
        ),
    },
    {
      name: "browser_get_network_request",
      description: "Get one captured network request by reqid, optionally saving request or response bodies to files.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          reqid: { type: "number", description: "Network request id from browser_list_network_requests." },
          requestFilePath: { type: "string", description: "Optional output path for the request body." },
          responseFilePath: { type: "string", description: "Optional output path for the response body." },
        },
        additionalProperties: false,
      },
      execute: async (input, context) =>
        toToolResult(
          await serviceOrThrow(service).getNetworkRequest({
            pageId: numberInput(input, "pageId"),
            reqid: numberInput(input, "reqid"),
            requestFilePath: workspaceResolvedPath(input, "requestFilePath", context.workspaceRoot) || undefined,
            responseFilePath: workspaceResolvedPath(input, "responseFilePath", context.workspaceRoot) || undefined,
          }),
        ),
    },
    {
      name: "browser_screenshot",
      description: "Capture a screenshot of the selected internal browser page. Provide filePath to save it.",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Optional page id from browser_list_pages." },
          filePath: { type: "string", description: "Optional output path for the screenshot." },
          format: { type: "string", enum: ["png", "jpeg"], description: "Screenshot format. Defaults to png." },
          quality: { type: "number", description: "JPEG quality." },
        },
        additionalProperties: false,
      },
      execute: async (input, context) =>
        toToolResult(
          await serviceOrThrow(service).takeScreenshot({
            pageId: numberInput(input, "pageId"),
            filePath: workspaceResolvedPath(input, "filePath", context.workspaceRoot),
            format: stringInput(input, "format") === "jpeg" ? "jpeg" : "png",
            quality: numberInput(input, "quality"),
          }),
        ),
    },
  ];
}
