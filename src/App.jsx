import React from 'react';
import '@omniship-labs/design-beacon/styles.css';
import { useRoute } from './lib/router.js';
import { useStore } from './lib/store.js';
import { setAnnouncer, useResolvedTheme } from './lib/hooks.js';
import { Splash, Start } from './screens/Start.jsx';
import { CameraDenied, CameraLive, CameraSetup } from './screens/Camera.jsx';
import { Live } from './screens/Live.jsx';
import { Cameras, Clip, Events, Zones } from './screens/Cameras.jsx';
import { Devices, Settings } from './screens/Settings.jsx';
import { AddCamera, ConnectNest, ConnectRing, ConnectStream, ConnectUsb, ConnectWyze, Guided, TeslaClips } from './screens/Add.jsx';
import { PairCode, PairDone, PairScan } from './screens/Pairing.jsx';
import { Flash } from './screens/Flash.jsx';

function screenFor(path, params) {
  const parts = path.split('/').filter(Boolean);
  const [a, b] = parts;
  const scenario = params.state;
  switch (a) {
    case undefined:
      return <Start />;
    case 'camera':
      if (b === 'live') return <CameraLive scenario={scenario} />;
      if (b === 'denied') return <CameraDenied />;
      return <CameraSetup />;
    case 'live':
      return <Live key={path} camId={b} scenario={scenario} />;
    case 'cameras':
      return <Cameras scenario={scenario} />;
    case 'events':
      return b === 'clip' ? <Clip /> : <Events />;
    case 'zones':
      return <Zones />;
    case 'settings':
      return <Settings />;
    case 'devices':
      return <Devices />;
    case 'flash':
      return <Flash />;
    case 'pair':
      if (b === 'code') return <PairCode initial={params.code} />;
      if (b === 'done') return <PairDone />;
      return <PairScan />;
    case 'add':
      switch (b) {
        case undefined:
          return <AddCamera />;
        case 'usb':
          return <ConnectUsb />;
        case 'hub':
        case 'pi':
        case 'esp32':
          return <Guided key={b} kind={b} />;
        case 'nest':
          return <ConnectNest />;
        case 'ring':
          return <ConnectRing />;
        case 'wyze':
          return <ConnectWyze />;
        case 'tesla':
          return <TeslaClips />;
        default:
          return <ConnectStream key={b} kind={b} />;
      }
    default:
      return <Start />;
  }
}

const SPLASH_KEY = 'lookabout-splash';

export function App() {
  const { path, params } = useRoute();
  const s = useStore();
  useResolvedTheme(s.theme);
  const [message, setMessage] = React.useState('');
  const [splash, setSplash] = React.useState(() => {
    try {
      return !sessionStorage.getItem(SPLASH_KEY);
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    setAnnouncer(setMessage);
    return () => setAnnouncer(null);
  }, []);

  const endSplash = React.useCallback(() => {
    try {
      sessionStorage.setItem(SPLASH_KEY, '1');
    } catch {
      // Storage blocked: the launch screen just plays again next time.
    }
    setSplash(false);
  }, []);

  return (
    <>
      {splash ? <Splash onDone={endSplash} /> : screenFor(path, params)}
      <div aria-live="polite" className="lk-sr">{message}</div>
    </>
  );
}
