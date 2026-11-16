import React from 'react';
import { announce } from '../lib/hooks.js';
import { navigate } from '../lib/router.js';
import { useStore } from '../lib/store.js';
import {
  addGroup, cancelInvite, changeGroup, changeMember, getHousehold, inviteMember, inviteMessage, levelOn, makePairingCode, memberLine, myAccount,
  problemText, removeGroup, removeMember, shareGroup, shareableGroups, withLevel,
} from '../lib/household.js';
import { BackBar, Chip, Cta, Field, Group, Note, Page, Row, RowLink, RowText, Segmented, Spacer, display } from '../components/ui.jsx';

// The household is a short list of people. Everything you can do to someone, or to a group, is its own small screen.

function useHousehold() {
  const hub = useStore().hub;
  const [data, setData] = React.useState(null);
  const [me, setMe] = React.useState(null);
  const [problem, setProblem] = React.useState('');
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
  // Runs a change, says how it went and reloads. True when it worked.
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
  return { hub, data, me, problem, act, admin: !!hub && !!hub.member && hub.member.role === 'admin' };
}

const Problem = ({ text }) => (text ? <Note size={13} style={{ color: 'var(--osl-danger)' }}>{text}</Note> : null);

function Shell({ back, title, children, state }) {
  const { hub, data, problem } = state;
  return (
    <Page gap={16}>
      <BackBar to={back} title={title} />
      <Problem text={problem} />
      {!hub ? <><Note size={13}>Sign in to a home hub first.</Note><Cta href="#/add/hub">Sign in</Cta></>
        : !data ? (problem ? null : <Note size={13}>Asking the hub…</Note>) : children}
    </Page>
  );
}

/** The household: people first. */
export function Household() {
  const state = useHousehold();
  const { hub, data, me, act, admin } = state;
  return (
    <Shell back="/add/hub" title="Household" state={state}>
      {data ? (
        <>
          {admin ? <Cta href="#/household/invite">Invite someone</Cta> : null}
          <Group>
            {data.members.map((m) => (admin
              ? <RowLink key={m.id} to={`/household/member/${m.id}`} title={m.name || m.email} sub={memberLine(m, data.groups).replace(`${m.email} · `, '')} />
              : <Row key={m.id}><RowText title={m.name || m.id} sub={m.role === 'admin' ? 'Admin' : 'Member'} /></Row>))}
          </Group>
          {admin ? (
            <Group>
              <RowLink to="/household/groups" title="Camera groups" sub={data.groups.length ? `${data.groups.length} group${data.groups.length === 1 ? '' : 's'}` : 'Make one to share cameras'} />
              <RowLink to="/setup/sign-in" title="Sign-in options" sub="Passwords, passkeys, Google, Apple" />
            </Group>
          ) : <ShareGroups hub={hub} me={me} data={data} act={act} />}
        </>
      ) : null}
    </Shell>
  );
}

/** A manager gives someone a view of a group they manage. */
function ShareGroups({ hub, me, data, act }) {
  const groups = shareableGroups(me || {});
  const [who, setWho] = React.useState('');
  if (!groups.length) return <Note size={13}>Only an admin changes who is in the household.</Note>;
  const others = data.members.filter((m) => m.id !== hub.member.id && m.role !== 'admin');
  return (
    <>
      <h2 style={display(18)}>Share a group you manage</h2>
      <Note size={13}>They’ll be able to watch it, not change it.</Note>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Share with">
        {others.map((m) => <Chip key={m.id} active={who === m.id} onClick={() => setWho(m.id)}>{m.name || m.id}</Chip>)}
      </div>
      {groups.map((g) => <Cta key={g.id} variant="outline" disabled={!who} onClick={() => act(() => shareGroup(hub, g.id, who), 'Shared')}>Share {g.name}</Cta>)}
    </>
  );
}

const ROLES = [{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }];
const LEVELS = [{ value: '', label: 'None' }, { value: 'view', label: 'View' }, { value: 'manage', label: 'Manage' }];

/** One person: their role, which groups they can open, and the rarely-needed things below. */
export function HouseholdMember({ id }) {
  const state = useHousehold();
  const { hub, data, act } = state;
  const member = data && data.members.find((m) => m.id === id);
  const [code, setCode] = React.useState('');
  const [sure, setSure] = React.useState(false);
  return (
    <Shell back="/household" title={member ? member.name || member.email : 'Person'} state={state}>
      {data && !member ? <Note size={13}>They’re no longer in the household.</Note> : null}
      {member ? (
        <>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{member.email}{member.status === 'invited' ? ' · invited, hasn’t joined yet' : ''}</span>
          {member.status === 'active' ? (
            <Segmented label="Role" options={ROLES} value={member.role} onChange={(role) => act(() => changeMember(hub, member.id, { role }), 'Role changed')} />
          ) : null}
          {member.role === 'admin' ? <Note size={13}>Admins can see and change everything.</Note> : (
            <>
              <h2 style={display(18)}>Cameras they can open</h2>
              {data.groups.length ? data.groups.map((g) => (
                <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{g.name}</span>
                  <Segmented label={`${g.name} for ${member.email}`} compact height={36} options={LEVELS} value={levelOn(member, g.id)}
                    onChange={(level) => act(() => changeMember(hub, member.id, { grants: withLevel(member, g.id, level) }), 'Saved')}
                  />
                </div>
              )) : <Note size={13}>No camera groups yet. <a href="#/household/group/new">Make one</a> to share cameras.</Note>}
            </>
          )}
          {member.status === 'active' ? (
            <>
              <Cta variant="outline" onClick={async () => { await act(async () => setCode((await makePairingCode(hub, member.id)).code)); }}>Code for their phone</Cta>
              {code ? <Note size={13}>Type <b>{code}</b> in the Lookabout app within five minutes. It works once.</Note> : null}
            </>
          ) : null}
          <Spacer />
          {sure ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <Cta variant="outline" onClick={() => setSure(false)}>Keep</Cta>
              <Cta variant="outline" style={{ color: 'var(--osl-danger)' }} onClick={async () => {
                if (await act(() => (member.status === 'invited' ? cancelInvite(hub, member.id) : removeMember(hub, member.id)), 'Removed')) navigate('/household');
              }}
              >
                {member.status === 'invited' ? 'Cancel invite' : 'Remove'}
              </Cta>
            </div>
          ) : <Cta variant="outline" style={{ color: 'var(--osl-danger)' }} onClick={() => setSure(true)}>{member.status === 'invited' ? 'Cancel invite' : 'Remove from household'}</Cta>}
        </>
      ) : null}
    </Shell>
  );
}

/** Invite: an email, a role, and (for a member) which groups. Then the link to pass on. */
export function HouseholdInvite() {
  const state = useHousehold();
  const { hub, data, act } = state;
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('member');
  const [picked, setPicked] = React.useState([]);
  const [link, setLink] = React.useState('');
  const toggle = (id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  if (link) {
    return (
      <Page gap={16}>
        <BackBar to="/household" title="Invite made" />
        <Note size={13}>The hub sends no email. Pass this link on yourself: it works once, for 7 days.</Note>
        <Group pad="12px 14px"><code data-testid="invite-link" style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--text-strong)' }}>{link}</code></Group>
        <Cta onClick={() => navigator.clipboard && navigator.clipboard.writeText(link).then(() => announce('Link copied'), () => {})}>Copy link</Cta>
        {navigator.share ? <Cta variant="outline" onClick={() => navigator.share({ text: inviteMessage(link) }).catch(() => {})}>Share…</Cta> : null}
        <Cta variant="outline" href="#/household">Done</Cta>
      </Page>
    );
  }
  return (
    <Shell back="/household" title="Invite someone" state={state}>
      <Field label="Their email" type="email" value={email} autoCapitalize="off" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
      <Segmented label="Role" options={ROLES} value={role} onChange={setRole} />
      {role === 'member' && data && data.groups.length ? (
        <>
          <Note size={13}>Cameras they can watch (you can change this later):</Note>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Cameras they can watch">
            {data.groups.map((g) => <Chip key={g.id} active={picked.includes(g.id)} onClick={() => toggle(g.id)}>{g.name}</Chip>)}
          </div>
        </>
      ) : null}
      <Cta disabled={!email.includes('@')} onClick={async () => {
        let made;
        if (await act(async () => { made = await inviteMember(hub, email.trim(), role, role === 'member' ? picked.map((group) => ({ group, level: 'view' })) : []); })) setLink(made.invite_link);
      }}
      >
        Make an invite link
      </Cta>
    </Shell>
  );
}

/** Camera groups: a list. */
export function HouseholdGroups() {
  const state = useHousehold();
  const { data } = state;
  return (
    <Shell back="/household" title="Camera groups" state={state}>
      <Note size={13}>A camera in no group is seen by admins only. Give people a group as View or Manage.</Note>
      <Cta href="#/household/group/new">New group</Cta>
      {data && data.groups.length ? (
        <Group>
          {data.groups.map((g) => <RowLink key={g.id} to={`/household/group/${g.id}`} title={g.name} sub={g.cameras.length ? `${g.cameras.length} camera${g.cameras.length === 1 ? '' : 's'}` : 'No cameras yet'} />)}
        </Group>
      ) : null}
    </Shell>
  );
}

/** One group (or a new one): its name and which cameras are in it. */
export function HouseholdGroup({ id }) {
  const state = useHousehold();
  const { hub, data, act } = state;
  const cameras = useStore().hubCameras;
  const group = data && data.groups.find((g) => g.id === id);
  const fresh = id === 'new';
  const [name, setName] = React.useState('');
  const [picked, setPicked] = React.useState([]);
  const [sure, setSure] = React.useState(false);
  const toggle = (list, cam) => (list.includes(cam) ? list.filter((x) => x !== cam) : [...list, cam]);
  const list = (ids, set) => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Cameras in the group">
      {cameras.length ? cameras.map((c) => <Chip key={c.id} active={ids.includes(c.id)} onClick={() => set(c.id)}>{c.name}</Chip>) : <Note size={13}>The hub has no cameras yet.</Note>}
    </div>
  );
  return (
    <Shell back="/household/groups" title={fresh ? 'New group' : group ? group.name : 'Group'} state={state}>
      {fresh ? (
        <>
          <Field label="Name" value={name} placeholder="Nursery" maxLength={40} onChange={(e) => setName(e.target.value)} />
          <Note size={13}>Cameras in it:</Note>
          {list(picked, (cam) => setPicked((now) => toggle(now, cam)))}
          <Cta disabled={!name.trim()} onClick={async () => { if (await act(() => addGroup(hub, name.trim(), picked), 'Group made')) navigate('/household/groups'); }}>Make the group</Cta>
        </>
      ) : group ? (
        <>
          <Note size={13}>Tap a camera to add or remove it:</Note>
          {list(group.cameras, (cam) => act(() => changeGroup(hub, group.id, { cameras: toggle(group.cameras, cam) }), 'Saved'))}
          <Spacer />
          {sure ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <Cta variant="outline" onClick={() => setSure(false)}>Keep</Cta>
              <Cta variant="outline" style={{ color: 'var(--osl-danger)' }} onClick={async () => { if (await act(() => removeGroup(hub, group.id), 'Group removed')) navigate('/household/groups'); }}>Delete</Cta>
            </div>
          ) : <Cta variant="outline" style={{ color: 'var(--osl-danger)' }} onClick={() => setSure(true)}>Delete group</Cta>}
        </>
      ) : <Note size={13}>That group is gone.</Note>}
    </Shell>
  );
}
