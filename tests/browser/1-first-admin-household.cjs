const { chromium } = require('playwright');
const SCR = process.env.SCR;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('lookabout-splash', '1'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${SCR}/fail-${name.replace(/\W+/g, '_')}.png` }); throw e; } };
  const base = 'http://localhost:8799';
  await step('hub page opens the app', async () => {
    await page.goto(base + '/#/add/hub');
    await page.getByRole('heading', { name: 'Sign in to Smoke hub' }).waitFor({ timeout: 5000 });
  });
  await step('first-admin form shows the setup code', async () => {
    await page.getByLabel('Setup code').waitFor();
    const v = await page.getByLabel('Setup code').inputValue();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(v)) throw new Error('code was ' + v);
  });
  await step('weak password is flagged', async () => {
    await page.getByLabel('Your name').fill('Sam');
    await page.getByLabel('Email').fill('sam@example.com');
    await page.getByLabel('Choose a password').fill('short');
    await page.getByText('Use at least 10 characters.').waitFor();
    if (await page.getByRole('button', { name: 'Make the first admin' }).isEnabled()) throw new Error('button enabled');
  });
  await step('first admin is made and signed in', async () => {
    await page.getByLabel('Choose a password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Make the first admin' }).click();
    await page.getByText('Home hub recording').waitFor({ timeout: 8000 });
  });
  await page.screenshot({ path: `${SCR}/1-signed-in.png` });
  await step('the home hub page is a short menu', async () => {
    await page.goto(base + '/#/add/hub');
    await page.getByRole('heading', { name: 'Smoke hub' }).waitFor();
    for (const t of ['Cameras', 'Household', 'Your account', 'Setup']) await page.getByRole('link', { name: new RegExp(t) }).first().waitFor();
  });
  await page.screenshot({ path: `${SCR}/1b-home-hub.png` });
  await step('household is people first, with two more places to go', async () => {
    await page.goto(base + '/#/household');
    await page.getByRole('heading', { name: 'Household' }).waitFor();
    await page.getByRole('link', { name: 'Invite someone' }).waitFor();
    await page.getByRole('link', { name: /Camera groups/ }).waitFor();
    await page.getByRole('link', { name: /Sign-in options/ }).waitFor();
    if (await page.getByLabel('New group').count()) throw new Error('group form is on the people page');
  });
  await page.screenshot({ path: `${SCR}/2a-household.png` });
  await step('make a group on its own screen', async () => {
    await page.getByRole('link', { name: /Camera groups/ }).click();
    await page.getByRole('link', { name: 'New group' }).click();
    await page.getByLabel('Name').fill('Nursery');
    await page.getByRole('button', { name: 'Make the group' }).click();
    await page.getByRole('link', { name: /Nursery/ }).waitFor();
  });
  let link = '';
  await step('invite someone and get a link on its own screen', async () => {
    await page.goto(base + '/#/household/invite');
    await page.getByLabel('Their email').fill('vera@example.com');
    await page.getByRole('button', { name: 'Nursery' }).click();
    await page.getByRole('button', { name: 'Make an invite link' }).click();
    link = await page.getByTestId('invite-link').innerText();
    if (!link.includes('#/join?invite=')) throw new Error('link ' + link);
  });
  await page.screenshot({ path: `${SCR}/2b-invite-made.png` });
  await step('the invited person is one tap away, with role and group access', async () => {
    await page.goto(base + '/#/household');
    await page.getByText('Invited, hasn’t joined yet').waitFor();
    await page.getByRole('link', { name: /vera@example.com/ }).click();
    await page.getByRole('heading', { name: 'vera@example.com' }).waitFor();
    await page.getByRole('group', { name: 'Nursery for vera@example.com' }).getByRole('button', { name: 'View' }).waitFor();
  });
  await page.screenshot({ path: `${SCR}/2c-member.png` });
  await step('account is a short menu; password is its own screen', async () => {
    await page.goto(base + '/#/account');
    await page.getByRole('heading', { name: 'Your account' }).waitFor();
    for (const t of ['Passkeys', 'Password', 'Signed-in devices']) await page.getByRole('link', { name: new RegExp(t) }).waitFor();
    await page.screenshot({ path: `${SCR}/3a-account.png` });
    await page.getByRole('link', { name: /^Password/ }).click();
    await page.getByLabel('Current password').fill('not it at all');
    await page.getByLabel('New password').fill('another long password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByText("That isn't your current password.").waitFor();
  });
  await page.screenshot({ path: `${SCR}/3b-password.png` });
  require('fs').writeFileSync(`${SCR}/invite.txt`, link);
  console.log('page errors:', errors.length ? errors : 'none');
  await ctx.storageState({ path: `${SCR}/admin-state.json` });
  await browser.close();
})().catch((e) => { console.log('stopped:', e.message.split('\n')[0]); process.exit(1); });
