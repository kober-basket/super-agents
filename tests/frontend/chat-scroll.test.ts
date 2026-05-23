import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMessageListScrollRevision,
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

test("message list scroll revision changes when streaming text grows within the same millisecond", () => {
  const previous = buildMessageListScrollRevision({
    lastMessageContentLength: 12,
    lastMessageId: "assistant-1",
    lastMessageUpdatedAt: 1_000,
    messageCount: 2,
    runtimeFingerprint: "{}",
  });
  const next = buildMessageListScrollRevision({
    lastMessageContentLength: 18,
    lastMessageId: "assistant-1",
    lastMessageUpdatedAt: 1_000,
    messageCount: 2,
    runtimeFingerprint: "{}",
  });

  assert.notEqual(next, previous);
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

test("message list bypasses smooth scrolling when pinning to streaming output", () => {
  let assignedScrollBehavior = "";
  const target = {
    scrollHeight: 1_200,
    style: {
      scrollBehavior: "smooth",
    },
    currentScrollTop: 700,
    get scrollTop() {
      return this.currentScrollTop;
    },
    set scrollTop(value: number) {
      assignedScrollBehavior = this.style.scrollBehavior;
      if (this.style.scrollBehavior !== "smooth") {
        this.currentScrollTop = value;
      }
    },
  };

  scrollMessageListToBottom(target);

  assert.equal(assignedScrollBehavior, "auto");
  assert.equal(target.scrollTop, 1_200);
  assert.equal(target.style.scrollBehavior, "smooth");
});

test("message list preserves CSS smooth scrolling for conversation switches", () => {
  let assignedScrollBehavior = "";
  let scrollToOptions: ScrollToOptions | null = null;
  const target = {
    scrollHeight: 1_200,
    style: {
      scrollBehavior: "smooth",
    },
    currentScrollTop: 0,
    get scrollTop() {
      return this.currentScrollTop;
    },
    set scrollTop(value: number) {
      assignedScrollBehavior = this.style.scrollBehavior;
      this.currentScrollTop = value;
    },
    scrollTo(options: ScrollToOptions) {
      scrollToOptions = options;
    },
  };

  (scrollMessageListToBottom as (
    target: Parameters<typeof scrollMessageListToBottom>[0],
    options?: { behavior?: ScrollBehavior },
  ) => void)(target, { behavior: "auto" });

  assert.deepEqual(scrollToOptions, { top: 1_200, behavior: "auto" });
  assert.equal(assignedScrollBehavior, "");
  assert.equal(target.scrollTop, 0);
  assert.equal(target.style.scrollBehavior, "smooth");
});

test("message list releases auto-scroll as soon as the user wheels upward", () => {
  assert.equal(shouldReleaseAutoScrollOnWheel(-1), true);
  assert.equal(shouldReleaseAutoScrollOnWheel(0), false);
  assert.equal(shouldReleaseAutoScrollOnWheel(1), false);
});
