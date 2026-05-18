import type { AppConfig } from "../../src/types";
import { getActiveModelOption } from "../../src/lib/model-config";
import type { AgentMessage, ModelEvent, ModelGateway, ModelRequest, ModelToolSchema, ToolCall } from "./types";

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      reasoning_text?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string | Record<string, unknown>;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

interface PendingToolCall {
  id: string;
  name: string;
  argumentsText: string;
  argumentsObject?: unknown;
}

interface ParsedPseudoToolCall {
  name: string;
  input: unknown;
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function mapMessage(message: AgentMessage) {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input ?? {}),
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function parseSseEvents(buffer: string) {
  const events: string[] = [];
  let rest = buffer;

  while (true) {
    const separatorIndex = rest.indexOf("\n\n");
    if (separatorIndex < 0) {
      break;
    }

    const rawEvent = rest.slice(0, separatorIndex);
    rest = rest.slice(separatorIndex + 2);
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();

    if (data) {
      events.push(data);
    }
  }

  return { events, rest };
}

function parseToolInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { raw: value };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeToolText(value: string) {
  return value
    .trim()
    .replace(/^```(?:json|tool|tool_call)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function getToolByName(tools: ModelToolSchema[], name: string) {
  return tools.find((tool) => tool.name === name);
}

function getSchemaProperties(tool?: ModelToolSchema) {
  return isRecord(tool?.inputSchema.properties) ? tool.inputSchema.properties : {};
}

function getSchemaRequired(tool?: ModelToolSchema) {
  return Array.isArray(tool?.inputSchema.required)
    ? tool.inputSchema.required.filter((item): item is string => typeof item === "string")
    : [];
}

function getCandidateInputKeys(tool?: ModelToolSchema) {
  const keys = new Set<string>([
    ...getSchemaRequired(tool),
    ...Object.keys(getSchemaProperties(tool)),
    "query",
    "url",
    "command",
    "path",
    "pattern",
    "content",
    "question",
  ]);
  return Array.from(keys).filter(Boolean);
}

function getPropertyType(tool: ModelToolSchema | undefined, key: string) {
  const property = getSchemaProperties(tool)[key];
  return isRecord(property) && typeof property.type === "string" ? property.type : "";
}

function coerceSchemaValue(tool: ModelToolSchema | undefined, key: string, rawValue: string) {
  const propertyType = getPropertyType(tool, key);
  const trimmed = rawValue.trim();
  if (propertyType === "number" || propertyType === "integer") {
    const cleaned = trimmed.replace(/[)\]}]+$/g, "").trim();
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : cleaned;
  }
  if (propertyType === "boolean") {
    const cleaned = trimmed.replace(/[)\]}]+$/g, "").trim();
    if (/^(true|false)$/i.test(cleaned)) {
      return /^true$/i.test(cleaned);
    }
  }
  if (propertyType === "object" || propertyType === "array") {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  const cleaned = trimmed.replace(/[)\]}]+$/g, "").trim();
  return cleaned;
}

function decodeXmlishValue(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function coerceToolArgumentValue(tool: ModelToolSchema | undefined, key: string, rawValue: string) {
  const decoded = decodeXmlishValue(rawValue).trim();
  if (/^["[{]/.test(decoded)) {
    try {
      return JSON.parse(decoded) as unknown;
    } catch {
      // Fall through to schema-based coercion.
    }
  }
  return coerceSchemaValue(tool, key, decoded);
}

function stripKnownToolNamePrefix(tool: ModelToolSchema | undefined, value: string) {
  const trimmed = value.trimStart();
  if (!tool || !trimmed.startsWith(tool.name)) {
    return trimmed;
  }

  let rest = trimmed.slice(tool.name.length).trimStart();
  if (rest.startsWith(":") || rest.startsWith("=")) {
    rest = rest.slice(1).trimStart();
  }
  return rest;
}

function tryParseJsonObject(value: string) {
  const trimmed = normalizeToolText(value);
  if (!trimmed) {
    return undefined;
  }

  const candidates = [trimmed];
  if (trimmed.startsWith("{") && !trimmed.endsWith("}")) {
    candidates.push(`${trimmed}}`);
  }
  if (!trimmed.startsWith("{") && /["']?[A-Za-z_][\w-]*["']?\s*:/.test(trimmed)) {
    candidates.push(`{${trimmed}${trimmed.endsWith("}") ? "" : "}"}`);
    const repairedLeadingKey = trimmed.replace(/^([A-Za-z_][\w-]*)["']\s*:/, '"$1":');
    if (repairedLeadingKey !== trimmed) {
      candidates.push(`{${repairedLeadingKey}${repairedLeadingKey.endsWith("}") ? "" : "}"}`);
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next repair candidate.
    }
  }

  return undefined;
}

function repairGlmArgKeyInput(tool: ModelToolSchema | undefined, value: string): unknown {
  const stripped = stripKnownToolNamePrefix(tool, value);
  if (!/<arg_key\b/i.test(stripped)) {
    return undefined;
  }

  const object: Record<string, unknown> = {};
  const pairPattern =
    /<arg_key\b[^>]*>([\s\S]*?)(?:<\/arg_key>|(?=<arg_value\b)|$)\s*(?:<arg_value\b[^>]*>([\s\S]*?)(?:<\/arg_value>|(?=<arg_key\b)|$))?/gi;
  for (const match of stripped.matchAll(pairPattern)) {
    const key = decodeXmlishValue(match[1] ?? "").trim();
    const rawValue = match[2];
    if (!key || rawValue === undefined) {
      continue;
    }
    object[key] = coerceToolArgumentValue(tool, key, rawValue);
  }

  if (Object.keys(object).length > 0) {
    return object;
  }

  const compactKeyValue = stripped
    .replace(/<\/?arg_key\b[^>]*>/gi, "")
    .replace(/<arg_value\b[^>]*>/gi, ": ")
    .replace(/<\/arg_value>/gi, "")
    .trim();
  const parsed = tryParseJsonObject(compactKeyValue);
  if (isRecord(parsed)) {
    return parsed;
  }

  return repairObjectFromKeyValueFragment(tool, compactKeyValue);
}

function extractBalancedJsonValue(value: string, startIndex: number) {
  const opener = value[startIndex];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
  if (!closer) {
    return undefined;
  }

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function extractQuotedValue(value: string, startIndex: number) {
  const quote = value[startIndex];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let escaped = false;
  for (let index = startIndex + 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      return value.slice(startIndex + 1, index);
    }
  }

  return value.slice(startIndex + 1);
}

function isTopLevelIndex(value: string, targetIndex: number) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < targetIndex; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth === 0;
}

function extractToolKeyValue(tool: ModelToolSchema | undefined, source: string, key: string) {
  const pattern = new RegExp(`(?:^|[\\s,{])["']?${escapeRegExp(key)}["']?\\s*[:=]\\s*`, "gi");
  const matches = Array.from(source.matchAll(pattern));
  const match = matches.find((candidate) => candidate.index !== undefined && isTopLevelIndex(source, candidate.index));
  if (match?.index === undefined) {
    return undefined;
  }

  let valueStart = match.index + match[0].length;
  while (/\s/.test(source[valueStart] ?? "")) {
    valueStart += 1;
  }

  const firstChar = source[valueStart];
  if (firstChar === "{" || firstChar === "[") {
    return extractBalancedJsonValue(source, valueStart);
  }
  if (firstChar === '"' || firstChar === "'") {
    return extractQuotedValue(source, valueStart);
  }

  const propertyType = getPropertyType(tool, key);
  const stopPattern = propertyType === "object" || propertyType === "array" ? /[\r\n]/ : /[,}\r\n]/;
  const rest = source.slice(valueStart);
  const stopMatch = rest.match(stopPattern);
  const rawValue = stopMatch?.index === undefined ? rest : rest.slice(0, stopMatch.index);
  return rawValue.trim();
}

function repairObjectFromKeyValueFragment(tool: ModelToolSchema | undefined, value: string) {
  const object: Record<string, unknown> = {};
  const trimmed = normalizeToolText(stripKnownToolNamePrefix(tool, value));
  for (const key of getCandidateInputKeys(tool)) {
    const rawValue = extractToolKeyValue(tool, trimmed, key);
    if (rawValue !== undefined) {
      object[key] = coerceSchemaValue(tool, key, rawValue);
    }
  }

  const required = getSchemaRequired(tool);
  if (required.length > 0 && required.every((key) => object[key] !== undefined && object[key] !== "")) {
    return object;
  }

  return Object.keys(object).length > 0 ? object : undefined;
}

function repairToolInputFromText(tool: ModelToolSchema | undefined, value: string): unknown {
  const trimmed = normalizeToolText(value);
  if (!trimmed) {
    return undefined;
  }

  const repairedGlmInput = repairGlmArgKeyInput(tool, trimmed);
  if (repairedGlmInput !== undefined) {
    return repairedGlmInput;
  }

  const stripped = stripKnownToolNamePrefix(tool, trimmed);
  for (const candidate of [stripped, trimmed]) {
    const parsed = tryParseJsonObject(candidate);
    if (isRecord(parsed)) {
      return parsed;
    }

    const repaired = repairObjectFromKeyValueFragment(tool, candidate);
    if (repaired) {
      return repaired;
    }
  }

  return undefined;
}

function normalizeArgumentsValue(tool: ModelToolSchema | undefined, value: unknown) {
  if (typeof value === "string") {
    return repairToolInputFromText(tool, value) ?? parseToolInput(value);
  }
  if (value !== undefined) {
    return value;
  }
  return {};
}

function getTopLevelToolArguments(tool: ModelToolSchema | undefined, value: Record<string, unknown>) {
  const controlKeys = new Set([
    "arguments",
    "function",
    "id",
    "input",
    "name",
    "parameters",
    "tool",
    "tool_call_id",
    "tool_name",
    "type",
  ]);
  const object: Record<string, unknown> = {};

  for (const key of getCandidateInputKeys(tool)) {
    if (controlKeys.has(key)) {
      continue;
    }
    if (value[key] !== undefined) {
      object[key] = value[key];
    }
  }

  return Object.keys(object).length > 0 ? object : undefined;
}

function getPseudoToolRecordInput(
  tool: ModelToolSchema | undefined,
  value: Record<string, unknown>,
  functionRecord?: Record<string, unknown>,
) {
  const rawArguments = value.arguments ?? value.input ?? value.parameters ?? functionRecord?.arguments;
  if (rawArguments !== undefined) {
    return normalizeArgumentsValue(tool, rawArguments);
  }

  return getTopLevelToolArguments(tool, value) ?? {};
}

function parsePseudoToolCallFromRecord(
  value: Record<string, unknown>,
  tools: ModelToolSchema[],
): ParsedPseudoToolCall | undefined {
  const functionRecord = isRecord(value.function) ? value.function : undefined;
  const nameValue = value.name ?? value.tool ?? value.tool_name ?? functionRecord?.name;
  if (typeof nameValue !== "string") {
    return undefined;
  }

  const tool = getToolByName(tools, nameValue);
  if (!tool) {
    return undefined;
  }

  return {
    name: tool.name,
    input: getPseudoToolRecordInput(tool, value, functionRecord),
  };
}

function parsePseudoToolCallsFromValue(value: unknown, tools: ModelToolSchema[]): ParsedPseudoToolCall[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parsePseudoToolCallsFromValue(item, tools));
  }

  if (!isRecord(value)) {
    return [];
  }

  const direct = parsePseudoToolCallFromRecord(value, tools);
  if (direct) {
    return [direct];
  }

  for (const key of ["tool_calls", "toolCalls", "calls"]) {
    const calls = value[key];
    if (Array.isArray(calls)) {
      return calls.flatMap((item) => parsePseudoToolCallsFromValue(item, tools));
    }
  }

  for (const tool of tools) {
    if (tool.name in value) {
      return [
        {
          name: tool.name,
          input: normalizeArgumentsValue(tool, value[tool.name]),
        },
      ];
    }
  }

  return [];
}

function startsWithToolCallPrefix(value: string, tool: ModelToolSchema) {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith(tool.name)) {
    return false;
  }

  const rest = trimmed.slice(tool.name.length).trimStart();
  if (!rest) {
    return true;
  }
  if (/^[{(:=]/.test(rest)) {
    return true;
  }
  if (/^<\/?arg_(?:key|value)\b/i.test(rest)) {
    return true;
  }

  return getCandidateInputKeys(tool).some(
    (key) => rest.startsWith(key) || rest.startsWith(`"${key}"`) || rest.startsWith(`'${key}'`),
  );
}

function looksLikePseudoToolCallPrefix(value: string, tools: ModelToolSchema[]) {
  const trimmed = value.trimStart();
  if (!trimmed) {
    return false;
  }
  const structuralPrefixes = [
    "<tool_call",
    "<tool_calls",
    "<function_call",
    "<function_calls",
    "<function",
    '{"name"',
    "{'name'",
    '{"tool"',
    "{'tool'",
    '{"tool_name"',
    "{'tool_name'",
    '{"function"',
    "{'function'",
    '{"tool_calls"',
    "{'tool_calls'",
    '{"toolCalls"',
    "{'toolCalls'",
    '{"calls"',
    "{'calls'",
    "[{",
  ];
  if (structuralPrefixes.some((prefix) => prefix.startsWith(trimmed) || trimmed.startsWith(prefix))) {
    return true;
  }
  if (/^<\/?(?:tool_call|tool_calls|function_call|function)\b/i.test(trimmed)) {
    return true;
  }
  if (/^\{\s*"(?:name|tool|tool_name|function)"/i.test(trimmed)) {
    return true;
  }
  if (/^\{\s*"(?:tool_calls|toolCalls|calls)"/.test(trimmed)) {
    return true;
  }
  if (/^\[\s*\{/.test(trimmed)) {
    return true;
  }
  return tools.some((tool) => tool.name.startsWith(trimmed) || startsWithToolCallPrefix(trimmed, tool));
}

function looksLikeToolArgumentFragment(value: string, tool: ModelToolSchema | undefined) {
  const trimmed = value.trimStart();
  if (!tool || !trimmed) {
    return false;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("(") || startsWithToolCallPrefix(trimmed, tool)) {
    return true;
  }
  return getCandidateInputKeys(tool).some(
    (key) => trimmed.startsWith(key) || trimmed.startsWith(`"${key}"`) || trimmed.startsWith(`'${key}'`),
  );
}

function parsePseudoToolCallsFromText(value: string, tools: ModelToolSchema[]): ParsedPseudoToolCall[] {
  const trimmed = normalizeToolText(value);
  if (!trimmed) {
    return [];
  }

  const namedXmlCalls = Array.from(
    trimmed.matchAll(
      /<(?:tool_call|function_call|function)\b[^>]*\bname=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/(?:tool_call|function_call|function)>/gi,
    ),
  )
    .map((match) => {
      const tool = getToolByName(tools, match[1] ?? "");
      if (!tool || match[2] === undefined) {
        return undefined;
      }
      return {
        name: tool.name,
        input: normalizeArgumentsValue(tool, match[2]),
      };
    })
    .filter((call): call is ParsedPseudoToolCall => Boolean(call));

  if (namedXmlCalls.length > 0) {
    return namedXmlCalls;
  }

  const xmlMatch = trimmed.match(
    /<(?:(?:tool|function)_?calls?|function)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:(?:tool|function)_?calls?|function)>/i,
  );
  if (xmlMatch?.[1]) {
    return parsePseudoToolCallsFromText(xmlMatch[1], tools);
  }

  const parsed = tryParseJsonObject(trimmed);
  const parsedCalls = parsePseudoToolCallsFromValue(parsed, tools);
  if (parsedCalls.length > 0) {
    return parsedCalls;
  }

  const orderedTools = [...tools].sort((left, right) => right.name.length - left.name.length);
  for (const tool of orderedTools) {
    if (!startsWithToolCallPrefix(trimmed, tool)) {
      continue;
    }
    const input = repairToolInputFromText(tool, trimmed);
    if (input !== undefined) {
      return [
        {
          name: tool.name,
          input,
        },
      ];
    }
  }

  return [];
}

function getToolInput(tool: PendingToolCall, modelTool?: ModelToolSchema) {
  if (tool.argumentsText.trim()) {
    const repaired = repairToolInputFromText(modelTool, tool.argumentsText);
    if (repaired !== undefined) {
      return repaired;
    }
    const parsed = parseToolInput(tool.argumentsText);
    if (!(isRecord(parsed) && "raw" in parsed)) {
      return parsed;
    }
  }
  if (tool.argumentsObject !== undefined) {
    return tool.argumentsObject;
  }
  return parseToolInput(tool.argumentsText);
}

function getLatestPendingTool(pendingTools: Map<string, PendingToolCall>) {
  let latest: PendingToolCall | undefined;
  for (const tool of pendingTools.values()) {
    latest = tool;
  }
  return latest;
}

export class OpenAICompatibleModelGateway implements ModelGateway {
  private fallbackToolCallSequence = 0;
  private anonymousToolCallSequence = 0;

  constructor(private readonly getConfig: () => Promise<AppConfig>) {}

  private createFallbackToolCallId(index: number) {
    this.fallbackToolCallSequence += 1;
    return `tool-${index}-${this.fallbackToolCallSequence}`;
  }

  private createAnonymousToolKey() {
    this.anonymousToolCallSequence += 1;
    return `anonymous-${this.anonymousToolCallSequence}`;
  }

  async *stream(input: ModelRequest): AsyncIterable<ModelEvent> {
    const config = await this.getConfig();
    const activeModel = getActiveModelOption(config.modelProviders, config.activeModelId);
    if (!activeModel) {
      throw new Error("No active model is configured.");
    }

    const provider = config.modelProviders.find((item) => item.id === activeModel.providerId);
    if (!provider || provider.enabled === false) {
      throw new Error("Active model provider is disabled or missing.");
    }
    if (!provider.apiKey.trim()) {
      throw new Error(`Provider "${provider.name}" is missing an API key.`);
    }
    if (!provider.baseUrl.trim()) {
      throw new Error(`Provider "${provider.name}" is missing a base URL.`);
    }

    const body = {
      model: activeModel.modelId || input.model,
      messages: [{ role: "system", content: input.system }, ...input.messages.map(mapMessage)],
      stream: true,
      temperature: provider.temperature,
      max_tokens: provider.maxTokens,
      tools:
        input.tools.length > 0
          ? input.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            }))
          : undefined,
      tool_choice: input.tools.length > 0 ? "auto" : undefined,
    };

    const response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Model request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let stopReason = "end_turn";
    const pendingTools = new Map<string, PendingToolCall>();
    let lastAnonymousToolKey = "";
    let heldText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;

      for (const eventData of parsed.events) {
        if (eventData === "[DONE]") {
          continue;
        }

        const chunk = JSON.parse(eventData) as ChatCompletionChunk;
        for (const choice of chunk.choices ?? []) {
          const reasoning =
            choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? choice.delta?.reasoning_text;
          if (reasoning) {
            yield { type: "reasoning_delta", text: reasoning };
          }

          for (const toolDelta of choice.delta?.tool_calls ?? []) {
            const hasStableKey = typeof toolDelta.index === "number" || Boolean(toolDelta.id);
            const key = hasStableKey
              ? typeof toolDelta.index === "number"
                ? `index:${toolDelta.index}`
                : `id:${toolDelta.id}`
              : toolDelta.function?.name
                ? this.createAnonymousToolKey()
                : lastAnonymousToolKey || this.createAnonymousToolKey();
            if (!hasStableKey) {
              lastAnonymousToolKey = key;
            }

            const current = pendingTools.get(key) ?? {
              id: toolDelta.id ?? this.createFallbackToolCallId(toolDelta.index ?? 0),
              name: "",
              argumentsText: "",
            };
            const argumentDelta = toolDelta.function?.arguments;
            pendingTools.set(key, {
              id: toolDelta.id ?? current.id,
              name: toolDelta.function?.name ?? current.name,
              argumentsText:
                typeof argumentDelta === "string" ? current.argumentsText + argumentDelta : current.argumentsText,
              argumentsObject: typeof argumentDelta === "string" || argumentDelta === undefined
                ? current.argumentsObject
                : argumentDelta,
            });
          }

          const content = choice.delta?.content;
          if (content) {
            const latestPendingTool = getLatestPendingTool(pendingTools);
            const latestModelTool = latestPendingTool ? getToolByName(input.tools, latestPendingTool.name) : undefined;
            if (
              latestPendingTool &&
              latestModelTool &&
              looksLikeToolArgumentFragment(latestPendingTool.argumentsText + content, latestModelTool)
            ) {
              latestPendingTool.argumentsText += content;
              continue;
            }

            if (heldText || looksLikePseudoToolCallPrefix(content, input.tools)) {
              heldText += content;
              if (!looksLikePseudoToolCallPrefix(heldText, input.tools)) {
                yield { type: "text_delta", text: heldText };
                heldText = "";
              }
              continue;
            }

            yield { type: "text_delta", text: content };
          }

          if (choice.finish_reason) {
            stopReason = choice.finish_reason;
          }
        }
      }
    }

    const syntheticToolCalls: ToolCall[] = [];
    if (heldText) {
      const pseudoToolCalls = parsePseudoToolCallsFromText(heldText, input.tools);
      if (pseudoToolCalls.length > 0) {
        pseudoToolCalls.forEach((pseudoToolCall, index) => {
          syntheticToolCalls.push({
            id: this.createFallbackToolCallId(pendingTools.size + index),
            name: pseudoToolCall.name,
            input: pseudoToolCall.input,
          });
        });
        stopReason = "tool_calls";
      } else {
        yield { type: "text_delta", text: heldText };
      }
    }

    const toolCalls: ToolCall[] = Array.from(pendingTools.values())
      .filter((tool) => tool.name.trim())
      .map((tool) => ({
        id: tool.id,
        name: tool.name,
        input: getToolInput(tool, getToolByName(input.tools, tool.name)),
      }));

    for (const toolCall of [...toolCalls, ...syntheticToolCalls]) {
      yield { type: "tool_call", toolCall };
    }

    yield { type: "done", stopReason };
  }
}
