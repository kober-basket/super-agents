import assert from "node:assert/strict";
import test from "node:test";

import { OpencodeRuntime } from "../../../electron/opencode-runtime-acp";

test("OpencodeRuntime groups chunk updates without message ids into a single message per role", () => {
  const runtime = new OpencodeRuntime() as any;
  const session = runtime.ensureSession("session-1", "F:/work/github/super-agents");

  runtime.appendChunk(
    session,
    "user",
    {
      content: { type: "text", text: "hel" },
    },
    "text",
  );
  runtime.appendChunk(
    session,
    "user",
    {
      content: { type: "text", text: "lo" },
    },
    "text",
  );
  runtime.appendChunk(
    session,
    "assistant",
    {
      content: { type: "text", text: "wor" },
    },
    "text",
  );
  runtime.appendChunk(
    session,
    "assistant",
    {
      content: { type: "text", text: "ld" },
    },
    "text",
  );

  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0]?.info.role, "user");
  assert.equal(session.messages[1]?.info.role, "assistant");

  const userTextParts = session.messages[0]?.parts.filter((part: any) => part.type === "text") ?? [];
  const assistantTextParts = session.messages[1]?.parts.filter((part: any) => part.type === "text") ?? [];

  assert.equal(userTextParts.length, 1);
  assert.equal(userTextParts[0]?.text, "hello");
  assert.equal(assistantTextParts.length, 1);
  assert.equal(assistantTextParts[0]?.text, "world");
});
