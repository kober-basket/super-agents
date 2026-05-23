import assert from "node:assert/strict";
import test from "node:test";

import {
  isScrollAtBottom,
  isScrollNearBottom,
  scrollMessageListToBottom,
  shouldReleaseAutoScrollOnWheel,
  shouldAutoScrollMessageList,
} from "../../src/lib/chat-scroll";

test("message list is pinned when it is close to the bottom", () => {
  assert.equal(
    isScrollNearBottom({ clientHeight: 500, scrollHeight: 1_000, scrollTop: 486 }),
    true,
  );
  assert.equal(
    isScrollNearBottom({ clientHeight: 500, scrollHeight: 1_000, scrollTop: 470 }),
    false,
  );
});

test("message list resumes auto-scroll only at the bottom after manual detachment", () => {
  assert.equal(
    isScrollAtBottom({ clientHeight: 500, scrollHeight: 1_000, scrollTop: 496 }),
    true,
  );
  assert.equal(
    isScrollAtBottom({ clientHeight: 500, scrollHeight: 1_000, scrollTop: 486 }),
    false,
  );
});

test("message list auto-scroll respects explicit requests and pinned state", () => {
  assert.equal(
    shouldAutoScrollMessageList({
      conversationChanged: true,
      requestedManualScroll: false,
      wasPinnedToBottom: false,
    }),
    true,
  );
  assert.equal(
    shouldAutoScrollMessageList({
      conversationChanged: false,
      requestedManualScroll: true,
      wasPinnedToBottom: false,
    }),
    true,
  );
  assert.equal(
    shouldAutoScrollMessageList({
      conversationChanged: false,
      requestedManualScroll: false,
      wasPinnedToBottom: true,
    }),
    true,
  );
  assert.equal(
    shouldAutoScrollMessageList({
      conversationChanged: false,
      requestedManualScroll: false,
      wasPinnedToBottom: false,
    }),
    false,
  );
});

test("message list pins to the bottom synchronously during streaming", () => {
  let scrollToCalls = 0;
  const target = {
    clientHeight: 500,
    scrollHeight: 1_200,
    scrollTop: 700,
    scrollTo() {
      scrollToCalls += 1;
    },
  };

  scrollMessageListToBottom(target);

  assert.equal(target.scrollTop, 1_200);
  assert.equal(scrollToCalls, 0);
});

test("message list releases auto-scroll as soon as the user wheels upward", () => {
  assert.equal(shouldReleaseAutoScrollOnWheel(-1), true);
  assert.equal(shouldReleaseAutoScrollOnWheel(0), false);
  assert.equal(shouldReleaseAutoScrollOnWheel(1), false);
});
