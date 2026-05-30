import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeDesktopApprovalDecision,
  sanitizeExternalDirectoryApprovalRequestMetadata,
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
          { label: " Safe " },
          { label: " Fast " },
          { label: " Extra " },
          { label: "" },
        ],
        multiple: false,
      },
      {
        question: "",
        options: [{ label: "Ignored" }, { label: "Also ignored" }],
      },
      {
        id: "single",
        question: " Only one option? ",
        options: [{ label: "Only" }],
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
          { label: "Safe", description: "" },
          { label: "Fast", description: "" },
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

test("external directory approval metadata is sanitized for renderer cards", () => {
  assert.deepEqual(
    sanitizeExternalDirectoryApprovalRequestMetadata({
      directory: " C:\\Users\\Administrator\\Desktop ",
      targetPath: " C:\\Users\\Administrator\\Desktop\\notes.txt ",
      workspaceRoot: " C:\\Users\\Administrator\\AppData\\Roaming\\Super Agents\\workspaces\\abc ",
      ignored: true,
    }),
    {
      directory: "C:\\Users\\Administrator\\Desktop",
      targetPath: "C:\\Users\\Administrator\\Desktop\\notes.txt",
      workspaceRoot: "C:\\Users\\Administrator\\AppData\\Roaming\\Super Agents\\workspaces\\abc",
    },
  );
});

test("external directory approval decisions preserve remember-directory intent", () => {
  assert.deepEqual(
    sanitizeDesktopApprovalDecision("external_directory", {
      type: "allow",
      metadata: { rememberDirectory: true, ignored: "value" },
    }),
    {
      type: "allow",
      metadata: {
        rememberDirectory: true,
      },
    },
  );

  assert.deepEqual(sanitizeDesktopApprovalDecision("external_directory", { type: "deny" }), {
    type: "deny",
    reason: "User denied external directory access.",
  });
});
