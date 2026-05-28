import { Check, Circle, LoaderCircle, Square, X } from "lucide-react";
import { useState } from "react";

import type {
  DesktopApprovalResponse,
  QuestionApprovalQuestion,
  QuestionDesktopApprovalRequest,
  QuestionDesktopApprovalResponse,
} from "../../types";

const QUESTIONS_PER_PAGE = 1;

export type QuestionSelectionState = Record<string, string[]>;
export type QuestionDraftState = Record<string, string>;

export function questionPageForIndex(index: number) {
  const safeIndex = Math.max(0, index);
  return {
    start: Math.floor(safeIndex / QUESTIONS_PER_PAGE) * QUESTIONS_PER_PAGE,
    active: safeIndex,
  };
}

export function visibleQuestionRange(activeQuestionIndex: number, questionCount: number) {
  const page = questionPageForIndex(activeQuestionIndex);
  return {
    start: page.start,
    end: Math.min(page.start + QUESTIONS_PER_PAGE, Math.max(0, questionCount)),
  };
}

export function toggleQuestionSelection(
  question: QuestionApprovalQuestion,
  selections: QuestionSelectionState,
  label: string,
): QuestionSelectionState {
  const current = selections[question.id] ?? [];
  const next = question.multiple
    ? current.includes(label)
      ? current.filter((item) => item !== label)
      : [...current, label]
    : [label];

  return { ...selections, [question.id]: next };
}

export function buildQuestionApprovalResponse(
  request: QuestionDesktopApprovalRequest,
  selections: QuestionSelectionState,
  drafts: QuestionDraftState = {},
): QuestionDesktopApprovalResponse {
  return {
    approvalId: request.approvalId,
    decision: {
      type: "allow",
      metadata: {
        answers: request.metadata.questions.map((question) => {
          const selected = selections[question.id] ?? [];
          const draft = (drafts[question.id] ?? "").trim();
          return {
            id: question.id,
            question: question.question,
            answer: [...selected, ...(draft ? [draft] : [])].join(", "),
          };
        }),
      },
    },
  };
}

function hasSelectedAnswer(
  request: QuestionDesktopApprovalRequest,
  selections: QuestionSelectionState,
  drafts: QuestionDraftState,
) {
  return request.metadata.questions.some((question) => {
    return (selections[question.id] ?? []).length > 0 || Boolean((drafts[question.id] ?? "").trim());
  });
}

function questionHasSelection(
  question: QuestionApprovalQuestion,
  selections: QuestionSelectionState,
  drafts: QuestionDraftState,
) {
  return (selections[question.id] ?? []).length > 0 || Boolean((drafts[question.id] ?? "").trim());
}

function pageLabel(activeQuestionIndex: number, total: number) {
  return total > 1 ? `问题 ${activeQuestionIndex + 1} / ${total}` : "问题";
}

interface QuestionRequestCardProps {
  request: QuestionDesktopApprovalRequest;
  onResolve: (response: DesktopApprovalResponse) => void | Promise<void>;
}

export function QuestionRequestCard({ request, onResolve }: QuestionRequestCardProps) {
  const [selections, setSelections] = useState<QuestionSelectionState>({});
  const [drafts, setDrafts] = useState<QuestionDraftState>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const canSubmit = hasSelectedAnswer(request, selections, drafts);
  const questions = request.metadata.questions;
  const range = visibleQuestionRange(activeQuestionIndex, questions.length);
  const visibleQuestions = questions.slice(range.start, range.end);
  const hasMultipleQuestions = questions.length > 1;
  const currentPageLabel = pageLabel(activeQuestionIndex, questions.length);

  async function resolve(response: QuestionDesktopApprovalResponse) {
    setBusy(true);
    try {
      await onResolve(response);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    await resolve(buildQuestionApprovalResponse(request, selections, drafts));
  }

  function goToQuestion(index: number) {
    setActiveQuestionIndex(Math.max(0, Math.min(index, Math.max(questions.length - 1, 0))));
  }

  async function cancel() {
    await resolve({
      approvalId: request.approvalId,
      decision: { type: "deny", reason: "User cancelled question." },
    });
  }

  return (
    <article className="question-card" data-approval-id={request.approvalId}>
      <header className="question-card-head">
        <div className="question-card-title">
          <strong>{currentPageLabel}</strong>
        </div>
        {hasMultipleQuestions ? (
          <div className="question-jump-list" aria-label="题目切换">
            {questions.map((question, index) => {
              const selected = index >= range.start && index < range.end;
              const answered = questionHasSelection(question, selections, drafts);
              return (
                <button
                  aria-label={`跳到第 ${index + 1} 题`}
                  className={selected ? "question-jump selected" : answered ? "question-jump answered" : "question-jump"}
                  disabled={busy}
                  key={question.id}
                  onClick={() => goToQuestion(index)}
                  type="button"
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        ) : null}
      </header>

      <div className="question-card-body">
        {visibleQuestions.map((question, visibleIndex) => {
          const questionNumber = range.start + visibleIndex + 1;
          return (
            <section className="question-block" key={question.id}>
              <div className="question-block-copy">
                {question.header ? <span className="question-topic">{question.header}</span> : null}
                <div className="question-line">
                  {hasMultipleQuestions ? <span className="question-number">{questionNumber}</span> : null}
                  <p>{question.question}</p>
                </div>
              </div>
              {question.options.length > 0 ? (
                <div className="question-option-list">
                  {question.options.map((option) => {
                    const selected = (selections[question.id] ?? []).includes(option.label);
                    return (
                      <button
                        aria-pressed={selected}
                        className={selected ? "question-option selected" : "question-option"}
                        disabled={busy}
                        key={option.label}
                        onClick={() =>
                          setSelections((current) => toggleQuestionSelection(question, current, option.label))
                        }
                        type="button"
                      >
                        {selected ? (
                          <Check size={14} />
                        ) : question.multiple ? (
                          <Square size={14} />
                        ) : (
                          <Circle size={14} />
                        )}
                        <strong>{option.label}</strong>
                        {option.description ? <span>{option.description}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="question-freeform">
                <textarea
                  aria-label={`第 ${questionNumber} 题自定义答案`}
                  className="question-freeform-input"
                  disabled={busy}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: event.currentTarget.value,
                    }))
                  }
                  placeholder={question.options.length > 0 ? "补充自己的答案" : "输入答案"}
                  rows={1}
                  value={drafts[question.id] ?? ""}
                />
              </div>
            </section>
          );
        })}
      </div>

      <div className="question-card-actions">
        <button className="question-action stop" disabled={busy} onClick={() => void cancel()} type="button">
          <X size={15} />
          取消
        </button>
        <button
          className="question-action primary"
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          提交
        </button>
      </div>
    </article>
  );
}
