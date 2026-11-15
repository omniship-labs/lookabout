// Naming and checks for snapshots, apart from snapshot.js (which reads the
// app store) so they can be tested in plain Node.

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
  return !!(cam && (cam.address || cam.hub));
}
