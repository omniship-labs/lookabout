const { chromium } = require('playwright');
const SCR = process.env.SCR; const base = 'http://localhost:8799';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('lookabout-splash', '1'); } catch {} });
  const page = await ctx.newPage();
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); await page.screenshot({ path: `${SCR}/fail-${name.replace(/\W+/g, '_')}.png`, fullPage: true }); throw e; } };

  await step('install helper makes a command and refuses unsafe input', async () => {
    await page.goto(base + '/#/install');
    await page.getByRole('heading', { name: 'Install the hub' }).waitFor();
    await page.getByText('cd lookabout-hub && ./install.sh', { exact: true }).waitFor();
    await page.getByLabel('Name shown in Lookabout').fill('Shed hub');
    await page.getByText('More options').click();
    await page.getByLabel('Port').fill('9000');
    await page.getByLabel('USB webcams on the Pi').fill('/dev/video0');
    await page.getByText('cd lookabout-hub && ./install.sh --name "Shed hub" --port 9000 --usb /dev/video0', { exact: true }).waitFor();
    await page.getByLabel('Name shown in Lookabout').fill('bad"name');
    await page.getByText('can’t contain quotes').waitFor();
    await page.getByText('Fix the fields above to get the command.').waitFor();
  });
  await page.screenshot({ path: `${SCR}/7-install.png`, fullPage: true });

  await step('before any admin, the install check is open, one step at a time', async () => {
    await page.goto(base + '/#/add/hub');
    await page.getByRole('link', { name: 'Check it' }).click();
    await page.getByRole('heading', { name: 'Check the install' }).waitFor();
    await page.getByText('STEP 1 OF 5').waitFor();
    if ((await page.getByRole('heading', { level: 2 }).count()) !== 1) throw new Error('more than one step is open');
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByText('The hub is running in a container.').waitFor({ timeout: 8000 });
    await page.getByText('STEP 2 OF 5').waitFor();
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByText(/go2rtc isn.t running/).first().waitFor({ timeout: 8000 });
  });
  await page.screenshot({ path: `${SCR}/8-install-check.png`, fullPage: true });

  await step('make the first admin', async () => {
    await page.goto(base + '/#/add/hub');
    await page.getByLabel('Your name').fill('Sam');
    await page.getByLabel('Email').fill('sam@example.com');
    await page.getByLabel('Choose a password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Make the first admin' }).click();
    await page.getByText('Home hub recording').waitFor({ timeout: 8000 });
  });
  await step('setup says what to look at, and shows only that', async () => {
    await page.goto(base + '/#/setup');
    await page.getByRole('heading', { name: /things? to look at/ }).waitFor();
    await page.getByText('Video bridge').waitFor();
    if (await page.getByText('Provider secrets key').count()) throw new Error('a fine check is shown');
    await page.getByRole('link', { name: /Sign-in options/ }).waitFor();
    await page.getByRole('link', { name: /Remote access/ }).waitFor();
    await page.getByRole('link', { name: /Check the install/ }).waitFor();
  });
  await page.screenshot({ path: `${SCR}/9-health.png`, fullPage: true });
  await step('every check is one tap away', async () => {
    await page.getByRole('button', { name: 'Show every check' }).click();
    await page.getByText('Provider secrets key').waitFor();
  });

  await step('sign-in options: switches, and Google and Apple lead to their guides', async () => {
    await page.goto(base + '/#/setup/sign-in');
    await page.getByRole('heading', { name: 'Sign-in options' }).waitFor();
    await page.getByRole('switch', { name: 'Passwords' }).waitFor();
    await page.getByRole('link', { name: /Google/ }).waitFor();
    await page.getByRole('link', { name: /Apple/ }).waitFor();
  });
  await page.screenshot({ path: `${SCR}/9b-sign-in-options.png` });

  await step('Google wizard: finished steps shrink, the hub says what it contacts', async () => {
    await page.goto(base + '/#/setup/google');
    await page.getByRole('heading', { name: 'Continue with Google' }).waitFor();
    await page.getByLabel('The hub’s public https address').fill('http://hub.example.com');
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByText(/real domain name/).first().waitFor({ timeout: 8000 });
    await page.getByLabel('The hub’s public https address').fill('https://hub.example.com');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('STEP 2 OF 5').waitFor({ timeout: 8000 });
    await page.getByText('https://hub.example.com', { exact: true }).first().waitFor();
    await page.getByText('https://hub.example.com/api/auth/callback/google').waitFor();
    await page.getByRole('button', { name: 'I’ve made the client' }).click();
    await page.getByLabel('Client ID').fill('1234-abc.apps.googleusercontent.com');
    await page.getByLabel('Client secret').fill('GOCSPX-fake');
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByText('STEP 4 OF 5').waitFor({ timeout: 8000 });
    await page.getByText('accounts.google.com').first().waitFor();
  });
  await page.screenshot({ path: `${SCR}/10-google-wizard.png`, fullPage: true });
  await step('Google discovery reports honestly', async () => {
    await page.getByRole('button', { name: 'Check' }).click();
    await page.waitForTimeout(3000);
    const text = await page.locator('body').innerText();
    if (!/Google.s published settings|couldn.t reach|STEP 5 OF 5/.test(text)) throw new Error('no answer shown');
    console.log('   (discovery:', /STEP 5 OF 5/.test(text) ? 'passed against the real Google' : 'could not reach Google from here', ')');
  });

  await step('remote access is a two-choice page, then a guide', async () => {
    await page.goto(base + '/#/setup/remote');
    await page.getByRole('heading', { name: 'Remote access' }).waitFor();
    await page.getByRole('link', { name: /Cloudflare Tunnel/ }).click();
    await page.getByRole('heading', { name: 'Remote access with Cloudflare Tunnel' }).waitFor();
    await page.getByLabel('The hub’s public https address').fill('https://pi.local');
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByText(/real domain name/).first().waitFor({ timeout: 8000 });
  });
  await step('progress is kept on the hub: reload and the wizard resumes', async () => {
    await page.goto(base + '/#/setup/google');
    await page.reload();
    await page.getByText('https://hub.example.com', { exact: true }).first().waitFor({ timeout: 8000 });
  });
  await browser.close();
})().catch((e) => { console.log('stopped:', e.message.split('\n')[0]); process.exit(1); });
