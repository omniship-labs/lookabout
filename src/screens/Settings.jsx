import React from 'react';
import { ProjectByline } from '@omniship-labs/design-beacon/ProjectByline';
import { setState, updateCamera, updateViewer, useStore } from '../lib/store.js';
import { BackBar, Chip, Eyebrow, Group, Note, Page, Row, RowText, Segmented, Spacer, Switch, display } from '../components/ui.jsx';
import { Shell } from '../components/viewer.jsx';

const cycle = (list, current) => list[(list.indexOf(current) + 1) % list.length];

function Section({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <Group>{children}</Group>
    </div>
  );
}

function Toggle({ title, sub, field }) {
  const s = useStore();
  return (
    <Row>
      <RowText title={title} sub={sub} />
      <Switch label={title} checked={s[field]} onChange={(v) => setState({ [field]: v })} />
    </Row>
  );
}

function Value({ title, sub, value, to, onClick }) {
  return (
    <Row to={to} onClick={onClick}>
      <RowText title={title} sub={sub} />
      <span style={{ flexShrink: 0, fontSize: 14, color: 'var(--text-muted)' }}>{value}</span>
    </Row>
  );
}

/** 6 · Alerts & settings. Appearance here applies to the whole app. */
export function Settings() {
  const s = useStore();
  const cams = s.devices.cameras.length;
  const viewers = s.devices.viewers.length;
  return (
    <Shell active="alerts">
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: '0 var(--lk-side) 20px' }}>
        <h1 style={display(26, { marginBottom: 4 })}>Alerts &amp; settings</h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>APPEARANCE</Eyebrow>
          <Segmented
            label="Appearance"
            height={40}
            value={s.theme}
            onChange={(theme) => setState({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>

        <Section label="BABY MONITOR">
          <Toggle title="Cry detection" sub="Alert after 20 s of crying" field="cryDetection" />
          <Value
            title="Sensitivity"
            sub="Ignores fan and white noise"
            value={s.sensitivity}
            onClick={() => setState({ sensitivity: cycle(['Low', 'Medium', 'High'], s.sensitivity) })}
          />
          <Toggle title="Keep audio on in background" sub="Hear the room with the app closed" field="backgroundAudio" />
        </Section>

        <Section label="SECURITY CAMERAS">
          <Toggle title="Motion alerts" sub="Only inside drawn zones" field="motionAlerts" />
          <Value title="Motion zones" sub="Front door 2 · Driveway 1" value="Edit" to="/zones" />
          <Value title="Quiet hours" sub="Indoor cams pause when you are home" value="7 AM – 6 PM" />
        </Section>

        <Section label="RECORDING">
          <Value title="Home hub" sub="Live view works without it" value={!s.hubPaired ? 'Set up' : s.hubReachable ? 'Connected' : 'Not reachable'} to="/add/hub" />
          <Value
            title="Keep clips for"
            sub="Oldest clips delete first"
            value={`${s.keepDays} days`}
            onClick={() => setState({ keepDays: cycle([7, 14, 30], s.keepDays) })}
          />
        </Section>

        <Section label="PRIVACY">
          <Toggle title="End-to-end encryption" sub="Keys stay on your devices" field="e2e" />
          <Value title="Paired devices" sub={`${cams} cameras · ${viewers} viewers`} value="Manage" to="/devices" />
          <Value title="Camera firmware" sub="Flash or update ESP32 cameras" value="Open" to="/flash" />
        </Section>

        <Spacer />

        <ProjectByline variant="app-about" style={{ padding: '12px 0 8px' }} />
      </div>
    </Shell>
  );
}

function DeviceRow({ item, onRemove, onRename }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.t);
  const save = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== item.t) onRename(name);
    else setDraft(item.t);
  };
  return (
    <Row minHeight={60} style={{ padding: 0 }}>
      {editing ? (
        <input
          autoFocus
          aria-label={`Rename ${item.t}`}
          value={draft}
          maxLength={24}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          style={{
            flexGrow: 1,
            minWidth: 0,
            height: 40,
            boxSizing: 'border-box',
            padding: '0 12px',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            font: '500 14px var(--font-sans)',
            color: 'var(--text-strong)',
          }}
        />
      ) : (
        <RowText title={item.t} sub={item.s} weight={600} />
      )}
      <Chip onClick={item.a === 'Remove' ? onRemove : () => setEditing(true)}>{item.a}</Chip>
    </Row>
  );
}

/** Paired devices: cameras and viewers that hold a key. */
export function Devices() {
  const s = useStore();
  // Rename (a name) or remove (null). With a hub paired this happens on the hub.
  const update = (group, id, name) => (group === 'cameras' ? updateCamera(id, name) : updateViewer(id, name));
  const groups = [
    { key: 'cameras', label: 'CAMERAS' },
    { key: 'viewers', label: 'VIEWERS' },
  ];
  return (
    <Page gap={14}>
      <BackBar to="/settings" title="Paired devices" />
      {groups.map((g) => (
        <React.Fragment key={g.key}>
          <Eyebrow style={{ paddingTop: 4 }}>{g.label}</Eyebrow>
          <Group>
            {!s.devices[g.key].length ? (
              <Row><RowText title={g.key === 'cameras' ? 'No cameras yet' : 'No viewers yet'} muted /></Row>
            ) : null}
            {s.devices[g.key].map((item) => (
              <DeviceRow
                key={item.id}
                item={item}
                onRemove={() => update(g.key, item.id, null)}
                onRename={(t) => update(g.key, item.id, t)}
              />
            ))}
          </Group>
        </React.Fragment>
      ))}
      <Note>
        {s.hubPaired
          ? 'Removing a viewer deletes its key on the hub. It can’t watch again without a new pairing code.'
          : 'Removing a viewer deletes its key on every camera. It can’t watch again without a new pairing.'}
      </Note>
    </Page>
  );
}
