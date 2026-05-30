import type { ToolDefinition } from "../types";
import { arrayInput, isRecord, sanitizeIdentifier } from "./input";

export function createInteractionToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "question",
      description:
        "向用户提出 1-4 个结构化澄清问题，并等待回答后再继续。每个问题必须包含 2-4 个具体选项；界面会额外提供自定义答案，不要把 Other/Custom 当作选项。",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable answer id." },
                header: { type: "string", description: "Short label for the question." },
                question: { type: "string", description: "Question text shown to the user." },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 4,
                  description:
                    "Two to four concrete choices. Put the recommended choice first. Do not include Other/Custom because the UI adds that separately.",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["label"],
                    additionalProperties: false,
                  },
                },
                multiple: { type: "boolean", description: "Whether multiple options may be selected." },
              },
              required: ["question", "options"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
      execute: async (input, context) => {
        context.emitOutput?.({ stream: "info", text: "Preparing question card\n" });
        const rawQuestions = arrayInput(input, "questions");
        if (rawQuestions.length === 0 || rawQuestions.length > 4) {
          throw new Error("questions must contain 1 to 4 questions.");
        }
        const questions = rawQuestions.map((question, index) => {
          if (!isRecord(question)) {
            throw new Error(`questions[${index}] must be an object.`);
          }
          const text = typeof question.question === "string" ? question.question.trim() : "";
          if (!text) {
            throw new Error(`questions[${index}].question is required.`);
          }
          const rawOptions = Array.isArray(question.options) ? question.options : [];
          const options = rawOptions.map((option, optionIndex) => {
            if (!isRecord(option)) {
              throw new Error(`questions[${index}].options[${optionIndex}] must be an object.`);
            }
            const label = typeof option.label === "string" ? option.label.trim() : "";
            if (!label) {
              throw new Error(`questions[${index}].options[${optionIndex}].label is required.`);
            }
            return {
              label,
              description: typeof option.description === "string" ? option.description.trim() : "",
            };
          });
          if (options.length < 2 || options.length > 4) {
            throw new Error(`questions[${index}].options must contain 2 to 4 options.`);
          }
          return {
            id: sanitizeIdentifier(typeof question.id === "string" ? question.id : "", `question-${index + 1}`),
            header: typeof question.header === "string" ? question.header.trim() : "",
            question: text,
            options,
            multiple: question.multiple === true,
          };
        });

        if (!context.requestApproval) {
          throw new Error("Question tool requires an approval handler.");
        }
        context.emitOutput?.({ stream: "info", text: "Waiting for user answer\n" });
        const approval = await context.requestApproval({
          sessionId: context.sessionId,
          agentId: context.agentId,
          toolCall: context.toolCall ?? { id: `question-${Date.now()}`, name: "question", input },
          kind: "question",
          reason: "The agent needs user input before continuing.",
          metadata: { questions },
        });
        if (approval.type === "deny") {
          context.emitOutput?.({ stream: "info", text: "Question cancelled\n" });
          return {
            content: `Question cancelled: ${approval.reason}`,
            metadata: { cancelled: true },
          };
        }

        const rawAnswers = Array.isArray(approval.metadata?.answers) ? approval.metadata.answers : [];
        const answers = questions.map((question, index) => {
          const rawAnswer = rawAnswers[index];
          if (isRecord(rawAnswer)) {
            return {
              id: typeof rawAnswer.id === "string" ? rawAnswer.id : question.id,
              question: typeof rawAnswer.question === "string" ? rawAnswer.question : question.question,
              answer: typeof rawAnswer.answer === "string" ? rawAnswer.answer : "",
            };
          }
          return {
            id: question.id,
            question: question.question,
            answer: typeof rawAnswer === "string" ? rawAnswer : "",
          };
        });
        context.emitOutput?.({ stream: "info", text: `Received ${answers.length} answer${answers.length === 1 ? "" : "s"}\n` });

        return {
          content: `User answered: ${answers.map((answer) => `"${answer.question}"="${answer.answer || "Unanswered"}"`).join(", ")}`,
          metadata: { answers },
        };
      },
    },
  ];
}
