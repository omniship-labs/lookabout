// Talks to the home hub (see hub/ in this repo).
//
// A paired hub is { address, token, viewerId, id, name }. The token is the
// key the hub gave this viewer when it was paired; every request shows it.

const TIMEOUT_MS = 8000;
export const DEFAULT_HUB_PORT = 8787;

/** What someone typed -> "http://host:8787". */
export function normalizeHubAddress(value) {
  let v = (value || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const url = new URL(v);
    if (!url.port && url.protocol === 'http:') url.port = String(DEFAULT_HUB_PORT);
    return url.origin;
  } catch {
    return '';
  }
}

export class HubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status; // 0: the hub didn't answer at all
  }
}

/** One request to a hub. Resolves with the Response; rejects with HubError. */
async function request(address, path, { method = 'GET', token, body, type } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers['Content-Type'] = type || 'application/json';
  let res;
  try {
    res = await fetch(`${address}${path}`, {
      method,
      headers,
      body: body != null && !type ? JSON.stringify(body) : body,
      cache: 'no-store',
      signal: abort.signal,
    });
  } catch {
    throw new HubError('The hub isn’t answering. Check its address and that this device is on the same network.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `The hub answered ${res.status}.`;
    try {
      message = (await res.json()).error || message;
    } catch {
      // Not JSON: keep the plain message.
    }
    throw new HubError(message, res.status);
  }
  return res;
}

/** Name, version and counts of the hub at this address (no key needed). */
export async function hubInfo(address) {
  return (await request(address, '/api/hub')).json();
}

/** Swap a pairing code from the hub's page for this viewer's key. */
export async function pairWithHub(address, code, name) {
  const res = await request(address, '/api/pair', { method: 'POST', body: { code, name, platform: 'web' } });
  const j = await res.json();
  return { address, token: j.token, viewerId: j.viewer.id, id: j.hub.id, name: j.hub.name };
}

export const hubGet = async (hub, path) => (await request(hub.address, path, { token: hub.token })).json();
export const hubSend = async (hub, method, path, body) =>
  (await request(hub.address, path, { method, token: hub.token, body })).json();

/** A JPEG frame from a camera the hub has (`/api/cameras/<id>/snapshot.jpg`). */
export const hubFrame = async (hub, camId) =>
  (await request(hub.address, `/api/cameras/${camId}/snapshot.jpg`, { token: hub.token })).blob();

/** Ask the hub to try a camera that isn't added yet. Resolves with a JPEG frame. */
export const hubTestCamera = async (hub, camera) =>
  (await request(hub.address, '/api/cameras/test', { method: 'POST', token: hub.token, body: camera })).blob();

/** Address of a clip (.mp4) or its thumbnail (.jpg), usable as a <video> or <img> source. */
export const hubClipUrl = (hub, name) => `${hub.address}/api/clips/${name}?token=${encodeURIComponent(hub.token)}`;

/** The clip file itself, for saving or sharing. */
export const hubClipFile = async (hub, name) => (await request(hub.address, `/api/clips/${name}`, { token: hub.token })).blob();

/** Address of a camera's MJPEG stream, usable as an <img> source. */
export const hubMjpegUrl = (hub, camId) =>
  `${hub.address}/api/cameras/${camId}/stream.mjpeg?token=${encodeURIComponent(hub.token)}`;

function iceGathered(pc, waitMs = 1500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, waitMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Live video from a hub camera over WebRTC. Calls onStream with the
 * MediaStream once video arrives. Resolves with the connection; close it
 * when the video is no longer shown.
 */
export async function hubWebrtc(hub, camId, onStream) {
  // The hub is on the same network, so the two sides can reach each other directly.
  const pc = new RTCPeerConnection();
  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addEventListener('track', (e) => onStream(e.streams[0] || new MediaStream([e.track])));
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const res = await request(hub.address, `/api/cameras/${camId}/webrtc`, {
      method: 'POST',
      token: hub.token,
      body: pc.localDescription.sdp,
      type: 'application/sdp',
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    return pc;
  } catch (err) {
    pc.close();
    throw err;
  }
}

/** A hub camera in the shape the viewer screens use. */
export function viewerCamera(c) {
  return {
    id: c.id,
    name: c.name,
    device: c.device,
    source: c.source,
    kind: c.kind,
    status: c.status === 'offline' ? 'offline' : 'online',
    sinceMs: c.since * 1000,
    motion: !!c.motion,
    hub: true,
  };
}

/** "3 min", "2 h 5 min" */
export function spanLabel(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

const titles = { offline: 'Offline', motion: 'Motion', crying: 'Crying' };

/** A hub event in the shape the Events rows use. */
export function viewerEvent(e) {
  const span = e.ended ? spanLabel(e.ended - e.started) : '';
  let meta = [e.detail, span].filter(Boolean).join(' · ');
  if (e.kind === 'offline') meta = e.ended ? e.detail || `Back after ${span}` : 'Still offline';
  return {
    id: `hub-${e.id}`,
    hubId: e.id,
    ended: !!e.ended,
    lengthLabel: span,
    thumb: e.thumb,
    kind: e.kind,
    cam: e.camera,
    camId: e.camera_id,
    t: `${titles[e.kind] || e.kind} · ${e.camera}`,
    m: meta,
    startedMs: e.started * 1000,
    time: new Date(e.started * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    clip: e.clip,
  };
}

/** Groups events (newest first) under TODAY, YESTERDAY, then the date. */
export function eventDays(events, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const days = [];
  events.forEach((e) => {
    const day = startOfDay(new Date(e.startedMs));
    const back = Math.round((today - day) / 86400000);
    const label = back === 0 ? 'TODAY' : back === 1 ? 'YESTERDAY'
      : new Date(day).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  });
  return days;
}
