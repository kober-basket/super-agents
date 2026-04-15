export type VoiceInputState = "idle" | "recording" | "transcribing";

export type BrowserSpeechRecognitionError =
  | "aborted"
  | "audio-capture"
  | "language-not-supported"
  | "network"
  | "no-speech"
  | "not-allowed"
  | "service-not-allowed"
  | string;

export interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence?: number;
}

export interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

export interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

export interface BrowserSpeechRecognitionEvent extends Event {
  readonly resultIndex?: number;
  readonly results: BrowserSpeechRecognitionResultList;
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: BrowserSpeechRecognitionError;
  readonly message?: string;
}

export interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const PREFERRED_AUDIO_RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

type MediaRecorderSupportProbe = {
  isTypeSupported?: (mimeType: string) => boolean;
};

export function getPreferredAudioRecordingMimeType(
  mediaRecorderCtor?: MediaRecorderSupportProbe | null,
) {
  const target =
    mediaRecorderCtor ??
    (typeof MediaRecorder === "undefined"
      ? null
      : ({
          isTypeSupported: MediaRecorder.isTypeSupported.bind(MediaRecorder),
        } satisfies MediaRecorderSupportProbe));

  if (!target?.isTypeSupported) {
    return "";
  }

  return (
    PREFERRED_AUDIO_RECORDING_MIME_TYPES.find((mimeType) => target.isTypeSupported?.(mimeType)) ??
    ""
  );
}

export function getAudioRecordingExtension(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();

  if (normalized.includes("ogg")) {
    return "ogg";
  }

  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "m4a";
  }

  return "webm";
}

export function buildVoiceRecordingFileName(mimeType: string, timestamp = Date.now()) {
  return `voice-input-${timestamp}.${getAudioRecordingExtension(mimeType)}`;
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return Buffer.from(binary, "binary").toString("base64");
}

export function normalizeVoiceTranscript(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function mergeTranscriptIntoDraft(currentDraft: string, transcript: string) {
  const normalizedTranscript = normalizeVoiceTranscript(transcript);
  if (!normalizedTranscript) {
    return currentDraft;
  }

  if (!currentDraft.trim()) {
    return normalizedTranscript;
  }

  if (/\s$/.test(currentDraft)) {
    return `${currentDraft}${normalizedTranscript}`;
  }

  return `${currentDraft}\n${normalizedTranscript}`;
}

export function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const browserWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

export function collectFinalTranscript(event: BrowserSpeechRecognitionEvent) {
  const transcripts: string[] = [];
  const startIndex = Math.max(0, event.resultIndex ?? 0);

  for (let index = startIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result?.isFinal) {
      continue;
    }

    const alternative = result[0];
    if (!alternative?.transcript) {
      continue;
    }

    const normalizedTranscript = normalizeVoiceTranscript(alternative.transcript);
    if (normalizedTranscript) {
      transcripts.push(normalizedTranscript);
    }
  }

  return transcripts.join(" ").trim();
}
