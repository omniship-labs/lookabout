import React from 'react';
import { announce } from '../lib/hooks.js';
import { navigate } from '../lib/router.js';
import { useStore } from '../lib/store.js';
import { detectOwnHub } from '../lib/hub.js';
import { getProviders, saveProviders } from '../lib/household.js';
import {
  FLOW_LIST, FLOW_TITLES, HEALTH_LABEL, confirmStep, getFlow, getHealth, getPlan, healthLine, healthLink, hubProgress, isFlow, stepsFor, turnOffRemote,
  verifyStep, worstFirst,
} from '../lib/setupFlows.js';
import { DEFAULT_HUB_NAME, DEFAULT_PORT, copyCommand, hubNameProblem, hubUrl, installCommand, portProblem, badUsb } from '../lib/hubInstall.js';
import { Wizard, CopyBox } from '../components/Wizard.jsx';
import { BackBar, Chip, Cta, Field, Group, Note, Page, Pill, Row, RowLink, RowText, Switch, display } from '../components/ui.jsx';

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

/** How the hub is set up: a verdict, then only what needs attention. The rest is one tap away. */
export function SetupHealth() {
  const { hub, loading } = useSetupHub();
  const [health, setHealth] = React.useState(null);
  const [problem, setProblem] = React.useState('');
  const [all, setAll] = React.useState(false);
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
        <BackBar to="/add/hub" title="Setup" />
        <Note size={13}>Sign in to a home hub as an admin first.</Note>
        <Cta href="#/add/hub">Sign in</Cta>
      </Page>
    );
  }
  const attention = health ? worstFirst(health.checks).filter((c) => c.state !== 'ok') : [];
  const shown = all ? worstFirst(health.checks) : attention;
  return (
    <Page gap={16}>
      <BackBar to="/add/hub" title="Setup" />
      {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : null}
      {health ? (
        <>
          <h2 style={display(22)}>{healthLine(health)}</h2>
          {shown.length ? (
            <Group>
              {shown.map((c) => {
                const to = healthLink(c);
                const row = (
                  <>
                    <RowText title={c.title} sub={c.detail} />
                    {c.state !== 'ok' ? <Pill small tone={toneFor[c.state]}>{HEALTH_LABEL[c.state]}</Pill> : null}
                  </>
                );
                return to && c.state !== 'ok' ? <Row key={c.id} to={to}>{row}</Row> : <Row key={c.id}>{row}</Row>;
              })}
            </Group>
          ) : null}
          <Chip active={all} onClick={() => setAll((v) => !v)}>{all ? 'Show only what needs attention' : 'Show every check'}</Chip>
          <h2 style={display(18)}>Set up</h2>
          <Group>
            <RowLink to="/setup/sign-in" title="Sign-in options" sub="Passwords, passkeys, Google, Apple" />
            <RowLink to="/setup/remote" title="Remote access" sub={(health.checks.find((c) => c.id === 'remote') || {}).detail} />
            <RowLink to="/setup/hub-install" title="Check the install" />
          </Group>
        </>
      ) : !problem ? <Note size={13}>Asking the hub…</Note> : null}
    </Page>
  );
}

/** Which ways of signing in are on. Each provider's guide is its own page. */
export function SignInMethods() {
  const { hub, loading } = useSetupHub();
  const [p, setP] = React.useState(null);
  const [problem, setProblem] = React.useState('');
  const load = React.useCallback(() => {
    if (hub) getProviders(hub).then(setP, (err) => setProblem(err.message));
  }, [hub]);
  React.useEffect(() => {
    load();
  }, [load]);
  const change = async (patch) => {
    setProblem('');
    try {
      await saveProviders(hub, patch);
      await load();
    } catch (err) {
      setProblem(err.message);
    }
  };
  if (loading) return null;
  if (!hub) return <Page><BackBar to="/setup" title="Sign-in options" /><Cta href="#/add/hub">Sign in</Cta></Page>;
  const state = (x) => (x.enabled ? 'On' : 'Not set up');
  return (
    <Page gap={16}>
      <BackBar to="/setup" title="Sign-in options" />
      {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : null}
      {p ? (
        <>
          <Group>
            <Row><RowText title="Passwords" /><Switch label="Passwords" checked={p.local.password} onChange={(on) => change({ local: { password: on } })} /></Row>
            <Row><RowText title="Passkeys" /><Switch label="Passkeys" checked={p.local.passkey} onChange={(on) => change({ local: { passkey: on } })} /></Row>
          </Group>
          <Note size={13}>Passwords can only be turned off once every admin has a passkey or a linked account.</Note>
          <Group>
            <RowLink to="/setup/google" title="Google" sub={state(p.google)} />
            <RowLink to="/setup/apple" title="Apple" sub={state(p.apple)} />
          </Group>
          {p.google.enabled ? <Chip onClick={() => change({ google: { enabled: false } })}>Turn off Google</Chip> : null}
          {p.apple.enabled ? <Chip onClick={() => change({ apple: { enabled: false } })}>Turn off Apple</Chip> : null}
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
  const on = !!remote && remote.detail.startsWith('On');
  return (
    <Page gap={16}>
      <BackBar to="/setup" title="Remote access" />
      <Note size={13}>{on ? remote.detail : 'Off. Turn it on only to watch from outside the house. Choose how:'}</Note>
      <Group>
        <RowLink to="/setup/remote-cloudflare" title="Cloudflare Tunnel" sub="Your own domain" />
        <RowLink to="/setup/remote-tailscale" title="Tailscale" sub="Private to your devices, or a public link" />
      </Group>
      {on ? (
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
      <BackBar to="/add" title="Install the hub" />
      <Note size={13}>For a Raspberry Pi 4 or 5 on your home network, running the 64-bit Raspberry Pi OS. This page only makes the commands to copy.</Note>
      <Field label="Name shown in Lookabout" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} error={nameProblem || undefined} />
      <details>
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', cursor: 'pointer' }}>More options</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
          <Field label="Port" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} error={bad || undefined} />
          <Field label="USB webcams on the Pi" monoFont size={14} value={usb} placeholder="/dev/video0" autoCapitalize="off" onChange={(e) => setUsb(e.target.value)}
            error={usbBad.length ? `Not a webcam address: ${usbBad.join(', ')}` : undefined} hint="Skip for ESP32 or network cameras."
          />
          <Field label="The Pi’s address" monoFont size={14} value={host} autoCapitalize="off" onChange={(e) => setHost(e.target.value)} />
        </div>
      </details>
      <CopyBox label="1 · ON YOUR COMPUTER, IN THE LOOKABOUT FOLDER" text={copyCommand(host.trim() || 'raspberrypi.local')} />
      {command ? <CopyBox label="2 · ON THE PI" text={`cd lookabout-hub && ${command}`} /> : <Note size={13} style={{ color: 'var(--osl-danger)' }}>Fix the fields above to get the command.</Note>}
      <CopyBox label="3 · OPEN IN A BROWSER" text={hubUrl(host.trim() || 'raspberrypi.local', Number(port) || DEFAULT_PORT)} />
      <Note size={13}>The installer builds the hub (several minutes on a Pi), then prints a setup code. Type it there to make the first admin.</Note>
      <Cta href="#/add/hub">I’ve done this</Cta>
    </Page>
  );
}
