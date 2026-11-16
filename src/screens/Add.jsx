import React from 'react';
import { navigate } from '../lib/router.js';
import { addCameras, addHubCamera, getState, refreshHub, setHub, unpairHub, useStore } from '../lib/store.js';
import { detectOwnHub, hubGet, hubInfo, providerSignInAddress, hubTestCamera, inviteFromLink, joinHub, normalizeHubAddress, pairWithHub, setUpHub, signInToHub } from '../lib/hub.js';
import { passwordProblem } from '../lib/access.js';
import { signInOptions } from '../lib/household.js';
import { passkeyAddressOk, passkeysSupported, signInWithPasskey } from '../lib/passkey.js';
import { blockedByHttps, codeReady, findHub, freeSpace, typedAddress } from '../lib/hubPairing.js';
import { addGroups, connectKinds, guidedFlows, nestCams, ringCams, teslaClips, wyzeCams } from '../lib/sampleData.js';
import { BackBar, CheckMark, Cta, Eyebrow, Field, Group, Note, Page, Pill, Row, RowText, Spacer, StatusBox, Steps, display, mono } from '../components/ui.jsx';
import { ClipRow, VideoTile } from '../components/viewer.jsx';
import { Wizard } from '../components/Wizard.jsx';

const tags = {
  live: { tone: 'success', label: 'LIVE' },
  hub: { tone: 'outline', label: 'VIA HUB' },
  clips: { tone: 'warning', label: 'CLIPS' },
};

/** 7 · Add a camera (any source). */
export function AddCamera() {
  const s = useStore();
  return (
    <Page pad="48px var(--lk-side) 32px">
      <BackBar to="/cameras" title="Add a camera" />
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
        Anything with a lens. Cameras you already own come in through your home hub, which turns their feed into a Lookabout stream.
      </p>

      {addGroups.map((g) => (
        <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>{g.label}</Eyebrow>
          <Group pad="0">
            {g.rows.map((r) => {
              const needsHub = r.tag === 'hub' && !s.hubPaired;
              // Sample flows (Nest, Ring, Wyze, Tesla) aren't in the hub yet, so a real hub can't add them.
              const notYet = r.sample && s.hubPaired;
              return (
                <Row
                  key={r.ab}
                  minHeight={60}
                  to={notYet ? undefined : needsHub ? '/add/hub' : r.to}
                  style={{ padding: '10px 14px', justifyContent: 'flex-start', opacity: needsHub || notYet ? 0.6 : 1 }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: 'var(--surface-inverse)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...mono(11),
                      letterSpacing: '0.04em',
                      color: 'var(--text-on-dark)',
                    }}
                  >
                    {r.ab}
                  </span>
                  <RowText title={r.t} sub={notYet ? 'Not in the hub yet' : needsHub ? 'Set up a hub first' : r.s} weight={600} />
                  {r.tag ? <Pill tone={tags[r.tag].tone} small>{tags[r.tag].label}</Pill> : null}
                  {r.to === '/add/hub' && s.hubPaired ? <Pill tone="success" small>PAIRED</Pill> : null}
                </Row>
              );
            })}
          </Group>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <Pill tone="success" small>LIVE</Pill>
        <Note>Live video and sound. VIA HUB needs the home hub running. CLIPS imports saved recordings only, no live view.</Note>
      </div>
    </Page>
  );
}

function FlowPage({ title, intro, eyebrow = 'ADD CAMERA · VIA HUB', children }) {
  return (
    <Page gap={16}>
      <BackBar to="/add" eyebrow={eyebrow} />
      <h1 style={display(26, { lineHeight: 1.15 })}>{title}</h1>
      {intro ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>{intro}</p> : null}
      {children}
    </Page>
  );
}

function finish(cameras) {
  addCameras(cameras);
  navigate('/cameras');
}

/** Asks the hub to try a camera and keeps the frame it got back. */
function useHubTest() {
  const [test, setTest] = React.useState({ status: 'idle' }); // idle | busy | ok | failed
  React.useEffect(() => () => test.url && URL.revokeObjectURL(test.url), [test.url]);
  const run = async (camera) => {
    setTest({ status: 'busy' });
    try {
      const frame = await hubTestCamera(getState().hub, camera);
      setTest({ status: 'ok', url: URL.createObjectURL(frame) });
    } catch (err) {
      setTest({ status: 'failed', error: err.message });
    }
  };
  return [test, run];
}

function TestPreview({ test }) {
  return (
    <VideoTile
      label="Test preview from the camera"
      height={180}
      placeholder={test.status === 'busy' ? 'CONNECTING…' : 'TEST PREVIEW'}
      src={test.url}
    >
      {test.status === 'ok' ? <Pill tone="success" style={{ position: 'absolute', top: 12, left: 12 }}>CONNECTED</Pill> : null}
    </VideoTile>
  );
}

/** Adds cameras to the hub one after another; reports the first problem. */
function useHubAdd() {
  const [state, setState] = React.useState({ busy: false, error: '' });
  const add = async (cameras) => {
    setState({ busy: true, error: '' });
    try {
      for (const camera of cameras) await addHubCamera(camera);
      navigate('/cameras');
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  };
  return [state, add];
}

/** 8 · Connect via hub: any RTSP / ONVIF camera (Eufy is the worked example). */
export function ConnectStream({ kind }) {
  const cfg = connectKinds[kind] || connectKinds.rtsp;
  const [form, setForm] = React.useState({ address: '', user: '', pass: '', name: cfg.name });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const [test, runTest] = useHubTest();
  const [adding, add] = useHubAdd();
  const camera = {
    kind: 'rtsp',
    address: form.address.trim(),
    username: form.user,
    password: form.pass,
    name: form.name.trim(),
    device: cfg.device,
    source: cfg.source,
  };
  return (
    <FlowPage title={cfg.title}>
      <Steps items={cfg.steps} />
      <Field
        label="Stream address"
        monoFont
        size={14}
        placeholder={cfg.address}
        value={form.address}
        onChange={set('address')}
        hint={cfg.hint}
        error={test.status === 'failed' ? test.error : undefined}
        autoCapitalize="off"
        spellCheck={false}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <Field label="Username" size={14} value={form.user} onChange={set('user')} autoComplete="off" autoCapitalize="off" />
        <Field label="Password" size={14} type="password" value={form.pass} onChange={set('pass')} autoComplete="off" />
      </div>
      <TestPreview test={test} />
      <Cta variant="outline" disabled={!camera.address || test.status === 'busy'} onClick={() => runTest(camera)}>
        {test.status === 'busy' ? 'Connecting…' : 'Test the stream'}
      </Cta>
      <Field label="Name" value={form.name} maxLength={24} onChange={set('name')} error={adding.error || undefined} />
      <Spacer />
      <Cta disabled={!camera.name || !camera.address || adding.busy} onClick={() => add([camera])}>
        {adding.busy ? 'Adding…' : 'Add camera'}
      </Cta>
      <Note center>The hub keeps the stream on your home network and hands it to your viewers.</Note>
    </FlowPage>
  );
}

function PickList({ items, picked, onToggle }) {
  return (
    <Group>
      {items.map((c) => (
        <Row key={c.id} minHeight={60} onClick={() => onToggle(c.id)} role="checkbox" aria-checked={picked.includes(c.id)} style={{ padding: 0, justifyContent: 'flex-start' }}>
          <CheckMark on={picked.includes(c.id)} />
          <RowText title={c.t} sub={c.s} weight={600} />
        </Row>
      ))}
    </Group>
  );
}

function usePicked(items) {
  const [picked, setPicked] = React.useState(() => items.filter((c) => c.on).map((c) => c.id));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return [picked, toggle];
}

const countLabel = (n) => `Add ${n} camera${n === 1 ? '' : 's'}`;

/** USB webcams plugged into the hub. */
export function ConnectUsb() {
  const hub = useStore().hub;
  const [found, setFound] = React.useState(null); // null while asking the hub
  const [problem, setProblem] = React.useState('');
  const [picked, setPicked] = React.useState([]);
  const [adding, add] = useHubAdd();
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  React.useEffect(() => {
    if (!hub) return;
    hubGet(hub, '/api/usb')
      .then((j) => setFound(j.cameras.filter((c) => !c.added).map((c) => ({ id: c.address, t: c.name, s: c.port ? `USB port ${c.port}` : c.address }))))
      .catch((err) => {
        setFound([]);
        setProblem(err.message);
      });
  }, [hub]);

  return (
    <FlowPage title="Add a USB webcam" intro="Webcams plugged into the machine your hub runs on show up here. The hub turns them into Lookabout streams.">
      <Eyebrow style={{ paddingTop: 6 }}>FOUND ON YOUR HUB</Eyebrow>
      {found && found.length ? <PickList items={found} picked={picked} onToggle={toggle} /> : null}
      {found && !found.length ? (
        <Note size={13}>
          {problem || 'No webcams to add. Plug one into the hub, list it under “devices” in the hub’s docker-compose.yml, and restart the hub.'}
        </Note>
      ) : null}
      {!found ? <Note size={13}>Asking the hub…</Note> : null}
      {adding.error ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{adding.error}</Note> : null}
      <Spacer />
      <Cta
        disabled={!picked.length || adding.busy}
        onClick={() => add(found.filter((c) => picked.includes(c.id)).map((c) => ({ kind: 'usb', address: c.id, name: c.t.slice(0, 24) })))}
      >
        {adding.busy ? 'Adding…' : countLabel(picked.length)}
      </Cta>
    </FlowPage>
  );
}

/** Connect Google Nest through Google's Device Access program. */
export function ConnectNest() {
  const [picked, toggle] = usePicked(nestCams);
  return (
    <FlowPage
      title="Connect Google Nest"
      intro="Nest cameras come in through Google’s Device Access program. Google charges a fee to register, and the hub signs in for you."
    >
      <Cta variant="outline" style={{ background: 'var(--surface-card)', fontWeight: 600 }}>Sign in with Google</Cta>
      <Eyebrow style={{ paddingTop: 6 }}>FOUND IN YOUR ACCOUNT</Eyebrow>
      <PickList items={nestCams} picked={picked} onToggle={toggle} />
      <Spacer />
      <Cta
        disabled={!picked.length}
        onClick={() => finish(nestCams.filter((c) => picked.includes(c.id)).map((c) => ({ name: c.t, device: 'NEST', source: 'Google Nest via hub' })))}
      >
        {countLabel(picked.length)}
      </Cta>
    </FlowPage>
  );
}

function Unofficial({ children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)' }}>
      <Pill tone="caution" small style={{ height: 22, boxSizing: 'border-box', padding: '0 8px' }}>UNOFFICIAL</Pill>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-body)' }}>{children}</span>
    </div>
  );
}

function FoundList({ items }) {
  return (
    <Group>
      {items.map((c) => (
        <Row key={c.t} style={{ padding: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{c.t}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.s}</span>
        </Row>
      ))}
    </Group>
  );
}

/** Connect Ring (unofficial connection). */
export function ConnectRing() {
  const [form, setForm] = React.useState({ email: '', pass: '', code: '' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <FlowPage title="Connect Ring">
      <Unofficial>
        Ring has no public API. This uses a community-built connection, so a Ring update can break it. We’ll tell you if it does.
      </Unofficial>
      <Field label="Ring account email" size={15} type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} autoComplete="off" />
      <Field label="Password" size={15} type="password" value={form.pass} onChange={set('pass')} autoComplete="off" />
      <Field
        label="Verification code from Ring"
        monoFont
        size={18}
        emphasis
        inputMode="numeric"
        placeholder="000 000"
        value={form.code}
        onChange={set('code')}
        hint="Your password goes to Ring only. The hub keeps a sign-in token, never the password."
      />
      <FoundList items={ringCams} />
      <Spacer />
      <Cta onClick={() => finish(ringCams.map((c) => ({ name: c.t, device: 'RING', source: 'Ring via hub', brand: 'Ring' })))}>
        {countLabel(ringCams.length)}
      </Cta>
    </FlowPage>
  );
}

/** Connect Wyze (unofficial connection). */
export function ConnectWyze() {
  const [form, setForm] = React.useState({ id: '', key: '', email: '' });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <FlowPage title="Connect Wyze">
      <Unofficial>
        Uses a community-built connection to Wyze cameras on your network. A Wyze firmware update can break it.
      </Unofficial>
      <Steps
        items={[
          'Sign in to Wyze’s developer console and create an API key.',
          'Paste the key ID and key here, with your Wyze email and password.',
        ]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <Field label="Key ID" monoFont size={14} value={form.id} onChange={set('id')} autoComplete="off" />
        <Field label="API key" monoFont size={14} type="password" value={form.key} onChange={set('key')} autoComplete="off" />
      </div>
      <Field label="Wyze account email" size={15} type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} autoComplete="off" />
      <FoundList items={wyzeCams} />
      <Spacer />
      <Cta onClick={() => finish(wyzeCams.map((c) => ({ name: c.t.split(' · ')[1] || c.t, device: 'WYZE', source: 'Wyze via hub', brand: 'Wyze' })))}>
        {countLabel(wyzeCams.length)}
      </Cta>
    </FlowPage>
  );
}

/** Tesla Sentry and Dashcam clips (no live view). */
export function TeslaClips() {
  return (
    <FlowPage
      title="Tesla Sentry clips"
      intro="Tesla doesn’t share live video outside its app. A Raspberry Pi Zero plugged into the car stands in for the TeslaCam drive and copies new clips to your hub when the car is home on Wi-Fi."
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: 14, color: 'var(--text-strong)' }}>Car drive</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--osl-success)' }}>Synced 8 min ago</span>
      </div>
      <Eyebrow>IMPORTED CLIPS</Eyebrow>
      {teslaClips.map((c) => (
        <ClipRow key={c.t} title={c.t} meta={c.m} badge="CLIP" play={false} />
      ))}
    </FlowPage>
  );
}

function normalizeAddress(value) {
  let v = value.trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v.replace(/\/+$/, '');
}

/**
 * ESP32 or Pi camera on your own Wi-Fi. With a hub paired the hub reads the
 * board and viewers watch through the hub; without one the viewer shows the
 * board's stream directly when both are on the same network.
 */
function DirectCamera({ defaultAddress, defaultName, device, source, hint }) {
  const viaHub = useStore().hubPaired;
  const [address, setAddress] = React.useState(defaultAddress);
  const [name, setName] = React.useState(defaultName);
  const base = normalizeAddress(address);
  const [preview, setPreview] = React.useState('');
  const [test, runTest] = useHubTest();
  const [adding, add] = useHubAdd();
  const insecure = !viaHub && window.location.protocol === 'https:' && base.startsWith('http://');
  const hubCamera = { kind: 'mjpeg', address: base, name: name.trim(), device, source: source.replace('on your Wi-Fi', 'via hub') };
  const error = insecure
    ? 'This page is on https, so the browser will block a plain http camera. Open Lookabout from your own network instead.'
    : viaHub && test.status === 'failed'
      ? test.error
      : undefined;
  return (
    <>
      <Field
        label="Camera address on your network"
        monoFont
        size={14}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        hint={hint}
        error={error}
      />
      {viaHub ? <TestPreview test={test} /> : <VideoTile label="Test preview from the camera" height={180} placeholder="TEST PREVIEW" src={preview || undefined} />}
      <Cta
        variant="outline"
        disabled={!base || test.status === 'busy'}
        onClick={() => (viaHub ? runTest(hubCamera) : setPreview(`${base}/stream?t=${Date.now()}`))}
      >
        {test.status === 'busy' ? 'Connecting…' : 'Test the stream'}
      </Cta>
      <Field label="Name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} error={adding.error || undefined} />
      <Spacer />
      <Cta
        disabled={!base || !name.trim() || adding.busy}
        onClick={() => (viaHub ? add([hubCamera]) : finish([{ name: name.trim(), device, source, streamUrl: `${base}/stream`, address: base }]))}
      >
        {adding.busy ? 'Adding…' : viaHub ? 'Add through the hub' : 'Add this camera'}
      </Cta>
      {viaHub ? <Note center>The hub reads this camera and hands the video to your viewers.</Note> : null}
    </>
  );
}

function thisDeviceName() {
  const ua = navigator.userAgent;
  const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Computer';
  return `${what} browser`;
}

/** The paired hub: what it is, and unpairing. */
function HubPaired() {
  const s = useStore();
  const [info, setInfo] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    hubInfo(s.hub.address).then(setInfo).catch(() => setInfo(null));
  }, [s.hub.address, s.hubReachable]);
  return (
    <FlowPage title="Home hub" eyebrow="HOME HUB" intro="This device is signed in to your hub. Cameras, events and devices come from it.">
      {s.hubReachable ? (
        <StatusBox label="SIGNED IN">
          {s.hub.name}{s.hub.member ? ` · ${s.hub.member.name || s.hub.member.email}` : ''}{info ? ` · ${freeSpace(info.free_bytes)} · version ${info.version}` : ''}
        </StatusBox>
      ) : (
        <Note size={13} style={{ color: 'var(--osl-danger)' }}>
          Can’t reach the hub right now. Check that it is switched on and that this device is on your home network.
        </Note>
      )}
      <Group>
        <Row><RowText title="Address" sub={s.hub.address} /></Row>
        <Row to="/cameras"><RowText title="Cameras" sub={`${s.hubCameras.length} on this hub`} /><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Open</span></Row>
        <Row to="/account"><RowText title="Your account" sub="Password, passkeys, linked sign-ins" /><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Open</span></Row>
        <Row to="/household"><RowText title="Household" sub="Who can see which cameras" /><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Open</span></Row>
        <Row to="/devices"><RowText title="Signed-in devices" sub={`${s.hubViewers.length} signed in`} /><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Manage</span></Row>
      </Group>
      <Spacer />
      <Cta href="#/add">Add a camera</Cta>
      <Cta
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await unpairHub();
        }}
      >
        {busy ? 'Signing out…' : 'Sign out of this hub'}
      </Cta>
      <Note center>Signing out ends this device’s session on the hub. The hub keeps its cameras and everyone else’s sign-ins.</Note>
    </FlowPage>
  );
}

/**
 * Home hub: install it, find it by address, pair with the code from its page.
 * `address` and `code` can come in the link (`#/add/hub?address=…&code=…`).
 */
const HUB_README = 'https://github.com/omniship-labs/lookabout/tree/main/hub#install-on-a-raspberry-pi';
const PAIR_SECRET = ['code', 'password', 'setupCode']; // codes and passwords are never written to storage

const pairSteps = [
  {
    id: 'start',
    title: 'Start the hub',
    guide: [
      ['Copy the ', ['hub'], ' folder from the Lookabout repository to the Pi (64-bit Raspberry Pi OS with Docker).'],
      'In that folder, start it. The first build takes several minutes on a Pi.',
    ],
    copy: [{ label: 'COMMAND', text: 'docker compose up -d --build' }],
    links: [{ label: 'Hub install guide', href: HUB_README }],
    confirmLabel: 'The hub is running',
  },
  {
    id: 'find',
    title: 'Find the hub',
    body: ({ values, set }) => {
      const base = normalizeHubAddress(typedAddress(values));
      const insecure = blockedByHttps(base, window.location.protocol);
      return (
        <Field
          label="Hub address"
          monoFont
          size={14}
          value={typedAddress(values)}
          onChange={(e) => set({ address: e.target.value })}
          hint="The hub page shows this. Use the machine’s IP address if the .local name doesn’t open."
          error={insecure ? 'This page is on https, so the browser will block a plain http hub. Open Lookabout over http on your own network instead.' : undefined}
          autoCapitalize="off"
          spellCheck={false}
        />
      );
    },
    ready: (values) => !!normalizeHubAddress(typedAddress(values)),
    checkLabel: 'Find the hub',
    checkingLabel: 'Looking…',
    check: ({ values }) => findHub(values, window.location.protocol),
  },
  {
    id: 'pair',
    title: 'Sign in to the hub',
    // A new hub asks for its first admin; after that people sign in, or join with an invite link.
    guide: (values) => (values.setup
      ? ['This hub has no accounts yet. Make the first admin: the setup code is on the hub’s page, and in its log.']
      : ['Sign in with your hub account. If someone invited you, paste the invite link and choose a password.']),
    links: (values) => (values.base ? [{ label: 'Open the hub page', href: values.base }] : []),
    body: ({ values, set }) => (
      <>
        {values.setup ? (
          <Field
            label="Setup code"
            monoFont
            size={18}
            emphasis
            placeholder="XXXX-XXXX"
            value={values.setupCode || ''}
            maxLength={12}
            onChange={(e) => set({ setupCode: e.target.value.toUpperCase() })}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        ) : null}
        {!values.setup && !values.code ? (
          <Field
            label="Invite link (only if you were invited)"
            monoFont
            size={13}
            value={values.invite || ''}
            onChange={(e) => set({ invite: e.target.value })}
            autoCapitalize="off"
            spellCheck={false}
          />
        ) : null}
        {values.setup || values.invite ? (
          <Field label="Your name" value={values.person || ''} maxLength={40} onChange={(e) => set({ person: e.target.value })} autoComplete="name" />
        ) : null}
        {!values.setup && !values.code && (values.providers || []).map((p) => (
          <Cta
            key={p.id}
            variant="outline"
            onClick={async () => {
              try {
                // Back to the app afterwards: the hub leaves its session cookie, and the app picks it up.
                window.location.href = await providerSignInAddress(values.base, p.id, '/#/cameras');
              } catch (err) {
                set({ passkeyError: err.message });
              }
            }}
          >
            {p.label}
          </Cta>
        ))}
        {!values.setup && !values.invite && !values.code && passkeysSupported() ? (
          <>
            <Cta
              variant="outline"
              onClick={async () => {
                const address = values.base || normalizeHubAddress(typedAddress(values));
                if (!passkeyAddressOk(new URL(address).hostname)) {
                  set({ passkeyError: 'Passkeys need the hub’s name (such as raspberrypi.local), not its IP address.' });
                  return;
                }
                try {
                  set({ passkeyError: '' });
                  setHub(await signInWithPasskey(address, (values.name ?? '').trim() || thisDeviceName()));
                  await refreshHub();
                } catch (err) {
                  set({ passkeyError: err.message });
                }
              }}
            >
              Sign in with a passkey
            </Cta>
            {values.passkeyError ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{values.passkeyError}</Note> : null}
          </>
        ) : null}
        {!values.invite ? (
          <Field label="Email" type="email" value={values.email || ''} onChange={(e) => set({ email: e.target.value })} autoCapitalize="off" autoComplete="email" spellCheck={false} />
        ) : null}
        <Field
          label={values.setup || values.invite ? 'Choose a password' : 'Password'}
          type="password"
          value={values.password || ''}
          onChange={(e) => set({ password: e.target.value })}
          autoComplete={values.setup || values.invite ? 'new-password' : 'current-password'}
          hint={values.setup || values.invite ? 'At least 10 characters. Use 14 or more to be able to turn on remote access later.' : undefined}
          error={(values.setup || values.invite) && values.password ? passwordProblem(values.password) || undefined : undefined}
        />
        <Field
          label="Name for this device"
          value={values.name ?? thisDeviceName()}
          maxLength={24}
          onChange={(e) => set({ name: e.target.value })}
          hint="Shown under Paired devices, so you can tell devices apart."
        />
      </>
    ),
    ready: (values) => {
      if (values.code) return codeReady(values.code); // a pairing code from a link or QR
      if (values.setup) return codeReady(values.setupCode) && !!(values.email || '').includes('@') && !passwordProblem(values.password);
      if (values.invite) return !!(inviteFromLink(values.invite) || values.invite.trim()) && !passwordProblem(values.password);
      return !!(values.email || '').includes('@') && !!values.password;
    },
    checkLabel: (values) => (values.setup ? 'Make the first admin' : values.invite ? 'Join' : 'Sign in'),
    checkingLabel: 'Signing in…',
    check: async ({ values }) => {
      const address = values.base || normalizeHubAddress(typedAddress(values));
      const device = (values.name ?? '').trim() || thisDeviceName();
      let hub;
      if (values.code) hub = await pairWithHub(address, values.code, device);
      else if (values.setup) hub = await setUpHub(address, { setupCode: values.setupCode, name: values.person, email: values.email, password: values.password }, device);
      else if (values.invite) hub = await joinHub(address, inviteFromLink(values.invite) || values.invite.trim(), values.person, values.password, device);
      else hub = await signInToHub(address, values.email, values.password, device);
      setHub(hub);
      await refreshHub();
      return 'Signed in.';
    },
    note: 'Without a hub everything still works live, phone to phone.',
  },
];

export function HubSetup({ address: linkAddress, code: linkCode, invite, error }) {
  const s = useStore();
  const [own, setOwn] = React.useState(undefined); // undefined: still asking; null: this page isn't a hub's
  React.useEffect(() => {
    let off = false;
    detectOwnHub(window.location.origin).then(async (found) => {
      if (found) {
        // Which of Google and Apple this hub has switched on (the cookie they leave is the hub's own page's).
        const options = await signInOptions(found.address).catch(() => ({ providers: [] }));
        found.providers = options.providers.filter((p) => p.id === 'google' || p.id === 'apple');
      }
      if (!off) setOwn(found);
    });
    return () => {
      off = true;
    };
  }, []);
  if (s.hubPaired) return <HubPaired />;
  if (own === undefined) return null;
  // On the hub's own page there is nothing to install or find: just sign in.
  const steps = own ? pairSteps.filter((step) => step.id === 'pair') : pairSteps;
  const initial = own
    ? { base: own.address, setup: !!own.setup.setup_required, setupCode: own.setup.setup_code || '', invite: invite || '', code: linkCode, providers: own.providers || [] }
    : { address: linkAddress, code: linkCode, invite: invite || '' };
  return (
    <FlowPage
      title={own ? `Sign in to ${own.info.name}` : 'Set up a home hub'}
      eyebrow="HOME HUB"
      intro={own
        ? 'This hub keeps your cameras and who may see them.'
        : 'Optional. Runs on a Raspberry Pi 4/5, home server or NAS. Brings in cameras you already own and keeps watch when your phone is away.'}
    >
      {error ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{error}</Note> : null}
      <Wizard
        flow="hub-pair"
        steps={steps}
        secret={PAIR_SECRET}
        // A link from the hub's QR (#/add/hub?address=…&code=…) or an invite link fills the form in.
        initialValues={initial}
        restart={!!linkAddress || !!invite || !!own}
        forgetWhenDone
        onDone={() => navigate(own ? '/cameras' : '/add')}
      />
    </FlowPage>
  );
}

/** Guided setup: Raspberry Pi camera, ESP32 camera. */
export function Guided({ kind }) {
  const f = guidedFlows[kind];
  if (kind === 'esp32') {
    return (
      <FlowPage
        title="Add an ESP32 camera"
        eyebrow="ADD CAMERA · ON YOUR WI-FI"
        intro="An ESP32-S3 board with a USB webcam plugged in. Flash the Lookabout firmware, join it to your Wi-Fi, then add it here."
      >
        <Steps
          items={[
            'Flash the firmware onto the board (button below), then plug the webcam into the board’s USB port.',
            'Join the “Lookabout-Setup” Wi-Fi the board creates and give it your home Wi-Fi details.',
            'Enter the address it reports, test the stream, and add it.',
          ]}
        />
        <Cta variant="outline" href="#/flash">Flash or update firmware</Cta>
        <DirectCamera
          defaultAddress="lookabout-cam.local"
          defaultName="Garage"
          device="ESP32"
          source="ESP32 on your Wi-Fi"
          hint="The board prints this over USB when it joins Wi-Fi. Use its IP address if the .local name doesn’t open."
        />
        <Note center>Video only. Good for doors and garages, not for listening.</Note>
      </FlowPage>
    );
  }
  if (kind === 'pi') {
    return (
      <FlowPage title={f.title} eyebrow="ADD CAMERA · ON YOUR WI-FI" intro={f.intro.replace(' that reports to your hub', '')}>
        <Steps
          items={[
            'Copy the firmware/rpi folder to the Pi and run ./install.sh on it.',
            'Plug in a Pi camera module or a USB webcam.',
            'Enter the address the installer prints, test the stream, and add it.',
          ]}
        />
        <DirectCamera
          defaultAddress="raspberrypi.local:8080"
          defaultName="Pi camera"
          device="PI"
          source="Raspberry Pi on your Wi-Fi"
          hint="The installer prints this address when it finishes."
        />
        <Note center>{f.foot}</Note>
      </FlowPage>
    );
  }
  return null;
}
