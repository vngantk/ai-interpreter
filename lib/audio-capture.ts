import type { AudioSource } from "@/lib/translation-types";

export type CaptureAudioOptions = {
  source: AudioSource;
  audioDeviceId?: string;
};

/** Capture microphone/virtual input or browser-tab audio as a MediaStream. */
export async function captureAudioStream(
  options: CaptureAudioOptions,
): Promise<MediaStream> {
  if (options.source === "microphone") {
    const deviceId = options.audioDeviceId?.trim();
    const useSpecificDevice =
      !!deviceId && deviceId !== "default" && deviceId !== "communications";

    // Virtual loopback devices usually sound worse with processing on.
    const processing = useSpecificDevice
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };

    return navigator.mediaDevices.getUserMedia({
      audio: useSpecificDevice
        ? {
            deviceId: { exact: deviceId },
            ...processing,
          }
        : processing,
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
