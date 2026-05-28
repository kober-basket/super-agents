import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import * as ComposerRichInputModule from "../../src/features/chat/ComposerRichInput";

interface PlainTextRange {
  start: number;
  end: number;
}

type InsertPlainTextAtRange = (value: string, text: string, range: PlainTextRange) => string;

function readRepoFile(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  const filePath = existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath);

  return readFileSync(filePath, "utf8");
}

function getInsertPlainTextAtRange() {
  const insertPlainTextAtRange = (ComposerRichInputModule as { insertPlainTextAtRange?: InsertPlainTextAtRange })
    .insertPlainTextAtRange;

  assert.equal(typeof insertPlainTextAtRange, "function");
  return insertPlainTextAtRange as InsertPlainTextAtRange;
}

test("composer plain-text paste updates the controlled value without execCommand", () => {
  const source = readRepoFile("src/features/chat/ComposerRichInput.tsx");

  assert.doesNotMatch(source, /document\.execCommand\(\s*["']insertText["']/);
  assert.match(source, /insertPlainTextAtRange/);
});

test("composer plain-text paste inserts large text at the selected range", () => {
  const insertPlainTextAtRange = getInsertPlainTextAtRange();

  const longPaste = `${"日志行\n".repeat(20_000)}最后一行`;
  assert.equal(
    insertPlainTextAtRange("前缀<>后缀", longPaste, { start: 2, end: 4 }),
    `前缀${longPaste}后缀`,
  );
});

test("composer plain-text paste normalizes clipboard line endings", () => {
  const insertPlainTextAtRange = getInsertPlainTextAtRange();
  assert.equal(insertPlainTextAtRange("a", "b\r\nc\rd", { start: 1, end: 1 }), "ab\nc\nd");
});
