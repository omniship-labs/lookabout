import React from 'react';
import { announce } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import {
  addGroup, cancelInvite, canShareWith, changeGroup, changeMember, getHousehold, getProviders, inviteMember, inviteMessage,
  levelOn, makePairingCode, memberLine, myAccount, problemText, removeGroup, removeMember, saveProviders, shareGroup, shareableGroups, withLevel,
} from '../lib/household.js';
import { BackBar, Chip, Cta, Field, Group, Note, Page, Row, RowText, Spacer, Switch, display } from '../components/ui.jsx';

const levelOptions = [['', 'None'], ['view', 'View'], ['manage', 'Manage']];

/** One member, opened: role, what they may see per group, an app pairing code, remove. */
function MemberEditor({ hub, member, household, run }) {
  const [code, setCode] = React.useState('');
  const groups = household.groups;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0 12px' }}>
      {member.status === 'active' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label={`Role of ${member.email}`}>
          {['member', 'admin'].map((role) => (
            <Chip key={role} active={member.role === role} onClick={run(() => changeMember(hub, member.id, { role }), 'Role changed')}>
              {role === 'admin' ? 'Admin' : 'Member'}
            </Chip>
          ))}
        </div>
      ) : null}
      {member.role !== 'admin' ? groups.map((g) => (
        <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} role="group" aria-label={`${g.name} for ${member.email}`}>
          <span style={{ fontSize: 14, color: 'var(--text-strong)', minWidth: 90 }}>{g.name}</span>
          {levelOptions.map(([level, label]) => (
            <Chip key={level || 'none'} height={32} active={levelOn(member, g.id) === level}
              onClick={run(() => changeMember(hub, member.id, { grants: withLevel(member, g.id, level) }), 'Saved')}
            >
              {label}
            </Chip>
          ))}
        </div>
      )) : <Note size={13}>Admins see every camera.</Note>}
      {!groups.length && member.role !== 'admin' ? <Note size={13}>Make a camera group below to give this person cameras.</Note> : null}
      {member.status === 'active' ? (
        <>
          <Cta variant="outline" onClick={run(async () => setCode((await makePairingCode(hub, member.id)).code))}>Make a code for their phone</Cta>
          {code ? <Note size={13}>Code for {member.email}: <b>{code}</b>. It works once, for five minutes, in the Lookabout app.</Note> : null}
        </>
      ) : null}
      <Cta variant="outline" style={{ color: 'var(--osl-danger)' }}
        onClick={run(() => (member.status === 'invited' ? cancelInvite(hub, member.id) : removeMember(hub, member.id)),
          member.status === 'invited' ? 'Invite cancelled' : 'Removed')}
      >
        {member.status === 'invited' ? 'Cancel invite' : 'Remove from household'}
      </Cta>
    </div>
  );
}

function Invite({ hub, household, run }) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('member');
  const [picked, setPicked] = React.useState([]);
  const [link, setLink] = React.useState('');
  const toggle = (id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  return (
    <>
      <h2 style={display(18)}>Invite someone</h2>
      <Field label="Their email" type="email" value={email} autoCapitalize="off" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Role">
        <Chip active={role === 'member'} onClick={() => setRole('member')}>Member</Chip>
        <Chip active={role === 'admin'} onClick={() => setRole('admin')}>Admin</Chip>
      </div>
      {role === 'member' && household.groups.length ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Cameras they can watch">
          {household.groups.map((g) => <Chip key={g.id} active={picked.includes(g.id)} onClick={() => toggle(g.id)}>{g.name}</Chip>)}
        </div>
      ) : null}
      <Cta disabled={!email.includes('@')} onClick={run(async () => {
        const made = await inviteMember(hub, email.trim(), role, role === 'member' ? picked.map((group) => ({ group, level: 'view' })) : []);
        setLink(made.invite_link);
        setEmail('');
        setPicked([]);
      }, 'Invite made')}
      >
        Make an invite link
      </Cta>
      {link ? (
        <Group pad="12px 14px">
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>The hub sends no email. Pass this link on; it works once, for 7 days.</span>
          <code data-testid="invite-link" style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--text-strong)' }}>{link}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Chip onClick={() => navigator.clipboard && navigator.clipboard.writeText(link).then(() => announce('Link copied'), () => {})}>Copy</Chip>
            {navigator.share ? <Chip onClick={() => navigator.share({ text: inviteMessage(link) }).catch(() => {})}>Share</Chip> : null}
          </div>
        </Group>
      ) : null}
    </>
  );
}

function Groups({ hub, household, cameras, run }) {
  const [name, setName] = React.useState('');
  const [picked, setPicked] = React.useState([]);
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <>
      <h2 style={display(18)}>Camera groups</h2>
      <Note size={13}>A camera in no group is seen by admins only. People get a group as View or Manage.</Note>
      {household.groups.map((g) => (
        <Group key={g.id} pad="12px 14px">
          <RowText title={g.name} sub={g.cameras.length ? '' : 'No cameras yet'} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }} role="group" aria-label={`Cameras in ${g.name}`}>
            {cameras.map((c) => (
              <Chip key={c.id} height={32} active={g.cameras.includes(c.id)}
                onClick={run(() => changeGroup(hub, g.id, { cameras: toggle(g.cameras, c.id) }), 'Saved')}
              >
                {c.name}
              </Chip>
            ))}
          </div>
          <Chip onClick={run(() => removeGroup(hub, g.id), 'Group removed')}>Delete group</Chip>
        </Group>
      ))}
      <Field label="New group" value={name} placeholder="Nursery" maxLength={40} onChange={(e) => setName(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Cameras for the new group">
        {cameras.map((c) => <Chip key={c.id} height={32} active={picked.includes(c.id)} onClick={() => setPicked((now) => toggle(now, c.id))}>{c.name}</Chip>)}
      </div>
      <Cta variant="outline" disabled={!name.trim()} onClick={run(async () => {
        await addGroup(hub, name.trim(), picked);
        setName('');
        setPicked([]);
      }, 'Group made')}
      >
        Make the group
      </Cta>
    </>
  );
}

/** Admin only: the hub's public address and the Google and Apple keys the owner brings. */
function SignInOptions({ hub, run }) {
  const [p, setP] = React.useState(null);
  const [form, setForm] = React.useState({});
  const load = React.useCallback(() => getProviders(hub).then(setP, () => {}), [hub]);
  React.useEffect(() => {
    load();
  }, [load]);
  if (!p) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const save = (patch, done) => run(async () => {
    await saveProviders(hub, patch);
    setForm({});
    await load();
  }, done);
  const val = (key, fallback) => (form[key] !== undefined ? form[key] : fallback || '');
  return (
    <>
      <h2 style={display(18)}>Sign-in options</h2>
      <Field label="The hub’s public https address" value={val('public_url', p.public_url)} placeholder="https://hub.example.com" autoCapitalize="off"
        hint="Google and Apple only call back to https. Leave empty for a hub used at home only." onChange={(e) => set({ public_url: e.target.value })}
      />
      <Cta variant="outline" disabled={form.public_url === undefined} onClick={save({ public_url: form.public_url }, 'Address saved')}>Save address</Cta>
      <Group>
        <Row><RowText title="Passwords" sub="Needs a passkey or linked account for every admin to turn off" />
          <Switch label="Passwords" checked={p.local.password} onChange={(on) => run(() => saveProviders(hub, { local: { password: on } }).then(load), 'Saved')()} /></Row>
        <Row><RowText title="Passkeys" />
          <Switch label="Passkeys" checked={p.local.passkey} onChange={(on) => run(() => saveProviders(hub, { local: { passkey: on } }).then(load), 'Saved')()} /></Row>
      </Group>
      <h3 style={display(16)}>Google</h3>
      <Note size={13}>Your own Google Cloud OAuth client. Redirect address: {p.google.redirect_uri || 'set the public address first'}</Note>
      <Field label="Client ID" monoFont size={13} value={val('g_id', p.google.client_id)} autoCapitalize="off" spellCheck={false} onChange={(e) => set({ g_id: e.target.value })} />
      <Field label="Client secret" type="password" value={val('g_secret')} placeholder={p.google.has_secret ? 'Saved. Type to replace.' : ''} autoComplete="off" onChange={(e) => set({ g_secret: e.target.value })} />
      <Group><Row><RowText title="Continue with Google" />
        <Switch label="Google sign-in" checked={p.google.enabled} onChange={(on) => save({ google: { client_id: val('g_id', p.google.client_id), client_secret: form.g_secret || undefined, enabled: on } }, 'Saved')()} /></Row></Group>
      <Cta variant="outline" disabled={form.g_id === undefined && !form.g_secret} onClick={save({ google: { client_id: val('g_id', p.google.client_id), client_secret: form.g_secret || undefined } }, 'Saved')}>Save Google details</Cta>
      <h3 style={display(16)}>Apple</h3>
      <Note size={13}>Your own Apple developer Services ID and Sign in with Apple key. Redirect address: {p.apple.redirect_uri || 'set the public address first'}</Note>
      <Field label="Services ID" monoFont size={13} value={val('a_services', p.apple.services_id)} autoCapitalize="off" onChange={(e) => set({ a_services: e.target.value })} />
      <Field label="Team ID" monoFont size={13} value={val('a_team', p.apple.team_id)} autoCapitalize="off" onChange={(e) => set({ a_team: e.target.value })} />
      <Field label="Key ID" monoFont size={13} value={val('a_key_id', p.apple.key_id)} autoCapitalize="off" onChange={(e) => set({ a_key_id: e.target.value })} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="apple-key" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Key (.p8 file contents)</label>
        <textarea id="apple-key" rows={4} value={val('a_key')} placeholder={p.apple.has_key ? 'Saved. Paste to replace.' : '-----BEGIN PRIVATE KEY-----'}
          onChange={(e) => set({ a_key: e.target.value })}
          style={{ font: '12px var(--font-mono)', padding: 10, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-card)', color: 'var(--text-strong)' }}
        />
      </div>
      <Group><Row><RowText title="Continue with Apple" />
        <Switch label="Apple sign-in" checked={p.apple.enabled} onChange={(on) => save({ apple: { enabled: on } }, 'Saved')()} /></Row></Group>
      <Cta variant="outline" disabled={!['a_services', 'a_team', 'a_key_id', 'a_key'].some((k) => form[k])} onClick={save({ apple: {
        services_id: val('a_services', p.apple.services_id), team_id: val('a_team', p.apple.team_id), key_id: val('a_key_id', p.apple.key_id), key: form.a_key || undefined } }, 'Saved')}
      >
        Save Apple details
      </Cta>
    </>
  );
}

/** Who is in the household and what each person may see. Admins change it; managers share the groups they manage. */
export function Household() {
  const s = useStore();
  const hub = s.hub;
  const [data, setData] = React.useState(null);
  const [open, setOpen] = React.useState('');
  const [problem, setProblem] = React.useState('');
  const [me, setMe] = React.useState(null);
  const admin = !!hub && !!hub.member && hub.member.role === 'admin';

  const load = React.useCallback(async () => {
    if (!hub) return;
    try {
      setData(await getHousehold(hub));
      setMe(await myAccount(hub));
    } catch (err) {
      setProblem(problemText(err));
    }
  }, [hub]);
  React.useEffect(() => {
    load();
  }, [load]);

  // Runs a change, says what happened, and reloads. `fn` may be given directly or as the thing to run on click.
  const run = (fn, done) => async () => {
    setProblem('');
    try {
      await fn();
      if (done) announce(done);
      await load();
    } catch (err) {
      setProblem(problemText(err));
    }
  };

  if (!hub) {
    return (
      <Page>
        <BackBar to="/add/hub" title="Household" />
        <Note size={13}>Sign in to a home hub first.</Note>
        <Cta href="#/add/hub">Sign in to a hub</Cta>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page>
        <BackBar to="/add/hub" title="Household" />
        {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : <Note size={13}>Asking the hub…</Note>}
      </Page>
    );
  }

  return (
    <Page gap={16}>
      <BackBar to="/add/hub" title="Household" />
      <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{data.household.name}</span>
      {problem ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{problem}</Note> : null}

      <h2 style={display(18)}>People</h2>
      <Group>
        {data.members.map((m) => (
          <React.Fragment key={m.id}>
            <Row onClick={admin ? () => setOpen(open === m.id ? '' : m.id) : undefined} aria-expanded={admin ? open === m.id : undefined}>
              <RowText title={m.name || m.email} sub={admin ? memberLine(m, data.groups) : m.role === 'admin' ? 'Admin' : 'Member'} />
              {admin ? <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open === m.id ? 'Close' : 'Edit'}</span> : null}
            </Row>
            {admin && open === m.id ? <MemberEditor hub={hub} member={m} household={data} run={run} /> : null}
          </React.Fragment>
        ))}
      </Group>

      {admin ? (
        <>
          <Invite hub={hub} household={data} run={run} />
          <Groups hub={hub} household={data} cameras={s.hubCameras} run={run} />
          <SignInOptions hub={hub} run={run} />
        </>
      ) : (
        <ShareGroups hub={hub} me={me} household={data} run={run} />
      )}
      <Spacer />
    </Page>
  );
}

/** A manager gives other members a view of a group they manage. */
function ShareGroups({ hub, me, household, run }) {
  const groups = shareableGroups(me || {});
  const [who, setWho] = React.useState('');
  if (!groups.length) return <Note size={13}>You can see the groups above. Only an admin changes who is in the household.</Note>;
  const others = household.members.filter((m) => m.id !== hub.member.id && m.role !== 'admin');
  return (
    <>
      <h2 style={display(18)}>Share a group</h2>
      <Note size={13}>You manage these groups. Sharing gives someone view access only.</Note>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Share with">
        {others.map((m) => <Chip key={m.id} active={who === m.id} onClick={() => setWho(m.id)}>{m.name || m.id}</Chip>)}
      </div>
      {groups.map((g) => (
        <Cta key={g.id} variant="outline" disabled={!who} onClick={run(() => shareGroup(hub, g.id, who), 'Shared')}>Share {g.name}</Cta>
      ))}
    </>
  );
}
