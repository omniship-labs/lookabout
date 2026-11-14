import React from 'react';
import * as sample from './sampleData.js';
import { HubError, hubGet, hubSend, viewerCamera, viewerEvent } from './hub.js';
import { announce, formatClock } from './hooks.js';

// App state. Settings, cameras added by address and the paired hub persist
// in localStorage. With a hub paired, cameras, viewers and events come from
// the hub. Without one, the house cameras are seeded from sampleData.js
// until phone-to-phone pairing exists.

const KEY = 'lookabout-settings';

const settingDefaults = {
  theme: 'system', // system | light | dark
  cameraName: 'Nursery',
  cameraMode: 'baby', // baby | security
  lens: 'back', // back | front
  quality: '720', // 480 | 720 | 1080
  lowLight: true,
  cryDetection: true,
  sensitivity: 'Medium',
  backgroundAudio: true,
  motionAlerts: true,
  keepDays: 14,
  e2e: true,
  direct: [], // cameras added by address on this network (e.g. an ESP32), kept across reloads
  hub: null, // the paired home hub: { address, token, viewerId, id, name }
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

// Cameras and device rows that don't come from the hub or a board address:
// the sample house, plus anything added through a sample flow this session.
const session = {
  cameras: [...sample.houseCameras],
  cameraRows: [...sample.pairedDevices.cameras],
  viewerRows: [...sample.pairedDevices.viewers],
};

const hubCameraRow = (c) => ({ id: c.id, t: c.name, s: c.source || 'Via hub', a: 'Remove' });
const directRow = (c) => ({ id: c.id, t: c.name, s: c.source, a: 'Remove' });
function viewerRow(v) {
  const seen = v.you ? 'This device' : `Last seen ${new Date(v.last_seen * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`;
  return { id: v.id, t: v.name, s: v.role === 'owner' ? `${seen} · owner` : seen, a: v.you ? 'Rename' : 'Remove' };
}

/** Fills in what the screens read (cameras, devices, hubPaired) from the lists behind them. */
function derive(st) {
  const hubPaired = !!st.hub;
  const hubCams = st.hubCameras.map((c) => (c.status === 'offline' ? { ...c, since: formatClock(c.sinceMs) } : c));
  return {
    ...st,
    hubPaired,
    cameras: hubPaired ? [...hubCams, ...st.direct] : [...session.cameras, ...st.direct],
    devices: {
      cameras: [...(hubPaired ? st.hubCameras.map(hubCameraRow) : session.cameraRows), ...st.direct.map(directRow)],
      viewers: hubPaired ? st.hubViewers.map(viewerRow) : session.viewerRows,
    },
  };
}

let state = derive({
  ...settingDefaults,
  ...loadSettings(),
  hubCameras: [], // as the hub last reported them
  hubViewers: [],
  hubEvents: [],
  hubReachable: true,
});

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  state = derive({ ...state, ...patch });
  try {
    const persisted = {};
    Object.keys(settingDefaults).forEach((k) => {
      persisted[k] = state[k];
    });
    localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch {
    // Private mode or blocked storage: settings just don't persist.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore() {
  return React.useSyncExternalStore(subscribe, getState);
}

/** Cameras added on this device: by address (kept) or through a sample flow (this session). */
export function addCameras(list) {
  const direct = [...state.direct];
  list.forEach((c) => {
    const id = `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}${state.cameras.length + direct.length}`;
    const cam = { id, status: 'online', motion: false, ...c };
    if (cam.streamUrl) {
      direct.push(cam);
    } else {
      session.cameras.push(cam);
      session.cameraRows.push({ id, t: c.name, s: c.source || 'Via hub', a: 'Remove' });
    }
  });
  setState({ direct });
}

// ---- home hub ---------------------------------------------------------------

/** Line under "Cameras" and in the sidebar. */
export function hubLine(s) {
  if (!s.hubPaired) return 'No hub · live only';
  return s.hubReachable ? 'Home hub connected' : 'Home hub not reachable';
}

export function setHub(hub) {
  setState({ hub, hubCameras: [], hubViewers: [], hubEvents: [], hubReachable: true });
  if (hub) refreshHub();
}

/** A hub answer of 401 means this viewer was removed there: forget the hub here too. */
function hubFailed(err, hub) {
  if (state.hub !== hub) return;
  if (err instanceof HubError && err.status === 401) {
    setHub(null);
    announce('This device is no longer paired with the home hub');
  } else if (state.hubReachable) {
    setState({ hubReachable: false });
  }
}

let refreshing = null;

/** Fetch cameras, events and viewers from the paired hub. */
export function refreshHub() {
  const hub = state.hub;
  if (!hub) return Promise.resolve();
  if (refreshing) return refreshing;
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  refreshing = Promise.all([
    hubGet(hub, '/api/cameras'),
    hubGet(hub, `/api/events?since=${weekAgo}`),
    hubGet(hub, '/api/viewers'),
  ])
    .then(([cams, events, viewers]) => {
      if (state.hub !== hub) return;
      setState({
        hubCameras: cams.cameras.map(viewerCamera),
        hubEvents: events.events.map(viewerEvent),
        hubViewers: viewers.viewers,
        hubReachable: true,
      });
    })
    .catch((err) => hubFailed(err, hub))
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Keeps hub data fresh while the app is open and visible. */
export function useHubSync(intervalMs = 5000) {
  const hub = useStore().hub;
  React.useEffect(() => {
    if (!hub) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') refreshHub();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [hub, intervalMs]);
}

/** Add a camera to the hub. Rejects with a HubError whose message can be shown. */
export async function addHubCamera(camera) {
  await hubSend(state.hub, 'POST', '/api/cameras', camera);
  await refreshHub();
}

/** Unpair this device: the hub forgets its key, and this device forgets the hub. */
export async function unpairHub() {
  const hub = state.hub;
  if (!hub) return;
  try {
    await hubSend(hub, 'DELETE', `/api/viewers/${hub.viewerId}`);
  } catch {
    // Hub unreachable: forget it here anyway; the key can be removed on the hub later.
  }
  setHub(null);
}

// ---- paired devices -----------------------------------------------------------

async function onHub(method, path, body) {
  const hub = state.hub;
  try {
    await hubSend(hub, method, path, body);
  } catch (err) {
    hubFailed(err, hub);
    announce(err.message);
  }
  await refreshHub();
}

/** Rename (name given) or remove (name null) a camera in Paired devices. */
export function updateCamera(id, name) {
  if (state.hubCameras.some((c) => c.id === id)) {
    return onHub(name ? 'PATCH' : 'DELETE', `/api/cameras/${id}`, name ? { name } : undefined);
  }
  if (state.direct.some((c) => c.id === id)) {
    setState({ direct: name ? state.direct.map((c) => (c.id === id ? { ...c, name } : c)) : state.direct.filter((c) => c.id !== id) });
    return Promise.resolve();
  }
  const edit = (list, change) => (name ? list.map((x) => (x.id === id ? { ...x, ...change } : x)) : list.filter((x) => x.id !== id));
  session.cameras = edit(session.cameras, { name });
  session.cameraRows = edit(session.cameraRows, { t: name });
  setState({});
  return Promise.resolve();
}

/** Rename or remove a viewer. Removing one on the hub makes its key stop working. */
export function updateViewer(id, name) {
  if (state.hubPaired) {
    if (!name && id === state.hub.viewerId) return unpairHub();
    return onHub(name ? 'PATCH' : 'DELETE', `/api/viewers/${id}`, name ? { name } : undefined);
  }
  session.viewerRows = name ? session.viewerRows.map((x) => (x.id === id ? { ...x, t: name } : x)) : session.viewerRows.filter((x) => x.id !== id);
  setState({});
  return Promise.resolve();
}
