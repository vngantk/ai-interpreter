import type { ChineseScript } from "@/lib/chinese-script";
import type { OutputLanguageCode } from "@/lib/languages";

export type AudioSource = "microphone" | "tab";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "error"
  | "reconnecting";

export type TranslationProviderId = "openai" | "gemini";

export const TRANSLATION_PROVIDERS = [
  { id: "openai" as const, label: "OpenAI" },
  { id: "gemini" as const, label: "Gemini" },
];

export type TranslationSessionCallbacks = {
  onStatus?: (status: SessionStatus, message?: string) => void;
  /** Append a transcript delta (OpenAI streaming style). */
  onOutputTranscript?: (delta: string) => void;
  onInputTranscript?: (delta: string) => void;
  /**
   * Replace the full caption text (Gemini / Azure interim style).
   * Prefer this when hypotheses are revised rather than appended.
   */
  onOutputTranscriptReplace?: (text: string) => void;
  onInputTranscriptReplace?: (text: string) => void;
  onError?: (message: string) => void;
  /** Raw provider events (OpenAI realtime / Gemini Live). */
  onRealtimeEvent?: (event: Record<string, unknown>) => void;
};

export type TranslationSessionOptions = {
  targetLanguage: OutputLanguageCode;
  source: AudioSource;
  /** Microphone / virtual input device id from enumerateDevices. */
  audioDeviceId?: string;
  audioElement: HTMLAudioElement;
  callbacks?: TranslationSessionCallbacks;
  /** Used by Gemini when target is Chinese (zh-Hans vs zh-Hant). */
  chineseScript?: ChineseScript;
};

/** Common surface shared by OpenAI and Gemini live sessions. */
export type LiveTranslationSession = {
  start(): Promise<void>;
  stop(): void;
  setTranslatedVolume(volume: number): void;
  setTranslatedMuted(muted: boolean): void;
  setSourceVolume(volume: number): void;
};
