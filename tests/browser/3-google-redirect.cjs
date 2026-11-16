const { chromium } = require('playwright');
const SCR = process.env.SCR; const base = 'http://localhost:8799';
(async () => {
  const browser = await chromium.launch();
  // Sign in as the admin script 1 made (fixed smoke-test credentials), rather than reading a token from a file.
  const login = await fetch(base + '/api/auth/login/local?app=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sam@example.com', password: 'correct horse battery' }),
  });
  const { token } = await login.json();
  const api = async (method, path, body) => (await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
  let r = await api('PUT', '/api/admin/auth/providers', { public_url: 'https://hub.example.test', google: { client_id: '1234-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-fake', enabled: true } });
  console.log('enable google via API:', r.status);
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('lookabout-splash', '1'); } catch {} });
  const page = await ctx.newPage();
  let seen = '';
  await page.route('https://accounts.google.com/**', (route) => { seen = route.request().url(); route.abort(); });
  await page.goto(base + '/#/add/hub');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForTimeout(1500);
  const u = new URL(seen || 'http://none/');
  console.log('browser was sent to', u.origin + u.pathname);
  console.log('client_id', u.searchParams.get('client_id'), '| redirect_uri', u.searchParams.get('redirect_uri'), '| state?', !!u.searchParams.get('state'), '| challenge?', !!u.searchParams.get('code_challenge'));
  const cookies = (await ctx.cookies()).map((c) => c.name);
  console.log('cookies set on the hub origin:', cookies);
  // The member-facing provider button must not show for someone not on a hub that has it on: Apple is off.
  console.log('apple button shown:', await page.getByRole('button', { name: 'Continue with Apple' }).count());
  await page.screenshot({ path: `${SCR}/6-signin-google.png` });
  await browser.close();
})().catch((e) => { console.log('stopped:', e.message.split('\n')[0]); process.exit(1); });
