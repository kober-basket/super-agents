import { Check, Circle, LoaderCircle, MessageCircleQuestion, Square, X } from "lucide-react";
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

function hasQuestionOptions(question: QuestionApprovalQuestion) {
  return question.options.length >= 2;
}

function pageLabel(activeQuestionIndex: number, total: number) {
  return total > 1 ? `待确认 ${activeQuestionIndex + 1} / ${total}` : "待确认";
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
          <MessageCircleQuestion size={15} />
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
          const hasOptions = hasQuestionOptions(question);
          return (
            <section className="question-block" key={question.id}>
              <div className="question-block-copy">
                <div className="question-line">
                  {hasMultipleQuestions ? <span className="question-number">{questionNumber}</span> : null}
                  <p>{question.question}</p>
                </div>
              </div>
              {hasOptions ? (
                <>
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
                            <span className="question-option-mark">
                              <Check size={14} strokeWidth={3} />
                            </span>
                          ) : question.multiple ? (
                            <span className="question-option-mark">
                              <Square size={13} />
                            </span>
                          ) : (
                            <span className="question-option-mark">
                              <Circle size={13} />
                            </span>
                          )}
                          <span className="question-option-copy">
                            <strong>{option.label}</strong>
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
                      placeholder="补充自己的答案"
                      rows={1}
                      value={drafts[question.id] ?? ""}
                    />
                  </div>
                </>
              ) : (
                <div className="question-option-error" role="alert">
                  这个问题缺少选项，请取消后让助手重新生成。
                </div>
              )}
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
