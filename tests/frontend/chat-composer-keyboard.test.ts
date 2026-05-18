import assert from "node:assert/strict";
import test from "node:test";

import { shouldSubmitComposerKeyDown } from "../../src/features/chat/composer-keyboard";

test("composer submits plain Enter", () => {
  assert.equal(shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: false }), true);
});

test("composer keeps Shift Enter for new lines", () => {
  assert.equal(shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: true }), false);
});

test("composer ignores Enter while an IME composition is active", () => {
  assert.equal(
    shouldSubmitComposerKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: true },
    }),
    false,
  );
});

test("composer ignores legacy IME composition key events", () => {
  assert.equal(
    shouldSubmitComposerKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { keyCode: 229 },
    }),
    false,
  );
});
