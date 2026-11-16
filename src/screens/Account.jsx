import React from 'react';
import { announce } from '../lib/hooks.js';
import { setHub, unpairHub, useStore } from '../lib/store.js';
import { hubPasskeys, removePasskey } from '../lib/hub.js';
import { accessLine, passwordProblem } from '../lib/access.js';
import { addPasskey, passkeyAddressOk, passkeysSupported } from '../lib/passkey.js';
import { changePassword, linkProvider, myAccount, problemText, renameMe, signInOptions, unlinkProvider } from '../lib/household.js';
import { BackBar, Chip, Cta, Field, Group, Note, Page, Row, RowText, Spacer, display } from '../components/ui.jsx';

/** The signed-in person: name, password, passkeys, linked Google and Apple, devices, sign out. */
export function Account() {
  const s = useStore();
  const hub = s.hub;
  const [me, setMe] = React.useState(null);
  const [passkeys, setPasskeys] = React.useState({ passkeys: [], this_address: '' });
  const [providers, setProviders] = React.useState([]);
  const [name, setName] = React.useState('');
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [problem, setProblem] = React.useState('');

  const load = React.useCallback(async () => {
    if (!hub) return;
    try {
      const [mine, keys, options] = await Promise.all([myAccount(hub), hubPasskeys(hub), signInOptions(hub.address)]);
      setMe(mine);
      setName((was) => was || mine.member.name);
      setPasskeys(keys);
      setProviders(options.providers.filter((p) => p.id === 'google' || p.id === 'apple'));
    } catch (err) {
      setProblem(problemText(err));
    }
  }, [hub]);
  React.useEffect(() => {
    load();
  }, [load]);

  const act = (what, fn, done) => async () => {
    setBusy(what);
    setProblem('');
    try {
      await fn();
      if (done) announce(done);
      await load();
    } catch (err) {
      setProblem(problemText(err));
    }
    setBusy('');
  };

  if (!hub) {
    return (
      <Page>
        <BackBar to="/add/hub" title="Your account" />
        <Note size={13}>Sign in to a home hub first.</Note>
        <Cta href="#/add/hub">Sign in to a hub</Cta>
      </Page>
    );
  }

  const here = passkeys.this_address;
  const hasHere = passkeys.passkeys.some((p) => p.rp_id === here);
  const canAddPasskey = passkeysSupported() && passkeyAddressOk(here) && !hasHere;
  const newProblem = next ? passwordProblem(next) : '';

  return (
    <Page gap={16}>
      <BackBar to="/add/hub" title="Your account" />
      {me ? <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{me.member.email} · {accessLine(me)}</span> : null}
      {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : null}

      <h2 style={display(18)}>Name</h2>
      <Field label="Your name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <Cta variant="outline" disabled={!name.trim() || busy === 'name'} onClick={act('name', async () => {
        await renameMe(hub, name.trim());
        setHub({ ...hub, member: { ...hub.member, name: name.trim() } });
      }, 'Name saved')}
      >
        Save name
      </Cta>

      <h2 style={display(18)}>Password</h2>
      <Field label="Current password" type="password" value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
      <Field
        label="New password"
        type="password"
        value={next}
        autoComplete="new-password"
        onChange={(e) => setNext(e.target.value)}
        hint="At least 10 characters. 14 or more counts as strong enough for remote access."
        error={newProblem || undefined}
      />
      <Cta variant="outline" disabled={!current || !next || !!newProblem || busy === 'password'} onClick={act('password', async () => {
        await changePassword(hub, current, next);
        setCurrent('');
        setNext('');
      }, 'Password changed')}
      >
        Change password
      </Cta>

      <h2 style={display(18)}>Passkeys</h2>
      <Note size={13}>A passkey signs you in with your fingerprint, face or screen lock. Each one works on one address of the hub.</Note>
      <Group>
        {passkeys.passkeys.length ? passkeys.passkeys.map((p) => (
          <Row key={p.id}>
            <RowText title={p.name} sub={`Works on ${p.rp_id}${p.rp_id === here ? ' (this address)' : ''}`} />
            <Chip onClick={act(`rm-${p.id}`, () => removePasskey(hub, p.id), 'Passkey removed')}>Remove</Chip>
          </Row>
        )) : <Row><RowText title="No passkeys yet" muted /></Row>}
      </Group>
      {canAddPasskey ? (
        <Cta variant="outline" disabled={busy === 'passkey'} onClick={act('passkey', () => addPasskey(hub, ''), 'Passkey added')}>
          Add a passkey for this address
        </Cta>
      ) : (
        <Note size={13}>
          {!passkeysSupported() ? 'This browser can’t make passkeys.'
            : !passkeyAddressOk(here) ? 'Passkeys need the hub’s name (such as raspberrypi.local), not its IP address. Open the hub by name to add one.'
              : 'You already have a passkey for this address.'}
        </Note>
      )}

      {providers.length ? (
        <>
          <h2 style={display(18)}>Linked sign-ins</h2>
          <Group>
            {providers.map((p) => {
              const email = me && me.sign_in[p.id];
              return (
                <Row key={p.id}>
                  <RowText title={p.id === 'google' ? 'Google' : 'Apple'} sub={email || 'Not linked'} />
                  {email ? (
                    <Chip onClick={act(`un-${p.id}`, () => unlinkProvider(hub, p.id), 'Unlinked')}>Unlink</Chip>
                  ) : (
                    <Chip onClick={act(`link-${p.id}`, async () => {
                      const { redirect } = await linkProvider(hub, p.id);
                      window.location.href = redirect;
                    })}
                    >
                      Link
                    </Chip>
                  )}
                </Row>
              );
            })}
          </Group>
        </>
      ) : null}

      <Group>
        <Row to="/devices"><RowText title="Signed-in devices" sub="See where you’re signed in and sign other devices out" /></Row>
      </Group>
      <Spacer />
      <Cta variant="outline" disabled={busy === 'out'} onClick={act('out', unpairHub)}>Sign out of this hub</Cta>
    </Page>
  );
}
