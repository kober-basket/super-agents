import assert from "node:assert/strict";
import test from "node:test";

import { shouldBypassSmoothScrollTarget } from "../../src/lib/useGlobalSmoothScroll";

test("shouldBypassSmoothScrollTarget skips elements inside native wheel regions", () => {
  let receivedSelector = "";
  const target = {
    closest(selector: string) {
      receivedSelector = selector;
      return selector === "[data-native-wheel-scroll]" ? {} : null;
    },
  } as unknown as Element;

  assert.equal(shouldBypassSmoothScrollTarget(target), true);
  assert.equal(receivedSelector, "[data-native-wheel-scroll]");
});

test("shouldBypassSmoothScrollTarget keeps regular elements on smooth scrolling", () => {
  const target = {
    closest() {
      return null;
    },
  } as unknown as Element;

  assert.equal(shouldBypassSmoothScrollTarget(target), false);
});
