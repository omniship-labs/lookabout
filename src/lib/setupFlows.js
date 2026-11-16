// The setup wizards that run against a hub (docs/hub-auth.md, "Setup wizards"): Google, Apple, remote
// access and the install check. Each step is data: what to tell the person, which fields to show and
// which hub check to run. The hub keeps the progress, so a flow can be carried on from another device.
//
//   stepsFor(flow, api, plans) -> steps for the Wizard component
//   api = { verify(step, body) -> hub step, confirm(step) -> hub step }  (see household.js / hub.js callers)

import { hubGet, hubSend } from './hub.js';

export const getSetup = (hub) => hubGet(hub, '/api/setup');
export const getFlow = (hub, flow) => hubGet(hub, `/api/setup/${flow}`);
export const getPlan = (hub, flow, step) => hubGet(hub, `/api/setup/${flow}/${step}/plan`);
export const verifyStep = (hub, flow, step, body) => hubSend(hub, 'POST', `/api/setup/${flow}/${step}/verify`, body || {});
export const confirmStep = (hub, flow, step) => hubSend(hub, 'PUT', `/api/setup/${flow}/${step}`, { state: 'passed' });
export const getHealth = (hub) => hubGet(hub, '/api/admin/health');
export const turnOffRemote = (hub) => hubSend(hub, 'POST', '/api/admin/remote/off', {});

export const FLOW_TITLES = {
  'hub-install': 'Check the install',
  'remote-cloudflare': 'Remote access with Cloudflare Tunnel',
  'remote-tailscale': 'Remote access with Tailscale',
  google: 'Continue with Google',
  apple: 'Continue with Apple',
};

const redirect = (provider) => (v) => [{ label: 'REDIRECT ADDRESS', text: `${(v.public_url || 'https://hub.example.com').replace(/\/$/, '')}/api/auth/callback/${provider}` }];
const publicUrlField = { key: 'public_url', label: 'The hub’s public https address', placeholder: 'https://hub.example.com', required: true, mono: true };

const publicUrlStep = {
  id: 'public-url',
  title: 'The hub’s public address',
  guide: ['Google and Apple only send people back to an https address on a domain you own, such as https://hub.example.com.', 'It has to reach this hub: the remote access wizard sets that up. Enter it here now.'],
  fields: [publicUrlField],
};

const DEFS = {
  'hub-install': [
    { id: 'docker', title: 'Running in Docker', guide: ['The hub should run as a Docker container on your Pi, started by ./install.sh.'] },
    { id: 'container', title: 'The hub and its video', guide: ['Checks the hub is up and the video bridge (go2rtc) is running inside it.'] },
    { id: 'volume', title: 'Room to store things', guide: ['Checks the hub can write to its data folder and has at least 1 GB free for recordings.'] },
    { id: 'mdns', title: 'Found by name', guide: ['Checks the hub announces itself on your network, so the apps can find raspberrypi.local.'] },
    { id: 'first-admin', title: 'The first admin', guide: ['Checks an admin account exists. If not, open the hub in Lookabout and make one with the setup code.'] },
  ],
  google: [
    publicUrlStep,
    {
      id: 'console',
      title: 'Make Google credentials',
      guide: [
        ['In the Google Cloud console, make a project (or pick one), then ', ['APIs & Services → Credentials → Create credentials → OAuth client ID'], '.'],
        ['Application type: ', ['Web application'], '. Under ', ['Authorized redirect URIs'], ' add the address below.'],
        'Google shows a client ID and a client secret. Keep that page open for the next step.',
      ],
      copy: redirect('google'),
      links: [{ label: 'Google Cloud credentials', href: 'https://console.cloud.google.com/apis/credentials' }],
      manual: true,
      confirmLabel: 'I’ve made the client',
    },
    {
      id: 'client',
      title: 'Enter the client details',
      guide: ['The client ID ends in .apps.googleusercontent.com. The secret is stored encrypted on the hub and never shown again.'],
      fields: [
        { key: 'client_id', label: 'Client ID', mono: true, required: true, placeholder: '1234-abc.apps.googleusercontent.com' },
        { key: 'client_secret', label: 'Client secret', secret: true, required: false, hint: 'Leave empty to keep the one saved.' },
      ],
    },
    { id: 'discovery', title: 'Check Google’s settings', guide: ['The hub asks Google for its public sign-in settings and checks they match what the hub uses.'] },
    {
      id: 'test-sign-in',
      title: 'Test it with your own account',
      guide: [['Go to ', ['Your account → Linked sign-ins → Link'], ' next to Google and sign in with your Google account.'], 'Then come back and press Check. Nobody else sees “Continue with Google” until this passes and you switch it on.'],
      links: [{ label: 'Your account', href: '#/account' }],
    },
  ],
  apple: [
    publicUrlStep,
    {
      id: 'developer',
      title: 'Your Apple developer account',
      guide: ['Sign in with Apple needs a paid Apple Developer Program membership (about 99 US dollars a year).', 'Nothing here is shared with Apple until you finish the steps below.'],
      links: [{ label: 'Apple developer account', href: 'https://developer.apple.com/account' }],
      manual: true,
      confirmLabel: 'I have one',
    },
    {
      id: 'identifiers',
      title: 'App ID and Services ID',
      guide: [
        [['Certificates, Identifiers & Profiles → Identifiers'], ': make an App ID with Sign in with Apple switched on, then a ', ['Services ID'], ' (this is what the hub uses).'],
        ['Open the Services ID, tick Sign in with Apple, ', ['Configure'], ', and add your domain and the return address below.'],
        'The Team ID is shown under your name at the top right.',
      ],
      copy: (v) => [{ label: 'RETURN URL', text: `${(v.public_url || 'https://hub.example.com').replace(/\/$/, '')}/api/auth/callback/apple` }],
      fields: [
        { key: 'services_id', label: 'Services ID', mono: true, required: true, placeholder: 'dev.example.lookabout' },
        { key: 'team_id', label: 'Team ID', mono: true, required: true, placeholder: '10 letters and digits' },
      ],
    },
    {
      id: 'key',
      title: 'The Sign in with Apple key',
      guide: [['Under ', ['Keys'], ', make a key with Sign in with Apple, choose your App ID and download the .p8 file (Apple lets you download it once).'], 'Paste the Key ID and the contents of the file. It is stored encrypted and never shown again.'],
      fields: [
        { key: 'key_id', label: 'Key ID', mono: true, required: true, placeholder: '10 letters and digits' },
        { key: 'key', label: 'Key (.p8 file contents)', secret: true, multiline: true, required: false, placeholder: '-----BEGIN PRIVATE KEY-----', hint: 'Leave empty to keep the one saved.' },
      ],
    },
    { id: 'token-endpoint', title: 'Check with Apple', guide: ['The hub makes a signed request to Apple with a made-up code. Apple refusing only the code means your Services ID, Team ID and key fit together.'] },
    {
      id: 'test-sign-in',
      title: 'Test it with your own account',
      guide: [['Go to ', ['Your account → Linked sign-ins → Link'], ' next to Apple and sign in.'], 'Then come back and press Check.'],
      links: [{ label: 'Your account', href: '#/account' }],
    },
  ],
  'remote-cloudflare': [
    {
      id: 'domain',
      title: 'Your domain',
      guide: ['Remote access needs a domain you own, on Cloudflare (the free plan is enough), such as hub.example.com.', 'Enter the https address people will use.'],
      fields: [publicUrlField],
    },
    {
      id: 'tunnel',
      title: 'Start the tunnel',
      guide: [
        [['Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel'], ' (Cloudflared). Install the connector on the Pi with the command Cloudflare shows.'],
        ['Add a ', ['public hostname'], ' for your domain. Service: HTTP, URL ', ['localhost:8787'], '.'],
        'Expose only port 8787. Never expose 1984 or 8554: they are the video bridge’s own ports.',
      ],
      links: [{ label: 'Cloudflare Zero Trust', href: 'https://one.dash.cloudflare.com/' }],
      manual: true,
      confirmLabel: 'The tunnel is running',
    },
    { id: 'certificate', title: 'Check the certificate', guide: ['The hub opens a secure connection to your address and checks the certificate is valid for that name.'] },
    { id: 'reach-self', title: 'Check it reaches this hub', guide: ['The hub asks your public address for its own name and id, to be sure the tunnel points here and not at something else.'] },
    {
      id: 'locked-down',
      title: 'Lock it down',
      guide: ['Before the hub is reachable from outside, it checks: every admin has a passkey or a 14+ character password, every camera, stream and clip route refuses strangers, no other website can read from the hub, and the video bridge’s own ports are closed.', 'If all pass, remote access switches on and sessions shorten to 7 days.'],
    },
  ],
  'remote-tailscale': [
    {
      id: 'tailnet',
      title: 'Tailscale on the Pi',
      guide: [['Install Tailscale on the Pi and sign in: ', ['curl -fsSL https://tailscale.com/install.sh | sh'], ' then ', ['sudo tailscale up'], '.'], 'In the Tailscale admin console, switch on MagicDNS and HTTPS certificates.'],
      links: [{ label: 'Tailscale admin', href: 'https://login.tailscale.com/admin/dns' }],
      manual: true,
      confirmLabel: 'Tailscale is up',
    },
    {
      id: 'funnel-or-private',
      title: 'Private or public',
      guide: [
        [['Private (only your own devices on Tailscale): '], ['tailscale serve --bg 8787']],
        [['Public (anyone with the link, no Tailscale needed): '], ['tailscale funnel --bg 8787']],
        'Either gives you an https address like https://pi.your-tailnet.ts.net. Use the one you want.',
      ],
      copy: () => [{ label: 'PRIVATE', text: 'sudo tailscale serve --bg 8787' }, { label: 'PUBLIC', text: 'sudo tailscale funnel --bg 8787' }],
      manual: true,
      confirmLabel: 'It’s running',
    },
    {
      id: 'certificate',
      title: 'Check the certificate',
      guide: ['Enter the https address Tailscale gave you. The hub opens a secure connection to it and checks the certificate.'],
      fields: [{ ...publicUrlField, placeholder: 'https://pi.your-tailnet.ts.net' }],
    },
    { id: 'reach-self', title: 'Check it reaches this hub', guide: ['The hub asks your address for its own name and id, to be sure it is this hub answering.'] },
    {
      id: 'locked-down',
      title: 'Lock it down',
      guide: ['The hub checks every admin has a passkey or a 14+ character password, every route refuses strangers, no other website can read from it and the video bridge’s ports are closed. If all pass, remote access switches on.'],
    },
  ],
};

const pick = (values, keys) => Object.fromEntries(keys.filter((k) => values[k] !== undefined && values[k] !== '').map((k) => [k, values[k]]));

/** Steps for the Wizard component. `plans` is the hub's plan per step id: [{ host, sends }]. */
export function stepsFor(flow, api, plans = {}) {
  return (DEFS[flow] || []).map((def) => {
    const keys = (def.fields || []).map((f) => f.key);
    const required = (def.fields || []).filter((f) => f.required).map((f) => f.key);
    return {
      ...def,
      plan: plans[def.id] || [],
      checkLabel: def.manual ? def.confirmLabel : 'Check',
      checkingLabel: def.manual ? 'Saving…' : 'Checking…',
      ready: (values) => required.every((k) => String(values[k] || '').trim() !== ''),
      check: async ({ values }) => {
        const answer = def.manual ? await api.confirm(def.id) : await api.verify(def.id, pick(values, keys));
        if (answer.state !== 'passed') throw new Error(answer.reason || 'That didn’t pass.');
        return { summary: answer.summary || '', values: answer.summary && def.id === 'public-url' ? { public_url: answer.summary } : null };
      },
    };
  });
}

/** What the hub says about a flow, in the shape the Wizard restores from. */
export function flowToProgress(flow) {
  return {
    steps: Object.fromEntries(flow.steps.map((s) => [s.id, { state: s.state, reason: s.reason || '', summary: s.summary || '' }])),
    values: flow.values || {},
  };
}

/** A Wizard store that holds what the hub said; the hub itself keeps the real progress as each step is checked. */
export const hubProgress = (flow) => {
  const initial = flowToProgress(flow);
  return { load: () => initial, save() {}, clear() {} };
};

/** The flows a person can start from the health panel, with what each is for. */
export const FLOW_LIST = [
  { flow: 'hub-install', blurb: 'Is the hub installed properly? Docker, video, storage, discovery.' },
  { flow: 'google', blurb: 'Let invited people sign in with Google, using your own Google client.' },
  { flow: 'apple', blurb: 'Let invited people sign in with Apple, using your own Apple developer keys.' },
  { flow: 'remote-cloudflare', blurb: 'Reach the hub from outside the house through a Cloudflare Tunnel.' },
  { flow: 'remote-tailscale', blurb: 'Reach the hub from outside the house through Tailscale.' },
];

export const HEALTH_LABEL = { ok: 'Fine', warn: 'Check', bad: 'Fix' };

/** Worst-first order for the health list. */
export const worstFirst = (checks) => [...checks].sort((a, b) => ({ bad: 0, warn: 1, ok: 2 })[a.state] - ({ bad: 0, warn: 1, ok: 2 })[b.state]);

/** "3 things to look at", "All fine". */
export function healthLine(health) {
  const n = (health.checks || []).filter((c) => c.state !== 'ok').length;
  return n ? `${n} thing${n === 1 ? '' : 's'} to look at` : 'All fine';
}

/** Where to send someone for a health row: its flow's wizard, or nowhere. */
export const healthLink = (check) => (check.flow ? `/setup/${check.flow === 'remote-cloudflare' ? 'remote' : check.flow}` : '');
