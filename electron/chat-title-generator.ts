import type { ModelGateway, ModelRequest } from "./agent-core/types";

const TITLE_SYSTEM_PROMPT = [
  "Generate a short, descriptive title for this conversation.",
  "Capture the main user intent, not the first sentence verbatim.",
  "Use the same language as the conversation when possible.",
  "Return only the title text. No quotes, no prefix, no trailing punctuation.",
  "Keep it under 32 characters for Chinese, or 3-7 words for English.",
].join(" ");

const DEFAULT_TITLE_MODEL = "gpt-5-mini";
const TITLE_SNIPPET_LIMIT = 700;
const TITLE_MAX_LENGTH = 80;

export interface ConversationTitleInput {
  userMessage: string;
  assistantMessage: string;
}

export interface ConversationTitleGenerator {
  generate(input: ConversationTitleInput): Promise<string | null>;
}

function snippet(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, TITLE_SNIPPET_LIMIT);
}

export function sanitizeGeneratedConversationTitle(value: string) {
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/^title\s*[:：]\s*/i, "")
    .replace(/[.!?。！？；;，,、：:]+$/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.length > TITLE_MAX_LENGTH ? `${cleaned.slice(0, TITLE_MAX_LENGTH - 3)}...` : cleaned;
}

export async function generateConversationTitle(
  input: ConversationTitleInput,
  gateway: ModelGateway,
): Promise<string | null> {
  const userMessage = snippet(input.userMessage);
  const assistantMessage = snippet(input.assistantMessage);
  if (!userMessage || !assistantMessage) {
    return null;
  }

  const request: ModelRequest = {
    model: DEFAULT_TITLE_MODEL,
    system: TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [`User: ${userMessage}`, "", `Assistant: ${assistantMessage}`].join("\n"),
      },
    ],
    tools: [],
    toolChoice: "none",
  };

  let text = "";
  for await (const event of gateway.stream(request)) {
    if (event.type === "text_delta") {
      text += event.text;
    }
  }

  return sanitizeGeneratedConversationTitle(text);
}

export class ModelConversationTitleGenerator implements ConversationTitleGenerator {
  constructor(private readonly gateway: ModelGateway) {}

  async generate(input: ConversationTitleInput): Promise<string | null> {
    return await generateConversationTitle(input, this.gateway);
  }
}
