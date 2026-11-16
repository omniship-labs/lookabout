import React from 'react';
import { announce } from '../lib/hooks.js';
import { navigate } from '../lib/router.js';
import { useStore } from '../lib/store.js';
import { detectOwnHub } from '../lib/hub.js';
import { saveProviders } from '../lib/household.js';
import {
  FLOW_LIST, FLOW_TITLES, HEALTH_LABEL, confirmStep, getFlow, getHealth, getPlan, healthLine, healthLink, hubProgress, isFlow, stepsFor, turnOffRemote,
  verifyStep, worstFirst,
} from '../lib/setupFlows.js';
import { DEFAULT_HUB_NAME, DEFAULT_PORT, copyCommand, hubNameProblem, hubUrl, installCommand, portProblem, badUsb } from '../lib/hubInstall.js';
import { Wizard, CopyBox } from '../components/Wizard.jsx';
import { BackBar, Cta, Field, Group, Note, Page, Pill, Row, RowText, display } from '../components/ui.jsx';

/** The hub to talk to: the signed-in one, or (before anyone has signed in) the one serving this page. */
function useSetupHub() {
  const s = useStore();
  const [own, setOwn] = React.useState(undefined);
  React.useEffect(() => {
    let off = false;
    detectOwnHub(window.location.origin).then((found) => !off && setOwn(found));
    return () => {
      off = true;
    };
  }, []);
  if (s.hub) return { hub: s.hub, loading: false };
  if (own === undefined) return { hub: null, loading: true };
  return { hub: own ? { address: own.address, token: '', member: null } : null, loading: false };
}

const toneFor = { ok: 'success', warn: 'caution', bad: 'caution' };

/** G10: how the hub is set up, worst first, each row leading to what fixes it. */
export function SetupHealth() {
  const { hub, loading } = useSetupHub();
  const [health, setHealth] = React.useState(null);
  const [problem, setProblem] = React.useState('');
  const load = React.useCallback(() => {
    if (hub) getHealth(hub).then(setHealth, (err) => setProblem(err.message));
  }, [hub]);
  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;
  if (!hub) {
    return (
      <Page>
        <BackBar to="/add/hub" title="Setup health" />
        <Note size={13}>Sign in to a home hub as an admin first.</Note>
        <Cta href="#/add/hub">Sign in to a hub</Cta>
      </Page>
    );
  }
  return (
    <Page gap={16}>
      <BackBar to="/add/hub" title="Setup health" />
      {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : null}
      {health ? (
        <>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{healthLine(health)}</span>
          <Group>
            {worstFirst(health.checks).map((c) => {
              const to = healthLink(c);
              const row = (
                <>
                  <RowText title={c.title} sub={c.detail} />
                  <Pill small tone={toneFor[c.state]}>{HEALTH_LABEL[c.state]}</Pill>
                </>
              );
              return to && c.state !== 'ok' ? <Row key={c.id} to={to}>{row}</Row> : <Row key={c.id}>{row}</Row>;
            })}
          </Group>
          <h2 style={display(18)}>Setup guides</h2>
          <Group>
            {FLOW_LIST.map((f) => {
              const state = (health.flows.find((x) => x.flow === f.flow) || {}).state;
              return (
                <Row key={f.flow} to={`/setup/${f.flow === 'remote-cloudflare' || f.flow === 'remote-tailscale' ? 'remote' : f.flow}`}>
                  <RowText title={FLOW_TITLES[f.flow]} sub={f.blurb} />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{state === 'passed' ? 'Done' : state === 'failed' ? 'Needs a fix' : state === 'started' ? 'Started' : ''}</span>
                </Row>
              );
            })}
          </Group>
          <Cta variant="outline" onClick={load}>Check again</Cta>
        </>
      ) : !problem ? <Note size={13}>Asking the hub…</Note> : null}
    </Page>
  );
}

/** Which way to reach the hub from outside. */
export function RemoteChoice() {
  const { hub } = useSetupHub();
  const [health, setHealth] = React.useState(null);
  React.useEffect(() => {
    if (hub) getHealth(hub).then(setHealth, () => {});
  }, [hub]);
  const remote = health && health.checks.find((c) => c.id === 'remote');
  return (
    <Page gap={16}>
      <BackBar to="/setup" title="Remote access" />
      <Note size={13}>Off by default. Turn it on only if you want to watch from outside the house. Port forwarding on your router isn’t offered here: use one of these.</Note>
      {remote ? <Note size={13}>{remote.detail}</Note> : null}
      <Group>
        <Row to="/setup/remote-cloudflare"><RowText title="Cloudflare Tunnel" sub="Your own domain; no open ports at home" /></Row>
        <Row to="/setup/remote-tailscale"><RowText title="Tailscale" sub="Private to your devices, or a public link with Funnel" /></Row>
      </Group>
      {health && health.state !== undefined && remote && remote.detail.startsWith('On') ? (
        <Cta variant="outline" onClick={async () => {
          await turnOffRemote(hub);
          announce('Remote access is off');
          setHealth(await getHealth(hub));
        }}
        >
          Turn remote access off
        </Cta>
      ) : null}
    </Page>
  );
}

function fieldsBody(fields) {
  return ({ values, set }) => fields.map((f) => (f.multiline ? (
    <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={`f-${f.key}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{f.label}</label>
      <textarea id={`f-${f.key}`} rows={4} value={values[f.key] || ''} placeholder={f.placeholder} onChange={(e) => set({ [f.key]: e.target.value })}
        style={{ font: '12px var(--font-mono)', padding: 10, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-card)', color: 'var(--text-strong)' }}
      />
      {f.hint ? <Note>{f.hint}</Note> : null}
    </div>
  ) : (
    <Field key={f.key} label={f.label} type={f.secret ? 'password' : 'text'} monoFont={!!f.mono} size={f.mono ? 14 : 16} value={values[f.key] || ''}
      placeholder={f.placeholder} hint={f.hint} autoCapitalize="off" autoComplete="off" spellCheck={false} onChange={(e) => set({ [f.key]: e.target.value })}
    />
  )));
}

/** One setup wizard, with its progress kept on the hub. */
export function SetupFlow({ flow }) {
  const { hub, loading } = useSetupHub();
  const [loaded, setLoaded] = React.useState(null);
  const [problem, setProblem] = React.useState('');
  React.useEffect(() => {
    if (!hub || !isFlow(flow)) return undefined;
    let off = false;
    (async () => {
      try {
        const state = await getFlow(hub, flow);
        const defs = stepsFor(flow, {});
        const plans = {};
        await Promise.all(defs.map(async (d) => {
          const plan = await getPlan(hub, flow, d.id).catch(() => ({ contacts: [] }));
          plans[d.id] = plan.contacts;
        }));
        if (!off) setLoaded({ state, plans });
      } catch (err) {
        if (!off) setProblem(err.message);
      }
    })();
    return () => {
      off = true;
    };
  }, [hub, flow]);

  const steps = React.useMemo(() => {
    if (!loaded) return [];
    const api = { verify: (step, body) => verifyStep(hub, flow, step, body), confirm: (step) => confirmStep(hub, flow, step) };
    return stepsFor(flow, api, loaded.plans).map((step) => ({ ...step, body: step.fields ? fieldsBody(step.fields) : undefined }));
  }, [loaded, hub, flow]);
  const store = React.useMemo(() => (loaded ? hubProgress(loaded.state) : null), [loaded]);

  const finish = async () => {
    // The provider wizards end by switching the sign-in on (the hub only allows it now that they have passed).
    if (flow === 'google' || flow === 'apple') {
      try {
        await saveProviders(hub, flow === 'google' ? { google: { enabled: true } } : { apple: { enabled: true } });
        announce(`${FLOW_TITLES[flow]} is on`);
      } catch (err) {
        setProblem(err.message);
        return;
      }
    }
    navigate('/setup');
  };

  if (!isFlow(flow)) return <Page><BackBar to="/setup" title="Setup" /><Note size={13}>There is no such guide.</Note></Page>;
  if (loading) return null;
  if (!hub) {
    return (
      <Page>
        <BackBar to="/add/hub" title={FLOW_TITLES[flow]} />
        <Note size={13}>Sign in to a home hub as an admin first.</Note>
        <Cta href="#/add/hub">Sign in to a hub</Cta>
      </Page>
    );
  }
  return (
    <Page gap={16}>
      <BackBar to="/setup" title={FLOW_TITLES[flow]} />
      {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : null}
      {loaded ? <Wizard flow={flow} steps={steps} store={store} onDone={finish} /> : !problem ? <Note size={13}>Asking the hub…</Note> : null}
    </Page>
  );
}

/** G6, for the Pages site and before a hub exists: make the command to run on the Pi. Nothing here talks to a hub. */
export function InstallHub() {
  const [name, setName] = React.useState(DEFAULT_HUB_NAME);
  const [port, setPort] = React.useState(String(DEFAULT_PORT));
  const [usb, setUsb] = React.useState('');
  const [host, setHost] = React.useState('raspberrypi.local');
  const nameProblem = hubNameProblem(name);
  const bad = portProblem(port);
  const usbBad = badUsb(usb);
  const command = installCommand({ name, port, usb });
  return (
    <Page gap={16}>
      <BackBar to="/add" eyebrow="HOME HUB · INSTALL" />
      <h1 style={display(26, { lineHeight: 1.15 })}>Install the hub on a Raspberry Pi</h1>
      <Note size={13}>You need a Pi 4 or 5 with the 64-bit Raspberry Pi OS, on your home network. Nothing on this page talks to your Pi: it only makes the text to copy.</Note>
      <Field label="Name shown in Lookabout" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} error={nameProblem || undefined} />
      <Field label="Port" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} error={bad || undefined} hint="8787 is fine unless something else uses it." />
      <Field label="USB webcams plugged into the Pi (optional)" monoFont size={14} value={usb} placeholder="/dev/video0" autoCapitalize="off"
        onChange={(e) => setUsb(e.target.value)} error={usbBad.length ? `Not a webcam address: ${usbBad.join(', ')}` : undefined} hint="One or more, like /dev/video0. Skip it for ESP32 or network cameras."
      />
      <Field label="The Pi’s address" monoFont size={14} value={host} autoCapitalize="off" onChange={(e) => setHost(e.target.value)} />
      <h2 style={display(18)}>1. Copy the hub folder to the Pi</h2>
      <CopyBox label="ON YOUR COMPUTER, IN THE LOOKABOUT FOLDER" text={copyCommand(host.trim() || 'raspberrypi.local')} />
      <h2 style={display(18)}>2. Run the installer on the Pi</h2>
      <Note size={13}>It installs Docker if you add --install-docker (it says it is contacting get.docker.com first), builds the hub (several minutes on a Pi) and prints the address and a setup code.</Note>
      {command ? <CopyBox label="ON THE PI, IN lookabout-hub" text={`cd lookabout-hub && ${command}`} /> : <Note size={13} style={{ color: 'var(--osl-danger)' }}>Fix the fields above to get the command.</Note>}
      <h2 style={display(18)}>3. Open it</h2>
      <CopyBox label="IN A BROWSER ON YOUR NETWORK" text={hubUrl(host.trim() || 'raspberrypi.local', Number(port) || DEFAULT_PORT)} />
      <Note size={13}>Type the setup code the installer printed, and make the first admin account. Then Lookabout checks the install for you.</Note>
      <Cta href="#/add/hub">I’ve done this</Cta>
    </Page>
  );
}
