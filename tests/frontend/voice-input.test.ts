import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVoiceRecordingFileName,
  getAudioRecordingExtension,
  getPreferredAudioRecordingMimeType,
  mergeTranscriptIntoDraft,
} from "../../src/lib/voice-input";

test("preferred audio recording mime type chooses the first supported format", () => {
  const mimeType = getPreferredAudioRecordingMimeType({
    isTypeSupported: (value) => value === "audio/webm",
  });

  assert.equal(mimeType, "audio/webm");
});

test("voice recording file names follow the mime type", () => {
  assert.equal(getAudioRecordingExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(getAudioRecordingExtension("audio/ogg"), "ogg");
  assert.equal(getAudioRecordingExtension("audio/mp4"), "m4a");
  assert.equal(buildVoiceRecordingFileName("audio/ogg", 123), "voice-input-123.ogg");
});

test("voice transcript is appended cleanly into the draft", () => {
  assert.equal(mergeTranscriptIntoDraft("", "  你好   世界  "), "你好 世界");
  assert.equal(mergeTranscriptIntoDraft("第一段", "第二段"), "第一段\n第二段");
  assert.equal(mergeTranscriptIntoDraft("第一段\n", "第二段"), "第一段\n第二段");
});
