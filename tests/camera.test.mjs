// Small rules of the camera role and snapshots (src/lib/camera.js,
// src/lib/snapshotName.js). Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAIRING_CODE_PATTERN, makePairingCode } from '../src/lib/camera.js';
import { canSnapshot, snapshotName } from '../src/lib/snapshotName.js';

test('pairing word codes match the pattern the viewer accepts, with two different words', () => {
  for (let i = 0; i < 500; i++) {
    const code = makePairingCode();
    assert.match(code, PAIRING_CODE_PATTERN);
    const [a, n, b] = code.split('-');
    assert.notEqual(a, b);
    assert.ok(Number(n) >= 10 && Number(n) <= 99, code);
  }
  assert.doesNotMatch('FERN-4-OTTER', PAIRING_CODE_PATTERN);
  assert.doesNotMatch('fern-42-otter', PAIRING_CODE_PATTERN);
});

test('snapshot files are named after the camera and the moment', () => {
  const when = new Date(2026, 10, 14, 3, 7, 9);
  assert.equal(snapshotName('Side cam', when), 'side-cam-20261114-030709.jpg');
  assert.equal(snapshotName('  Kid’s Room #2! ', when), 'kid-s-room-2-20261114-030709.jpg');
  assert.equal(snapshotName('', when), 'camera-20261114-030709.jpg');
  assert.equal(snapshotName('🙂', when), 'camera-20261114-030709.jpg');
});

test('only cameras with an address or a hub can give a snapshot', () => {
  assert.equal(canSnapshot({ address: 'http://10.0.0.9' }), true);
  assert.equal(canSnapshot({ hub: true, id: 'cam-1' }), true);
  assert.equal(canSnapshot({ id: 'nursery' }), false, 'sample cameras have no frame');
  assert.equal(canSnapshot(null), false);
});
