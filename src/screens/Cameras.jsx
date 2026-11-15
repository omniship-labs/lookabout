import React from 'react';
import { href } from '../lib/router.js';
import { hubLine, useStore } from '../lib/store.js';
import { eventDays as groupByDay } from '../lib/hub.js';
import { applyScenario, clip, eventDays, zones as sampleZones } from '../lib/sampleData.js';
import { BackBar, Banner, Chip, Cta, Eyebrow, Group, Note, Page, Row, SliderBar, display, mono } from '../components/ui.jsx';
import { CameraTile, ClipRow, Shell, ShellHeader, VideoTile } from '../components/viewer.jsx';
import { PauseIcon, PlayIcon, PlusIcon, WarningIcon } from '../components/icons.jsx';

const section = { padding: '0 var(--lk-side)' };

/** 5 · Viewer: CCTV grid + today's clips. */
export function Cameras({ scenario }) {
  const s = useStore();
  const cams = applyScenario(s.cameras, scenario);
  const [filter, setFilter] = React.useState('all');

  const online = cams.filter((c) => c.status === 'online').length;
  const offline = cams.filter((c) => c.status === 'offline');
  // What the hub recorded since midnight. "Sound" covers crying.
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const today = s.hubEvents.filter((e) => e.startedMs >= startOfToday);
  const pausedBrands = [...new Set(cams.filter((c) => c.status === 'paused').map((c) => c.brand))];
  const firstCam = cams.find((c) => !c.room && c.status === 'online');
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'motion', label: 'Motion' },
    { id: 'sound', label: 'Sound' },
    ...(firstCam ? [{ id: `cam:${firstCam.name}`, label: firstCam.name }] : []),
  ];
  const shown = today.filter(
    (e) => filter === 'all' || e.kind === filter || (filter === 'sound' && e.kind === 'crying') || `cam:${e.cam}` === filter
  );
  const clipCount = today.filter((e) => e.clip).length;

  return (
    <Shell active="cameras">
      <ShellHeader
        title="Cameras"
        right={
          <a
            href={href('/add')}
            aria-label="Add camera"
            style={{
              width: 44,
              height: 44,
              boxSizing: 'border-box',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-card)',
              color: 'var(--text-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlusIcon size={20} />
          </a>
        }
        sub={`${online} online · ${hubLine(s)}`}
      />

      {s.hubPaired && !s.hubReachable ? (
        <div style={{ ...section, paddingBottom: 14 }}>
          <Banner icon={<WarningIcon size={18} />} title="Can’t reach your home hub">
            Check that it is switched on and that this device is on your home network. Trying again every few seconds.
          </Banner>
        </div>
      ) : null}
      {s.hubPaired && !cams.length ? (
        <div style={{ ...section, paddingBottom: 14 }}>
          <Note size={13}>Your hub has no cameras yet. Press + to add one.</Note>
        </div>
      ) : null}
      {offline.map((c) => (
        <div key={c.id} style={{ ...section, paddingBottom: 14 }}>
          <Banner icon={<WarningIcon size={18} />} title={`${c.name} went offline at ${c.since}`}>
            Check its power or Wi-Fi. We’ll tell you when it’s back.
          </Banner>
        </div>
      ))}
      {pausedBrands.map((brand) => (
        <div key={brand} style={{ ...section, paddingBottom: 14 }}>
          <Banner
            title={`${brand} cameras stopped connecting`}
            actions={
              <>
                <Chip active height={40} onClick={() => { window.location.hash = `/add/${brand.toLowerCase()}`; }}>Sign in again</Chip>
                <Chip height={40}>Status page</Chip>
              </>
            }
          >
            {brand} changed something on their side. Your other cameras are fine. A fix usually lands within a few days through a hub update.
          </Banner>
        </div>
      ))}

      <div style={{ ...section, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {cams.map((c) => (
          <CameraTile key={c.id} cam={c} to={c.status === 'online' ? (c.room ? '/live' : `/live/${c.id}`) : undefined} />
        ))}
      </div>

      {s.hubPaired ? (
        <>
          <div style={{ padding: '20px var(--lk-side) 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={display(19, { letterSpacing: 0 })}>Events today</h2>
            {clipCount ? <span style={{ ...mono(11), color: 'var(--text-muted)' }}>{clipCount} CLIPS</span> : null}
          </div>
          <div style={{ ...section, paddingBottom: 12, display: 'flex', gap: 8, overflowX: 'auto' }}>
            {filters.map((f) => (
              <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Chip>
            ))}
          </div>
          <div style={{ ...section, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((e) => (
              <ClipRow key={e.id} title={e.t} meta={e.m} time={e.time} play={false} />
            ))}
            {!shown.length ? <Note size={13}>{today.length ? 'Nothing matches this filter today.' : 'Nothing has happened today.'}</Note> : null}
          </div>
        </>
      ) : null}
    </Shell>
  );
}

const eventFilters = [
  { id: 'all', label: 'All' },
  { id: 'crying', label: 'Crying' },
  { id: 'motion', label: 'Motion' },
  { id: 'offline', label: 'Offline' },
];

/** Events tab: everything that happened, by day. */
export function Events() {
  const s = useStore();
  const [filter, setFilter] = React.useState('all');
  // With a hub paired these are the hub's events; otherwise the sample night.
  const days = (s.hubPaired ? groupByDay(s.hubEvents) : eventDays)
    .map((d) => ({ ...d, items: d.items.filter((e) => filter === 'all' || e.kind === filter) }))
    .filter((d) => d.items.length);
  return (
    <Shell active="events">
      <ShellHeader title="Events" />
      <div style={{ ...section, paddingBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {eventFilters.map((f) => (
            <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Chip>
          ))}
        </div>
        {days.map((d) => (
          <React.Fragment key={d.label}>
            <Eyebrow style={{ paddingTop: 6 }}>{d.label}</Eyebrow>
            {d.items.map((e) => (
              <ClipRow key={e.id} title={e.t} meta={e.m} time={e.time} to={s.hubPaired ? undefined : '/events/clip'} play={false} />
            ))}
          </React.Fragment>
        ))}
        {!days.length ? <Note size={13}>Nothing of this kind yet.</Note> : null}
      </div>
    </Shell>
  );
}

/** Clip player. */
export function Clip() {
  const [playing, setPlaying] = React.useState(false);
  const m = clip.marker;
  return (
    <Page pad="48px var(--lk-side) 20px" gap={14}>
      <BackBar to="/events" eyebrow="EVENTS" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h1 style={display(22)}>{clip.title}</h1>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{clip.when}</span>
      </div>
      <VideoTile label="Recorded clip" placeholder="">
        <button
          type="button"
          aria-label={playing ? 'Pause clip' : 'Play clip'}
          aria-pressed={playing}
          onClick={() => setPlaying((v) => !v)}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-pill)',
            border: 0,
            background: 'var(--lk-scrim)',
            color: 'var(--text-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
      </VideoTile>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ position: 'relative', height: 28, borderRadius: 'var(--radius-sm)', background: 'var(--surface-card)', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', left: `${m.left}%`, width: `${m.width}%`, top: 0, bottom: 0, background: 'color-mix(in srgb, var(--osl-warning) 45%, transparent)' }} />
          <span style={{ position: 'absolute', left: `${m.playhead}%`, top: -2, bottom: -2, width: 2, background: 'var(--text-strong)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', ...mono(11), letterSpacing: 0, color: 'var(--text-muted)' }}>
          <span>{clip.position}</span>
          <span>{m.label}</span>
          <span>{clip.length}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Cta variant="outline" style={{ fontSize: 14 }}>Save</Cta>
        <Cta variant="outline" style={{ fontSize: 14 }}>Share</Cta>
        <Cta variant="outline" style={{ fontSize: 14 }}>Delete</Cta>
      </div>
      <Note size={13}>Clips live on the hub only. Save downloads to this phone; Share makes a link that expires in 24 h.</Note>
    </Page>
  );
}

const zoneColors = {
  accent: { stroke: 'var(--accent)', fill: 'var(--lk-zone-tint)' },
  info: { stroke: 'var(--osl-info)', fill: 'var(--lk-zone-tint-2)' },
};
const VIEW_W = 350;
const VIEW_H = 250;

/** Motion zones: drag corners to shape a zone. */
export function Zones() {
  const [zones, setZones] = React.useState(sampleZones);
  const [editing, setEditing] = React.useState(sampleZones[0].id);
  const [sensitivity, setSensitivity] = React.useState(60);
  const svgRef = React.useRef(null);
  const drag = React.useRef(null);

  const toView = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [
      Math.round(Math.min(VIEW_W, Math.max(0, ((e.clientX - r.left) / r.width) * VIEW_W))),
      Math.round(Math.min(VIEW_H, Math.max(0, ((e.clientY - r.top) / r.height) * VIEW_H))),
    ];
  };
  const onMove = (e) => {
    if (drag.current == null) return;
    const point = toView(e);
    setZones((zs) => zs.map((z) => (z.id === editing ? { ...z, points: z.points.map((p, i) => (i === drag.current ? point : p)) } : z)));
  };
  const nudge = (index, dx, dy) => {
    setZones((zs) =>
      zs.map((z) =>
        z.id === editing
          ? { ...z, points: z.points.map((p, i) => (i === index ? [Math.min(VIEW_W, Math.max(0, p[0] + dx)), Math.min(VIEW_H, Math.max(0, p[1] + dy))] : p)) }
          : z
      )
    );
  };
  const addZone = () => {
    const id = `zone-${zones.length + 1}`;
    setZones((zs) => [...zs, { id, name: `Zone ${zs.length + 1}`, action: 'alert + record', tone: 'accent', points: [[120, 80], [230, 80], [230, 170], [120, 170]] }]);
    setEditing(id);
  };
  const level = sensitivity < 34 ? 'Low' : sensitivity < 67 ? 'Medium' : 'High';

  return (
    <Page pad="48px var(--lk-side) 20px" gap={14}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={display(22)}>Front door zones</h1>
        <a
          href={href('/settings')}
          style={{
            height: 36,
            padding: '0 14px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            font: '600 13px var(--font-sans)',
          }}
        >
          Done
        </a>
      </div>
      <div
        style={{
          position: 'relative',
          aspectRatio: `${VIEW_W} / ${VIEW_H}`,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <svg
          ref={svgRef}
          role="img"
          aria-label={`Camera still with ${zones.length} motion zones drawn`}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          onPointerMove={onMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
        >
          {zones.map((z) => (
            <polygon
              key={z.id}
              points={z.points.map((p) => p.join(',')).join(' ')}
              fill={zoneColors[z.tone].fill}
              stroke={zoneColors[z.tone].stroke}
              strokeWidth="2"
              strokeDasharray={z.id === editing ? undefined : '6 4'}
              onClick={() => setEditing(z.id)}
            />
          ))}
          {(zones.find((z) => z.id === editing) || { points: [] }).points.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r="7"
              fill="var(--text-strong)"
              tabIndex={0}
              role="slider"
              aria-label={`Corner ${i + 1}`}
              aria-valuetext={`${p[0]}, ${p[1]}`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                drag.current = i;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onKeyDown={(e) => {
                const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key];
                if (d) {
                  e.preventDefault();
                  nudge(i, d[0], d[1]);
                }
              }}
            />
          ))}
        </svg>
      </div>
      <Note size={13}>Drag corners to shape a zone. Motion outside zones is ignored.</Note>
      <Group>
        {zones.map((z) => (
          <Row key={z.id} onClick={() => setEditing(z.id)} style={{ justifyContent: 'flex-start', gap: 10 }}>
            <span
              style={{
                width: 12,
                height: 12,
                flexShrink: 0,
                boxSizing: 'border-box',
                borderRadius: 3,
                background: z.id === editing ? zoneColors[z.tone].stroke : 'transparent',
                border: z.id === editing ? 0 : `2px dashed ${zoneColors[z.tone].stroke}`,
              }}
            />
            <span style={{ flexGrow: 1, fontSize: 14, color: 'var(--text-strong)' }}>{z.name} · {z.action}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{z.id === editing ? 'Editing' : 'Edit'}</span>
          </Row>
        ))}
      </Group>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', width: 80 }}>Sensitivity</span>
        <SliderBar label="Motion sensitivity" value={sensitivity} onChange={setSensitivity} />
        <span style={{ fontSize: 13, color: 'var(--text-body)', width: 56, textAlign: 'right' }}>{level}</span>
      </div>
      <Cta variant="outline" onClick={addZone} style={{ fontSize: 14, border: '1px dashed var(--border-strong)' }}>+ Add zone</Cta>
    </Page>
  );
}
