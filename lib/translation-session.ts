import type { OutputLanguageCode } from "@/lib/languages";

const TRANSLATION_CALL_URL =
  "https://api.openai.com/v1/realtime/translations/calls";

export type AudioSource = "microphone" | "tab";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "error"
  | "reconnecting";

export type TranslationSessionCallbacks = {
  onStatus?: (status: SessionStatus, message?: string) => void;
  onOutputTranscript?: (delta: string) => void;
  onInputTranscript?: (delta: string) => void;
  onError?: (message: string) => void;
  /** Raw realtime events from the oai-events data channel. */
  onRealtimeEvent?: (event: Record<string, unknown>) => void;
};

export type TranslationSessionOptions = {
  targetLanguage: OutputLanguageCode;
  source: AudioSource;
  audioElement: HTMLAudioElement;
  callbacks?: TranslationSessionCallbacks;
  /** Optional id used when forwarding debug logs to the server. */
  debugSessionId?: string;
};

type SessionResponse = {
  client_secret: string;
  targetLanguage: string;
  error?: string;
};

export class TranslationSession {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private captureStream: MediaStream | null = null;
  private sourceAudio: HTMLAudioElement | null = null;
  private stopped = false;
  private readonly debugSessionId: string;

  constructor(private readonly options: TranslationSessionOptions) {
    this.debugSessionId =
      options.debugSessionId ??
      `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async start(): Promise<void> {
    const { callbacks } = this.options;
    this.logServer("lifecycle", {
      type: "client.session.starting",
      source: this.options.source,
      targetLanguage: this.options.targetLanguage,
    });
    callbacks?.onStatus?.("connecting", "Requesting audio access…");

    try {
      this.captureStream = await this.captureAudio();
      this.wireCaptureEnded();
      this.logServer("lifecycle", {
        type: "client.audio.captured",
        source: this.options.source,
        audioTracks: this.captureStream.getAudioTracks().length,
      });

      if (this.options.source === "tab") {
        this.startLocalSourcePlayback(this.captureStream);
      }

      callbacks?.onStatus?.("connecting", "Creating translation session…");
      const session = await this.createSession();

      callbacks?.onStatus?.("connecting", "Connecting WebRTC…");
      await this.connectWebRtc(session, this.captureStream);

      if (this.stopped) {
        this.cleanup();
        return;
      }

      this.logServer("lifecycle", {
        type: "client.session.live",
        targetLanguage: session.targetLanguage,
      });
      callbacks?.onStatus?.("live", "Listening and translating…");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logServer("lifecycle", {
        type: "client.session.error",
        error: message,
      });
      callbacks?.onError?.(message);
      callbacks?.onStatus?.("error", message);
      this.cleanup();
      throw error;
    }
  }

  stop(): void {
    this.stopped = true;
    this.logServer("lifecycle", { type: "client.session.stopped" });
    this.cleanup();
    this.options.callbacks?.onStatus?.("idle", "Stopped");
  }

  setTranslatedVolume(volume: number): void {
    this.options.audioElement.volume = clamp(volume, 0, 1);
  }

  setTranslatedMuted(muted: boolean): void {
    this.options.audioElement.muted = muted;
  }

  setSourceVolume(volume: number): void {
    if (this.sourceAudio) {
      this.sourceAudio.volume = clamp(volume, 0, 1);
    }
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

  private async captureAudio(): Promise<MediaStream> {
    if (this.options.source === "microphone") {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("This browser does not support tab audio capture.");
    }

    const audioConstraints: MediaTrackConstraints & {
      suppressLocalAudioPlayback?: boolean;
    } = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    const supported = navigator.mediaDevices.getSupportedConstraints?.() as
      | (MediaTrackSupportedConstraints & {
          suppressLocalAudioPlayback?: boolean;
        })
      | undefined;
    if (supported?.suppressLocalAudioPlayback) {
      audioConstraints.suppressLocalAudioPlayback = true;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: audioConstraints,
    });

    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Choose a browser tab and enable tab audio.");
    }

    // Video is only required to open the picker; drop it to save resources.
    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });

    return stream;
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

  private startLocalSourcePlayback(stream: MediaStream): void {
    this.sourceAudio = new Audio();
    this.sourceAudio.autoplay = true;
    this.sourceAudio.srcObject = stream;
    this.sourceAudio.volume = 0;
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
      this.logServer("webrtc", {
        type: "client.webrtc.connection_state",
        state,
      });
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
        this.options.callbacks?.onStatus?.("live", "Listening and translating…");
      }
    };

    const audio = this.options.audioElement;
    audio.autoplay = true;
    pc.ontrack = ({ streams, track }) => {
      this.logServer("webrtc", {
        type: "client.webrtc.remote_track",
        kind: track.kind,
        id: track.id,
      });
      audio.srcObject = streams[0];
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
    this.logServer("webrtc", {
      type: "client.webrtc.sdp_answered",
      answerBytes: answerSdp.length,
    });
  }

  private handleRealtimeEvent(message: MessageEvent<string>): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(message.data) as Record<string, unknown>;
    } catch {
      this.logServer("model", {
        type: "client.event.parse_error",
        raw: String(message.data).slice(0, 200),
      });
      return;
    }

    this.logServer("model", event);
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

  private logServer(source: string, event: Record<string, unknown>): void {
    // Fire-and-forget; never block the realtime path on logging.
    void fetch("/api/debug/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.debugSessionId,
        source,
        event,
      }),
      keepalive: true,
    }).catch(() => {
      // ignore logging failures
    });
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
