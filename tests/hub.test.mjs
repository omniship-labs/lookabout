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
const paired = { address: 'http://hub.local:8787', token: 'k&y/1', viewerId: 'viewer-1', id: 'h1', name: 'Home hub' };

test('pairing sends the code and keeps what the viewer needs', async () => {
  const asked = fakeHub(() => json(200, { token: 'T', viewer: { id: 'viewer-9' }, hub: { id: 'h1', name: 'Home hub', version: '0.1.0' } }));
  const got = await hub.pairWithHub('http://hub.local:8787', 'ABCD-EFGH', 'Mac browser');
  assert.equal(asked[0].url, 'http://hub.local:8787/api/pair');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(asked[0].init.body), { code: 'ABCD-EFGH', name: 'Mac browser', platform: 'web' });
  assert.deepEqual(got, { address: 'http://hub.local:8787', token: 'T', viewerId: 'viewer-9', id: 'h1', name: 'Home hub' });
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

test('addresses used as <img>/<video> sources carry the key, escaped', () => {
  assert.equal(hub.hubMjpegUrl(paired, 'cam-1'), 'http://hub.local:8787/api/cameras/cam-1/stream.mjpeg?token=k%26y%2F1');
  assert.equal(hub.hubClipUrl(paired, '7.mp4'), 'http://hub.local:8787/api/clips/7.mp4?token=k%26y%2F1');
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
  assert.deepEqual(c, { id: 'cam-1', name: 'Porch', device: 'IP CAM', source: 'RTSP via hub', kind: 'rtsp', status: 'online', sinceMs: 1700000000000, motion: true, hub: true });
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
