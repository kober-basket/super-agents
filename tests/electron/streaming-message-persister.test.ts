import assert from "node:assert/strict";
import test from "node:test";

import { StreamingMessagePersister } from "../../electron/streaming-message-persister";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("streaming message persister coalesces scheduled writes", async () => {
  let writes = 0;
  const persister = new StreamingMessagePersister({
    intervalMs: 20,
    persist: async () => {
      writes += 1;
    },
  });

  persister.schedule();
  persister.schedule();
  persister.schedule();

  assert.equal(writes, 0);
  await delay(40);
  assert.equal(writes, 1);
});

test("streaming message persister flushes pending content immediately", async () => {
  let writes = 0;
  const persister = new StreamingMessagePersister({
    intervalMs: 10_000,
    persist: async () => {
      writes += 1;
    },
  });

  persister.schedule();
  await persister.flush();

  assert.equal(writes, 1);
});
