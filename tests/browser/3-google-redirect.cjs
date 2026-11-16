// Google before it is switched on: the wizard gates the switch, and an admin can still try the sign-in (a link).
// Runs against the hub script 1 made (same admin). No browser is needed for this one, and no Google account.
const base = 'http://localhost:8799';
(async () => {
  const login = await fetch(base + '/api/auth/login/local?app=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sam@example.com', password: 'correct horse battery' }),
  });
  const { token } = await login.json();
  const api = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie') || '' };
  };
  const wizard = (step, body) => api('POST', `/api/setup/google/${step}/verify`, body || {});
  let r = await wizard('public-url', { public_url: 'https://hub.example.test' });
  console.log('public address:', r.body.state);
  r = await api('PUT', '/api/setup/google/console', { state: 'passed' });
  console.log('console (manual):', r.body.state);
  r = await wizard('client', { client_id: '1234-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-fake' });
  console.log('client details:', r.body.state);
  r = await api('PUT', '/api/admin/auth/providers', { google: { enabled: true } });
  console.log('switch on before the wizard has passed:', r.status, '-', r.body.error);
  if (r.status !== 409) throw new Error('Google could be switched on early');
  r = await api('POST', '/api/me/link/google', { return_to: '/#/account' });
  const u = new URL(r.body.redirect || 'http://none/');
  console.log('admin test link goes to', u.origin + u.pathname);
  console.log('client_id', u.searchParams.get('client_id'), '| redirect_uri', u.searchParams.get('redirect_uri'), '| state?', !!u.searchParams.get('state'), '| challenge?', !!u.searchParams.get('code_challenge'));
  console.log('state cookie set:', /lk_oauth=/.test(r.cookie));
  if (u.hostname !== 'accounts.google.com') throw new Error('not sent to Google');
})().catch((e) => { console.log('stopped:', e.message); process.exit(1); });
