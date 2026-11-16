// The checks behind the home hub pairing wizard (HubSetup in screens/Add.jsx),
// kept out of the JSX so they can be tested without a browser.

import { hubInfo, hubSetupState, normalizeHubAddress } from './hub.js';

export const DEFAULT_HUB_ADDRESS = 'raspberrypi.local:8787';

/** What's in the address field: what was typed, or the usual Pi name. */
export const typedAddress = (values) => values.address ?? DEFAULT_HUB_ADDRESS;

/** True when this page is https and the hub plain http: the browser will block it. */
export const blockedByHttps = (base, pageProtocol) => pageProtocol === 'https:' && base.startsWith('http://');

/** A pairing or setup code has 8 letters or digits; dashes and spaces don't count. */
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
  let setup = {};
  try {
    setup = await hubSetupState(base);
  } catch {
    // An older hub has no setup state: sign-in is all there is to offer.
  }
  // A hub that is reached from outside says only its name and version until someone signs in.
  const parts = [`${found.name} at ${base}`];
  if (typeof found.free_bytes === 'number') parts.push(freeSpace(found.free_bytes));
  if (typeof found.cameras === 'number') parts.push(`${found.cameras} camera${found.cameras === 1 ? '' : 's'}`);
  if (setup.setup_required) parts.push('needs its first admin');
  return {
    summary: parts.join(' · '),
    values: { base, setup: !!setup.setup_required, setupCode: setup.setup_code || '' },
  };
}
