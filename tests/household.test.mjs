// The household helpers (src/lib/household.js). Run: npm test
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as h from '../src/lib/household.js';
import * as hub from '../src/lib/hub.js';

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
const signedIn = { address: 'http://hub.local:8787', token: 'T', member: { id: 'm-1', role: 'admin' }, id: 'h1', name: 'Home hub' };

const groups = [{ id: 'g-n', name: 'Nursery', cameras: ['c1'] }, { id: 'g-o', name: 'Outside', cameras: [] }];
const vera = { id: 'm-v', email: 'vera@example.com', role: 'member', status: 'active', grants: [{ group: 'g-n', level: 'view', by: 'm-1' }] };

test('each change asks the hub the way the contract says', async () => {
  const asked = fakeHub(() => json(200, {}));
  await h.getHousehold(signedIn);
  await h.inviteMember(signedIn, 'a@b.co', 'member', [{ group: 'g-n', level: 'view' }]);
  await h.cancelInvite(signedIn, 'm-2');
  await h.changeMember(signedIn, 'm-2', { role: 'admin' });
  await h.removeMember(signedIn, 'm 2');
  await h.addGroup(signedIn, 'Garden', ['c1']);
  await h.changeGroup(signedIn, 'g-n', { name: 'Baby' });
  await h.removeGroup(signedIn, 'g-n');
  await h.shareGroup(signedIn, 'g-n', 'm-3');
  await h.unshareGroup(signedIn, 'g-n', 'm-3');
  await h.makePairingCode(signedIn, 'm-3');
  await h.getProviders(signedIn);
  await h.saveProviders(signedIn, { public_url: 'https://hub.example.com' });
  await h.changePassword(signedIn, 'old', 'new');
  await h.renameMe(signedIn, 'Sam');
  await h.myAccount(signedIn);
  await h.linkProvider(signedIn, 'google');
  await h.unlinkProvider(signedIn, 'apple');
  const seen = asked.map((a) => `${a.init.method || 'GET'} ${a.url.replace('http://hub.local:8787', '')}`);
  assert.deepEqual(seen, [
    'GET /api/household', 'POST /api/household/invites', 'DELETE /api/household/invites/m-2', 'PATCH /api/household/members/m-2',
    'DELETE /api/household/members/m%202', 'POST /api/household/groups', 'PATCH /api/household/groups/g-n', 'DELETE /api/household/groups/g-n',
    'POST /api/groups/g-n/shares', 'DELETE /api/groups/g-n/shares/m-3', 'POST /api/pairing/code', 'GET /api/admin/auth/providers',
    'PUT /api/admin/auth/providers', 'PUT /api/me/password', 'PATCH /api/me', 'GET /api/me', 'POST /api/me/link/google', 'DELETE /api/me/link/apple',
  ]);
  assert.deepEqual(JSON.parse(asked[13].init.body), { current: 'old', new: 'new' });
  assert.deepEqual(JSON.parse(asked[16].init.body), { return_to: '/#/account' });
  assert.ok(asked.every((a) => a.init.headers.Authorization === 'Bearer T'));
});

test('sign-in options need no session', async () => {
  const asked = fakeHub(() => json(200, { providers: [{ id: 'local' }] }));
  await h.signInOptions('http://hub.local:8787');
  assert.equal(asked[0].init.headers.Authorization, undefined);
});

test('grants: the level on a group, and changing one without touching the rest', () => {
  assert.equal(h.levelOn(vera, 'g-n'), 'view');
  assert.equal(h.levelOn(vera, 'g-o'), '');
  assert.equal(h.levelOn({}, 'g-n'), '');
  assert.deepEqual(h.withLevel(vera, 'g-n', 'manage'), [{ group: 'g-n', level: 'manage' }]);
  assert.deepEqual(h.withLevel(vera, 'g-o', 'view'), [{ group: 'g-n', level: 'view' }, { group: 'g-o', level: 'view' }]);
  assert.deepEqual(h.withLevel(vera, 'g-n', ''), []);
  assert.deepEqual(h.withLevel({}, 'g-n', 'view'), [{ group: 'g-n', level: 'view' }]);
});

test('the line under a member', () => {
  assert.equal(h.memberLine(vera, groups), 'vera@example.com · Nursery');
  assert.equal(h.memberLine({ ...vera, grants: [{ group: 'g-n', level: 'manage' }, { group: 'g-o', level: 'view' }, { group: 'g-gone', level: 'view' }] }, groups),
    'vera@example.com · Nursery (manage), Outside');
  assert.equal(h.memberLine({ ...vera, grants: [] }, groups), 'vera@example.com · No cameras yet');
  assert.equal(h.memberLine({ ...vera, role: 'admin' }, groups), 'vera@example.com · Admin · every camera');
  assert.equal(h.memberLine({ ...vera, status: 'invited' }, groups), 'vera@example.com · Invited, hasn’t joined yet');
});

test('who a manager may share with, and which groups they may share', () => {
  const household = { members: [vera, { id: 'm-o', role: 'member', status: 'active', grants: [] }, { id: 'm-a', role: 'admin', status: 'active', grants: [] },
    { id: 'm-i', role: 'member', status: 'invited', grants: [] }] };
  assert.deepEqual(h.canShareWith(household, 'g-n').map((m) => m.id), ['m-o']);
  assert.deepEqual(h.canShareWith(household, 'g-o').map((m) => m.id), ['m-v', 'm-o']);
  assert.deepEqual(h.shareableGroups({ groups: [{ id: 'a', level: 'manage' }, { id: 'b', level: 'view' }] }).map((g) => g.id), ['a']);
  assert.deepEqual(h.shareableGroups({ groups: 'all' }), []);
  assert.deepEqual(h.shareableGroups(null), []);
});

test('words for problems and invites', () => {
  assert.equal(h.problemText(new Error('The hub needs at least one admin.')), 'The hub needs at least one admin.');
  assert.equal(h.problemText(undefined), 'That didn’t work.');
  assert.match(h.inviteMessage('https://hub/#/join?invite=abc'), /Open this link to join: https:\/\/hub\/#\/join\?invite=abc/);
});

test('a page served by a hub is found; any other page is not', async () => {
  fakeHub((url) => (url.endsWith('/api/hub') ? json(200, { id: 'h1', name: 'Home hub', version: '0.1.0' }) : json(200, { setup_required: false })));
  const own = await hub.detectOwnHub('http://hub.local:8787');
  assert.equal(own.info.name, 'Home hub');
  assert.deepEqual(own.setup, { setup_required: false });
  fakeHub(() => new Response('<html>', { status: 200 }));                // a dev server answers with its page
  assert.equal(await hub.detectOwnHub('http://localhost:5173'), null);
  fakeHub(() => json(404, { error: 'Not found.' }));                     // Pages
  assert.equal(await hub.detectOwnHub('https://omniship-labs.github.io'), null);
  fakeHub(() => json(200, { name: 'x' }));
  assert.equal(await hub.detectOwnHub('http://x'), null);
  fakeHub((url) => (url.endsWith('/api/hub') ? json(200, { id: 'h1', name: 'H', version: '1' }) : json(404, {})));
  assert.deepEqual((await hub.detectOwnHub('http://old')).setup, {});
});

test('a browser holding the hub’s cookie is signed in without a token', async () => {
  const asked = fakeHub(() => json(200, { member: { id: 'm-1', name: 'Sam', role: 'admin' } }));
  const got = await hub.ownSession({ address: 'http://hub.local:8787', info: { id: 'h1', name: 'Home hub' } });
  assert.deepEqual(got, { address: 'http://hub.local:8787', token: '', member: { id: 'm-1', name: 'Sam', role: 'admin' }, id: 'h1', name: 'Home hub' });
  assert.equal(asked[0].init.headers.Authorization, undefined);
  fakeHub(() => json(401, { error: 'Sign in to use the hub.' }));
  assert.equal(await hub.ownSession({ address: 'http://hub.local:8787', info: {} }), null);
});
