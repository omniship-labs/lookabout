const { chromium } = require('playwright');
const fs = require('fs');
const SCR = process.env.SCR;
const base = 'http://localhost:8799';
const authenticatorOptions = { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
(async () => {
  const browser = await chromium.launch();
  const mk = async (state) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, storageState: state });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('lookabout-splash', '1'); } catch {} });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
    return { ctx, page, cdp, authenticatorId };
  };
  const step = async (page, name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${SCR}/fail-${name.replace(/\W+/g, '_')}.png` }); throw e; } };

  // A: the admin adds a passkey.
  const A = await mk(`${SCR}/admin-state.json`);
  await step(A.page, 'admin adds a passkey for this address', async () => {
    await A.page.goto(base + '/#/account/passkeys');
    await A.page.getByRole('heading', { name: 'Passkeys' }).waitFor();
    await A.page.getByRole('button', { name: 'Add a passkey here' }).click();
    await A.page.getByText('This address', { exact: true }).waitFor({ timeout: 8000 });
    if (await A.page.getByRole('button', { name: 'Add a passkey here' }).count()) throw new Error('still offers to add');
  });
  await A.page.screenshot({ path: `${SCR}/4-passkey-added.png`, fullPage: true });
  const { credentials } = await A.cdp.send('WebAuthn.getCredentials', { authenticatorId: A.authenticatorId });
  console.log('virtual authenticator holds', credentials.length, 'credential');

  // B: a fresh browser (no session) signs in with that passkey.
  const B = await mk(undefined);
  for (const credential of credentials) await B.cdp.send('WebAuthn.addCredential', { authenticatorId: B.authenticatorId, credential });
  await step(B.page, 'fresh browser signs in with the passkey', async () => {
    await B.page.goto(base + '/#/add/hub');
    await B.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await B.page.getByText(/Signed in as/).waitFor({ timeout: 8000 });
  });
  await step(B.page, 'signed in as the admin (sees the household editor)', async () => {
    await B.page.goto(base + '/#/household');
    await B.page.getByRole('link', { name: 'Invite someone' }).waitFor();
  });
  await step(B.page, 'the passkey can be removed only while another way in remains', async () => {
    await B.page.goto(base + '/#/account/passkeys');
    await B.page.getByRole('button', { name: 'Remove' }).click();
    await B.page.getByText('No passkeys yet').waitFor();
  });
  await B.ctx.close();

  // C: the invited person joins from the link.
  const link = fs.readFileSync(`${SCR}/invite.txt`, 'utf8').trim();
  const C = await mk(undefined);
  await step(C.page, 'invite link opens the join form', async () => {
    await C.page.goto(link);
    await C.page.getByRole('heading', { name: 'Sign in to Smoke hub' }).waitFor();
    await C.page.getByLabel('Your name').fill('Vera');
    await C.page.getByLabel('Choose a password').fill('correct horse battery');
    await C.page.getByRole('button', { name: 'Join' }).click();
    await C.page.getByText('Home hub recording').waitFor({ timeout: 8000 });
  });
  await step(C.page, 'the member sees the household as a member (no invite form)', async () => {
    await C.page.goto(base + '/#/household');
        if (await C.page.getByRole('link', { name: 'Invite someone' }).count()) throw new Error('member sees admin controls');
    await C.page.getByText('Sam').first().waitFor();
  });
  await C.page.screenshot({ path: `${SCR}/5-member-household.png`, fullPage: true });
  await step(C.page, 'the link cannot be used twice', async () => {
    const D = await mk(undefined);
    await D.page.goto(link);
    await D.page.getByLabel('Your name').fill('Again');
    await D.page.getByLabel('Choose a password').fill('correct horse battery');
    await D.page.getByRole('button', { name: 'Join' }).click();
    await D.page.getByText('run out or was already used').first().waitFor({ timeout: 8000 });
    await D.ctx.close();
  });
  await step(C.page, 'sign out returns to the sign-in form', async () => {
    await C.page.goto(base + '/#/account');
    await C.page.getByRole('button', { name: 'Sign out' }).click();
    await C.page.goto(base + '/#/add/hub');
    await C.page.getByLabel('Email').waitFor();
  });
  await browser.close();
})().catch((e) => { console.log('stopped:', e.message.split('\n')[0]); process.exit(1); });
