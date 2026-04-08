import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { LoaderCircle, Square, Undo2 } from "lucide-react";

import type { PendingQuestion } from "../../types";

type DraftAnswer = {
  selected: string[];
  custom: string;
};

interface QuestionCardProps {
  request: PendingQuestion;
  onSubmit: (answers: string[][]) => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onAbort: () => Promise<void> | void;
}

function createDrafts(request: PendingQuestion): DraftAnswer[] {
  return request.questions.map(() => ({
    selected: [],
    custom: "",
  }));
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function QuestionCard({ request, onSubmit, onReject, onAbort }: QuestionCardProps) {
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() => createDrafts(request));
  const [busyAction, setBusyAction] = useState<"submit" | "reject" | "abort" | null>(null);

  useEffect(() => {
    setDrafts(createDrafts(request));
    setBusyAction(null);
  }, [request.id]);

  const answers = useMemo(
    () =>
      request.questions.map((question, index) => {
        const draft = drafts[index] ?? { selected: [], custom: "" };
        const selected = question.multiple ? dedupe(draft.selected) : dedupe(draft.selected.slice(0, 1));
        const custom = draft.custom.trim();
        return custom ? dedupe([...selected, custom]) : selected;
      }),
    [drafts, request.questions],
  );
  const canSubmit =
    request.questions.length > 0 &&
    answers.length === request.questions.length &&
    answers.every((answer) => answer.length > 0);

  function setSelected(index: number, label: string, multiple: boolean | undefined) {
    setDrafts((current) =>
      current.map((draft, draftIndex) => {
        if (draftIndex !== index) return draft;

        if (!multiple) {
          const isSelected = draft.selected.includes(label);
          return {
            ...draft,
            selected: isSelected ? [] : [label],
          };
        }

        return {
          ...draft,
          selected: draft.selected.includes(label)
            ? draft.selected.filter((item) => item !== label)
            : [...draft.selected, label],
        };
      }),
    );
  }

  function setCustom(index: number, value: string) {
    setDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, custom: value } : draft)),
    );
  }

  async function handleAction(action: "submit" | "reject" | "abort") {
    if (busyAction) return;
    setBusyAction(action);

    try {
      if (action === "submit") {
        await onSubmit(answers);
        return;
      }
      if (action === "reject") {
        await onReject();
        return;
      }
      await onAbort();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="question-card">
      <div className="question-card-head">
        <div>
          <strong>需要你的输入</strong>
          <span>回答后会继续执行当前会话。</span>
        </div>
      </div>

      <div className="question-card-body">
        {request.questions.map((item, index) => {
          const draft = drafts[index] ?? { selected: [], custom: "" };
          const isMultiple = item.multiple === true;
          const allowCustom = item.custom !== false;

          return (
            <section key={`${request.id}:${index}`} className="question-block">
              <div className="question-block-copy">
                <span>{item.header || `问题 ${index + 1}`}</span>
                <p>{item.question}</p>
              </div>

              {item.options.length > 0 ? (
                <div className="question-option-list">
                  {item.options.map((option) => {
                    const selected = draft.selected.includes(option.label);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        className={clsx("question-option", selected && "selected")}
                        onClick={() => setSelected(index, option.label, isMultiple)}
                        disabled={busyAction !== null}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {allowCustom ? (
                <input
                  value={draft.custom}
                  onChange={(event) => setCustom(index, event.target.value)}
                  placeholder="也可以直接输入你的答案"
                  disabled={busyAction !== null}
                />
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="question-card-actions">
        <button
          type="button"
          className="question-action secondary"
          onClick={() => void handleAction("reject")}
          disabled={busyAction !== null}
        >
          {busyAction === "reject" ? <LoaderCircle size={14} className="spin" /> : <Undo2 size={14} />}
          <span>拒绝</span>
        </button>

        <button
          type="button"
          className="question-action stop"
          onClick={() => void handleAction("abort")}
          disabled={busyAction !== null}
        >
          {busyAction === "abort" ? <LoaderCircle size={14} className="spin" /> : <Square size={14} />}
          <span>停止运行</span>
        </button>

        <button
          type="button"
          className="question-action primary"
          onClick={() => void handleAction("submit")}
          disabled={!canSubmit || busyAction !== null}
        >
          {busyAction === "submit" ? <LoaderCircle size={14} className="spin" /> : null}
          <span>提交答案</span>
        </button>
      </div>
    </section>
  );
}
