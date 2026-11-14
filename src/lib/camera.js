// This device's camera + mic, held across the setup and streaming screens.

let stream = null;

export async function startCamera({ lens, quality }) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new Error('Camera access needs a secure (https) page.');
    err.name = 'NotSupportedError';
    throw err;
  }
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      facingMode: lens === 'front' ? 'user' : 'environment',
      height: { ideal: Number(quality) },
    },
  });
  return stream;
}

export function getStream() {
  return stream;
}

export function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

export function setPaused(paused) {
  if (stream) {
    stream.getTracks().forEach((t) => {
      t.enabled = !paused;
    });
  }
}

// 'granted' | 'denied' | 'prompt' | 'unknown' for camera and microphone.
export async function permissionStates() {
  const read = async (name) => {
    try {
      const status = await navigator.permissions.query({ name });
      return status.state;
    } catch {
      return 'unknown';
    }
  };
  return { camera: await read('camera'), microphone: await read('microphone') };
}

const WORDS = ['FERN', 'OTTER', 'MAPLE', 'HERON', 'CEDAR', 'FINCH', 'MOSS', 'WREN', 'BIRCH', 'LYNX', 'CLOVER', 'ROBIN'];

// Word code shown under the QR code, e.g. FERN-42-OTTER.
export function makePairingCode() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a}-${10 + Math.floor(Math.random() * 90)}-${b}`;
}

export const PAIRING_CODE_PATTERN = /^[A-Z]{3,8}-\d{2}-[A-Z]{3,8}$/;
