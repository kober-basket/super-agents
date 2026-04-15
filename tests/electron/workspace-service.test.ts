import assert from "node:assert/strict";
import test from "node:test";

import { getAudioTranscriptionModelCandidates } from "../../electron/workspace-service";

test("audio transcription candidates prefer configured speech models before fallbacks", () => {
  const candidates = getAudioTranscriptionModelCandidates({
    id: "openai",
    name: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    temperature: 0.2,
    maxTokens: 4096,
    enabled: true,
    models: [
      { id: "gpt-5", label: "GPT-5", enabled: true },
      { id: "whisper-large-v3", label: "Whisper Large V3", enabled: true },
    ],
  });

  assert.equal(candidates[0], "whisper-large-v3");
  assert.deepEqual(candidates.slice(1, 4), [
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe",
    "whisper-1",
  ]);
});
