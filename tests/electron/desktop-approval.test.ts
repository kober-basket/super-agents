import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeDesktopApprovalDecision,
  sanitizeQuestionApprovalRequestMetadata,
} from "../../electron/desktop-approval";

test("question approval metadata is sanitized for renderer cards", () => {
  const metadata = sanitizeQuestionApprovalRequestMetadata({
    questions: [
      {
        id: " approach ",
        header: " Approach ",
        question: " Which approach should we use? ",
        options: [
          { label: " Focused ", description: " Keep the change narrow. " },
          { label: " Broad " },
          { label: "" },
        ],
        multiple: false,
      },
      {
        question: "",
        options: [{ label: "Ignored" }, { label: "Also ignored" }],
      },
    ],
  });

  assert.deepEqual(metadata, {
    questions: [
      {
        id: "approach",
        header: "Approach",
        question: "Which approach should we use?",
        options: [
          { label: "Focused", description: "Keep the change narrow." },
          { label: "Broad", description: "" },
        ],
        multiple: false,
      },
    ],
  });
});

test("question approval decisions return sanitized answers to the tool", () => {
  const decision = sanitizeDesktopApprovalDecision("question", {
    type: "allow",
    metadata: {
      answers: [
        {
          id: "approach",
          question: "Which approach should we use?",
          answer: "Focused",
          extra: "ignored",
        },
      ],
    },
  });

  assert.deepEqual(decision, {
    type: "allow",
    metadata: {
      answers: [
        {
          id: "approach",
          question: "Which approach should we use?",
          answer: "Focused",
        },
      ],
    },
  });
});
