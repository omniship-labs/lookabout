// Rules of the setup wizard's state (src/lib/wizard.js). Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restore, activeIndex, isLocked, isDone, startCheck, finishCheck, reopen, setValues, localProgress } from '../src/lib/wizard.js';
test('wizard steps open in order, fail with a reason, reopen and restore', () => {
  const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let p = restore(steps, null);
  assert.equal(activeIndex(steps, p), 0);
  assert.ok(isLocked(steps, p, 1));
  // can't check a locked step
  assert.equal(startCheck(steps, p, 'b'), p);
  p = startCheck(steps, p, 'a'); assert.equal(p.steps.a.state, 'checking');
  p = finishCheck(steps, p, 'a', { ok: false, reason: 'nope' }); assert.equal(p.steps.a.state, 'failed'); assert.equal(p.steps.a.reason, 'nope');
  assert.equal(activeIndex(steps, p), 0);
  p = finishCheck(steps, p, 'a', { ok: true }); assert.equal(p.steps.a.state, 'failed', 'finish ignored when not checking');
  p = finishCheck(steps, startCheck(steps, p, 'a'), 'a', { ok: true, summary: 'S' });
  assert.equal(p.steps.a.state, 'passed'); assert.equal(activeIndex(steps, p), 1);
  p = finishCheck(steps, startCheck(steps, p, 'b'), 'b', { ok: true });
  assert.equal(activeIndex(steps, p), 2);
  p = reopen(steps, p, 'a'); assert.equal(activeIndex(steps, p), 0); assert.equal(p.steps.b.state, 'todo');
  // restore: checking -> todo, passed after unfinished -> todo, junk states
  const r = restore(steps, { steps: { a: { state: 'checking' }, b: { state: 'passed' }, c: { state: 'bogus' } }, values: { x: 1 } });
  assert.deepEqual([r.steps.a.state, r.steps.b.state, r.steps.c.state], ['todo', 'todo', 'todo']);
  assert.equal(r.values.x, 1);
  const r2 = restore(steps, { steps: { a: { state: 'passed', summary: 'ok' }, b: { state: 'failed', reason: 'why' } } });
  assert.equal(r2.steps.a.summary, 'ok'); assert.equal(r2.steps.b.reason, 'why'); assert.equal(activeIndex(steps, r2), 1);
  let all = restore(steps, { steps: { a: { state: 'passed' }, b: { state: 'passed' }, c: { state: 'passed' } } });
  assert.ok(isDone(steps, all));
  // local store drops secrets, survives junk and throwing storage
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const st = localProgress('t', { secret: ['code'], storage });
  st.save(setValues(restore(steps, null), { code: 'ABCD', address: 'h' }));
  const loaded = st.load(); assert.equal(loaded.values.code, undefined); assert.equal(loaded.values.address, 'h');
  mem.set('lookabout-wizard:t', '{not json'); assert.equal(st.load(), null);
  st.clear(); assert.equal(st.load(), null);
  const bad = localProgress('t', { storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } } });
  assert.equal(bad.load(), null); bad.save(restore(steps, null)); bad.clear();
});
