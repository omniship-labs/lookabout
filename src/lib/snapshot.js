// Snapshot: save the camera's current frame to this device.
//
// Cameras added by address (ESP32, Raspberry Pi) serve one JPEG frame at
// /snapshot.jpg with cross-origin access allowed, so the viewer can fetch it
// and hand it to the browser as a download. Cameras that come through the
// home hub give their frame through the hub, which checks this viewer's key.

import { getState } from './store.js';
import { hubFrame } from './hub.js';
import { canSnapshot, snapshotName } from './snapshotName.js';

export { canSnapshot, snapshotName };

const TIMEOUT_MS = 5000;

async function boardFrame(cam) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cam.address}/snapshot.jpg?t=${Date.now()}`, { cache: 'no-store', signal: abort.signal });
    if (!res.ok) throw new Error(`Camera answered ${res.status}`);
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the camera's current frame and download it.
 * Resolves with the file name; rejects if the camera can't give a frame.
 */
export async function saveSnapshot(cam) {
  if (!canSnapshot(cam)) throw new Error('No video from this camera yet');
  const blob = cam.hub ? await hubFrame(getState().hub, cam.id) : await boardFrame(cam);
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
