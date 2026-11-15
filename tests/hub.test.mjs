// How the web app talks to the hub and turns its answers into what screens
// show (src/lib/hub.js). Run: npm test
process.env.TZ = 'UTC'; // event times and day groups are local time; pin it

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
const hub = await import('../src/lib/hub.js');

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
const paired = { address: 'http://hub.local:8787', token: 'k&y/1', member: { id: 'm-1', role: 'admin' }, id: 'h1', name: 'Home hub' };

test('pairing sends the code and keeps what the viewer needs', async () => {
  const asked = fakeHub(() => json(200, { token: 'T', member: { id: 'm-9' }, hub: { id: 'h1', name: 'Home hub', version: '0.1.0' } }));
  const got = await hub.pairWithHub('http://hub.local:8787', 'ABCD-EFGH', 'Mac browser');
  assert.equal(asked[0].url, 'http://hub.local:8787/api/pair');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(asked[0].init.body), { code: 'ABCD-EFGH', name: 'Mac browser', platform: 'web' });
  assert.deepEqual(got, { address: 'http://hub.local:8787', token: 'T', member: { id: 'm-9' }, id: 'h1', name: 'Home hub' });
});

test('a wrong pairing code comes back as the hub’s own words with its status', async () => {
  fakeHub(() => json(403, { error: 'That code is wrong or has run out.' }));
  await assert.rejects(hub.pairWithHub('http://hub.local:8787', 'X', 'n'), (err) => err instanceof hub.HubError && err.status === 403 && /run out/.test(err.message));
});

test('every request after pairing shows the key, and sends JSON or SDP as asked', async () => {
  const asked = fakeHub(() => json(200, { ok: true }));
  await hub.hubGet(paired, '/api/cameras');
  await hub.hubSend(paired, 'PATCH', '/api/settings', { keep_days: 30 });
  assert.equal(asked[0].init.headers.Authorization, 'Bearer k&y/1');
  assert.equal(asked[0].init.body, undefined);
  assert.equal(asked[0].init.cache, 'no-store');
  assert.equal(asked[1].init.method, 'PATCH');
  assert.equal(asked[1].init.body, '{"keep_days":30}');
});

test('a live stream address carries a short ticket for one camera, never the session', async () => {
  const asked = fakeHub(() => json(200, { ticket: 't&k/1', expires: 1763400000 }));
  assert.equal(await hub.hubMjpegUrl(paired, 'cam-1'), 'http://hub.local:8787/api/cameras/cam-1/stream.mjpeg?ticket=t%26k%2F1');
  assert.equal(asked[0].url, 'http://hub.local:8787/api/cameras/cam-1/ticket');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.headers.Authorization, 'Bearer k&y/1');
  assert.ok(!asked.some((a) => a.url.includes('k%26y')), 'the session key is not in any address');
});

test('signing in keeps the session, the member and the hub’s identity', async () => {
  const asked = fakeHub((url) => (url.endsWith('/api/hub')
    ? json(200, { id: 'h1', name: 'Home hub' })
    : json(200, { token: 'T', me: { id: 'm-1', name: 'Sam', role: 'admin' } })));
  const got = await hub.signInToHub('http://hub.local:8787', 'sam@example.com', 'pw pw pw pw', 'Mac browser');
  assert.equal(asked[0].url, 'http://hub.local:8787/api/auth/login/local?app=1');
  assert.deepEqual(JSON.parse(asked[0].init.body), { email: 'sam@example.com', password: 'pw pw pw pw', device: 'Mac browser' });
  assert.deepEqual(got, { address: 'http://hub.local:8787', token: 'T', member: { id: 'm-1', name: 'Sam', role: 'admin' }, id: 'h1', name: 'Home hub' });
});

test('a wrong password comes back as the hub’s words with 401', async () => {
  fakeHub(() => json(401, { error: 'That email and password don’t match.', code: 'bad_sign_in' }));
  await assert.rejects(hub.signInToHub('http://hub.local:8787', 'a@b.co', 'x'), (err) => err.status === 401 && /don’t match/.test(err.message));
});

test('setting up a hub makes the first admin, then signs in as them', async () => {
  const asked = fakeHub((url) => {
    if (url.endsWith('/api/hub')) return json(200, { id: 'h1', name: 'Home hub' });
    if (url.endsWith('/first-admin')) return json(201, { me: { id: 'm-1' } });
    return json(200, { token: 'T', me: { id: 'm-1', role: 'admin' } });
  });
  const got = await hub.setUpHub('http://hub.local:8787', { setupCode: 'K7QM-2XPA', name: 'Sam', email: 'sam@example.com', password: 'pw pw pw pw' });
  assert.equal(asked[0].url, 'http://hub.local:8787/api/setup/first-admin');
  assert.deepEqual(JSON.parse(asked[0].init.body), { setup_code: 'K7QM-2XPA', name: 'Sam', email: 'sam@example.com', password: 'pw pw pw pw' });
  assert.equal(got.token, 'T');
  assert.equal(got.member.role, 'admin');
});

test('a wrong setup code stops before signing in', async () => {
  const asked = fakeHub(() => json(403, { error: 'That setup code is wrong.', code: 'bad_code' }));
  await assert.rejects(hub.setUpHub('http://hub.local:8787', { setupCode: 'X', name: '', email: 'a@b.co', password: 'pw pw pw pw' }), (err) => err.status === 403);
  assert.equal(asked.length, 1);
});

test('joining with an invite code chooses a password and signs in', async () => {
  const asked = fakeHub((url) => (url.endsWith('/api/hub') ? json(200, { id: 'h1', name: 'Home hub' }) : json(201, { token: 'T2', me: { id: 'm-2', role: 'member' } })));
  const got = await hub.joinHub('http://hub.local:8787', 'Q3J-x_y', 'Alex', 'pw pw pw pw');
  assert.equal(asked[0].url, 'http://hub.local:8787/api/auth/join?app=1');
  assert.deepEqual(JSON.parse(asked[0].init.body), { invite: 'Q3J-x_y', name: 'Alex', password: 'pw pw pw pw', device: '' });
  assert.equal(got.member.role, 'member');
});

test('an invite code is found in a pasted link, or in the code on its own being absent', () => {
  assert.equal(hub.inviteFromLink('https://hub.example.com/#/join?invite=Q3J-x_y'), 'Q3J-x_y');
  assert.equal(hub.inviteFromLink('http://hub.local:8787/#/join?foo=1&invite=abc123'), 'abc123');
  assert.equal(hub.inviteFromLink('http://hub.local:8787/'), '');
  assert.equal(hub.inviteFromLink(''), '');
  assert.equal(hub.inviteFromLink(undefined), '');
});

test('whether the hub needs its first admin comes from the setup state', async () => {
  const asked = fakeHub(() => json(200, { setup_required: true, setup_code: 'K7QM-2XPA', devices: 2 }));
  assert.deepEqual(await hub.hubSetupState('http://hub.local:8787'), { setup_required: true, setup_code: 'K7QM-2XPA', devices: 2 });
  assert.equal(asked[0].url, 'http://hub.local:8787/api/setup/state');
});

test('a camera keeps the level the hub gave it', () => {
  assert.equal(hub.viewerCamera({ id: 'c', name: 'n', status: 'online', since: 1, access: 'manage' }).access, 'manage');
  assert.equal(hub.viewerCamera({ id: 'c', name: 'n', status: 'online', since: 1 }).access, 'view');
});

test('a hub that never answers gives up with a reason instead of hanging', async () => {
  globalThis.fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // skip the 8 s wait
  try {
    await assert.rejects(hub.hubInfo('http://hub.local:8787'), (err) => err.status === 0 && /isn’t answering/.test(err.message));
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('spans read as seconds, minutes, then hours and minutes', () => {
  assert.equal(hub.spanLabel(0), '0 s');
  assert.equal(hub.spanLabel(59.4), '59 s');
  assert.equal(hub.spanLabel(60), '1 min');
  assert.equal(hub.spanLabel(150), '3 min');
  assert.equal(hub.spanLabel(3600), '1 h');
  assert.equal(hub.spanLabel(7500), '2 h 5 min');
  assert.equal(hub.spanLabel(-5), '0 s', 'clock skew never shows a negative time');
});

test('hub cameras in the viewer’s shape', () => {
  const c = hub.viewerCamera({ id: 'cam-1', name: 'Porch', device: 'IP CAM', source: 'RTSP via hub', kind: 'rtsp', status: 'online', since: 1700000000, motion: true });
  assert.deepEqual(c, { id: 'cam-1', name: 'Porch', device: 'IP CAM', source: 'RTSP via hub', kind: 'rtsp', status: 'online', sinceMs: 1700000000000, motion: true, access: 'view', hub: true });
  assert.equal(hub.viewerCamera({ status: 'offline', since: 0 }).status, 'offline');
  assert.equal(hub.viewerCamera({ status: 'starting', since: 0 }).status, 'online', 'only "offline" shows as offline');
  assert.equal(hub.viewerCamera({ since: 0 }).motion, false);
});

const event = (over) => ({ id: 7, kind: 'motion', camera: 'Porch', camera_id: 'cam-1', started: 1763211600, ended: 1763211750, detail: 'Door zone', clip: '7.mp4', thumb: '7.jpg', ...over });

test('hub events in the Events rows’ shape', () => {
  const e = hub.viewerEvent(event());
  assert.equal(e.id, 'hub-7');
  assert.equal(e.hubId, 7);
  assert.equal(e.t, 'Motion · Porch');
  assert.equal(e.m, 'Door zone · 3 min');
  assert.equal(e.lengthLabel, '3 min');
  assert.equal(e.ended, true);
  assert.equal(e.time, '1:00 PM');
  assert.equal(e.startedMs, 1763211600000);
  assert.deepEqual([e.clip, e.thumb, e.camId, e.cam], ['7.mp4', '7.jpg', 'cam-1', 'Porch']);

  const going = hub.viewerEvent(event({ ended: null, detail: '' }));
  assert.equal(going.ended, false);
  assert.equal(going.m, '', 'nothing to say yet while it goes on');
  assert.equal(hub.viewerEvent(event({ kind: 'crying', detail: '' })).t, 'Crying · Porch');
  assert.equal(hub.viewerEvent(event({ kind: 'mystery' })).t, 'mystery · Porch', 'an unknown kind still shows');
});

test('offline events say whether the camera is back', () => {
  assert.equal(hub.viewerEvent(event({ kind: 'offline', ended: null, detail: '' })).m, 'Still offline');
  assert.equal(hub.viewerEvent(event({ kind: 'offline', detail: '' })).m, 'Back after 3 min');
  assert.equal(hub.viewerEvent(event({ kind: 'offline', detail: 'Camera removed' })).m, 'Camera removed');
});

test('events group under TODAY, YESTERDAY, then the date, keeping their order', () => {
  const now = new Date('2026-11-15T18:00:00Z');
  const at = (iso, id) => ({ id, startedMs: Date.parse(iso) });
  const days = hub.eventDays([
    at('2026-11-15T17:00:00Z', 'a'), at('2026-11-15T00:00:00Z', 'b'),
    at('2026-11-14T23:59:59Z', 'c'), at('2026-11-12T09:00:00Z', 'd'),
  ], now);
  assert.deepEqual(days.map((d) => [d.label, d.items.map((e) => e.id)]), [
    ['TODAY', ['a', 'b']], ['YESTERDAY', ['c']], ['THU, NOV 12', ['d']],
  ]);
  assert.deepEqual(hub.eventDays([], now), []);
});
