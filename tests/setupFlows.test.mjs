// The setup wizard definitions and hub calls (src/lib/setupFlows.js, src/lib/hubInstall.js). Run: npm test
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as install from '../src/lib/hubInstall.js';
import * as flows from '../src/lib/setupFlows.js';
import { restore } from '../src/lib/wizard.js';

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
const hub = { address: 'http://hub.local:8787', token: 'T', member: { id: 'm-1', role: 'admin' }, id: 'h1', name: 'Home hub' };

test('every flow has the steps the hub has, in the hub’s order', () => {
  const hubSteps = {
    'hub-install': ['docker', 'container', 'volume', 'mdns', 'first-admin'],
    'remote-cloudflare': ['domain', 'tunnel', 'certificate', 'reach-self', 'locked-down'],
    'remote-tailscale': ['tailnet', 'funnel-or-private', 'certificate', 'reach-self', 'locked-down'],
    google: ['public-url', 'console', 'client', 'discovery', 'test-sign-in'],
    apple: ['public-url', 'developer', 'identifiers', 'key', 'token-endpoint', 'test-sign-in'],
  };
  const noApi = { verify: async () => ({}), confirm: async () => ({}) };
  for (const [flow, ids] of Object.entries(hubSteps)) {
    assert.deepEqual(flows.stepsFor(flow, noApi).map((s) => s.id), ids, flow);
    assert.ok(flows.FLOW_TITLES[flow], flow);
  }
  assert.deepEqual(flows.stepsFor('nothing', noApi), []);
  assert.deepEqual(flows.FLOW_LIST.map((f) => f.flow).sort(), Object.keys(hubSteps).sort());
});

test('manual steps confirm, checked steps verify with only their own fields', async () => {
  const calls = [];
  const api = {
    confirm: async (id) => { calls.push(['confirm', id]); return { state: 'passed', summary: 'Confirmed' }; },
    verify: async (id, body) => { calls.push(['verify', id, body]); return { state: 'passed', summary: 'ok' }; },
  };
  const steps = flows.stepsFor('google', api);
  const values = { public_url: 'https://hub.example.com', client_id: 'x.apps.googleusercontent.com', client_secret: 's', other: 'ignored', empty: '' };
  assert.deepEqual(await steps[1].check({ values }), { summary: 'Confirmed', values: null });
  assert.deepEqual(await steps[2].check({ values }), { summary: 'ok', values: null });
  assert.deepEqual(await steps[0].check({ values }), { summary: 'ok', values: { public_url: 'ok' } });
  assert.deepEqual(calls, [['confirm', 'console'], ['verify', 'client', { client_id: 'x.apps.googleusercontent.com', client_secret: 's' }],
    ['verify', 'public-url', { public_url: 'https://hub.example.com' }]]);
  assert.equal(steps[1].checkLabel, 'I’ve made the client');
  assert.equal(steps[2].checkLabel, 'Check');
});

test('a step that doesn’t pass says why', async () => {
  const api = { verify: async () => ({ state: 'failed', reason: 'That client ID doesn’t look like a Google one.' }), confirm: async () => ({ state: 'todo' }) };
  const steps = flows.stepsFor('google', api);
  await assert.rejects(steps[2].check({ values: { client_id: 'x' } }), /doesn’t look like a Google one/);
  await assert.rejects(steps[1].check({ values: {} }), /didn’t pass/);
});

test('a step is ready when its required fields are filled', () => {
  const steps = flows.stepsFor('apple', { verify: async () => ({}), confirm: async () => ({}) });
  const ids = steps.find((s) => s.id === 'identifiers');
  assert.equal(ids.ready({}), false);
  assert.equal(ids.ready({ services_id: 'dev.x.y', team_id: ' ' }), false);
  assert.equal(ids.ready({ services_id: 'dev.x.y', team_id: 'ABCDE12345' }), true);
  const key = steps.find((s) => s.id === 'key');
  assert.equal(key.ready({ key_id: 'ABCDE12345' }), true, 'the key itself can stay as saved');
  assert.equal(steps.find((s) => s.id === 'token-endpoint').ready({}), true, 'a step with no fields is always ready');
});

test('the redirect address uses the public address typed so far', () => {
  const steps = flows.stepsFor('google', { verify: async () => ({}), confirm: async () => ({}) });
  assert.equal(steps[1].copy({ public_url: 'https://hub.example.com/' })[0].text, 'https://hub.example.com/api/auth/callback/google');
  assert.match(steps[1].copy({})[0].text, /hub\.example\.com\/api\/auth\/callback\/google/);
  const apple = flows.stepsFor('apple', { verify: async () => ({}), confirm: async () => ({}) }).find((s) => s.id === 'identifiers');
  assert.equal(apple.copy({ public_url: 'https://h.example.org' })[0].text, 'https://h.example.org/api/auth/callback/apple');
});

test('what the hub says about a flow is what the wizard restores', () => {
  const flow = { flow: 'google', steps: [{ id: 'public-url', state: 'passed', summary: 'https://hub.example.com' }, { id: 'console', state: 'passed', manual: true, summary: 'Confirmed' },
    { id: 'client', state: 'failed', reason: 'Wrong id.' }, { id: 'discovery', state: 'todo' }, { id: 'test-sign-in', state: 'todo' }],
  values: { public_url: 'https://hub.example.com' } };
  const store = flows.hubProgress(flow);
  const progress = restore(flows.stepsFor('google', { verify: async () => ({}), confirm: async () => ({}) }), store.load());
  assert.equal(progress.steps['public-url'].summary, 'https://hub.example.com');
  assert.equal(progress.steps.client.reason, 'Wrong id.');
  assert.equal(progress.steps.discovery.state, 'todo');
  assert.deepEqual(progress.values, { public_url: 'https://hub.example.com' });
  assert.equal(store.save(), undefined);
  assert.equal(store.clear(), undefined);
});

test('plans are attached to steps', () => {
  const steps = flows.stepsFor('google', { verify: async () => ({}), confirm: async () => ({}) }, { discovery: [{ host: 'accounts.google.com', sends: 'Nothing but the request.' }] });
  assert.equal(steps.find((s) => s.id === 'discovery').plan[0].host, 'accounts.google.com');
  assert.deepEqual(steps[0].plan, []);
});

test('the hub calls', async () => {
  const asked = fakeHub(() => json(200, {}));
  await flows.getSetup(hub);
  await flows.getFlow(hub, 'google');
  await flows.getPlan(hub, 'google', 'discovery');
  await flows.verifyStep(hub, 'google', 'client', { client_id: 'x' });
  await flows.verifyStep(hub, 'google', 'discovery');
  await flows.confirmStep(hub, 'google', 'console');
  await flows.getHealth(hub);
  await flows.turnOffRemote(hub);
  assert.deepEqual(asked.map((a) => `${a.init.method || 'GET'} ${a.url.replace(hub.address, '')}`), [
    'GET /api/setup', 'GET /api/setup/google', 'GET /api/setup/google/discovery/plan', 'POST /api/setup/google/client/verify',
    'POST /api/setup/google/discovery/verify', 'PUT /api/setup/google/console', 'GET /api/admin/health', 'POST /api/admin/remote/off']);
  assert.deepEqual(JSON.parse(asked[3].init.body), { client_id: 'x' });
  assert.deepEqual(JSON.parse(asked[4].init.body), {});
  assert.deepEqual(JSON.parse(asked[5].init.body), { state: 'passed' });
});

test('the health panel: worst first, a count, and where each row leads', () => {
  const checks = [{ id: 'a', state: 'ok' }, { id: 'b', state: 'bad', flow: 'google' }, { id: 'c', state: 'warn', flow: 'remote-cloudflare' }, { id: 'd', state: 'warn' }];
  assert.deepEqual(flows.worstFirst(checks).map((c) => c.id), ['b', 'c', 'd', 'a']);
  assert.equal(checks[0].id, 'a', 'the list is not changed');
  assert.equal(flows.healthLine({ checks }), '3 things to look at');
  assert.equal(flows.healthLine({ checks: [{ state: 'bad' }] }), '1 thing to look at');
  assert.equal(flows.healthLine({ checks: [{ state: 'ok' }] }), 'All fine');
  assert.equal(flows.healthLine({}), 'All fine');
  assert.equal(flows.healthLink({ flow: 'google' }), '/setup/google');
  assert.equal(flows.healthLink({ flow: 'remote-cloudflare' }), '/setup/remote');
  assert.equal(flows.healthLink({ flow: 'hub-install' }), '/setup/hub-install');
  assert.equal(flows.healthLink({}), '');
  assert.deepEqual(['ok', 'warn', 'bad'].map((s) => flows.HEALTH_LABEL[s]), ['Fine', 'Check', 'Fix']);
});

test('the install command is only made from safe input', () => {
  assert.equal(install.installCommand(), './install.sh');
  assert.equal(install.installCommand({ name: 'Shed hub', port: '9000', usb: '/dev/video0, /dev/video2\n/dev/video0' }), './install.sh --name "Shed hub" --port 9000 --usb /dev/video0 --usb /dev/video2');
  assert.equal(install.installCommand({ installDocker: true }), './install.sh --install-docker');
  assert.equal(install.installCommand({ name: 'bad"name' }), '');
  assert.equal(install.installCommand({ name: 'a$(rm -rf)' }), '');
  assert.equal(install.installCommand({ port: 'http' }), '');
  assert.equal(install.installCommand({ port: '70000' }), '');
  assert.equal(install.installCommand({ usb: '/etc/passwd' }), '');
});

test('hub name, port and webcam checks', () => {
  assert.equal(install.hubNameProblem(''), 'Give the hub a name.');
  assert.match(install.hubNameProblem('a`b'), /can’t contain/);
  assert.match(install.hubNameProblem('x'.repeat(41)), /under 40/);
  assert.equal(install.hubNameProblem('Home hub'), '');
  assert.equal(install.portProblem('8787'), '');
  for (const bad of ['0', '65536', '8.5', 'abc', '', '-1', ' 80']) assert.match(install.portProblem(bad), /number from 1 to 65535/, bad);
  assert.deepEqual(install.usbDevices('/dev/video0 /dev/video1,/dev/video0 nope'), ['/dev/video0', '/dev/video1']);
  assert.deepEqual(install.badUsb('/dev/video0 nope /etc/passwd'), ['nope', '/etc/passwd']);
  assert.deepEqual(install.usbDevices(undefined), []);
  assert.equal(install.copyCommand(), 'scp -r hub pi@raspberrypi.local:lookabout-hub');
  assert.equal(install.copyCommand('10.0.0.5', 'me'), 'scp -r hub me@10.0.0.5:lookabout-hub');
  assert.equal(install.hubUrl(), 'http://raspberrypi.local:8787');
  assert.equal(install.hubUrl('10.0.0.5', 9000), 'http://10.0.0.5:9000');
});
