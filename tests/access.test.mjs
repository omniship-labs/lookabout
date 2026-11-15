// What the signed-in person may see and do (src/lib/access.js). Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessLine, accessOf, canManage, isAdmin, levelLabel, passwordProblem, strongPassword, visibleCameras } from '../src/lib/access.js';

const admin = { member: { role: 'admin' }, cameras: 'all', groups: 'all' };
const member = {
  member: { role: 'member' },
  cameras: { 'cam-1': 'manage', 'cam-2': 'view' },
  groups: [{ id: 'g-n', name: 'Nursery', level: 'manage' }, { id: 'g-o', name: 'Outside', level: 'view' }],
};
const cams = [{ id: 'cam-1', name: 'Nursery' }, { id: 'cam-2', name: 'Door' }, { id: 'cam-3', name: 'Garage' }];

test('admins manage everything, members only what a grant gives', () => {
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(member), false);
  assert.equal(accessOf(admin, 'cam-3'), 'manage');
  assert.equal(accessOf(member, 'cam-1'), 'manage');
  assert.equal(accessOf(member, 'cam-2'), 'view');
  assert.equal(accessOf(member, 'cam-3'), null);
  assert.equal(canManage(member, 'cam-2'), false);
  assert.equal(canManage(member, 'cam-1'), true);
});

test('nobody signed in sees nothing', () => {
  assert.equal(accessOf(null, 'cam-1'), null);
  assert.equal(isAdmin(null), false);
  assert.deepEqual(visibleCameras(null, cams), []);
  assert.equal(accessLine(null), '');
  assert.equal(accessOf({ member: { role: 'member' } }, 'cam-1'), null);
});

test('the camera list is cut to what the person may see, with the level on each', () => {
  assert.deepEqual(visibleCameras(member, cams).map((c) => [c.id, c.access]), [['cam-1', 'manage'], ['cam-2', 'view']]);
  assert.equal(visibleCameras(admin, cams).length, 3);
  assert.deepEqual(visibleCameras({ member: { role: 'member' }, cameras: {} }, cams), []);
});

test('the access line names the groups', () => {
  assert.equal(accessLine(admin), 'Admin · every camera');
  assert.equal(accessLine(member), 'Nursery (manage), Outside');
  assert.equal(accessLine({ member: { role: 'member' }, cameras: {}, groups: [] }), 'No cameras shared with you yet');
  assert.equal(accessLine({ member: { role: 'member' }, cameras: {} }), 'No cameras shared with you yet');
});

test('password rules match the hub’s', () => {
  assert.match(passwordProblem('short'), /at least 10/);
  assert.match(passwordProblem(undefined), /at least 10/);
  assert.match(passwordProblem('1234567890'), /too easy/);
  assert.match(passwordProblem('PASSWORD1234'), /too easy/);
  assert.match(passwordProblem('aaaaaaaaaaaa'), /too easy/);
  assert.equal(passwordProblem('tenletters1'), '');
  assert.equal(strongPassword('tenletters1'), false);
  assert.equal(strongPassword('correct horse battery'), true);
});

test('level labels', () => {
  assert.equal(levelLabel('manage'), 'Can manage');
  assert.equal(levelLabel('view'), 'Can view');
});
