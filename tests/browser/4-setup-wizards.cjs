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
    await page.getByRole('heading', { name: 'Install the hub on a Raspberry Pi' }).waitFor();
    await page.getByText('cd lookabout-hub && ./install.sh', { exact: true }).waitFor();
    await page.getByLabel('Name shown in Lookabout').fill('Shed hub');
    await page.getByLabel('Port').fill('9000');
    await page.getByLabel('USB webcams plugged into the Pi (optional)').fill('/dev/video0');
    await page.getByText('cd lookabout-hub && ./install.sh --name "Shed hub" --port 9000 --usb /dev/video0', { exact: true }).waitFor();
    await page.getByLabel('Name shown in Lookabout').fill('bad"name');
    await page.getByText('can’t contain quotes').waitFor();
    await page.getByText('Fix the fields above to get the command.').waitFor();
  });
  await page.screenshot({ path: `${SCR}/7-install.png`, fullPage: true });

  await step('before any admin, the install check is open and says what is wrong', async () => {
    await page.goto(base + '/#/add/hub');
    await page.getByRole('link', { name: /Check this install/ }).click();
    await page.getByRole('heading', { name: 'Check the install' }).waitFor();
    await page.getByRole('button', { name: 'Check' }).first().click();
    await page.getByText('The hub is running in a container.').waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: 'Check' }).first().click();
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
  await step('health panel lists what needs attention, worst first', async () => {
    await page.goto(base + '/#/setup');
    await page.getByRole('heading', { name: 'Setup health' }).waitFor();
    await page.getByText(/things? to look at/).waitFor();
    await page.getByText('Video bridge').waitFor();
    await page.getByText(/go2rtc isn.t running/).first().waitFor();
    await page.getByRole('heading', { name: 'Setup guides' }).waitFor();
  });
  await page.screenshot({ path: `${SCR}/9-health.png`, fullPage: true });

  await step('Google wizard: address, console, client, and the hub says what it contacts', async () => {
    await page.goto(base + '/#/setup/google');
    await page.getByRole('heading', { name: 'Continue with Google' }).waitFor();
    await page.getByLabel('The hub’s public https address').fill('http://hub.example.com');
    await page.getByRole('button', { name: 'Check' }).first().click();
    await page.getByText(/real domain name/).first().waitFor({ timeout: 8000 });
    await page.getByLabel('The hub’s public https address').fill('https://hub.example.com');
    await page.getByRole('button', { name: 'Try again' }).first().click();
    await page.getByText('https://hub.example.com', { exact: true }).first().waitFor({ timeout: 8000 });
    await page.getByText('https://hub.example.com/api/auth/callback/google').waitFor();
    await page.getByRole('button', { name: 'I’ve made the client' }).click();
    await page.getByLabel('Client ID').fill('1234-abc.apps.googleusercontent.com');
    await page.getByLabel('Client secret').fill('GOCSPX-fake');
    await page.getByRole('button', { name: 'Check' }).first().click();
    await page.getByText(/saved\. The secret is stored encrypted/).waitFor({ timeout: 8000 });
    await page.getByText('accounts.google.com').first().waitFor();
  });
  await page.screenshot({ path: `${SCR}/10-google-wizard.png`, fullPage: true });
  await step('Google discovery reports honestly when it cannot reach Google', async () => {
    await page.getByRole('button', { name: 'Check' }).first().click();
    await page.waitForTimeout(3000);
    const text = await page.locator('body').innerText();
    if (!/Google.s published settings|couldn.t reach|Google.s sign-in settings match/.test(text)) throw new Error('no answer shown');
    console.log('   (discovery answer:', /match what the hub uses/.test(text) ? 'passed against the real Google' : 'could not reach Google from here, as expected', ')');
  });
  await step('the switch-on is refused until the wizard has passed', async () => {
    await page.goto(base + '/#/household');
    await page.getByLabel('Google sign-in').click();
    await page.getByText(/Finish the google setup first/).waitFor({ timeout: 5000 });
  });

  await step('remote access chooser and the Cloudflare guide', async () => {
    await page.goto(base + '/#/setup/remote');
    await page.getByRole('heading', { name: 'Remote access' }).waitFor();
    await page.getByText('Off by default').waitFor();
    await page.getByRole('link', { name: /Cloudflare Tunnel/ }).click();
    await page.getByRole('heading', { name: 'Remote access with Cloudflare Tunnel' }).waitFor();
    await page.getByLabel('The hub’s public https address').fill('https://pi.local');
    await page.getByRole('button', { name: 'Check' }).first().click();
    await page.getByText(/real domain name/).first().waitFor({ timeout: 8000 });
  });
  await page.screenshot({ path: `${SCR}/11-remote.png`, fullPage: true });
  await step('progress is kept on the hub: reload and the wizard resumes', async () => {
    await page.goto(base + '/#/setup/google');
    await page.reload();
    await page.getByText('https://hub.example.com', { exact: true }).first().waitFor({ timeout: 8000 });
  });
  await browser.close();
})().catch((e) => { console.log('stopped:', e.message.split('\n')[0]); process.exit(1); });
