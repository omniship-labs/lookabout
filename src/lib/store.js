import React from 'react';
import * as sample from './sampleData.js';

// App state. Settings persist in localStorage; cameras, devices and hub state
// are seeded from sampleData.js until the pairing and hub backends exist.

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
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

const saved = { ...settingDefaults, ...loadSettings() };

let state = {
  ...saved,
  hubPaired: true,
  cameras: [...sample.houseCameras, ...saved.direct],
  devices: {
    ...sample.pairedDevices,
    cameras: [
      ...sample.pairedDevices.cameras,
      ...saved.direct.map((c) => ({ id: c.id, t: c.name, s: c.source, a: 'Remove' })),
    ],
  },
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
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

export function addCameras(list) {
  const cameras = [...state.cameras];
  const devices = { ...state.devices, cameras: [...state.devices.cameras] };
  const direct = [...state.direct];
  list.forEach((c) => {
    const id = `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}${cameras.length}`;
    const cam = { id, status: 'online', motion: false, ...c };
    cameras.push(cam);
    if (cam.streamUrl) direct.push(cam);
    devices.cameras.push({ id, t: c.name, s: c.source || 'Via hub', a: 'Remove' });
  });
  setState({ cameras, devices, direct });
}
