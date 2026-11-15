import React from 'react';
import { navigate } from '../lib/router.js';
import { setState, useStore } from '../lib/store.js';
import { useBattery, useNow } from '../lib/hooks.js';
import * as camera from '../lib/camera.js';
import { AppIcon, LensGlyph } from '../components/brand.jsx';
import { BackBar, Cta, Field, Group, Note, Page, Row, Segmented, Spacer, Switch, cardStyle, display, mono } from '../components/ui.jsx';
import { BatteryLowIcon, CameraOffIcon, RecordIcon } from '../components/icons.jsx';

const lensLabels = { back: 'Back camera (wide)', front: 'Front camera' };
const qualityLabels = { 480: '480p · lowest data', 720: '720p · saves battery', 1080: '1080p · sharpest' };
const next = (keys, current) => keys[(keys.indexOf(String(current)) + 1) % keys.length];

function ValueRow({ label, value, onClick }) {
  return (
    <Row minHeight={48} onClick={onClick} style={{ padding: 0 }}>
      <span style={{ fontSize: 14, color: 'var(--text-body)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-strong)' }}>{value}</span>
    </Row>
  );
}

/** 2 · Camera setup + pairing. */
export function CameraSetup() {
  const s = useStore();
  const [code] = React.useState(camera.makePairingCode);
  const [starting, setStarting] = React.useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await camera.startCamera({ lens: s.lens, quality: s.quality });
      navigate('/camera/live');
    } catch {
      navigate('/camera/denied');
    }
  };

  return (
    <Page pad="48px var(--lk-side) 24px" gap={20}>
      <BackBar to="/" eyebrow="STEP 2 OF 2 · CAMERA" />
      <h1 style={display(28, { lineHeight: 1.1 })}>Set up this camera</h1>

      <Field
        label="Camera name"
        value={s.cameraName}
        maxLength={24}
        onChange={(e) => setState({ cameraName: e.target.value })}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Mode</span>
        <Segmented
          label="Mode"
          value={s.cameraMode}
          onChange={(cameraMode) => setState({ cameraMode })}
          options={[{ value: 'baby', label: 'Baby monitor' }, { value: 'security', label: 'Security cam' }]}
        />
        <Note>Baby monitor keeps audio always on and listens for crying. Security cam records on motion.</Note>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Camera &amp; mic</span>
        <Group>
          <ValueRow label="Lens" value={lensLabels[s.lens]} onClick={() => setState({ lens: next(['back', 'front'], s.lens) })} />
          <ValueRow label="Quality" value={qualityLabels[s.quality]} onClick={() => setState({ quality: next(['480', '720', '1080'], s.quality) })} />
          <Row minHeight={48} style={{ padding: 0 }}>
            <span style={{ fontSize: 14, color: 'var(--text-body)' }}>Low-light boost</span>
            <Switch label="Low-light boost" checked={s.lowLight} onChange={(lowLight) => setState({ lowLight })} />
          </Row>
        </Group>
      </div>

      <div style={{ ...cardStyle, display: 'flex', gap: 16, alignItems: 'center', padding: 16 }}>
        <div
          role="img"
          aria-label="Pairing QR code"
          style={{
            flexShrink: 0,
            width: 104,
            height: 104,
            boxSizing: 'border-box',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            border: '1px dashed var(--border-strong)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            ...mono(10),
            color: 'var(--text-muted)',
          }}
        >
          <AppIcon size={26} />
          QR + MARK
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--text-strong)' }}>Pair a viewer</span>
          <Note size={13}>Scan with your phone, or type the code at lookabout.omniship.dev/pair</Note>
          <span style={{ ...mono(15), color: 'var(--text-strong)' }}>{code}</span>
        </div>
      </div>

      <Spacer />

      <Cta onClick={start} disabled={starting} iconLeft={<RecordIcon size={18} />}>Start camera</Cta>
      <Note center>Keep it plugged in. The screen can go dark while it streams.</Note>
    </Page>
  );
}

function Stat({ label, children }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 14,
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border)',
      }}
    >
      <span style={{ ...mono(11), color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-strong)' }}>{children}</span>
    </div>
  );
}

function uptime(ms) {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m ${Math.floor((ms % 60000) / 1000)}s`;
}

const DIM_AFTER_MS = 10000;

/** 3 · Camera streaming: what the camera device shows while live. */
export function CameraLive({ scenario }) {
  const s = useStore();
  const now = useNow();
  const battery = useBattery();
  const [startedAt] = React.useState(() => Date.now());
  const [paused, setPausedState] = React.useState(false);
  const [lastTouch, setLastTouch] = React.useState(() => Date.now());
  const videoRef = React.useRef(null);
  const stream = camera.getStream();

  React.useEffect(() => {
    if (!stream && scenario !== 'battery') navigate('/camera/setup', { replace: true });
  }, [stream, scenario]);

  React.useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const wake = () => setLastTouch(Date.now());
  const dimmed = now - lastTouch > DIM_AFTER_MS;

  const togglePause = () => {
    camera.setPaused(!paused);
    setPausedState(!paused);
  };
  const stop = () => {
    camera.stopCamera();
    navigate('/camera/setup');
  };

  const level = scenario === 'battery' ? 14 : battery && !battery.charging ? battery.level : null;
  const lowBattery = level != null && level < 20;
  const power = battery ? (battery.charging ? 'Plugged in' : `Battery ${battery.level}%`) : 'Not reported';
  const viewers = s.devices.viewers.length;

  return (
    <div onPointerDown={wake} onKeyDown={wake}>
      <Page pad="72px 24px 32px" gap={lowBattery ? 22 : 24} align="center">
        <div
          style={{
            display: 'contents',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            <LensGlyph size={24} />
            <span style={{ fontSize: 13 }}>This device is a Lookabout camera</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--accent-soft)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: paused ? 'var(--text-muted)' : 'var(--accent)' }} />
            <span style={{ ...mono(12, true), color: 'var(--text-strong)' }}>{paused ? 'PAUSED' : 'LIVE'}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
            <h1 style={display(36)}>{s.cameraName || 'Camera'}</h1>
            <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>
              {paused ? 'Video paused · still paired' : `Streaming to ${viewers} viewers`} · {s.cameraMode === 'baby' ? 'baby monitor mode' : 'security cam mode'}
            </span>
          </div>

          {lowBattery ? (
            <div
              role="status"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: 22,
                borderRadius: 'var(--radius-lg)',
                border: '1.5px solid var(--osl-warning)',
                background: 'var(--lk-warning-tint)',
              }}
            >
              <BatteryLowIcon />
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)' }}>Battery {level}%</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-body)', textAlign: 'center' }}>
                Plug this device in to keep watching. Viewers were told too.
              </span>
            </div>
          ) : (
            <div
              style={{
                position: 'relative',
                width: 160,
                height: 120,
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-card)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...mono(11),
                color: 'var(--text-muted)',
              }}
            >
              SELF-VIEW
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                aria-label="Small self-view preview of the camera"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: paused ? 0.3 : 1 }}
              />
            </div>
          )}

          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <Stat label="MIC">{s.cameraMode === 'baby' && s.cryDetection ? 'On · cry detection' : 'On'}</Stat>
            <Stat label="POWER">{power}</Stat>
            <Stat label="UPTIME">{uptime(now - startedAt)}</Stat>
            <Stat label="HUB">{s.hubPaired ? 'Connected' : 'No hub · live only'}</Stat>
          </div>

          <Spacer />

          <Note size={13} center>Screen dims in 10 s to keep the room dark. Tap to wake.</Note>

          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <Cta variant="outline" height={52} style={{ fontWeight: 600 }} onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</Cta>
            <Cta variant="secondary" height={52} onClick={stop}>Stop camera</Cta>
          </div>
        </div>
      </Page>
      {dimmed ? (
        <button
          type="button"
          aria-label="Wake screen"
          onClick={wake}
          className="lk-fade"
          style={{ position: 'fixed', inset: 0, zIndex: 10, border: 0, padding: 0, background: 'color-mix(in srgb, var(--osl-ink) 94%, transparent)', cursor: 'default' }}
        />
      ) : null}
    </div>
  );
}

const stateLabels = { granted: 'Allowed', denied: 'Not allowed', prompt: 'Not asked yet', unknown: 'Not allowed' };

/** Permission denied: explain why and offer the way back in. */
export function CameraDenied() {
  const s = useStore();
  const [states, setStates] = React.useState({ camera: 'unknown', microphone: 'unknown' });
  React.useEffect(() => {
    camera.permissionStates().then(setStates);
  }, []);

  const retry = async () => {
    try {
      await camera.startCamera({ lens: s.lens, quality: s.quality });
      navigate('/camera/live');
    } catch {
      camera.permissionStates().then(setStates);
    }
  };

  const row = (label, state) => (
    <Row minHeight={48} style={{ padding: 0 }}>
      <span style={{ fontSize: 14, color: 'var(--text-strong)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: state === 'granted' ? 'var(--osl-success)' : 'var(--osl-danger)' }}>{stateLabels[state]}</span>
    </Row>
  );

  return (
    <Page pad="96px 24px 28px" gap={20}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-strong)',
        }}
      >
        <CameraOffIcon size={30} />
      </div>
      <h1 style={display(28, { lineHeight: 1.1 })}>Lookabout can’t use the camera</h1>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 'var(--leading-normal)' }}>
        To work as a camera, this device needs camera and microphone access. Video goes only to your paired viewers, encrypted.
      </p>
      <Group>
        {row('Camera', states.camera)}
        {row('Microphone', states.microphone)}
      </Group>
      <Note size={13}>Allow both for this site in your browser’s site settings, then try again.</Note>
      <Spacer />
      <Cta onClick={retry}>Try again</Cta>
      <Cta variant="outline" href="#/live">Use as viewer instead</Cta>
    </Page>
  );
}
