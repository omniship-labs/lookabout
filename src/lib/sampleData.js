// Sample content from the Lookabout design (camera names, times, levels).
// Illustrative only: it stands in for live data until pairing, streaming and
// the home hub are wired up. Everything the UI shows that isn't a setting on
// this device comes from this file.

export const CRY_BAR_THRESHOLD = 12; // sound meter bar height where a bar turns warning
export const LEVEL_THRESHOLD = 40; // per-camera level (%) where a bar turns warning

export const nursery = {
  id: 'nursery',
  name: 'Nursery',
  cameras: [
    { id: 'over', name: 'Crib overhead', level: 12 },
    { id: 'side', name: 'Crib side', level: 64 },
    { id: 'mat', name: 'Play mat', level: 6 },
  ],
  status: { label: 'Stirring', by: 'Heard by Crib side', since: 'for 40 s' },
};

export const soloStatus = { label: 'Calm', since: 'Quiet for 42 min' };
export const connection = { kind: 'P2P', latency: '38 ms' };

export const soundLevels = [
  3, 4, 3, 5, 4, 3, 4, 6, 5, 4, 3, 3, 4, 5, 8, 14, 22, 28, 24, 18,
  12, 8, 6, 5, 4, 4, 3, 3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 3, 4, 3,
];

export const tonight = [
  { time: '1:41 AM', label: 'Stirring', meta: 'Crib side', tone: 'warning' },
  { time: '1:00 AM', label: 'Crying', meta: '2 min · clip', tone: 'warning' },
  { time: '12:14 AM', label: 'Stirring', meta: '30 s', tone: 'muted' },
  { time: '10:48 PM', label: 'Fell asleep', meta: 'quiet 2h', tone: 'success' },
];

export const houseCameras = [
  { id: 'front', name: 'Front door', device: 'OLD PIXEL', motion: true, status: 'online' },
  { id: 'driveway', name: 'Driveway', device: 'USB CAM', motion: false, status: 'online' },
  { id: 'backyard', name: 'Backyard', device: 'IPAD', motion: false, status: 'online' },
  { id: 'nursery', name: 'Nursery', device: 'PHONE', motion: false, status: 'online', room: true },
];

export const clipCount = 12;
export const clipsToday = [
  { id: 'c1', kind: 'motion', cam: 'Front door', title: 'Motion · Front door', meta: '18 s · porch zone', time: '2:03 PM' },
  { id: 'c2', kind: 'motion', cam: 'Driveway', title: 'Motion · Driveway', meta: '42 s · gate zone', time: '11:20 AM' },
  { id: 'c3', kind: 'sound', cam: 'Nursery', title: 'Sound · Nursery', meta: 'Crying · 2 min', time: '1:00 AM' },
];

export const eventDays = [
  {
    label: 'TODAY',
    items: [
      { id: 'e1', kind: 'crying', t: 'Crying · Nursery', m: '2 min · clip', time: '1:00 AM' },
      { id: 'e2', kind: 'motion', t: 'Motion · Front door', m: 'Porch zone · 18 s', time: '11:20 PM' },
      { id: 'e3', kind: 'offline', t: 'Offline · Driveway', m: 'Back after 6 min', time: '10:02 PM' },
    ],
  },
  {
    label: 'YESTERDAY',
    items: [
      { id: 'e4', kind: 'stirring', t: 'Stirring · Nursery', m: '40 s', time: '3:15 AM' },
      { id: 'e5', kind: 'motion', t: 'Motion · Backyard', m: 'Lawn zone · 32 s', time: '7:48 PM' },
    ],
  },
];

export const clip = {
  title: 'Crying · Nursery',
  when: 'Today, 1:00 AM · 2 min 04 s',
  position: '0:42',
  length: '2:04',
  marker: { label: 'CRYING 0:28 – 0:50', left: 22, width: 18, playhead: 34 },
};

export const zones = [
  { id: 'porch', name: 'Porch', action: 'alert + record', tone: 'accent', points: [[40, 150], [190, 120], [210, 230], [30, 240]] },
  { id: 'street', name: 'Street', action: 'record only', tone: 'info', points: [[230, 60], [330, 50], [330, 140], [240, 150]] },
];

export const pairedDevices = {
  cameras: [
    { id: 'nursery', t: 'Nursery', s: 'Phone · paired 2 weeks ago', a: 'Rename' },
    { id: 'front', t: 'Front door', s: 'Eufy via hub', a: 'Remove' },
    { id: 'driveway', t: 'Driveway', s: 'USB webcam on hub', a: 'Remove' },
  ],
  viewers: [
    { id: 'this', t: 'This phone', s: 'Owner', a: 'Rename' },
    { id: 'second', t: 'Second phone', s: 'Last seen today', a: 'Remove' },
  ],
};

export const addGroups = [
  {
    label: 'NO EXTRA HARDWARE',
    rows: [
      { ab: 'ME', t: 'This phone', s: 'Turn this device into a camera', tag: 'live', to: '/camera/setup' },
      { ab: 'QR', t: 'Another phone, tablet or laptop', s: 'Open lookabout.omniship.dev on it, then scan', tag: 'live', to: '/pair' },
    ],
  },
  {
    label: 'SMALL BOARDS AND HUB',
    rows: [
      { ab: 'USB', t: 'USB webcam on the hub', s: 'Home server or NAS · 2 found', tag: 'hub', to: '/add/usb' },
      { ab: 'PI', t: 'Raspberry Pi camera', s: 'Pi camera module or USB webcam, on your Wi-Fi', tag: 'live', to: '/add/pi' },
      { ab: 'ESP', t: 'ESP32 camera', s: 'ESP32-S3 with a USB webcam, on your Wi-Fi', tag: 'live', to: '/add/esp32' },
    ],
  },
  {
    label: 'CAMERAS YOU ALREADY OWN',
    rows: [
      { ab: 'IP', t: 'Any RTSP or ONVIF camera', s: 'Reolink, Tapo, Amcrest, Hikvision and most IP cams', tag: 'hub', to: '/add/rtsp' },
      { ab: 'EU', t: 'Eufy', s: 'Models with NAS (RTSP) in the eufy app', tag: 'hub', to: '/add/eufy' },
      { ab: 'NE', t: 'Google Nest', s: 'Official Google API · Google charges a sign-up fee', tag: 'hub', to: '/add/nest' },
      { ab: 'RI', t: 'Ring', s: 'Doorbells and cams · unofficial connection', tag: 'hub', to: '/add/ring' },
      { ab: 'WY', t: 'Wyze', s: 'Cams on your network · unofficial connection', tag: 'hub', to: '/add/wyze' },
    ],
  },
  {
    label: 'CLIPS ONLY',
    rows: [
      { ab: 'TS', t: 'Tesla Sentry & Dashcam', s: 'Imports saved clips from the car’s USB drive', tag: 'clips', to: '/add/tesla' },
    ],
  },
];

export const connectKinds = {
  eufy: {
    title: 'Connect your Eufy camera',
    steps: [
      ['In the eufy app, open the camera’s settings and turn on ', ['NAS (RTSP)'], '. Set a username and password.'],
      ['Copy the stream address it shows and paste it below.'],
    ],
    address: 'rtsp://192.168.1.42/live0',
    hint: 'Hub found 1 camera on your network that matches. Give the camera a fixed IP in your router so this address doesn’t change.',
    name: 'Front door',
    source: 'Eufy via hub',
    device: 'EUFY',
  },
  rtsp: {
    title: 'Connect an RTSP or ONVIF camera',
    steps: [
      ['In the camera’s own app or web page, turn on ', ['RTSP'], ' or ', ['ONVIF'], '. Set a username and password.'],
      ['Copy the stream address it shows and paste it below.'],
    ],
    address: 'rtsp://192.168.1.42/stream1',
    hint: 'Give the camera a fixed IP in your router so this address doesn’t change.',
    name: 'Garage',
    source: 'RTSP via hub',
    device: 'IP CAM',
  },
};

export const usbCams = [
  { id: 'u1', t: 'Logitech C920', s: 'USB port 1 · 1080p', on: true },
  { id: 'u2', t: 'Generic UVC camera', s: 'USB port 3 · 720p', on: false },
];

export const guidedFlows = {
  hub: {
    title: 'Set up a home hub',
    intro: 'Optional. Runs on a home server, NAS or Raspberry Pi 4/5. Adds recording, clips and cameras you already own.',
    steps: [
      'Install the hub with Docker on your server or NAS.',
      'Open the hub page on your network and show its pairing code.',
      'Scan it here, then pick where recordings are stored.',
    ],
    code: 'docker run -d --name lookabout-hub \\\n  --network host [IMAGE NAME TBD]',
    statusLabel: 'HUB FOUND ON YOUR NETWORK',
    status: 'lookabout-hub · 412 GB free',
    cta: 'Pair this hub',
    foot: 'Without a hub everything still works live, phone to phone.',
  },
  pi: {
    title: 'Add a Raspberry Pi camera',
    intro: 'A Pi with a camera module or USB webcam becomes an always-on camera that reports to your hub.',
    steps: [
      'Flash the Lookabout Pi image with Raspberry Pi Imager. Set Wi-Fi in its settings.',
      'Plug in the camera and power it up.',
      'It shows up here in about a minute.',
    ],
    statusLabel: 'FOUND 1 PI',
    status: 'lookabout-pi-3f2a · Camera Module 3',
    cta: 'Add this camera',
    foot: 'Pi 3B+ or newer. Pi Zero 2 W works at 720p.',
    camera: { name: 'Pi camera', device: 'PI', source: 'Raspberry Pi via hub' },
  },
  esp32: {
    title: 'Add an ESP32-CAM',
    intro: 'Flash it straight from this browser over USB. Needs Chrome or Edge on a computer.',
    steps: [
      'Connect the ESP32-CAM to your computer with a USB adapter.',
      'Press Connect and pick its port. Flashing takes about a minute.',
      'Enter your Wi-Fi. It joins your hub on its own.',
    ],
    statusLabel: 'FLASHING',
    status: 'Writing firmware · 64%',
    progress: 64,
    cta: 'Connect and flash',
    foot: 'Video only, smoothest at 800×600 or lower. Good for doors and garages, not for listening.',
  },
};

export const nestCams = [
  { id: 'porch', t: 'Porch cam', s: 'Wired · stays live', on: true },
  { id: 'garden', t: 'Garden cam', s: 'Battery · 5-min live sessions, tap to reconnect', on: false },
];

export const ringCams = [
  { t: 'Front Doorbell', s: 'Live · two-way talk' },
  { t: 'Garage Stick Up Cam', s: 'Live' },
];

export const wyzeCams = [
  { t: 'Wyze Cam v3 · Backyard', s: 'On your network' },
  { t: 'Wyze Cam Pan · Garage', s: 'On your network' },
];

export const teslaClips = [
  { t: 'Sentry · someone near car', m: 'Today 6:12 PM · front + left cams' },
  { t: 'Sentry · door handle', m: 'Yesterday 11:04 PM · 4 angles' },
  { t: 'Dashcam · saved', m: 'Tue 8:31 AM · front' },
];

// Design states that need live data to occur on their own. Add `?state=<name>`
// to a route to see one, e.g. `#/cameras?state=offline`.
export function applyScenario(cameras, state) {
  if (state === 'offline') {
    return cameras.map((c) => (c.id === 'driveway' ? { ...c, status: 'offline', since: '2:14 AM' } : c));
  }
  if (state === 'ring') {
    return [
      { id: 'ring-door', name: 'Front Doorbell', status: 'paused', brand: 'Ring' },
      { id: 'ring-garage', name: 'Garage', status: 'paused', brand: 'Ring' },
      ...cameras.filter((c) => c.id === 'nursery' || c.id === 'backyard'),
    ];
  }
  return cameras;
}
