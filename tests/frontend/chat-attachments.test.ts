import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createComposerAttachmentsFromFiles } from "../../src/features/chat/attachment-files";

function readRepoFile(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const filePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(filePath, "utf8");
}

test("composer attachments render as removable file cards", () => {
  const source = readRepoFile("src/features/chat/ChatWorkspace.tsx");
  const inputSource = readRepoFile("src/features/chat/ComposerRichInput.tsx");
  const css = readRepoFile("src/styles.css");

  assert.match(source, /className="chat-attachment-card-list composer-attachment-card-list"/);
  assert.match(source, /className=\{`chat-attachment-card composer-attachment-card/);
  assert.match(source, /className="composer-attachment-card-main"/);
  assert.match(source, /className=\{`chat-attachment-card-badge composer-file-icon \$\{meta\.iconClass\}`\}[\s\S]*<span>\{meta\.iconText\}<\/span>/);
  assert.match(source, /className="composer-image-attachment-card"/);
  assert.match(source, /className="composer-image-attachment-thumb"/);
  assert.match(source, /kind === "pdf"[\s\S]*\? "format-pdf"/);
  assert.match(source, /extension === "html"[\s\S]*\? "format-html"/);
  assert.match(source, /office && extension[\s\S]*\? extension\.toUpperCase\(\)\.slice\(0,\s*4\)[\s\S]*: kind === "text"[\s\S]*\? "TXT"/);
  assert.match(source, /className="chat-attachment-remove composer-attachment-remove"/);
  assert.doesNotMatch(source, /className="chat-attachment-chip"/);
  assert.match(inputSource, /event\.clipboardData\.files/);
  assert.match(inputSource, /onPasteFiles\(files\)/);
  assert.match(source, /format-spreadsheet/);

  assert.match(css, /\.composer-attachment-card-list\s*{[^}]*display:\s*flex/s);
  assert.match(css, /\.composer-attachment-card-list\s*{[^}]*max-height:\s*148px/s);
  assert.match(css, /\.composer-attachment-card-list\s*{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.composer-attachment-card\s*{[^}]*width:\s*min\(264px,\s*100%\)/s);
  assert.match(css, /\.composer-attachment-card\s*{[^}]*min-height:\s*68px/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card:hover\s*{[^}]*transform:\s*none[^}]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.92\)[^}]*box-shadow:\s*0 8px 22px rgba\(17,\s*24,\s*39,\s*0\.045\)/s);
  assert.doesNotMatch(css, /\.composer-attachment-card-main:hover \.chat-attachment-card-copy strong\s*{/);
  assert.match(css, /\.composer-file-icon\s*{[^}]*width:\s*48px[^}]*height:\s*48px/s);
  assert.match(css, /\.composer-file-icon span\s*{[^}]*width:\s*30px[^}]*height:\s*36px[^}]*border-radius:\s*8px/s);
  assert.match(css, /\.composer-file-icon span::before\s*{[^}]*clip-path:\s*polygon\(100% 0,\s*0 0,\s*100% 100%\)/s);
  assert.match(css, /\.composer-attachment-card-main:focus-visible\s*{[^}]*box-shadow:\s*0 0 0 3px rgba\(78,\s*122,\s*104,\s*0\.16\)/s);
  assert.doesNotMatch(css, /\.composer-file-icon\.format-html\s*{[^}]*color:/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-pdf\s*{[^}]*background:\s*#f5f5f6[^}]*color:\s*#fff/s);
  assert.doesNotMatch(css, /\.composer-file-icon\.format-pdf\s*{[^}]*background:\s*transparent/s);
  assert.doesNotMatch(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-pdf span\s*{[^}]*clip-path:/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-pdf span\s*{[^}]*background:\s*linear-gradient\(180deg,\s*#ff706d,\s*#f14f4d\)[^}]*align-items:\s*center[^}]*box-shadow:\s*0 8px 16px rgba\(241,\s*79,\s*77,\s*0\.22\)/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-pdf span::before\s*{[^}]*background:\s*linear-gradient\(135deg,\s*#ffd0d0,\s*#ffaaaa\)[^}]*clip-path:\s*polygon\(100% 0,\s*0 0,\s*100% 100%\)[^}]*border-bottom-left-radius:\s*4px[^}]*box-shadow:\s*-1px 1px 0 rgba\(190,\s*45,\s*50,\s*0\.14\)/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-pdf span::after\s*{[^}]*content:\s*""[^}]*transform:\s*rotate\(45deg\)[^}]*background:\s*rgba\(190,\s*45,\s*50,\s*0\.2\)/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-spreadsheet span\s*{[^}]*background:\s*linear-gradient\(180deg,\s*#34c77b,\s*#15965a\)/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-markdown span\s*{[^}]*background:\s*linear-gradient\(180deg,\s*#2bb98d,\s*#13856a\)/s);
  assert.match(css, /\.chat-attachment-card\.composer-attachment-card \.composer-file-icon\.format-file span\s*{[^}]*background:\s*linear-gradient\(180deg,\s*#8f98a8,\s*#657184\)/s);
  assert.match(css, /\.composer-image-attachment-card\s*{[^}]*width:\s*92px[^}]*height:\s*76px/s);
  assert.match(css, /\.composer-image-attachment-thumb\s*{[^}]*object-fit:\s*cover/s);
  assert.match(css, /\.composer-attachment-remove\s*{[^}]*position:\s*absolute/s);
  assert.match(css, /\.composer-attachment-remove\s*{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)[^}]*color:\s*#be123c[^}]*opacity:\s*0[^}]*visibility:\s*hidden/s);
  assert.match(css, /\.composer-attachment-card:hover \.composer-attachment-remove[\s\S]*\.composer-image-attachment-card:focus-within \.composer-attachment-remove\s*{[^}]*opacity:\s*1[^}]*visibility:\s*visible[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.98\)/s);
  assert.match(css, /\.chat-attachment-remove\.composer-attachment-remove\s*{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*place-items:\s*center[^}]*padding:\s*0/s);
  assert.match(css, /\.chat-attachment-remove\.composer-attachment-remove:hover\s*{[^}]*background:\s*#fff1f2[^}]*color:\s*#9f1239/s);
  assert.match(css, /\.chat-attachment-remove\.composer-attachment-remove svg\s*{[^}]*display:\s*block/s);
  assert.match(css, /:root\[data-theme="graphite"\] \.composer-attachment-card[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.06\)/);
  assert.match(css, /:root\[data-theme="graphite"\] \.composer-attachment-card \.chat-attachment-card-copy strong[\s\S]*color:\s*var\(--text\)/);
});

test("clipboard image files become composer image attachments", async () => {
  const file = new File(["image-bytes"], "screen.png", { type: "image/png" });

  const attachments = await createComposerAttachmentsFromFiles([file], {
    createId: () => "image-1",
    readAsDataUrl: async () => "data:image/png;base64,abc",
  });

  assert.deepEqual(attachments, [
    {
      id: "image-1",
      name: "screen.png",
      path: "screen.png",
      size: file.size,
      mimeType: "image/png",
      kind: "image",
      dataUrl: "data:image/png;base64,abc",
    },
  ]);
});

test("clipboard text-like files preserve inline content for chat attachments", async () => {
  const file = new File(["<h1>hello</h1>"], "新建 文本文档.html", { type: "text/html" });

  const attachments = await createComposerAttachmentsFromFiles([file], {
    createId: () => "html-1",
    readAsText: async () => "<h1>hello</h1>",
  });

  assert.equal(attachments[0]?.id, "html-1");
  assert.equal(attachments[0]?.name, "新建 文本文档.html");
  assert.equal(attachments[0]?.kind, "html");
  assert.equal(attachments[0]?.content, "<h1>hello</h1>");
});
