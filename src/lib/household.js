// The household on a hub: members, invites, camera groups and who may see which (docs/hub-auth.md).
// Calls and the small pieces of logic behind the Household and Account screens.

import { hubGet, hubSend } from './hub.js';

export const getHousehold = (hub) => hubGet(hub, '/api/household');
export const inviteMember = (hub, email, role, grants) => hubSend(hub, 'POST', '/api/household/invites', { email, role, grants });
export const cancelInvite = (hub, id) => hubSend(hub, 'DELETE', `/api/household/invites/${encodeURIComponent(id)}`);
export const changeMember = (hub, id, patch) => hubSend(hub, 'PATCH', `/api/household/members/${encodeURIComponent(id)}`, patch);
export const removeMember = (hub, id) => hubSend(hub, 'DELETE', `/api/household/members/${encodeURIComponent(id)}`);
export const addGroup = (hub, name, cameras) => hubSend(hub, 'POST', '/api/household/groups', { name, cameras });
export const changeGroup = (hub, id, patch) => hubSend(hub, 'PATCH', `/api/household/groups/${encodeURIComponent(id)}`, patch);
export const removeGroup = (hub, id) => hubSend(hub, 'DELETE', `/api/household/groups/${encodeURIComponent(id)}`);
export const shareGroup = (hub, groupId, memberId) => hubSend(hub, 'POST', `/api/groups/${encodeURIComponent(groupId)}/shares`, { member: memberId });
export const unshareGroup = (hub, groupId, memberId) =>
  hubSend(hub, 'DELETE', `/api/groups/${encodeURIComponent(groupId)}/shares/${encodeURIComponent(memberId)}`);
export const makePairingCode = (hub, memberId) => hubSend(hub, 'POST', '/api/pairing/code', { member: memberId });
export const getProviders = (hub) => hubGet(hub, '/api/admin/auth/providers');
export const saveProviders = (hub, patch) => hubSend(hub, 'PUT', '/api/admin/auth/providers', patch);
export const changePassword = (hub, current, next) => hubSend(hub, 'PUT', '/api/me/password', { current, new: next });
export const renameMe = (hub, name) => hubSend(hub, 'PATCH', '/api/me', { name });
export const myAccount = (hub) => hubGet(hub, '/api/me');
export const signInOptions = (address) => hubGet({ address, token: '' }, '/api/auth/providers');
export const linkProvider = (hub, provider, returnTo = '/#/account') =>
  hubSend(hub, 'POST', `/api/me/link/${provider}`, { return_to: returnTo });
export const unlinkProvider = (hub, provider) => hubSend(hub, 'DELETE', `/api/me/link/${provider}`);

/** The level a member has on a group: 'manage', 'view' or ''. */
export const levelOn = (member, groupId) => ((member.grants || []).find((g) => g.group === groupId) || {}).level || '';

/** A member's grants with one group set to `level` ('' takes it away). Gives the list the hub's PATCH takes. */
export function withLevel(member, groupId, level) {
  const others = (member.grants || []).filter((g) => g.group !== groupId).map((g) => ({ group: g.group, level: g.level }));
  return level ? [...others, { group: groupId, level }] : others;
}

/** The line under a member's name. */
export function memberLine(member, groups) {
  const when = member.status === 'invited' ? 'Invited, hasn’t joined yet' : member.role === 'admin' ? 'Admin · every camera' : '';
  if (when) return `${member.email} · ${when}`;
  const names = (member.grants || []).map((g) => {
    const group = groups.find((x) => x.id === g.group);
    return group ? (g.level === 'manage' ? `${group.name} (manage)` : group.name) : '';
  }).filter(Boolean);
  return `${member.email} · ${names.length ? names.join(', ') : 'No cameras yet'}`;
}

/** Groups a manager may share (they hold `manage` on them), from the member's own household answer. */
export const shareableGroups = (me) => (Array.isArray(me && me.groups) ? me.groups.filter((g) => g.level === 'manage') : []);

/** Members a group can still be shared with: active, not an admin, with no grant on it. Needs the admin's full answer. */
export const canShareWith = (household, groupId) =>
  household.members.filter((m) => m.status === 'active' && m.role !== 'admin' && !levelOn(m, groupId));

/** Sentences for what the hub's `code` means when a change is refused. */
export const problemText = (err) => (err && err.message) || 'That didn’t work.';

/** Words on the invite screen for an invite that was just made. */
export const inviteMessage = (link) => `You’re invited to our Lookabout hub. Open this link to join: ${link}`;
