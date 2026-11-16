// Passkeys in the browser (src/lib/passkey.js), with a stand-in for navigator.credentials. Run: npm test
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as hub from '../src/lib/hub.js';
import * as passkey from '../src/lib/passkey.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function fakeHub(reply) {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push({ url, init });
    return reply(url, init);
  };
  return asked;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const signedIn = { address: 'http://hub.local:8787', token: 'T', member: { id: 'm-1' }, id: 'h1', name: 'Home hub' };
const bytes = (...n) => Uint8Array.from(n).buffer;

test('base64url round-trips and has no padding', () => {
  const text = passkey.bufferToB64u(bytes(251, 255, 0, 1, 2));
  assert.equal(text, '-_8AAQI');
  assert.deepEqual([...new Uint8Array(passkey.b64uToBuffer(text))], [251, 255, 0, 1, 2]);
  assert.deepEqual([...new Uint8Array(passkey.b64uToBuffer(''))], []);
});

test('the hub’s options become what the browser wants', () => {
  const made = passkey.creationOptions({
    challenge: 'AQID', rp: { id: 'hub.local', name: 'Home hub' }, user: { id: 'BAUG', name: 'a@b.co', displayName: 'A' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], excludeCredentials: [{ type: 'public-key', id: 'BwgJ' }],
  });
  assert.deepEqual([...new Uint8Array(made.publicKey.challenge)], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(made.publicKey.user.id)], [4, 5, 6]);
  assert.deepEqual([...new Uint8Array(made.publicKey.excludeCredentials[0].id)], [7, 8, 9]);
  assert.equal(made.publicKey.rp.id, 'hub.local');
  assert.deepEqual(passkey.creationOptions({ challenge: 'AQID', user: { id: 'BAUG' } }).publicKey.excludeCredentials, []);
  const asked = passkey.requestOptions({ challenge: 'AQID', rpId: 'hub.local', allowCredentials: [] });
  assert.deepEqual([...new Uint8Array(asked.publicKey.challenge)], [1, 2, 3]);
  assert.equal(asked.publicKey.rpId, 'hub.local');
});

test('what the device answers is sent as base64url', () => {
  const made = passkey.attestationJson({ id: 'cred', response: { clientDataJSON: bytes(1), attestationObject: bytes(2, 3) } });
  assert.deepEqual(made, { id: 'cred', response: { clientDataJSON: 'AQ', attestationObject: 'AgM' } });
  const got = passkey.assertionJson({ id: 'cred', response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: bytes(4) } });
  assert.deepEqual(got.response, { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw', userHandle: 'BA' });
  assert.equal(passkey.assertionJson({ id: 'c', response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: null } }).response.userHandle, '');
});

test('adding a passkey asks the hub, the device, then the hub again', async () => {
  const asked = fakeHub((url) => (url.endsWith('/options')
    ? json(200, { options: { challenge: 'AQID', rp: { id: 'hub.local', name: 'Hub' }, user: { id: 'BAUG', name: 'a', displayName: 'A' } } })
    : json(201, { passkeys: [{ id: 'cred', name: 'Mac', rp_id: 'hub.local' }] })));
  let received;
  const nav = { credentials: { create: async (o) => {
    received = o;
    return { id: 'cred', response: { clientDataJSON: bytes(1), attestationObject: bytes(2) } };
  } } };
  const list = await passkey.addPasskey(signedIn, 'Mac', nav);
  assert.deepEqual(asked.map((a) => a.url), ['http://hub.local:8787/api/me/passkeys/options', 'http://hub.local:8787/api/me/passkeys']);
  assert.equal(asked[0].init.headers.Authorization, 'Bearer T');
  assert.deepEqual(JSON.parse(asked[1].init.body), { credential: { id: 'cred', response: { clientDataJSON: 'AQ', attestationObject: 'Ag' } }, name: 'Mac' });
  assert.deepEqual([...new Uint8Array(received.publicKey.challenge)], [1, 2, 3]);
  assert.equal(list[0].rp_id, 'hub.local');
});

test('signing in with a passkey gives the hub as the store keeps it', async () => {
  const asked = fakeHub((url) => {
    if (url.endsWith('/passkey/options')) return json(200, { options: { challenge: 'AQID', rpId: 'hub.local', allowCredentials: [] } });
    if (url.endsWith('/api/hub')) return json(200, { id: 'h1', name: 'Home hub' });
    return json(200, { token: 'T2', me: { id: 'm-1', role: 'admin' } });
  });
  const nav = { credentials: { get: async () => ({ id: 'cred', response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: null } }) } };
  const got = await passkey.signInWithPasskey('http://hub.local:8787', 'Mac browser', nav);
  assert.equal(asked[1].url, 'http://hub.local:8787/api/auth/login/passkey?app=1');
  assert.equal(JSON.parse(asked[1].init.body).device, 'Mac browser');
  assert.deepEqual(got, { address: 'http://hub.local:8787', token: 'T2', member: { id: 'm-1', role: 'admin' }, id: 'h1', name: 'Home hub' });
});

test('a cancelled or refused passkey says why, and nothing is sent after it', async () => {
  const asked = fakeHub(() => json(200, { options: { challenge: 'AQID', rpId: 'hub.local', user: { id: 'BAUG' } } }));
  for (const [name, text] of [['NotAllowedError', /wasn’t confirmed/], ['InvalidStateError', /already has a passkey/], ['SecurityError', /not its IP address/], ['Other', /boom/]]) {
    const nav = { credentials: { get: async () => { throw Object.assign(new Error('boom'), { name }); }, create: async () => { throw Object.assign(new Error('boom'), { name }); } } };
    await assert.rejects(passkey.signInWithPasskey('http://hub.local:8787', '', nav), text);
    await assert.rejects(passkey.addPasskey(signedIn, '', nav), text);
  }
  assert.ok(asked.every((a) => a.url.endsWith('/options')), 'only the challenge was fetched');
  assert.equal(passkey.passkeyProblem(undefined), 'The passkey didn’t work.');
});

test('a wrong passkey answer from the hub comes back in the hub’s words', async () => {
  fakeHub((url) => (url.endsWith('/options') ? json(200, { options: { challenge: 'AQID' } }) : json(401, { error: 'That passkey looks copied, so the hub refused it.' })));
  const nav = { credentials: { get: async () => ({ id: 'c', response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3) } }) } };
  await assert.rejects(passkey.signInWithPasskey('http://hub.local:8787', '', nav), (err) => err.status === 401 && /copied/.test(err.message));
});

test('support and address checks', () => {
  assert.equal(passkey.passkeysSupported({ credentials: { create() {}, get() {} } }), true);
  assert.equal(passkey.passkeysSupported({ credentials: {} }), false);
  assert.equal(passkey.passkeysSupported(undefined), false);
  assert.equal(passkey.passkeyAddressOk('lookabout.local'), true);
  assert.equal(passkey.passkeyAddressOk('192.168.1.5'), false);
  assert.equal(passkey.passkeyAddressOk('::1'), false);
  assert.equal(passkey.passkeyAddressOk(''), false);
});

test('passkeys are listed and removed with the session', async () => {
  const asked = fakeHub(() => json(200, { passkeys: [], this_address: 'hub.local' }));
  assert.equal((await passkey.hubPasskeys(signedIn)).this_address, 'hub.local');
  await hub.removePasskey(signedIn, 'a/b');
  assert.equal(asked[1].url, 'http://hub.local:8787/api/me/passkeys/a%2Fb');
  assert.equal(asked[1].init.method, 'DELETE');
});

test('Google and Apple: the hub says where to send the browser, and a failure comes back on the sign-in page', async () => {
  const asked = fakeHub(() => json(200, { redirect: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }));
  assert.equal(await hub.providerSignInAddress('http://hub.local:8787', 'google', '/cameras'), 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
  assert.deepEqual(JSON.parse(asked[0].init.body), { return_to: '/cameras' });
  assert.equal(asked[0].url, 'http://hub.local:8787/api/auth/login/google');
  fakeHub(() => json(200, { redirect: 'x' }));
  await hub.providerSignInAddress('http://hub.local:8787', 'apple');
  assert.equal(hub.signInErrorFromHash('#/signin?error=not_invited&message=This%20account%20isn%27t%20part%20of%20this%20household.'), 'This account isn\'t part of this household.');
  assert.equal(hub.signInErrorFromHash('#/signin?error=cancelled'), 'That sign-in didn’t work.');
  assert.equal(hub.signInErrorFromHash('#/signin'), '');
  assert.equal(hub.signInErrorFromHash(''), '');
  assert.equal(hub.signInErrorFromHash(undefined), '');
});
