// Talks to the home hub (see hub/ in this repo).
//
// A signed-in hub is { address, token, member, id, name }. The token is the
// session the hub gave this device when the person signed in (docs/hub-auth.md);
// every request shows it. The hub sends no CORS headers, so `address` has to be
// the hub's own origin (the app served by the hub, or Vite's /api proxy in development).

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

/** Swap a pairing code (made by an admin for one member) for that member's session on this device. */
export async function pairWithHub(address, code, name) {
  const res = await request(address, '/api/pair', { method: 'POST', body: { code, name, platform: 'web' } });
  const j = await res.json();
  return { address, token: j.token, member: j.member, id: j.hub.id, name: j.hub.name };
}

/** Does the hub still need its first admin? `setup_code` is only sent to the home network. */
export async function hubSetupState(address) {
  return (await request(address, '/api/setup/state')).json();
}

/** Sign in with email and password. Resolves with the hub as the store keeps it. */
export async function signInToHub(address, email, password, device = '') {
  const res = await request(address, '/api/auth/login/local?app=1', { method: 'POST', body: { email, password, device } });
  const j = await res.json();
  const info = await hubInfo(address);
  return { address, token: j.token, member: j.me, id: info.id, name: info.name };
}

/** Make the first admin with the setup code the hub shows, then sign in as them. */
export async function setUpHub(address, { setupCode, name, email, password }, device = '') {
  await request(address, '/api/setup/first-admin', { method: 'POST', body: { setup_code: setupCode, name, email, password } });
  return signInToHub(address, email, password, device);
}

/** Accept an invite link's code: choose a password and sign in. */
export async function joinHub(address, invite, name, password, device = '') {
  const res = await request(address, '/api/auth/join?app=1', { method: 'POST', body: { invite, name, password, device } });
  const j = await res.json();
  const info = await hubInfo(address);
  return { address, token: j.token, member: j.me, id: info.id, name: info.name };
}

/** A challenge for signing in with a passkey (no account needed first). */
export async function passkeySignInOptions(address) {
  return (await request(address, '/api/auth/passkey/options', { method: 'POST', body: {} })).json();
}

/** Finish a passkey sign-in with what the device answered (see passkey.js). */
export async function passkeySignIn(address, credential, device = '') {
  const res = await request(address, '/api/auth/login/passkey?app=1', { method: 'POST', body: { credential, device } });
  const j = await res.json();
  const info = await hubInfo(address);
  return { address, token: j.token, member: j.me, id: info.id, name: info.name };
}

/** The passkeys this member has on the hub, and the address this page is opened on. */
export const hubPasskeys = (hub) => hubGet(hub, '/api/me/passkeys');
export const passkeyRegisterOptions = (hub) => hubSend(hub, 'POST', '/api/me/passkeys/options', {});
export const passkeyRegister = (hub, credential, name) => hubSend(hub, 'POST', '/api/me/passkeys', { credential, name });
export const removePasskey = (hub, id) => hubSend(hub, 'DELETE', `/api/me/passkeys/${encodeURIComponent(id)}`);

/** Where to send the browser for "Continue with Google / Apple". Resolves with the address. */
export async function providerSignInAddress(address, provider, returnTo = '/') {
  return (await (await request(address, `/api/auth/login/${provider}`, { method: 'POST', body: { return_to: returnTo } })).json()).redirect;
}

/** What the sign-in screen's error says, from the hub's `/#/signin?error=…&message=…` redirect. '' when none. */
export function signInErrorFromHash(hash) {
  const query = (hash || '').split('?')[1] || '';
  const params = new URLSearchParams(query);
  return params.get('error') ? params.get('message') || 'That sign-in didn’t work.' : '';
}

/**
 * Is this page served by a hub? (The hub sends no CORS headers, so the app that talks to one is
 * the app the hub itself serves.) Resolves with { address, info, setup } or null.
 */
export async function detectOwnHub(origin) {
  try {
    const info = await hubInfo(origin);
    if (!info || typeof info.id !== 'string' || typeof info.version !== 'string') return null;
    let setup = {};
    try {
      setup = await hubSetupState(origin);
    } catch {
      // An older hub: nothing to set up.
    }
    return { address: origin, info, setup };
  } catch {
    return null;
  }
}

/** The hub as the store keeps it, for a browser that already holds the hub's session cookie. Null if it doesn't. */
export async function ownSession(own) {
  try {
    const me = await hubGet({ address: own.address, token: '' }, '/api/me');
    return { address: own.address, token: '', member: me.member, id: own.info.id, name: own.info.name };
  } catch {
    return null;
  }
}

/** The invite code inside a link the hub made (`…/#/join?invite=CODE`), or ''. */
export function inviteFromLink(text) {
  const m = /[#&?]invite=([A-Za-z0-9_-]+)/.exec(text || '');
  return m ? m[1] : '';
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

/**
 * A five-minute ticket for one camera, for places that can't send the session
 * (an <img>, a <video>). The session itself never goes in a URL.
 */
export const hubTicket = async (hub, camId) => (await request(hub.address, `/api/cameras/${camId}/ticket`, { method: 'POST', token: hub.token, body: {} })).json();

const withTicket = (hub, path, t) => `${hub.address}${path}?ticket=${encodeURIComponent(t.ticket)}`;

/** A clip (.mp4) or its thumbnail (.jpg) as a file: to play (through an object URL), save or share. */
export const hubClipFile = async (hub, name) => (await request(hub.address, `/api/clips/${name}`, { token: hub.token })).blob();

/** Address of a camera's MJPEG stream, usable as an <img> source. */
export const hubMjpegUrl = async (hub, camId) => withTicket(hub, `/api/cameras/${camId}/stream.mjpeg`, await hubTicket(hub, camId));

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
    access: c.access || 'view', // "manage" lets the person delete events, edit zones and rename
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
