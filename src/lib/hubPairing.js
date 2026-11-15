// The checks behind the home hub pairing wizard (HubSetup in screens/Add.jsx),
// kept out of the JSX so they can be tested without a browser.

import { hubInfo, normalizeHubAddress } from './hub.js';

export const DEFAULT_HUB_ADDRESS = 'raspberrypi.local:8787';

/** What's in the address field: what was typed, or the usual Pi name. */
export const typedAddress = (values) => values.address ?? DEFAULT_HUB_ADDRESS;

/** True when this page is https and the hub plain http: the browser will block it. */
export const blockedByHttps = (base, pageProtocol) => pageProtocol === 'https:' && base.startsWith('http://');

/** A pairing code has 8 letters or digits; dashes and spaces don't count. */
export const codeReady = (code) => (code || '').replace(/[^A-Za-z0-9]/g, '').length >= 8;

export const freeSpace = (bytes) => (bytes >= 1e12 ? `${(bytes / 1e12).toFixed(1)} TB free` : `${Math.round(bytes / 1e9)} GB free`);

/** The "Find the hub" check: asks the hub who it is. Throws with a reason for the person. */
export async function findHub(values, pageProtocol) {
  const base = normalizeHubAddress(typedAddress(values));
  if (!base) throw new Error('That doesn’t look like an address. Try the one the hub page shows, such as raspberrypi.local:8787.');
  if (blockedByHttps(base, pageProtocol)) {
    throw new Error('The browser blocks a plain http hub from this https page. Open Lookabout over http on your own network instead.');
  }
  const found = await hubInfo(base);
  return {
    summary: `${found.name} at ${base} · ${freeSpace(found.free_bytes)} · ${found.cameras} camera${found.cameras === 1 ? '' : 's'}`,
    values: { base },
  };
}
