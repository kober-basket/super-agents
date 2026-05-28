import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { QuestionDesktopApprovalRequest } from "../../src/types";

function readSource(relativePath: string) {
  const parentPath = path.resolve(process.cwd(), "..", relativePath);
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(parentPath) ? parentPath : localPath, "utf8");
}

function questionRequest(): QuestionDesktopApprovalRequest {
  return {
    approvalId: "approval-question-1",
    kind: "question",
    sessionId: "session-1",
    agentId: "agent-1",
    toolCallId: "tool-call-1",
    toolName: "question",
    reason: "The agent needs user input before continuing.",
    createdAt: Date.UTC(2026, 4, 23, 8, 0, 0),
    metadata: {
      questions: [
        {
          id: "approach",
          header: "Approach",
          question: "Which approach should we use?",
          options: [
            { label: "Focused", description: "Implement the narrow path first." },
            { label: "Broad", description: "Implement every adjacent tool now." },
          ],
          multiple: false,
        },
      ],
    },
  };
}

test("question approval renders as an in-chat card", async () => {
  const { QuestionRequestCard } = await import("../../src/features/chat/QuestionRequestCard.js");

  const html = renderToStaticMarkup(
    <QuestionRequestCard request={questionRequest()} onResolve={async () => undefined} />,
  );

  assert.match(html, /<strong>问题<\/strong>/);
  assert.match(html, /Which approach should we use\?/);
  assert.match(html, /Focused/);
  assert.match(html, /Implement the narrow path first\./);
  assert.match(html, /提交/);
  assert.doesNotMatch(html, /跳过/);
});

test("question approval shows one numbered question per page with direct jump controls", async () => {
  const { QuestionRequestCard } = await import("../../src/features/chat/QuestionRequestCard.js");
  const request = questionRequest();
  request.metadata.questions.push(
    {
      id: "rpa",
      header: "RPA",
      question: "请选择您使用过的RPA工具（可多选）：",
      options: [
        { label: "UiPath", description: "" },
        { label: "Power Automate", description: "" },
      ],
      multiple: true,
    },
    {
      id: "useful",
      header: "反馈",
      question: "您是否觉得这个question工具很有用？",
      options: [
        { label: "是的，很有用", description: "" },
        { label: "不太好用", description: "" },
      ],
      multiple: false,
    },
  );

  const html = renderToStaticMarkup(
    <QuestionRequestCard request={request} onResolve={async () => undefined} />,
  );

  assert.match(html, /问题 1 \/ 3/);
  assert.match(html, /<span class="question-number">1<\/span>/);
  assert.match(html, /Which approach should we use\?/);
  assert.doesNotMatch(html, /请选择您使用过的RPA工具/);
  assert.doesNotMatch(html, /您是否觉得这个question工具很有用/);
  assert.doesNotMatch(html, /The agent needs user input before continuing/);
  assert.doesNotMatch(html, /可跳题回答/);
  assert.match(html, /aria-label="跳到第 3 题"/);
  assert.match(html, /aria-label="第 1 题自定义答案"/);
  assert.match(html, /placeholder="补充自己的答案"/);
  assert.doesNotMatch(html, /下一页/);
  assert.doesNotMatch(html, /跳过/);
  assert.doesNotMatch(html, /第 1-2/);
});

test("question approval paging can jump to any question without requiring earlier answers", async () => {
  const { questionPageForIndex, visibleQuestionRange } = await import(
    "../../src/features/chat/QuestionRequestCard.js"
  );

  assert.deepEqual(visibleQuestionRange(0, 3), { start: 0, end: 1 });
  assert.deepEqual(visibleQuestionRange(2, 3), { start: 2, end: 3 });
  assert.deepEqual(questionPageForIndex(2), { start: 2, active: 2 });
});

test("question approval card uses roomy adaptive option tiles", () => {
  const styles = readSource("src/styles.css");

  assert.match(styles, /\.question-card\s*{[^}]*grid-template-rows:\s*auto\s+auto\s+auto;/s);
  assert.match(
    styles,
    /\.question-option-list\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(150px,\s*100%\),\s*1fr\)\);/s,
  );
  assert.match(styles, /\.question-option\s*{(?=[^}]*width:\s*100%;)(?=[^}]*min-height:\s*38px;)[^}]*}/s);
  assert.match(styles, /\.question-freeform-input\s*{[^}]*resize:\s*vertical;/s);
  assert.match(styles, /\.question-card-actions\s*{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s);
  assert.match(
    styles,
    /\.question-action\.stop\s*{(?=[^}]*background:\s*#fff4f2;)(?=[^}]*border-color:\s*rgba\(180,\s*35,\s*24,\s*0\.14\);)[^}]*}/s,
  );
  assert.doesNotMatch(styles, /\.question-card-body\s*{[^}]*overflow-y:\s*auto;/s);
});

test("question approval response combines selected labels and custom answers", async () => {
  const { buildQuestionApprovalResponse, toggleQuestionSelection } = await import(
    "../../src/features/chat/QuestionRequestCard.js"
  );
  const request = questionRequest();
  const selections = toggleQuestionSelection(request.metadata.questions[0], {}, "Focused");

  assert.deepEqual(buildQuestionApprovalResponse(request, selections, { approach: "Also keep a rollback path." }), {
    approvalId: "approval-question-1",
    decision: {
      type: "allow",
      metadata: {
        answers: [
          {
            id: "approach",
            question: "Which approach should we use?",
            answer: "Focused, Also keep a rollback path.",
          },
        ],
      },
    },
  });
});
