import React from 'react';
import { navigate } from '../lib/router.js';
import { addCameras, setState, useStore } from '../lib/store.js';
import { addGroups, connectKinds, guidedFlows, nestCams, ringCams, teslaClips, usbCams, wyzeCams } from '../lib/sampleData.js';
import { BackBar, CheckMark, Cta, Eyebrow, Field, Group, Note, Page, Pill, Row, RowText, Spacer, StatusBox, Steps, display, mono } from '../components/ui.jsx';
import { ClipRow, VideoTile } from '../components/viewer.jsx';

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
              return (
                <Row
                  key={r.ab}
                  minHeight={60}
                  to={needsHub ? '/add/hub' : r.to}
                  style={{ padding: '10px 14px', justifyContent: 'flex-start', opacity: needsHub ? 0.6 : 1 }}
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
                  <RowText title={r.t} sub={needsHub ? 'Set up a hub first' : r.s} weight={600} />
                  <Pill tone={tags[r.tag].tone} small>{tags[r.tag].label}</Pill>
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

/** 8 · Connect via hub: any RTSP / ONVIF camera (Eufy is the worked example). */
export function ConnectStream({ kind }) {
  const cfg = connectKinds[kind] || connectKinds.rtsp;
  const [form, setForm] = React.useState({ address: cfg.address, user: 'lookabout', pass: '', name: cfg.name });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <FlowPage title={cfg.title}>
      <Steps items={cfg.steps} />
      <Field label="Stream address" monoFont size={14} value={form.address} onChange={set('address')} hint={cfg.hint} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <Field label="Username" size={14} value={form.user} onChange={set('user')} autoComplete="off" />
        <Field label="Password" size={14} type="password" value={form.pass} onChange={set('pass')} autoComplete="off" />
      </div>
      <VideoTile label="Test preview from the connected camera" height={180} placeholder="TEST PREVIEW">
        <Pill tone="success" style={{ position: 'absolute', top: 12, left: 12 }}>CONNECTED</Pill>
        <span style={{ position: 'absolute', bottom: 12, left: 12, ...mono(11), color: 'var(--text-body)' }}>1080P · H.264 · AUDIO</span>
      </VideoTile>
      <Field label="Name" value={form.name} maxLength={24} onChange={set('name')} />
      <Spacer />
      <Cta disabled={!form.name.trim()} onClick={() => finish([{ name: form.name.trim(), device: cfg.device, source: cfg.source }])}>Add camera</Cta>
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
  const [picked, toggle] = usePicked(usbCams);
  return (
    <FlowPage title="Add a USB webcam" intro="Webcams plugged into your home server or NAS show up here. The hub turns them into Lookabout streams.">
      <Eyebrow style={{ paddingTop: 6 }}>FOUND ON YOUR HUB</Eyebrow>
      <PickList items={usbCams} picked={picked} onToggle={toggle} />
      <Spacer />
      <Cta
        disabled={!picked.length}
        onClick={() => finish(usbCams.filter((c) => picked.includes(c.id)).map((c) => ({ name: c.t, device: 'USB CAM', source: 'USB webcam on hub' })))}
      >
        {countLabel(picked.length)}
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
 * ESP32 camera on your own Wi-Fi. Until the hub exists, the viewer can show
 * the board's stream directly when both are on the same network.
 */
function DirectCamera({ defaultAddress, defaultName, device, source, hint }) {
  const [address, setAddress] = React.useState(defaultAddress);
  const [name, setName] = React.useState(defaultName);
  const base = normalizeAddress(address);
  const [preview, setPreview] = React.useState('');
  const insecure = window.location.protocol === 'https:' && base.startsWith('http://');
  return (
    <>
      <Field
        label="Camera address on your network"
        monoFont
        size={14}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        hint={hint}
        error={insecure ? 'This page is on https, so the browser will block a plain http camera. Open Lookabout from your own network instead.' : undefined}
      />
      <VideoTile label="Test preview from the camera" height={180} placeholder="TEST PREVIEW" src={preview || undefined} />
      <Cta variant="outline" disabled={!base} onClick={() => setPreview(`${base}/stream?t=${Date.now()}`)}>Test the stream</Cta>
      <Field label="Name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
      <Spacer />
      <Cta
        disabled={!base || !name.trim()}
        onClick={() => finish([{ name: name.trim(), device, source, streamUrl: `${base}/stream`, address: base }])}
      >
        Add this camera
      </Cta>
    </>
  );
}

/** Guided setup: home hub, Raspberry Pi camera, ESP32 camera. */
export function Guided({ kind }) {
  const f = guidedFlows[kind];
  const done = () => {
    if (kind === 'hub') {
      setState({ hubPaired: true });
      navigate('/add');
    } else if (f.camera) {
      finish([f.camera]);
    }
  };
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
  return (
    <FlowPage title={f.title} intro={f.intro}>
      <Steps items={f.steps} />
      {f.code ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border)',
            ...mono(12),
            letterSpacing: 0,
            lineHeight: 1.6,
            color: 'var(--text-body)',
            whiteSpace: 'pre-line',
            overflowX: 'auto',
          }}
        >
          {f.code}
        </div>
      ) : null}
      <StatusBox label={f.statusLabel} progress={f.progress}>{f.status}</StatusBox>
      <Spacer />
      <Cta onClick={done}>{f.cta}</Cta>
      <Note center>{f.foot}</Note>
    </FlowPage>
  );
}
