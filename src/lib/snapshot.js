// Snapshot: save the camera's current frame to this device.
//
// Cameras added by address (ESP32, Raspberry Pi) serve one JPEG frame at
// /snapshot.jpg with cross-origin access allowed, so the viewer can fetch it
// and hand it to the browser as a download. Cameras that come through the hub
// have no frame to fetch until the hub exists.

const TIMEOUT_MS = 5000;

/** "Side cam" at 14 Nov 2026 03:07:09 -> "side-cam-20261114-030709.jpg" */
export function snapshotName(camName, date = new Date()) {
  const slug = (camName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'camera';
  const p = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const time = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${slug}-${day}-${time}.jpg`;
}

/** True when this camera has a frame the viewer can fetch. */
export function canSnapshot(cam) {
  return !!(cam && cam.address);
}

/**
 * Fetch the camera's current frame and download it.
 * Resolves with the file name; rejects if the camera can't give a frame.
 */
export async function saveSnapshot(cam) {
  if (!canSnapshot(cam)) throw new Error('No video from this camera yet');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let blob;
  try {
    const res = await fetch(`${cam.address}/snapshot.jpg?t=${Date.now()}`, { cache: 'no-store', signal: abort.signal });
    if (!res.ok) throw new Error(`Camera answered ${res.status}`);
    blob = await res.blob();
  } finally {
    clearTimeout(timer);
  }
  if (!blob.size) throw new Error('Camera sent an empty frame');

  const name = snapshotName(cam.name);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing the frame.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}
