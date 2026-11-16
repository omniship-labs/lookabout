// What the signed-in person may see and do, from the hub's `GET /api/me`
// (docs/hub-auth.md). This only decides what to show; the hub checks everything
// itself, and answers 404 for a camera the person can't see.

export const isAdmin = (me) => me?.member?.role === 'admin';

/** "manage", "view" or null for one camera. Admins manage every camera. */
export function accessOf(me, camId) {
  if (!me) return null;
  if (me.cameras === 'all') return 'manage';
  return (me.cameras && me.cameras[camId]) || null;
}

export const canManage = (me, camId) => accessOf(me, camId) === 'manage';

/** The cameras this person sees, with the level on each. */
export function visibleCameras(me, cameras) {
  return cameras.flatMap((c) => {
    const access = accessOf(me, c.id);
    return access ? [{ ...c, access }] : [];
  });
}

/** The line under a member's name: "Admin", or the groups they can open. */
export function accessLine(me) {
  if (!me) return '';
  if (isAdmin(me)) return 'Admin · every camera';
  const groups = Array.isArray(me.groups) ? me.groups : [];
  if (!groups.length) return 'No cameras shared with you yet';
  return groups.map((g) => (g.level === 'manage' ? `${g.name} (manage)` : g.name)).join(', ');
}

const COMMON = new Set(['password1234', '1234567890', 'qwertyuiop', '0123456789', 'password123', 'iloveyou123',
  'letmein1234', 'welcome1234', 'admin12345', 'changeme123', '11111111111', 'passw0rd123']);

/** The hub's password rules, to tell someone before they submit. '' when it's fine. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (COMMON.has(password.toLowerCase()) || new Set(password).size < 4) return 'That one is too easy to guess. Try a longer one.';
  return '';
}

/** Strong enough for remote access: 14 or more characters (a passkey counts too, once built). */
export const strongPassword = (password) => passwordProblem(password) === '' && password.length >= 14;

/** Access level a manager may give others (view only) and the level words people see. */
export const levelLabel = (level) => (level === 'manage' ? 'Can manage' : 'Can view');
