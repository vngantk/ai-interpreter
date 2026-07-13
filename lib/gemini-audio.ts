const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
/** ~100ms at 48kHz; Gemini recommends ~100ms PCM chunks. */
const PROCESSOR_BUFFER_SIZE = 4096;

export type PcmCapturePipe = {
  stop: () => void;
};

export type PcmChunkHandler = (pcm16: ArrayBuffer) => void;

/**
 * Capture a MediaStream as 16 kHz mono PCM16 little-endian chunks for Gemini.
 */
export function createPcmCapturePipe(
  stream: MediaStream,
  onChunk: PcmChunkHandler,
): PcmCapturePipe {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(
    PROCESSOR_BUFFER_SIZE,
    1,
    1,
  );
  const mute = audioContext.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const resampled = downsample(
      input,
      audioContext.sampleRate,
      INPUT_SAMPLE_RATE,
    );
    if (resampled.length === 0) return;
    onChunk(floatTo16BitPcm(resampled));
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  void audioContext.resume().catch(() => {
    // User gesture should already have unlocked audio.
  });

  return {
    stop: () => {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
        // Already disconnected.
      }
      void audioContext.close().catch(() => {});
    },
  };
}

/**
 * Low-latency player for Gemini 24 kHz PCM16 output chunks.
 */
export class PcmAudioPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextTime = 0;
  private volume = 1;
  private muted = false;
  private readonly audioElement: HTMLAudioElement;

  constructor(audioElement: HTMLAudioElement) {
    this.audioElement = audioElement;
    this.audioElement.autoplay = true;
    this.audioElement.muted = true;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyPlayback();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyPlayback();
  }

  enqueue(pcm16: ArrayBuffer): void {
    if (!pcm16.byteLength) return;
    const ctx = this.ensureContext();
    const frameCount = Math.floor(pcm16.byteLength / 2);
    if (frameCount <= 0) return;

    const buffer = ctx.createBuffer(1, frameCount, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    const view = new DataView(pcm16);
    for (let i = 0; i < frameCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 0x8000;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);

    const startAt = Math.max(ctx.currentTime + 0.01, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
  }

  clear(): void {
    this.nextTime = 0;
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
      this.gain = null;
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      this.applyPlayback();
      void this.context.resume().catch(() => {});
    }
    return this.context;
  }

  private applyPlayback(): void {
    const silent = this.muted || this.volume <= 0;
    if (this.gain) {
      this.gain.gain.value = silent ? 0 : this.volume;
    }
    this.audioElement.muted = true;
    this.audioElement.volume = 0;
  }
}

function downsample(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (outputSampleRate === inputSampleRate) {
    return input;
  }
  if (outputSampleRate > inputSampleRate) {
    throw new Error("Upsampling is not supported for Gemini mic capture.");
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.floor(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < input.length; j += 1) {
      sum += input[j] ?? 0;
      count += 1;
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
}

function floatTo16BitPcm(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    view.setInt16(
      i * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }
  return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
