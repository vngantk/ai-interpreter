export type AudioInputDevice = {
  deviceId: string;
  label: string;
  groupId: string;
};

const DEFAULT_DEVICE: AudioInputDevice = {
  deviceId: "default",
  label: "System default",
  groupId: "",
};

/**
 * Request a short-lived mic permission so enumerateDevices can return labels.
 * Stops tracks immediately after the grant.
 */
export async function ensureMicrophonePermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [DEFAULT_DEVICE];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId || `device-${index}`,
      label: device.label?.trim() || `Microphone ${index + 1}`,
      groupId: device.groupId ?? "",
    }));

  if (inputs.length === 0) {
    return [DEFAULT_DEVICE];
  }

  // Prefer an explicit "default" entry first when the browser provides one.
  const defaultIndex = inputs.findIndex(
    (device) => device.deviceId === "default" || /^default\b/i.test(device.label),
  );

  if (defaultIndex > 0) {
    const [preferred] = inputs.splice(defaultIndex, 1);
    inputs.unshift(preferred);
  }

  return inputs;
}

export function isLikelyVirtualMic(label: string): boolean {
  return /blackhole|loopback|vb-?cable|virtual|soundflower|aggregate|multi-output|zoomaudio|cable input|voice meter/i.test(
    label,
  );
}

export function formatAudioInputLabel(device: AudioInputDevice): string {
  if (isLikelyVirtualMic(device.label)) {
    return `${device.label} (virtual)`;
  }
  return device.label;
}
