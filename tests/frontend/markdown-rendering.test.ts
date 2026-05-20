import assert from "node:assert/strict";
import test from "node:test";

import { markdownToHtml } from "../../src/lib/format";

test("markdownToHtml renders mermaid fences as renderable placeholders", () => {
  const html = markdownToHtml("```mermaid\ngraph TD; A-->B;\n```");

  assert.match(html, /class="markdown-mermaid"/);
  assert.match(html, /data-mermaid-code="graph TD; A--&gt;B;"/);
  assert.doesNotMatch(html, /language-mermaid/);
});

test("markdownToHtml keeps richer markdown features and raw html", () => {
  const html = markdownToHtml(`
- [x] 已完成
- [ ] 待处理

这是脚注[^note]。

<section class="note"><mark>HTML 内容</mark></section>

[^note]: 脚注内容
`);

  assert.match(html, /task-list-item/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /<section class="note"><mark>HTML 内容<\/mark><\/section>/);
});

test("markdownToHtml preserves preview link markers and highlights code fences", () => {
  const html = markdownToHtml(`
[OpenAI](https://openai.com)

\`\`\`ts
const answer: number = 42;
\`\`\`
`);

  assert.match(html, /data-preview-link="true"/);
  assert.match(html, /hljs-keyword|hljs-variable|hljs-title/);
});
