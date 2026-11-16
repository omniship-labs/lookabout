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
  await step('household lists the admin', async () => {
    await page.goto(base + '/#/household');
    await page.getByRole('heading', { name: 'Household' }).waitFor();
    await page.getByText('Admin', { exact: true }).first().waitFor();
  });
  await step('make a group', async () => {
    await page.getByLabel('New group', { exact: true }).fill('Nursery');
    await page.getByRole('button', { name: 'Make the group' }).click();
    await page.getByText('No cameras yet').first().waitFor();
  });
  let link = '';
  await step('invite someone and get a link', async () => {
    await page.getByLabel('Their email').fill('vera@example.com');
    await page.getByRole('button', { name: 'Nursery' }).first().click();
    await page.getByRole('button', { name: 'Make an invite link' }).click();
    link = await page.getByTestId('invite-link').innerText();
    if (!link.includes('#/join?invite=')) throw new Error('link ' + link);
  });
  await page.screenshot({ path: `${SCR}/2-household.png`, fullPage: true });
  await step('invited member shows as invited', async () => {
    await page.getByText('Invited, hasn’t joined yet').waitFor();
  });
  await step('account page loads with passkey section', async () => {
    await page.goto(base + '/#/account');
    await page.getByRole('heading', { name: 'Your account' }).waitFor();
    await page.getByText('No passkeys yet').waitFor();
  });
  await step('change password with wrong current is refused', async () => {
    await page.getByLabel('Current password').fill('not it at all');
    await page.getByLabel('New password').fill('another long password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByText("That isn't your current password.").waitFor();
  });
  await page.screenshot({ path: `${SCR}/3-account.png`, fullPage: true });
  require('fs').writeFileSync(`${SCR}/invite.txt`, link);
  console.log('page errors:', errors.length ? errors : 'none');
  await ctx.storageState({ path: `${SCR}/admin-state.json` });
  await browser.close();
})().catch((e) => { console.log('stopped:', e.message.split('\n')[0]); process.exit(1); });
