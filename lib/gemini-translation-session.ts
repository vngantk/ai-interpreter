import { captureAudioStream } from "@/lib/audio-capture";
import { DEFAULT_CHINESE_SCRIPT } from "@/lib/chinese-script";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  createPcmCapturePipe,
  PcmAudioPlayer,
  type PcmCapturePipe,
} from "@/lib/gemini-audio";
import { GEMINI_LIVE_TRANSLATE_MODEL } from "@/lib/gemini-languages";
import type {
  LiveTranslationSession,
  TranslationSessionOptions,
} from "@/lib/translation-types";

type GeminiTokenResponse = {
  token: string;
  targetLanguageCode: string;
  model: string;
  expires_at?: string | null;
  error?: string;
};

type GeminiServerMessage = {
  setupComplete?: unknown;
  serverContent?: {
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    modelTurn?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  error?: { message?: string; code?: number };
};

/**
 * Browser Gemini Live Translate session over WebSocket + PCM audio.
 */
export class GeminiTranslationSession implements LiveTranslationSession {
  private captureStream: MediaStream | null = null;
  private sourceAudio: HTMLAudioElement | null = null;
  private pcmPipe: PcmCapturePipe | null = null;
  private socket: WebSocket | null = null;
  private player: PcmAudioPlayer;
  private sourceVolume = 0;
  private translatedVolume = 1;
  private translatedMuted = false;
  private stopped = false;
  private setupDone = false;
  /** Finalized caption text for continuous display. */
  private stableInput = "";
  private stableOutput = "";
  /** Current in-progress fragment (may be revised before it commits). */
  private interimInput = "";
  private interimOutput = "";

  constructor(private readonly options: TranslationSessionOptions) {
    this.player = new PcmAudioPlayer(options.audioElement);
  }

  async start(): Promise<void> {
    const { callbacks } = this.options;
    callbacks?.onStatus?.("connecting", "Gemini · Requesting audio access…");

    try {
      this.captureStream = await captureAudioStream({
        source: this.options.source,
        audioDeviceId: this.options.audioDeviceId,
      });
      this.wireCaptureEnded();
      this.startLocalSourcePlayback(this.captureStream);

      callbacks?.onStatus?.(
        "connecting",
        "Gemini · Creating ephemeral token…",
      );
      const auth = await this.fetchToken();

      callbacks?.onStatus?.("connecting", "Gemini · Connecting Live API…");
      await this.connectLive(auth);

      if (this.stopped) {
        this.cleanup();
        return;
      }

      this.player.setVolume(this.translatedVolume);
      this.player.setMuted(this.translatedMuted);
      this.pcmPipe = createPcmCapturePipe(this.captureStream, (chunk) => {
        this.sendAudioChunk(chunk);
      });

      callbacks?.onStatus?.("live", "Gemini · Listening and translating…");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks?.onError?.(message);
      callbacks?.onStatus?.("error", message);
      this.cleanup();
      throw error;
    }
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    this.options.callbacks?.onStatus?.("idle", "Stopped");
  }

  setTranslatedVolume(volume: number): void {
    this.translatedVolume = clamp(volume, 0, 1);
    this.player.setVolume(this.translatedVolume);
  }

  setTranslatedMuted(muted: boolean): void {
    this.translatedMuted = muted;
    this.player.setMuted(muted);
  }

  setSourceVolume(volume: number): void {
    this.sourceVolume = clamp(volume, 0, 1);
    this.applySourcePlayback();
  }

  private async fetchToken(): Promise<GeminiTokenResponse> {
    const response = await fetch("/api/gemini/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetLanguage: this.options.targetLanguage,
        chineseScript:
          this.options.chineseScript ?? DEFAULT_CHINESE_SCRIPT,
      }),
    });
    const body = (await response.json()) as GeminiTokenResponse;
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to mint Gemini ephemeral token.");
    }
    if (!body.token) {
      throw new Error("Gemini token response missing token.");
    }
    return body;
  }

  private connectLive(auth: GeminiTokenResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      // Ephemeral tokens require the Constrained Live endpoint + access_token.
      // Do not encodeURIComponent the whole token: names look like
      // `auth_tokens/...` and encoding `/` breaks auth (matches @google/genai).
      const url =
        `wss://generativelanguage.googleapis.com/ws/` +
        `google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained` +
        `?access_token=${auth.token}`;

      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;

      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      };

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };

      const timeout = window.setTimeout(() => {
        settleReject(new Error("Timed out waiting for Gemini Live setup."));
        socket.close();
      }, 20_000);

      socket.onopen = () => {
        // Config (modalities, transcripts, translation) is locked on the
        // ephemeral token. Constrained sessions only need the model here;
        // resending locked fields can cause an immediate close.
        const setupMessage = {
          setup: {
            model: `models/${auth.model || GEMINI_LIVE_TRANSLATE_MODEL}`,
          },
        };
        socket.send(JSON.stringify(setupMessage));
      };

      socket.onmessage = async (event) => {
        try {
          const raw =
            typeof event.data === "string"
              ? event.data
              : await blobToText(event.data);
          const message = JSON.parse(raw) as GeminiServerMessage;
          this.options.callbacks?.onRealtimeEvent?.(
            message as unknown as Record<string, unknown>,
          );

          if (message.error) {
            const detail =
              message.error.message ||
              `Gemini error${message.error.code ? ` ${message.error.code}` : ""}`;
            this.options.callbacks?.onError?.(detail);
            if (!this.setupDone) {
              settleReject(new Error(detail));
            }
            return;
          }

          if (message.setupComplete !== undefined && !this.setupDone) {
            this.setupDone = true;
            settleResolve();
          }

          this.handleServerContent(message.serverContent);
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : String(error);
          this.options.callbacks?.onError?.(detail);
          if (!this.setupDone) {
            settleReject(error instanceof Error ? error : new Error(detail));
          }
        }
      };

      socket.onerror = () => {
        const detail = "Gemini WebSocket connection failed.";
        if (!this.setupDone) {
          settleReject(new Error(detail));
        } else {
          this.options.callbacks?.onError?.(detail);
          this.options.callbacks?.onStatus?.("error", detail);
        }
      };

      socket.onclose = (event) => {
        if (this.stopped) return;
        if (!this.setupDone) {
          const reason = event.reason?.trim();
          const detail = reason
            ? `Gemini WebSocket closed before setup completed (${event.code}: ${reason}).`
            : `Gemini WebSocket closed before setup completed (code ${event.code}).`;
          settleReject(new Error(detail));
          return;
        }
        this.options.callbacks?.onStatus?.(
          "idle",
          "Gemini session closed",
        );
        this.stop();
      };
    });
  }

  private handleServerContent(
    content: GeminiServerMessage["serverContent"] | undefined,
  ): void {
    if (!content) return;

    const inputText = content.inputTranscription?.text;
    if (typeof inputText === "string" && inputText.length > 0) {
      this.publishTranscript(
        "input",
        inputText,
        content.inputTranscription?.finished === true,
      );
    }

    const outputText = content.outputTranscription?.text;
    if (typeof outputText === "string" && outputText.length > 0) {
      this.publishTranscript(
        "output",
        outputText,
        content.outputTranscription?.finished === true,
      );
    }

    if (content.turnComplete) {
      this.commitInterim("input");
      this.commitInterim("output");
    }

    const parts = content.modelTurn?.parts;
    if (!parts) return;

    for (const part of parts) {
      const data = part.inlineData?.data;
      if (!data) continue;
      this.player.enqueue(base64ToArrayBuffer(data));
    }
  }

  /**
   * Build a continuous caption from Gemini fragments.
   * Growing/revised hypotheses update the current phrase; unrelated
   * fragments are appended so the panel keeps a full running transcript.
   */
  private publishTranscript(
    kind: "input" | "output",
    text: string,
    finished = false,
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const interim =
      kind === "input" ? this.interimInput : this.interimOutput;
    const stable =
      kind === "input" ? this.stableInput : this.stableOutput;

    let nextStable = stable;
    let nextInterim = interim;

    if (!interim) {
      nextInterim = trimmed;
    } else if (trimmed === interim) {
      if (!finished) return;
    } else if (trimmed.startsWith(interim) || interim.startsWith(trimmed)) {
      // Same phrase growing or being revised.
      nextInterim = trimmed;
    } else {
      // New phrase — commit the previous fragment, then start a new interim.
      nextStable = joinCaption(stable, interim);
      nextInterim = trimmed;
    }

    if (finished) {
      nextStable = joinCaption(nextStable, nextInterim);
      nextInterim = "";
    }

    this.setCaptionState(kind, nextStable, nextInterim);
  }

  private commitInterim(kind: "input" | "output"): void {
    const interim =
      kind === "input" ? this.interimInput : this.interimOutput;
    if (!interim) return;
    const stable =
      kind === "input" ? this.stableInput : this.stableOutput;
    this.setCaptionState(kind, joinCaption(stable, interim), "");
  }

  private setCaptionState(
    kind: "input" | "output",
    stable: string,
    interim: string,
  ): void {
    const display = joinCaption(stable, interim);
    if (kind === "input") {
      this.stableInput = stable;
      this.interimInput = interim;
      this.options.callbacks?.onInputTranscriptReplace?.(display);
    } else {
      this.stableOutput = stable;
      this.interimOutput = interim;
      this.options.callbacks?.onOutputTranscriptReplace?.(display);
    }
  }

  private sendAudioChunk(pcm16: ArrayBuffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!this.setupDone || this.stopped) return;

    this.socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: arrayBufferToBase64(pcm16),
            mimeType: "audio/pcm;rate=16000",
          },
        },
      }),
    );
  }

  private wireCaptureEnded(): void {
    const track = this.captureStream?.getAudioTracks()[0];
    track?.addEventListener(
      "ended",
      () => {
        this.options.callbacks?.onStatus?.("idle", "Audio sharing ended");
        this.stop();
      },
      { once: true },
    );
  }

  private applySourcePlayback(): void {
    if (!this.sourceAudio) return;
    const silent = this.sourceVolume <= 0;
    this.sourceAudio.muted = silent;
    this.sourceAudio.volume = silent ? 0 : this.sourceVolume;
  }

  private startLocalSourcePlayback(stream: MediaStream): void {
    this.sourceAudio = new Audio();
    this.sourceAudio.autoplay = true;
    this.sourceAudio.srcObject = stream;
    this.applySourcePlayback();
    void this.sourceAudio.play().catch(() => {
      // Autoplay may be blocked; translated track still works via user gesture.
    });
  }

  private cleanup(): void {
    this.pcmPipe?.stop();
    this.pcmPipe = null;

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
      this.socket = null;
    }

    this.player.clear();

    if (this.sourceAudio) {
      this.sourceAudio.pause();
      this.sourceAudio.srcObject = null;
      this.sourceAudio = null;
    }

    this.captureStream?.getTracks().forEach((track) => track.stop());
    this.captureStream = null;

    const audio = this.options.audioElement;
    audio.pause();
    audio.srcObject = null;

    this.setupDone = false;
    this.stableInput = "";
    this.stableOutput = "";
    this.interimInput = "";
    this.interimOutput = "";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function joinCaption(stable: string, interim: string): string {
  if (!stable) return interim;
  if (!interim) return stable;
  if (stable.endsWith(" ") || interim.startsWith(" ")) {
    return `${stable}${interim}`;
  }
  return `${stable} ${interim}`;
}

async function blobToText(data: unknown): Promise<string> {
  if (data instanceof Blob) {
    return data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}
