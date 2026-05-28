import type { ToolApprovalDecision } from "./agent-core";
import type {
  DesktopApprovalRequest,
  MailAuthApprovalMetadata,
  MailOAuthProvider,
  MailAuthType,
  QuestionApprovalMetadata,
} from "../src/types";

type DesktopApprovalKind = DesktopApprovalRequest["kind"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function authTypeField(value: unknown): MailAuthType | undefined {
  return value === "oauth" || value === "password" ? value : undefined;
}

function oauthProviderField(value: unknown): MailOAuthProvider | undefined {
  return value === "google" || value === "microsoft" ? value : undefined;
}

function mailStatusField(value: unknown) {
  return value === "needs_auth" || value === "connected" || value === "error" ? value : undefined;
}

function sanitizeMailServerConfig(value: unknown) {
  if (!isRecord(value)) return undefined;
  const host = stringField(value.host);
  const port = typeof value.port === "number" && Number.isFinite(value.port) ? value.port : undefined;
  const secure = typeof value.secure === "boolean" ? value.secure : undefined;
  if (!host || port === undefined || secure === undefined) return undefined;
  return { host, port, secure };
}

function sanitizeMailSetup(value: unknown) {
  if (!isRecord(value)) return undefined;
  const incoming = sanitizeMailServerConfig(value.incoming);
  const outgoing = sanitizeMailServerConfig(value.outgoing);
  const email = stringField(value.email);
  const domain = stringField(value.domain) ?? "";
  const providerId = stringField(value.providerId);
  const providerName = stringField(value.providerName);
  const authType = authTypeField(value.authType);
  if (!email || !providerId || !providerName || !authType || !incoming || !outgoing) return undefined;
  return {
    email,
    domain,
    providerId,
    providerName,
    authType,
    oauthProvider: oauthProviderField(value.oauthProvider),
    incoming,
    outgoing,
    advancedRequired: value.advancedRequired === true,
    helpText: stringField(value.helpText),
  };
}

export function sanitizeMailAuthRequestMetadata(metadata: unknown): MailAuthApprovalMetadata {
  if (!isRecord(metadata)) {
    return {};
  }
  return {
    email: stringField(metadata.email),
    provider: stringField(metadata.provider),
    providerName: stringField(metadata.providerName),
    authType: authTypeField(metadata.authType),
    helpText: stringField(metadata.helpText),
    setup: sanitizeMailSetup(metadata.setup),
  };
}

function sanitizeQuestionOption(option: unknown) {
  if (!isRecord(option)) return null;
  const label = stringField(option.label);
  if (!label) return null;
  return {
    label,
    description: stringField(option.description) ?? "",
  };
}

export function sanitizeQuestionApprovalRequestMetadata(metadata: unknown): QuestionApprovalMetadata {
  if (!isRecord(metadata) || !Array.isArray(metadata.questions)) {
    return { questions: [] };
  }

  const questions = metadata.questions.flatMap((rawQuestion, index) => {
    if (!isRecord(rawQuestion)) return [];
    const question = stringField(rawQuestion.question);
    if (!question) return [];

    const options = Array.isArray(rawQuestion.options)
      ? rawQuestion.options
          .map(sanitizeQuestionOption)
          .filter((option): option is { label: string; description: string } => Boolean(option))
      : [];

    return [
      {
        id: stringField(rawQuestion.id) ?? `question-${index + 1}`,
        header: stringField(rawQuestion.header) ?? "",
        question,
        options,
        multiple: rawQuestion.multiple === true,
      },
    ];
  });

  return { questions };
}

export function sanitizeMailAuthDecision(
  decision: unknown,
): ToolApprovalDecision {
  if (!isRecord(decision)) {
    return { type: "deny", reason: "Invalid approval response." };
  }
  if (decision.type === "deny") {
    return { type: "deny", reason: stringField(decision.reason) ?? "User denied mail authorization." };
  }
  if (decision.type !== "allow") {
    return { type: "deny", reason: "Invalid approval response." };
  }

  const metadata = isRecord(decision.metadata) ? decision.metadata : {};
  return {
    type: "allow",
    metadata: {
      accountId: stringField(metadata.accountId),
      email: stringField(metadata.email),
      providerId: stringField(metadata.providerId),
      providerName: stringField(metadata.providerName),
      authType: authTypeField(metadata.authType),
      status: mailStatusField(metadata.status),
    },
  };
}

export function sanitizeQuestionApprovalDecision(
  decision: unknown,
): ToolApprovalDecision {
  if (!isRecord(decision)) {
    return { type: "deny", reason: "Invalid approval response." };
  }
  if (decision.type === "deny") {
    return { type: "deny", reason: stringField(decision.reason) ?? "User cancelled question." };
  }
  if (decision.type !== "allow") {
    return { type: "deny", reason: "Invalid approval response." };
  }

  const metadata: Record<string, unknown> = isRecord(decision.metadata) ? decision.metadata : {};
  const rawAnswers = Array.isArray(metadata.answers) ? metadata.answers : [];
  const answers = rawAnswers.flatMap((rawAnswer, index) => {
    if (!isRecord(rawAnswer)) return [];
    return [
      {
        id: stringField(rawAnswer.id) ?? `question-${index + 1}`,
        question: typeof rawAnswer.question === "string" ? rawAnswer.question.trim() : "",
        answer: typeof rawAnswer.answer === "string" ? rawAnswer.answer.trim() : "",
      },
    ];
  });

  return { type: "allow", metadata: { answers } };
}

export function sanitizeDesktopApprovalDecision(
  kind: DesktopApprovalKind,
  decision: unknown,
): ToolApprovalDecision {
  if (kind === "question") {
    return sanitizeQuestionApprovalDecision(decision);
  }
  return sanitizeMailAuthDecision(decision);
}
