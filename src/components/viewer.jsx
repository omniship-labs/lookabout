import React from 'react';
import { href } from '../lib/router.js';
import { useAsyncUrl, useLayout } from '../lib/hooks.js';
import { hubLine, useStore } from '../lib/store.js';
import { hubMjpegUrl, hubWebrtc } from '../lib/hub.js';
import { CRY_BAR_THRESHOLD, LEVEL_THRESHOLD, connection } from '../lib/sampleData.js';
import { AppIcon, LensWordmark } from './brand.jsx';
import { Bar, Eyebrow, Pill, display, mono } from './ui.jsx';
import { BellIcon, ClockIcon, GridIcon, PlayIcon, PlusIcon, SpeakerIcon, SwapIcon, VideoIcon, WifiOffIcon } from './icons.jsx';

// Viewer building blocks that are new for Lookabout: VideoTile, SoundMeter,
// LevelBar, EventRow, FollowSoundPill, TabBar / Sidebar / rail.

/**
 * Feed — fills its tile with the camera's video when the camera has a
 * stream address on your network, otherwise shows the placeholder label.
 */
export function Feed({ src, cam, label, small = false }) {
  if (cam && cam.hub) return <HubVideo cam={cam} small={small} />;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }
  return (
    <span
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...mono(small ? 10 : 12),
        color: small ? 'var(--text-faint)' : 'var(--text-muted)',
      }}
    >
      {label}
    </span>
  );
}

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };
const WEBRTC_WAIT_MS = 10000;

/**
 * Live video for a camera that comes through the home hub. WebRTC first;
 * if no picture arrives, the hub's MJPEG stream instead. Small tiles of
 * MJPEG cameras (ESP32, Pi) use MJPEG straight away, which costs the hub
 * nothing, where WebRTC would make it re-encode every tile.
 */
function HubVideo({ cam, small }) {
  const hub = useStore().hub;
  const video = React.useRef(null);
  const [mode, setMode] = React.useState(small && cam.kind === 'mjpeg' ? 'mjpeg' : 'webrtc');

  React.useEffect(() => {
    if (mode !== 'webrtc' || !hub) return undefined;
    let pc = null;
    let closed = false;
    const fallBack = () => !closed && setMode('mjpeg');
    const timer = setTimeout(() => {
      if (!video.current || !video.current.videoWidth) fallBack();
    }, WEBRTC_WAIT_MS);
    hubWebrtc(hub, cam.id, (stream) => {
      if (!closed && video.current) video.current.srcObject = stream;
    })
      .then((made) => {
        pc = made;
        if (closed) pc.close();
        else pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && fallBack());
      })
      .catch(fallBack);
    return () => {
      closed = true;
      clearTimeout(timer);
      if (pc) pc.close();
    };
  }, [mode, hub, cam.id]);

  // The stream address carries a short ticket for this camera, not the session.
  const mjpegUrl = useAsyncUrl(() => (hub && mode === 'mjpeg' ? hubMjpegUrl(hub, cam.id) : Promise.resolve('')), [hub, cam.id, mode]);

  if (!hub) return null;
  if (mode === 'mjpeg') return mjpegUrl ? <img src={mjpegUrl} alt="" style={fill} /> : null;
  return <video ref={video} autoPlay muted playsInline style={fill} />;
}

/**
 * VideoTile — the main feed. Always dark inside, so overlays stay legible in
 * the daytime light viewer too.
 */
export const VideoTile = React.forwardRef(function VideoTile(
  { label, height = 250, radius = 'var(--radius-lg)', flat = false, src, cam, placeholder = 'LIVE VIDEO', fadeKey, children, style },
  ref
) {
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      data-theme="dark"
      style={{
        position: 'relative',
        height,
        boxSizing: 'border-box',
        borderRadius: radius,
        background: flat ? 'var(--surface-sunken)' : 'var(--surface-card)',
        border: flat ? 0 : '1px solid var(--border)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div key={fadeKey} className={fadeKey ? 'lk-fade' : undefined} style={{ position: 'absolute', inset: 0 }}>
        <Feed src={src} cam={cam} label={placeholder} />
      </div>
      {children}
    </div>
  );
});

/** Small feed in multi-cam: tap to swap it into the main view. */
export function SmallFeed({ name, loud, onPick, height = 104, radius = 'var(--radius-md)', strip = true, src }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Show ${name} in main view`}
      data-theme="dark"
      style={{
        position: 'relative',
        height,
        padding: 0,
        borderRadius: radius,
        background: 'var(--surface-card)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        textAlign: 'left',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Feed src={src} label="FEED" small />
      {loud ? (
        <span style={{ position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 'var(--radius-pill)', background: 'var(--osl-warning)' }} />
      ) : null}
      {strip ? (
        <span
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '7px 10px',
            background: 'var(--lk-scrim)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: 'var(--text-muted)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{name}</span>
          <SwapIcon size={14} />
        </span>
      ) : (
        <span style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{name}</span>
      )}
    </button>
  );
}

/** Camera tile in the CCTV grid. Offline and paused tiles keep their slot. */
export function CameraTile({ cam, to, height = 128, radius = 'var(--radius-md)', showDevice = true, strip = true }) {
  const down = cam.status === 'offline' || cam.status === 'paused';
  const inner = (
    <>
      {down ? (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-muted)' }}>
          {cam.status === 'offline' ? <WifiOffIcon size={22} /> : null}
          <span style={{ ...mono(10), color: 'var(--text-body)' }}>
            {cam.status === 'offline' ? `OFFLINE · ${cam.since}` : `${(cam.brand || '').toUpperCase()} · PAUSED`}
          </span>
        </span>
      ) : (
        <Feed src={cam.streamUrl} cam={cam} label="FEED" small />
      )}
      {cam.motion && !down ? <Pill tone="accent" small style={{ position: 'absolute', top: 8, left: 8 }}>MOTION</Pill> : null}
      <span
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '8px 10px',
          background: down || !strip ? 'transparent' : 'var(--lk-scrim)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: down ? 'var(--text-muted)' : 'var(--text-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cam.name}
        </span>
        {showDevice && cam.device && !down ? <span style={{ ...mono(10), letterSpacing: 0, color: 'var(--text-muted)' }}>{cam.device}</span> : null}
      </span>
    </>
  );
  const style = {
    position: 'relative',
    display: 'block',
    height,
    boxSizing: 'border-box',
    borderRadius: radius,
    overflow: 'hidden',
    textDecoration: 'none',
    background: down ? 'var(--surface-sunken)' : 'var(--surface-card)',
    border: down
      ? '1px dashed var(--border-strong)'
      : cam.motion
        ? '1.5px solid var(--accent)'
        : '1px solid var(--border)',
  };
  // Feeds stay dark inside in both themes, so their labels stay legible over video.
  return to ? <a href={href(to)} data-theme="dark" style={style}>{inner}</a> : <div data-theme="dark" style={style}>{inner}</div>;
}

/** SoundMeter — 40 bars over a 10-minute window; a bar turns warning above the cry threshold. */
export function SoundMeter({ levels }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 36 }}>
      {levels.map((h, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            borderRadius: 2,
            height: Math.max(3, h),
            background: h > CRY_BAR_THRESHOLD ? 'var(--osl-warning)' : 'var(--osl-success)',
          }}
        />
      ))}
    </div>
  );
}

/** Per-camera level bars: success below the threshold, warning above. */
export function LevelBars({ cams, nameWidth = 92 }) {
  return cams.map((c) => (
    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: nameWidth, flexShrink: 0, fontSize: 13, color: 'var(--text-body)' }}>{c.name}</span>
      <Bar value={c.level} tone={c.level > LEVEL_THRESHOLD ? 'warning' : 'success'} />
    </div>
  ));
}

const dotTones = { warning: 'var(--osl-warning)', success: 'var(--osl-success)', muted: 'var(--text-muted)' };

/** EventRow — time · dot · label · meta. */
export function EventRow({ time, tone, label, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 64, flexShrink: 0, ...mono(12), letterSpacing: 0, color: 'var(--text-muted)' }}>{time}</span>
      {tone ? <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 'var(--radius-pill)', background: dotTones[tone] }} /> : null}
      <span style={{ flexGrow: 1, fontSize: 14, color: 'var(--text-strong)' }}>{label}</span>
      {meta ? <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{meta}</span> : null}
    </div>
  );
}

/** Clip row: thumbnail, title, meta, then a time or badge. */
export function ClipRow({ title, meta, time, badge, to, thumb, play = true }) {
  const inner = (
    <>
      <span
        role="img"
        aria-label="Clip thumbnail"
        style={{
          flexShrink: 0,
          width: 76,
          height: 48,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-sunken)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
        {play ? <span style={{ position: 'relative', display: 'flex', color: thumb ? 'var(--text-on-dark)' : undefined }}><PlayIcon size={16} /></span> : null}
      </span>
      <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta}</span>
      </span>
      {time ? <span style={{ ...mono(12), letterSpacing: 0, color: 'var(--text-muted)' }}>{time}</span> : null}
      {badge ? <Pill tone="warning" small>{badge}</Pill> : null}
    </>
  );
  const style = {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    padding: 8,
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-card)',
    border: '1px solid var(--border)',
    textDecoration: 'none',
  };
  return to ? <a href={href(to)} style={style}>{inner}</a> : <div style={style}>{inner}</div>;
}

/** FollowSoundPill — AUTO (success fill) follows the loudest camera; PINNED (outline) stays put. */
export function FollowPill({ follow, onToggle, height = 36, size = 11, style }) {
  return (
    <button
      type="button"
      aria-pressed={follow}
      data-theme="dark"
      aria-label={follow ? 'Main view follows the loudest camera. Tap to pin.' : 'Main view is pinned. Tap to follow sound.'}
      onClick={onToggle}
      style={{
        height,
        padding: `0 ${height >= 40 ? 14 : 12}px`,
        borderRadius: 'var(--radius-pill)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        ...mono(size),
        border: follow ? '1px solid transparent' : '1px solid var(--border-strong)',
        background: follow ? 'var(--osl-success)' : 'var(--lk-scrim)',
        color: follow ? 'var(--osl-ink)' : 'var(--text-strong)',
        transition: 'background var(--dur-base) var(--ease-out)',
        ...style,
      }}
    >
      <SpeakerIcon size={14} />
      {follow ? 'AUTO' : 'PINNED'}
    </button>
  );
}

const tabs = [
  { id: 'live', label: 'Live', wide: 'Nursery', to: '/live', Icon: VideoIcon },
  { id: 'cameras', label: 'Cameras', wide: 'All cameras', to: '/cameras', Icon: GridIcon },
  { id: 'events', label: 'Events', wide: 'Events', to: '/events', Icon: ClockIcon },
  { id: 'alerts', label: 'Alerts', wide: 'Alerts & settings', to: '/settings', Icon: BellIcon },
];

export function TabBar({ active }) {
  return (
    <nav
      aria-label="Main"
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        height: 76,
        paddingBottom: 12,
        boxSizing: 'border-box',
        borderTop: '1px solid var(--border)',
        background: 'var(--lk-tabbar)',
      }}
    >
      {tabs.map(({ id, label, to, Icon }) => {
        const on = id === active;
        return (
          <a
            key={id}
            href={href(to)}
            aria-current={on ? 'page' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              textDecoration: 'none',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontSize: 11,
              fontWeight: on ? 600 : 400,
            }}
          >
            <Icon size={20} />
            {label}
          </a>
        );
      })}
    </nav>
  );
}

function Sidebar({ active }) {
  const s = useStore();
  const online = s.cameras.filter((c) => c.status === 'online').length;
  return (
    <nav
      aria-label="Main"
      style={{
        width: 232,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100dvh',
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '28px 16px',
        background: 'var(--surface-sunken)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}
    >
      <a href={href('/')} style={{ display: 'flex', padding: '0 8px', textDecoration: 'none' }}>
        <LensWordmark size={26} />
      </a>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tabs.map(({ id, wide, to, Icon }) => {
          const on = id === active;
          return (
            <a
              key={id}
              href={href(to)}
              aria-current={on ? 'page' : undefined}
              style={{
                height: 44,
                padding: '0 12px',
                borderRadius: 'var(--radius-md)',
                background: on ? 'var(--lk-seg-on)' : 'transparent',
                boxShadow: on ? 'var(--lk-seg-shadow)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                textDecoration: 'none',
                color: on ? 'var(--text-strong)' : 'var(--text-body)',
                fontSize: 14,
                fontWeight: on ? 600 : 400,
              }}
            >
              <Icon size={18} />
              {wide}
            </a>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <Eyebrow>HOME HUB</Eyebrow>
        <span style={{ fontSize: 13, color: 'var(--text-strong)' }}>
          {s.hubPaired ? hubLine(s) : 'Not set up · live only'}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {s.hubPaired ? `${online} online` : `${online} cameras · ${connection.kind} ${connection.latency}`}
        </span>
      </div>
      <a
        href={href('/camera/setup')}
        style={{
          minHeight: 44,
          padding: '6px 12px',
          boxSizing: 'border-box',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-strong)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textDecoration: 'none',
          color: 'var(--text-strong)',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <PlusIcon size={18} />
        Use this computer as a camera
      </a>
    </nav>
  );
}

function Rail({ active }) {
  return (
    <nav
      aria-label="Main"
      style={{
        width: 88,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100dvh',
        boxSizing: 'border-box',
        padding: '28px 0',
        background: 'var(--surface-sunken)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <a href={href('/')} style={{ display: 'flex', marginBottom: 18 }}>
        <AppIcon size={40} label="Lookabout" />
      </a>
      {tabs.map(({ id, label, to }) => {
        const on = id === active;
        return (
          <a
            key={id}
            href={href(to)}
            aria-current={on ? 'page' : undefined}
            style={{
              width: 64,
              height: 56,
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              fontSize: 11,
              background: on ? 'var(--lk-seg-on)' : 'transparent',
              boxShadow: on ? 'var(--lk-seg-shadow)' : 'none',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontWeight: on ? 600 : 400,
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Shell — viewer chrome. Phone: bottom tab bar. Tablet landscape: icon rail.
 * Desktop: sidebar. Follows the app theme (System / Light / Dark); only the
 * video feeds themselves stay dark inside.
 * `wide` content lays itself out across the main area; otherwise it sits in
 * the phone-width column.
 */
export function Shell({ active, wide = false, children }) {
  const layout = useLayout();
  if (layout === 'phone') {
    return (
      <div
        style={{ minHeight: '100dvh', display: 'flex', justifyContent: 'center', background: 'var(--surface-page)', color: 'var(--text-body)' }}
      >
        <div style={{ width: '100%', maxWidth: 'var(--lk-col)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingTop: 48 }}>{children}</div>
          <TabBar active={active} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100dvh', display: 'flex' }}>
      {layout === 'desktop' ? <Sidebar active={active} /> : <Rail active={active} />}
      <main
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-page)', color: 'var(--text-body)' }}
      >
        {wide ? (
          children
        ) : (
          <div
            style={{
              width: '100%',
              maxWidth: 'var(--lk-col)',
              margin: '0 auto',
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              paddingTop: 28,
              paddingBottom: 12,
              boxSizing: 'border-box',
            }}
          >
            {children}
          </div>
        )}
      </main>
    </div>
  );
}

/** Screen title row inside the Shell's phone column. */
export function ShellHeader({ title, size = 26, right, sub }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 var(--lk-side) 6px', minHeight: 44 }}>
        <h1 style={display(size)}>{title}</h1>
        {right}
      </div>
      {sub ? <span style={{ padding: '0 var(--lk-side) 14px', fontSize: 13, color: 'var(--text-muted)' }}>{sub}</span> : null}
    </>
  );
}
