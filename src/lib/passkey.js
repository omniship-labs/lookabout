// Passkeys in the browser: turns the hub's options into what navigator.credentials
// wants, and what the device answers into what the hub checks (docs/hub-auth.md).
// The browser object is passed in so this runs, and is tested, without a browser.

import {
  hubPasskeys, passkeyRegister, passkeyRegisterOptions, passkeySignIn, passkeySignInOptions,
} from './hub.js';

export function bufferToB64u(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  bytes.forEach((b) => {
    text += String.fromCharCode(b);
  });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uToBuffer(value) {
  const text = atob(String(value).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(value).length % 4)) % 4));
  return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;
}

/** Can this browser make and use passkeys? (Needs a host name, not an IP address, and https or localhost.) */
export const passkeysSupported = (nav = globalThis.navigator) => !!(nav && nav.credentials && nav.credentials.create && nav.credentials.get);

/** An address a browser accepts as a passkey's home: a name, not an IP address. */
export const passkeyAddressOk = (host) => !/^[\d.]+$/.test(host || '') && !(host || '').includes(':') && !!host;

export function creationOptions(o) {
  return {
    publicKey: {
      ...o,
      challenge: b64uToBuffer(o.challenge),
      user: { ...o.user, id: b64uToBuffer(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64uToBuffer(c.id) })),
    },
  };
}

export const requestOptions = (o) => ({ publicKey: { ...o, challenge: b64uToBuffer(o.challenge) } });

export const attestationJson = (c) => ({
  id: c.id,
  response: { clientDataJSON: bufferToB64u(c.response.clientDataJSON), attestationObject: bufferToB64u(c.response.attestationObject) },
});

export const assertionJson = (c) => ({
  id: c.id,
  response: {
    clientDataJSON: bufferToB64u(c.response.clientDataJSON),
    authenticatorData: bufferToB64u(c.response.authenticatorData),
    signature: bufferToB64u(c.response.signature),
    userHandle: c.response.userHandle ? bufferToB64u(c.response.userHandle) : '',
  },
});

/** Words for what a browser says when the person cancels or the device can't do it. */
export function passkeyProblem(err) {
  if (err && err.name === 'NotAllowedError') return 'The passkey wasn’t confirmed. Try again.';
  if (err && err.name === 'InvalidStateError') return 'This device already has a passkey for this hub.';
  if (err && err.name === 'SecurityError') return 'Passkeys need the hub’s name (such as lookabout.local), not its IP address.';
  return (err && err.message) || 'The passkey didn’t work.';
}

/** Make a passkey for the signed-in member on this address. Resolves with the member's passkeys. */
export async function addPasskey(hub, name = '', nav = globalThis.navigator) {
  const { options } = await passkeyRegisterOptions(hub);
  let credential;
  try {
    credential = await nav.credentials.create(creationOptions(options));
  } catch (err) {
    throw new Error(passkeyProblem(err));
  }
  return (await passkeyRegister(hub, attestationJson(credential), name)).passkeys;
}

/** Sign in with a passkey. Resolves with the hub as the store keeps it. */
export async function signInWithPasskey(address, device = '', nav = globalThis.navigator) {
  const { options } = await passkeySignInOptions(address);
  let credential;
  try {
    credential = await nav.credentials.get(requestOptions(options));
  } catch (err) {
    throw new Error(passkeyProblem(err));
  }
  return passkeySignIn(address, assertionJson(credential), device);
}

export { hubPasskeys };
