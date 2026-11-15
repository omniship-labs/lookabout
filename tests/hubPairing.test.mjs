// The home hub pairing wizard's checks (src/lib/hubPairing.js) and the address
// rules they rely on (normalizeHubAddress in src/lib/hub.js). Run: npm test
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { normalizeHubAddress } from '../src/lib/hub.js';
import { DEFAULT_HUB_ADDRESS, blockedByHttps, codeReady, findHub, freeSpace, typedAddress } from '../src/lib/hubPairing.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stands in for the hub: answers fetch with `reply(url)`, and records what was asked. */
function fakeHub(reply) {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push({ url, init });
    return reply(url);
  };
  return asked;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('hub addresses: what people type becomes an origin on port 8787', () => {
  assert.equal(normalizeHubAddress('raspberrypi.local'), 'http://raspberrypi.local:8787');
  assert.equal(normalizeHubAddress('  192.168.1.20  '), 'http://192.168.1.20:8787');
  assert.equal(normalizeHubAddress('192.168.1.20:9000'), 'http://192.168.1.20:9000');
  assert.equal(normalizeHubAddress('http://hub.local:8787/some/path?x=1'), 'http://hub.local:8787');
  assert.equal(normalizeHubAddress('HTTP://Hub.Local'), 'http://hub.local:8787');
  assert.equal(normalizeHubAddress('https://hub.example.com'), 'https://hub.example.com', 'https keeps its own port');
  assert.equal(normalizeHubAddress(''), '');
  assert.equal(normalizeHubAddress(undefined), '');
  assert.equal(normalizeHubAddress('http://'), '');
});

test('the address field falls back to the usual Pi name, but keeps an emptied field empty', () => {
  assert.equal(typedAddress({}), DEFAULT_HUB_ADDRESS);
  assert.equal(typedAddress({ address: '10.0.0.5' }), '10.0.0.5');
  assert.equal(typedAddress({ address: '' }), '');
});

test('an https page is blocked from a plain http hub, and only then', () => {
  assert.equal(blockedByHttps('http://hub.local:8787', 'https:'), true);
  assert.equal(blockedByHttps('http://hub.local:8787', 'http:'), false);
  assert.equal(blockedByHttps('https://hub.example.com', 'https:'), false);
});

test('a pairing code needs 8 letters or digits, ignoring dashes and spaces', () => {
  assert.equal(codeReady('ABCD-EFGH'), true);
  assert.equal(codeReady('abcd efgh'), true);
  assert.equal(codeReady('ABCD-EFG'), false);
  assert.equal(codeReady('----------'), false);
  assert.equal(codeReady(undefined), false);
});

test('free space reads in GB, or TB from a terabyte up', () => {
  assert.equal(freeSpace(112e9), '112 GB free');
  assert.equal(freeSpace(1.5e12), '1.5 TB free');
});

test('Find the hub: asks /api/hub and sums up what answered', async () => {
  const asked = fakeHub(() => json(200, { name: 'Home hub', free_bytes: 112e9, cameras: 1 }));
  const out = await findHub({ address: 'hub.local' }, 'http:');
  assert.deepEqual(asked.map((a) => a.url), ['http://hub.local:8787/api/hub', 'http://hub.local:8787/api/setup/state']);
  assert.equal(asked[0].init.headers.Authorization, undefined, 'no session is sent before signing in');
  assert.deepEqual(out, { summary: 'Home hub at http://hub.local:8787 · 112 GB free · 1 camera',
    values: { base: 'http://hub.local:8787', setup: false, setupCode: '' } });
  fakeHub(() => json(200, { name: 'Shed', free_bytes: 2e12, cameras: 3 }));
  assert.equal((await findHub({}, 'http:')).summary, 'Shed at http://raspberrypi.local:8787 · 2.0 TB free · 3 cameras');
});

test('Find the hub: a new hub says it needs its first admin, and its setup code comes along', async () => {
  fakeHub((url) => (url.endsWith('/api/hub')
    ? json(200, { name: 'Home hub', free_bytes: 112e9, cameras: 0 })
    : json(200, { setup_required: true, setup_code: 'K7QM-2XPA', devices: 0 })));
  const out = await findHub({ address: 'hub.local' }, 'http:');
  assert.equal(out.summary, 'Home hub at http://hub.local:8787 · 112 GB free · 0 cameras · needs its first admin');
  assert.deepEqual(out.values, { base: 'http://hub.local:8787', setup: true, setupCode: 'K7QM-2XPA' });
});

test('Find the hub: a hub reached from outside gives only its name; an older hub has no setup state', async () => {
  fakeHub((url) => (url.endsWith('/api/hub') ? json(200, { name: 'Home hub', version: '0.1.0' }) : json(404, { error: 'Not found.' })));
  const out = await findHub({ address: 'hub.example.com' }, 'http:');
  assert.equal(out.summary, 'Home hub at http://hub.example.com:8787');
  assert.deepEqual(out.values, { base: 'http://hub.example.com:8787', setup: false, setupCode: '' });
});

test('Find the hub: fails with a reason the person can act on, without asking when it can’t work', async () => {
  const asked = fakeHub(() => json(200, {}));
  await assert.rejects(findHub({ address: '' }, 'http:'), /doesn’t look like an address/);
  await assert.rejects(findHub({ address: 'hub.local' }, 'https:'), /blocks a plain http hub/);
  assert.equal(asked.length, 0, 'nothing is sent for an empty or blocked address');

  fakeHub(() => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(findHub({ address: 'hub.local' }, 'http:'), /isn’t answering/);

  fakeHub(() => json(500, { error: 'The hub is starting.' }));
  await assert.rejects(findHub({ address: 'hub.local' }, 'http:'), (err) => err.message === 'The hub is starting.' && err.status === 500);

  fakeHub(() => new Response('not json', { status: 404 }));
  await assert.rejects(findHub({ address: 'hub.local' }, 'http:'), /answered 404/);
});
