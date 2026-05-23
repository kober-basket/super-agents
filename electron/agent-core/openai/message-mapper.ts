import type { AgentMessage } from "../types";

export function mapAgentMessageToOpenAIMessage(message: AgentMessage) {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    const mappedMessage: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    } = {
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
    if (message.reasoningContent !== undefined) {
      mappedMessage.reasoning_content = message.reasoningContent;
    }
    return mappedMessage;
  }

  return {
    role: message.role,
    content: message.content,
  };
}
