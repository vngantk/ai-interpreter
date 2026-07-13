import { captureAudioStream } from "@/lib/audio-capture";
import type {
  LiveTranslationSession,
  TranslationSessionOptions,
} from "@/lib/translation-types";

export type {
  AudioSource,
  SessionStatus,
  TranslationSessionCallbacks,
  TranslationSessionOptions,
} from "@/lib/translation-types";

const TRANSLATION_CALL_URL =
  "https://api.openai.com/v1/realtime/translations/calls";

type SessionResponse = {
  client_secret: string;
  targetLanguage: string;
  error?: string;
};

export class TranslationSession implements LiveTranslationSession {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private captureStream: MediaStream | null = null;
  private sourceAudio: HTMLAudioElement | null = null;
  private sourceVolume = 0;
  private translatedVolume = 1;
  private translatedMuted = false;
  private stopped = false;

  constructor(private readonly options: TranslationSessionOptions) {}

  async start(): Promise<void> {
    const { callbacks } = this.options;
    callbacks?.onStatus?.("connecting", "OpenAI · Requesting audio access…");

    try {
      this.captureStream = await captureAudioStream({
        source: this.options.source,
        audioDeviceId: this.options.audioDeviceId,
      });
      this.wireCaptureEnded();

      // Local monitor for tab audio and mic/virtual inputs (volume starts at 0).
      this.startLocalSourcePlayback(this.captureStream);

      callbacks?.onStatus?.(
        "connecting",
        "OpenAI · Creating translation session…",
      );
      const session = await this.createSession();

      callbacks?.onStatus?.("connecting", "OpenAI · Connecting WebRTC…");
      await this.connectWebRtc(session, this.captureStream);

      if (this.stopped) {
        this.cleanup();
        return;
      }

      callbacks?.onStatus?.("live", "OpenAI · Listening and translating…");
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
    this.applyTranslatedPlayback();
  }

  setTranslatedMuted(muted: boolean): void {
    this.translatedMuted = muted;
    this.applyTranslatedPlayback();
  }

  setSourceVolume(volume: number): void {
    this.sourceVolume = clamp(volume, 0, 1);
    this.applySourcePlayback();
  }

  private async createSession(): Promise<SessionResponse> {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLanguage: this.options.targetLanguage }),
    });

    const body = (await response.json()) as SessionResponse;
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to create translation session.");
    }
    if (!body.client_secret) {
      throw new Error("Session response missing client secret.");
    }
    return body;
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

  private applyTranslatedPlayback(): void {
    const audio = this.options.audioElement;
    const silent = this.translatedMuted || this.translatedVolume <= 0;
    audio.muted = silent;
    audio.volume = silent ? 0 : this.translatedVolume;

    // Hard-disable remote tracks so WebRTC cannot leak audible samples.
    const remote = audio.srcObject;
    if (remote instanceof MediaStream) {
      for (const track of remote.getAudioTracks()) {
        track.enabled = !silent;
      }
    }
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

  private async connectWebRtc(
    session: SessionResponse,
    stream: MediaStream,
  ): Promise<void> {
    const pc = new RTCPeerConnection();
    this.peerConnection = pc;

    const events = pc.createDataChannel("oai-events");
    this.dataChannel = events;
    events.onmessage = (message) => this.handleRealtimeEvent(message);

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed") {
        this.options.callbacks?.onStatus?.(
          "error",
          "WebRTC connection failed",
        );
      } else if (state === "disconnected") {
        this.options.callbacks?.onStatus?.(
          "reconnecting",
          "Connection interrupted…",
        );
      } else if (state === "connected" && !this.stopped) {
        this.options.callbacks?.onStatus?.(
          "live",
          "OpenAI · Listening and translating…",
        );
      }
    };

    const audio = this.options.audioElement;
    audio.autoplay = true;
    this.applyTranslatedPlayback();
    pc.ontrack = ({ streams }) => {
      audio.srcObject = streams[0];
      this.applyTranslatedPlayback();
      void audio.play().catch((error) => {
        this.options.callbacks?.onError?.(
          error instanceof Error ? error.message : String(error),
        );
      });
    };

    for (const track of stream.getAudioTracks()) {
      pc.addTrack(track, stream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(TRANSLATION_CALL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.client_secret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });

    const answerSdp = await sdpResponse.text();
    if (!sdpResponse.ok) {
      throw new Error(answerSdp || "Failed to negotiate translation call.");
    }

    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  private handleRealtimeEvent(message: MessageEvent<string>): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(message.data) as Record<string, unknown>;
    } catch {
      return;
    }

    this.options.callbacks?.onRealtimeEvent?.(event);

    if (event.type === "error") {
      const detail =
        typeof event.error === "string"
          ? event.error
          : JSON.stringify(event.error ?? event);
      this.options.callbacks?.onError?.(detail);
      return;
    }

    if (
      event.type === "session.output_transcript.delta" &&
      typeof event.delta === "string"
    ) {
      this.options.callbacks?.onOutputTranscript?.(event.delta);
      return;
    }

    if (
      event.type === "session.input_transcript.delta" &&
      typeof event.delta === "string"
    ) {
      this.options.callbacks?.onInputTranscript?.(event.delta);
    }
  }

  private cleanup(): void {
    this.dataChannel?.close();
    this.dataChannel = null;

    this.peerConnection?.close();
    this.peerConnection = null;

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
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
