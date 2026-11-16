import React from 'react';
import { announce } from '../lib/hooks.js';
import { setHub, unpairHub, useStore } from '../lib/store.js';
import { hubPasskeys, removePasskey } from '../lib/hub.js';
import { accessLine, passwordProblem } from '../lib/access.js';
import { addPasskey, passkeyAddressOk, passkeysSupported } from '../lib/passkey.js';
import { changePassword, linkProvider, myAccount, problemText, renameMe, signInOptions, unlinkProvider } from '../lib/household.js';
import { BackBar, Chip, Cta, Field, Group, Note, Page, Row, RowLink, RowText, Spacer } from '../components/ui.jsx';

// "Your account" is a short menu; each thing you can change is its own small screen.

/** What the account screens share: who you are, your passkeys, which sign-ins this hub offers. */
function useAccount() {
  const hub = useStore().hub;
  const [data, setData] = React.useState({ me: null, passkeys: { passkeys: [], this_address: '' }, providers: [] });
  const [problem, setProblem] = React.useState('');
  const load = React.useCallback(async () => {
    if (!hub) return;
    try {
      const [me, passkeys, options] = await Promise.all([myAccount(hub), hubPasskeys(hub), signInOptions(hub.address)]);
      setData({ me, passkeys, providers: options.providers.filter((p) => p.id === 'google' || p.id === 'apple') });
    } catch (err) {
      setProblem(problemText(err));
    }
  }, [hub]);
  React.useEffect(() => {
    load();
  }, [load]);
  // Runs a change, says how it went, and reloads. Returns true when it worked.
  const act = React.useCallback(async (fn, done) => {
    setProblem('');
    try {
      await fn();
      if (done) announce(done);
      await load();
      return true;
    } catch (err) {
      setProblem(problemText(err));
      return false;
    }
  }, [load]);
  return { hub, ...data, problem, act };
}

function NeedHub() {
  return (
    <Page>
      <BackBar to="/add/hub" title="Your account" />
      <Note size={13}>Sign in to a home hub first.</Note>
      <Cta href="#/add/hub">Sign in</Cta>
    </Page>
  );
}

const Problem = ({ text }) => (text ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{text}</Note> : null);

export function Account() {
  const { hub, me, passkeys, providers, problem, act } = useAccount();
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    if (me) setName((was) => was || me.member.name);
  }, [me]);
  if (!hub) return <NeedHub />;
  const here = passkeys.passkeys.filter((p) => p.rp_id === passkeys.this_address).length;
  const changed = me && name.trim() && name.trim() !== me.member.name;
  return (
    <Page gap={16}>
      <BackBar to="/add/hub" title="Your account" />
      <Problem text={problem} />
      <Field label="Your name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} hint={me ? `${me.member.email} · ${accessLine(me)}` : undefined} />
      {changed ? (
        <Cta variant="outline" onClick={() => act(async () => {
          await renameMe(hub, name.trim());
          setHub({ ...hub, member: { ...hub.member, name: name.trim() } });
        }, 'Name saved')}
        >
          Save name
        </Cta>
      ) : null}
      <Group>
        <RowLink to="/account/passkeys" title="Passkeys" sub={here ? 'Set up on this address' : passkeys.passkeys.length ? `${passkeys.passkeys.length} set up, none for this address` : 'None yet'} />
        <RowLink to="/account/password" title="Password" />
        {providers.length ? <RowLink to="/account/linked" title="Google and Apple" sub={me && (me.sign_in.google || me.sign_in.apple) ? 'Linked' : 'Not linked'} /> : null}
        <RowLink to="/devices" title="Signed-in devices" />
      </Group>
      <Spacer />
      <Cta variant="outline" onClick={() => act(unpairHub)}>Sign out</Cta>
    </Page>
  );
}

export function AccountPasskeys() {
  const { hub, passkeys, problem, act } = useAccount();
  if (!hub) return <NeedHub />;
  const here = passkeys.this_address;
  const hasHere = passkeys.passkeys.some((p) => p.rp_id === here);
  const can = passkeysSupported() && passkeyAddressOk(here) && !hasHere;
  return (
    <Page gap={16}>
      <BackBar to="/account" title="Passkeys" />
      <Note size={13}>Sign in with your fingerprint, face or screen lock. Each passkey works on one address of the hub.</Note>
      <Problem text={problem} />
      <Group>
        {passkeys.passkeys.length ? passkeys.passkeys.map((p) => (
          <Row key={p.id}>
            <RowText title={p.name} sub={p.rp_id === here ? 'This address' : p.rp_id} />
            <Chip onClick={() => act(() => removePasskey(hub, p.id), 'Passkey removed')}>Remove</Chip>
          </Row>
        )) : <Row><RowText title="No passkeys yet" muted /></Row>}
      </Group>
      {can ? <Cta onClick={() => act(() => addPasskey(hub, ''), 'Passkey added')}>Add a passkey here</Cta> : (
        <Note size={13}>
          {!passkeysSupported() ? 'This browser can’t make passkeys.'
            : !passkeyAddressOk(here) ? 'Open the hub by its name (such as raspberrypi.local), not its IP address, to add a passkey.'
              : 'You already have a passkey for this address.'}
        </Note>
      )}
    </Page>
  );
}

export function AccountPassword() {
  const { hub, problem, act } = useAccount();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  if (!hub) return <NeedHub />;
  const bad = next ? passwordProblem(next) : '';
  return (
    <Page gap={16}>
      <BackBar to="/account" title="Password" />
      <Problem text={problem} />
      <Field label="Current password" type="password" value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
      <Field label="New password" type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)}
        hint="10 or more characters. 14 or more is strong enough for remote access." error={bad || undefined}
      />
      <Cta disabled={!current || !next || !!bad} onClick={async () => {
        if (await act(() => changePassword(hub, current, next), 'Password changed')) {
          setCurrent('');
          setNext('');
        }
      }}
      >
        Change password
      </Cta>
    </Page>
  );
}

export function AccountLinked() {
  const { hub, me, providers, problem, act } = useAccount();
  if (!hub) return <NeedHub />;
  return (
    <Page gap={16}>
      <BackBar to="/account" title="Google and Apple" />
      <Note size={13}>Link an account to sign in with it. You always keep another way in.</Note>
      <Problem text={problem} />
      <Group>
        {providers.map((p) => {
          const email = me && me.sign_in[p.id];
          return (
            <Row key={p.id}>
              <RowText title={p.id === 'google' ? 'Google' : 'Apple'} sub={email || 'Not linked'} />
              {email ? (
                <Chip onClick={() => act(() => unlinkProvider(hub, p.id), 'Unlinked')}>Unlink</Chip>
              ) : (
                <Chip onClick={() => act(async () => {
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
    </Page>
  );
}
