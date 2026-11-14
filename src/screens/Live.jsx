import React from 'react';
import { href } from '../lib/router.js';
import { announce, haptic, useClock, useLayout, useNow } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { canSnapshot, saveSnapshot } from '../lib/snapshot.js';
import { connection, nursery, soloStatus, soundLevels, tonight } from '../lib/sampleData.js';
import { LensGlyph } from '../components/brand.jsx';
import { Chip, Cta, Eyebrow, Note, Pill, Segmented, SliderBar, cardStyle, display, mono } from '../components/ui.jsx';
import { CameraTile, EventRow, FollowPill, LevelBars, Shell, SmallFeed, SoundMeter, VideoTile } from '../components/viewer.jsx';
import { BulbIcon, ChevronDownIcon, FullscreenIcon, MicIcon, MusicIcon, SnapshotIcon, SpinnerIcon } from '../components/icons.jsx';

// ---- state ---------------------------------------------------------------

/** Multi-cam room: main view follows the loudest camera until one is pinned. */
function useRoom(pinnedId) {
  const cams = nursery.cameras;
  const loudest = cams.reduce((a, b) => (b.level > a.level ? b : a));
  const [st, set] = React.useState(() => ({
    mainId: pinnedId || loudest.id,
    follow: !pinnedId,
    mix: 'all',
  }));
  const main = cams.find((c) => c.id === st.mainId) || cams[0];
  return {
    cams,
    loudest,
    main,
    others: cams.filter((c) => c.id !== main.id),
    follow: st.follow,
    mix: st.mix,
    toggleFollow: () =>
      set((s) => {
        announce(s.follow ? `Main view pinned to ${main.name}` : `Main view follows sound: ${loudest.name}`);
        return s.follow ? { ...s, follow: false } : { ...s, follow: true, mainId: loudest.id };
      }),
    pick: (id) => {
      const cam = cams.find((c) => c.id === id);
      if (cam) announce(`Main view: ${cam.name}, pinned`);
      set((s) => ({ ...s, mainId: id, follow: false }));
    },
    setMix: (mix) => set((s) => ({ ...s, mix })),
  };
}

/** Talk, lullaby and night light: things the viewer asks the camera to do. */
function useControls(camName) {
  const [talking, setTalking] = React.useState(false);
  const [nightLight, setNightLight] = React.useState(false);
  const [lullaby, setLullaby] = React.useState(null); // { minutes, endsAt, volume }
  const now = useNow();

  React.useEffect(() => {
    if (lullaby && now >= lullaby.endsAt) setLullaby(null);
  }, [now, lullaby]);

  const talk = (on) => {
    setTalking((was) => {
      if (was !== on) haptic();
      return on;
    });
  };

  return {
    talking,
    talkProps: {
      'aria-pressed': talking,
      onPointerDown: () => talk(true),
      onPointerUp: () => talk(false),
      onPointerLeave: () => talk(false),
      onPointerCancel: () => talk(false),
      onKeyDown: (e) => {
        if (e.key === ' ' || e.key === 'Enter') talk(true);
      },
      onKeyUp: () => talk(false),
      onBlur: () => talk(false),
    },
    nightLight,
    toggleNightLight: () => setNightLight((v) => !v),
    lullaby,
    lullabyLeft: lullaby ? Math.max(0, lullaby.endsAt - now) : 0,
    toggleLullaby: () => {
      setLullaby((l) => {
        announce(l ? 'Lullaby stopped' : `Lullaby playing on ${camName}`);
        return l ? null : { minutes: 30, endsAt: Date.now() + 30 * 60000, volume: 40 };
      });
    },
    setLullabyMinutes: (minutes) => setLullaby((l) => l && { ...l, minutes, endsAt: Date.now() + minutes * 60000 }),
    setLullabyVolume: (volume) => setLullaby((l) => l && { ...l, volume }),
  };
}

// ---- shared pieces -------------------------------------------------------

function TalkButton({ controls, height = 52, stacked = false, icon = true }) {
  return (
    <button
      type="button"
      {...controls.talkProps}
      style={{
        height,
        borderRadius: 'var(--radius-md)',
        border: 0,
        background: controls.talking ? 'var(--accent-press)' : 'var(--accent)',
        color: 'var(--text-on-accent)',
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: stacked ? 6 : 8,
        font: `600 ${stacked ? 12 : 14}px var(--font-sans)`,
        touchAction: 'none',
        userSelect: 'none',
        transform: controls.talking ? 'scale(0.985)' : 'none',
        transition: 'background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
      }}
    >
      {icon ? <MicIcon size={stacked ? 20 : 18} /> : null}
      {controls.talking ? 'Talking…' : 'Hold to talk'}
    </button>
  );
}

function ControlButton({ on, onClick, disabled, height = 52, stacked = false, outline = false, icon, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      style={{
        height,
        borderRadius: 'var(--radius-md)',
        border: on ? '1.5px solid var(--osl-success)' : `1px solid var(--${outline ? 'border-strong' : 'border'})`,
        background: outline ? 'transparent' : 'var(--surface-card)',
        color: 'var(--text-strong)',
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: stacked ? 6 : 8,
        font: `500 ${stacked ? 12 : 14}px var(--font-sans)`,
        transition: 'border-color var(--dur-fast) var(--ease-out)',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Snapshot: saves the camera's current frame, and says how it went on the button. */
function SnapshotButton({ cam, height, stacked }) {
  const [status, setStatus] = React.useState('idle'); // idle | busy | saved | failed | none
  const timer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next, message) => {
    setStatus(next);
    announce(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2500);
  };

  const take = async () => {
    if (!canSnapshot(cam)) {
      settle('none', `No video from ${cam.name} to save yet`);
      return;
    }
    clearTimeout(timer.current);
    setStatus('busy');
    try {
      const name = await saveSnapshot(cam);
      haptic();
      settle('saved', `Snapshot of ${cam.name} saved as ${name}`);
    } catch {
      settle('failed', `Couldn’t get a snapshot from ${cam.name}`);
    }
  };

  const label = { idle: 'Snapshot', busy: 'Saving…', saved: 'Saved', failed: 'Couldn’t save', none: 'No video yet' }[status];
  return (
    <ControlButton onClick={take} disabled={status === 'busy'} height={height} stacked={stacked} icon={<SnapshotIcon size={20} />}>
      {label}
    </ControlButton>
  );
}

function mmss(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Lullaby playing: track, stop, volume, sleep timer. */
function LullabyCard({ controls, camName }) {
  const l = controls.lullaby;
  return (
    <div style={{ ...cardStyle, border: '1.5px solid var(--osl-success)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...mono(11, true), color: 'var(--osl-success)' }}>PLAYING ON {camName.toUpperCase()}</span>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-strong)' }}>Twinkle, Twinkle, Little Star</span>
        </div>
        <button
          type="button"
          aria-label="Stop lullaby"
          onClick={controls.toggleLullaby}
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-strong)',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--text-strong)', display: 'block' }} />
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', width: 56 }}>Volume</span>
        <SliderBar label="Lullaby volume" value={l.volume} onChange={controls.setLullabyVolume} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', width: 56 }}>Stop in</span>
        {[[15, '15 min'], [30, '30 min'], [60, '1 h']].map(([m, label]) => (
          <Chip key={m} height={32} active={l.minutes === m} onClick={() => controls.setLullabyMinutes(m)}>{label}</Chip>
        ))}
      </div>
      <span style={{ ...mono(11), color: 'var(--text-muted)' }}>{mmss(controls.lullabyLeft)} LEFT · FADES OUT OVER 1 MIN</span>
    </div>
  );
}

function Tonight({ events }) {
  if (!events.length) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          padding: '36px 20px',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border-strong)',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        <LensGlyph size={40} quiet />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--text-strong)' }}>Quiet so far tonight</span>
        <Note size={13}>Crying, stirring and sounds will show up here with the time they happened.</Note>
      </div>
    );
  }
  return events.map((e) => <EventRow key={e.time} {...e} />);
}

function RoomSwitcher({ title, currentId }) {
  const [open, setOpen] = React.useState(false);
  const items = [
    { id: null, label: `${nursery.name} · all ${nursery.cameras.length} cameras`, to: '/live' },
    ...nursery.cameras.map((c) => ({ id: c.id, label: c.name, to: `/live/${c.id}` })),
  ];
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 44,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: 'var(--text-strong)',
          font: '600 22px var(--font-display)',
          letterSpacing: 'var(--tracking-tight)',
        }}
      >
        {title}
        <ChevronDownIcon size={18} />
      </button>
      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 46,
            left: 0,
            zIndex: 5,
            minWidth: 240,
            padding: 6,
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-strong)',
            boxShadow: 'var(--shadow-overlay)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {items.map((it) => (
            <a
              key={it.label}
              role="menuitem"
              href={href(it.to)}
              onClick={() => setOpen(false)}
              style={{
                minHeight: 44,
                padding: '0 10px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: it.id === currentId ? 600 : 400,
                color: 'var(--text-strong)',
                background: it.id === currentId ? 'var(--surface-sunken)' : 'transparent',
              }}
            >
              {it.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const scrimButton = {
  position: 'absolute',
  bottom: 10,
  right: 10,
  width: 44,
  height: 44,
  borderRadius: 'var(--radius-md)',
  border: 0,
  background: 'var(--lk-scrim)',
  color: 'var(--text-strong)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function useFullscreen() {
  const ref = React.useRef(null);
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (ref.current && ref.current.requestFullscreen) ref.current.requestFullscreen();
  };
  return [ref, toggle];
}

// ---- phone: 4 · baby monitor (one camera) --------------------------------

function SoloLive({ cam, inRoom, scenario }) {
  const controls = useControls(cam.name);
  const clock = useClock();
  const [tileRef, toggleFullscreen] = useFullscreen();
  const reconnecting = scenario === 'reconnecting';
  const events = scenario === 'empty' ? [] : tonight.slice(1);
  const section = { margin: '0 var(--lk-side)' };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 var(--lk-side) 14px' }}>
        {inRoom ? (
          <RoomSwitcher title={nursery.name} currentId={cam.id} />
        ) : (
          <span style={{ ...display(22), height: 44, display: 'flex', alignItems: 'center' }}>{cam.name}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...mono(12), color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: reconnecting ? 'var(--osl-warning)' : 'var(--osl-success)' }} />
          {reconnecting ? 'RECONNECTING' : `${connection.kind} · ${connection.latency}`}
        </div>
      </div>

      <div style={section}>
        <VideoTile
          ref={tileRef}
          label={reconnecting ? 'Frozen last frame while reconnecting' : `Live video from ${cam.name}`}
          src={cam.streamUrl}
        >
          {reconnecting ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--lk-scrim)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <SpinnerIcon />
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-strong)' }}>Reconnecting…</span>
              <span style={{ ...mono(11), color: 'var(--text-body)' }}>LAST FRAME {clock.toUpperCase()}</span>
            </div>
          ) : (
            <>
              <Pill tone="scrim" style={{ position: 'absolute', top: 12, left: 12 }}>LIVE · {clock.toUpperCase()}</Pill>
              <Pill tone="scrim" style={{ position: 'absolute', top: 12, right: 12 }}>LOW-LIGHT</Pill>
              <button type="button" aria-label="Full screen" onClick={toggleFullscreen} style={scrimButton}>
                <FullscreenIcon size={18} />
              </button>
            </>
          )}
        </VideoTile>
      </div>

      {reconnecting ? (
        <>
          <div style={{ ...cardStyle, ...section, marginTop: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--text-strong)' }}>Sound paused</span>
            <Note size={13}>
              We can’t hear the room right now. If it takes longer than 30 seconds you’ll get a loud alert, even on silent.
            </Note>
          </div>
          <div style={{ ...section, marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Cta variant="outline" style={{ fontSize: 14, fontWeight: 600 }}>Try again now</Cta>
            <Cta variant="outline" style={{ fontSize: 14 }}>Connection help</Cta>
          </div>
        </>
      ) : (
        <>
          {controls.lullaby ? (
            <div style={{ ...section, marginTop: 16 }}>
              <LullabyCard controls={controls} camName={cam.name} />
            </div>
          ) : null}

          <div style={{ ...cardStyle, ...section, marginTop: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--text-strong)' }}>{soloStatus.label}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{soloStatus.since}</span>
            </div>
            <SoundMeter levels={soundLevels} />
            <span style={{ ...mono(11), color: 'var(--text-muted)' }}>SOUND · LAST 10 MIN</span>
          </div>

          <div style={{ ...section, marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            <TalkButton controls={controls} height={72} stacked />
            <ControlButton on={!!controls.lullaby} onClick={controls.toggleLullaby} height={72} stacked icon={<MusicIcon size={20} />}>Lullaby</ControlButton>
            <ControlButton on={controls.nightLight} onClick={controls.toggleNightLight} height={72} stacked icon={<BulbIcon size={20} />}>Night light</ControlButton>
            <SnapshotButton cam={cam} height={72} stacked />
          </div>
        </>
      )}

      <div style={{ ...section, marginTop: 18, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Eyebrow style={{ paddingBottom: 6 }}>TONIGHT</Eyebrow>
        <Tonight events={events} />
      </div>
    </>
  );
}

// ---- phone: 4b · nursery multi-cam ---------------------------------------

function StatusCard({ room, controls, since, nameWidth, pad = '14px 16px', titleSize = 18, children }) {
  return (
    <div style={{ ...cardStyle, padding: pad, display: 'flex', flexDirection: 'column', gap: titleSize > 18 ? 12 : 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: titleSize, color: 'var(--text-strong)' }}>{nursery.status.label}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{since}</span>
      </div>
      <LevelBars cams={room.cams} nameWidth={nameWidth} />
      {children}
      {controls ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 4 }}>
          <TalkButton controls={controls} height={controls.height} icon={false} />
          <ControlButton on={!!controls.lullaby} onClick={controls.toggleLullaby} height={controls.height} outline>Lullaby</ControlButton>
        </div>
      ) : null}
    </div>
  );
}

function MultiLive({ room }) {
  const controls = useControls(nursery.name);
  const section = { padding: '0 var(--lk-side)' };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 var(--lk-side) 4px' }}>
        <RoomSwitcher title={nursery.name} currentId={null} />
        <Pill>{room.cams.length} CAMS</Pill>
      </div>

      <div style={{ ...section, paddingTop: 8 }}>
        <VideoTile label={`Live video from ${room.main.name}`} height={236} fadeKey={room.main.id}>
          <FollowPill follow={room.follow} onToggle={room.toggleFollow} style={{ position: 'absolute', top: 10, left: 10 }} />
          {room.main.id === room.loudest.id ? (
            <Pill tone="warning" style={{ position: 'absolute', top: 12, right: 12 }}>HEARS SOUND</Pill>
          ) : null}
          <span style={{ position: 'absolute', bottom: 12, left: 12, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, color: 'var(--text-strong)' }}>
            {room.main.name}
          </span>
        </VideoTile>
      </div>

      <div style={{ ...section, paddingTop: 10, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {room.others.map((c) => (
          <SmallFeed key={c.id} name={c.name} loud={c.id === room.loudest.id} onPick={() => room.pick(c.id)} />
        ))}
      </div>

      {controls.lullaby ? (
        <div style={{ ...section, paddingTop: 14 }}>
          <LullabyCard controls={controls} camName={nursery.name} />
        </div>
      ) : null}

      <div style={{ ...section, paddingTop: 14 }}>
        <StatusCard room={room} since={nursery.status.by}>
          <div style={{ marginTop: 2 }}>
            <Segmented
              compact
              height={40}
              label="Audio"
              value={room.mix}
              onChange={room.setMix}
              options={[{ value: 'all', label: 'Hear all, mixed' }, { value: 'main', label: 'Main view only' }]}
            />
          </div>
        </StatusCard>
      </div>

      <div style={{ ...section, paddingTop: 12, paddingBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <TalkButton controls={controls} />
        <ControlButton on={!!controls.lullaby} onClick={controls.toggleLullaby} icon={<MusicIcon size={18} />}>Lullaby</ControlButton>
      </div>
    </>
  );
}

// ---- tablet + desktop ----------------------------------------------------

function WideLive({ room, layout }) {
  const s = useStore();
  const clock = useClock();
  const controls = { ...useControls(nursery.name), height: layout === 'desktop' ? 48 : 52 };
  const [tileRef, toggleFullscreen] = useFullscreen();
  const desktop = layout === 'desktop';
  const house = s.cameras.filter((c) => !c.room).slice(0, 3);

  const mainTile = (
    <VideoTile
      ref={tileRef}
      label={`Live video from ${room.main.name}`}
      height={desktop ? '26rem' : 'auto'}
      radius="var(--radius-xl)"
      fadeKey={room.main.id}
      style={desktop ? undefined : { flexGrow: 1, minHeight: 240 }}
    >
      {room.main.id === room.loudest.id ? (
        <Pill tone="warning" style={{ position: 'absolute', top: 14, right: 14, padding: '5px 12px' }}>HEARS SOUND</Pill>
      ) : null}
      <span style={{ position: 'absolute', bottom: 16, left: 18, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, color: 'var(--text-strong)' }}>
        {room.main.name}
      </span>
    </VideoTile>
  );

  const smallFeeds = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      {room.others.map((c) => (
        <SmallFeed
          key={c.id}
          name={c.name}
          loud={c.id === room.loudest.id}
          onPick={() => room.pick(c.id)}
          height={desktop ? '9rem' : 130}
          radius="var(--radius-lg)"
          strip={false}
        />
      ))}
    </div>
  );

  const side = (
    <>
      <StatusCard room={room} controls={controls} since={nursery.status.since} nameWidth={104} pad="18px 20px" titleSize={22} />
      {controls.lullaby ? <LullabyCard controls={controls} camName={nursery.name} /> : null}
      <div style={{ ...cardStyle, flexGrow: desktop ? 0 : 1, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Eyebrow style={{ paddingBottom: 6 }}>TONIGHT</Eyebrow>
        <Tonight events={desktop ? tonight.filter((e) => e.time !== '12:14 AM') : tonight} />
      </div>
    </>
  );

  if (!desktop) {
    return (
      <div style={{ flexGrow: 1, minHeight: '100dvh', boxSizing: 'border-box', padding: 28, display: 'flex', gap: 20 }}>
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={display(28)}>
              {nursery.name} <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0, color: 'var(--text-muted)' }}>{room.cams.length} cams</span>
            </h1>
            <FollowPill follow={room.follow} onToggle={room.toggleFollow} height={40} size={12} />
          </div>
          {mainTile}
          {smallFeeds}
        </div>
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>{side}</div>
      </div>
    );
  }

  return (
    <div style={{ boxSizing: 'border-box', padding: '28px 32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={display(30)}>{nursery.name}</h1>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{room.cams.length} cams · {clock}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <FollowPill follow={room.follow} onToggle={room.toggleFollow} height={40} size={12} />
          <button
            type="button"
            aria-label="Full screen"
            onClick={toggleFullscreen}
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FullscreenIcon size={16} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mainTile}
          {smallFeeds}
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{side}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={display(19, { letterSpacing: 0 })}>Around the house</h2>
          <a href={href('/cameras')} style={{ fontSize: 13, color: 'var(--text-body)' }}>All cameras</a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {house.map((c) => (
            <CameraTile key={c.id} cam={c} to={`/live/${c.id}`} height="8.5rem" radius="var(--radius-lg)" showDevice={false} strip={false} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- route ---------------------------------------------------------------

/** Live tab. `/live` is the nursery room; `/live/:id` is one camera. */
export function Live({ camId, scenario }) {
  const layout = useLayout();
  const s = useStore();
  const roomCam = nursery.cameras.find((c) => c.id === camId);
  const houseCam = s.cameras.find((c) => c.id === camId && !c.room);
  const room = useRoom(roomCam ? roomCam.id : null);

  // One camera: house cameras everywhere, room cameras on phones.
  const solo = houseCam || (layout === 'phone' ? roomCam : null);
  if (solo) {
    return (
      <Shell active={houseCam ? 'cameras' : 'live'}>
        <SoloLive key={solo.id} cam={solo} inRoom={!!roomCam} scenario={scenario} />
      </Shell>
    );
  }
  if (layout === 'phone') {
    return (
      <Shell active="live">
        <MultiLive room={room} />
      </Shell>
    );
  }
  return (
    <Shell active="live" wide>
      <WideLive room={room} layout={layout} />
    </Shell>
  );
}
