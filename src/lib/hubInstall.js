// The hub install wizard's pieces (G6), kept out of the JSX so they can be tested without a browser.
// The Pages site can't call a hub on a home network (https page, plain http hub), so this only makes
// the text a person copies; the checks that need the hub run on the hub's own page (setupFlows.js).

export const DEFAULT_PORT = 8787;
export const DEFAULT_HUB_NAME = 'lookabout-hub';

/** What the install script accepts: no quotes, $, backticks or backslashes in the name. */
export const hubNameProblem = (name) => {
  const n = String(name ?? '');
  if (!n.trim()) return 'Give the hub a name.';
  if (/["'$`\\]/.test(n)) return 'The name can’t contain quotes, $ or backslashes.';
  if (n.length > 40) return 'Keep the name under 40 characters.';
  return '';
};

export const portProblem = (port) => {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535 && /^\d+$/.test(String(port)) ? '' : 'The port is a number from 1 to 65535, such as 8787.';
};

/** Webcams: `/dev/video0`, one per line or comma. Returns the valid ones, in order, without repeats. */
export function usbDevices(text) {
  const found = String(text || '').split(/[\s,]+/).filter(Boolean);
  return [...new Set(found.filter((d) => /^\/dev\/video\d+$/.test(d)))];
}

export const badUsb = (text) => String(text || '').split(/[\s,]+/).filter((d) => d && !/^\/dev\/video\d+$/.test(d));

/** The command to run on the Pi, in the hub folder. Nothing that was typed is left unquoted. */
export function installCommand({ name = DEFAULT_HUB_NAME, port = DEFAULT_PORT, usb = '', installDocker = false } = {}) {
  if (hubNameProblem(name) || portProblem(port) || badUsb(usb).length) return '';
  const parts = ['./install.sh'];
  if (name !== DEFAULT_HUB_NAME) parts.push('--name', `"${name}"`);
  if (Number(port) !== DEFAULT_PORT) parts.push('--port', String(Number(port)));
  usbDevices(usb).forEach((d) => parts.push('--usb', d));
  if (installDocker) parts.push('--install-docker');
  return parts.join(' ');
}

/** The commands that bring the hub folder to the Pi. `host` is the Pi's address, `user` its login. */
export const copyCommand = (host = 'raspberrypi.local', user = 'pi') => `scp -r hub ${user}@${host}:lookabout-hub`;

/** Where to open the hub once it's running. */
export const hubUrl = (host = 'raspberrypi.local', port = DEFAULT_PORT) => `http://${host}:${port}`;
