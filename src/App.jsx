import React from 'react';
import '@omniship-labs/design-beacon/styles.css';
import { useRoute } from './lib/router.js';
import { adoptOwnSession, useHubSync, useStore } from './lib/store.js';
import { setAnnouncer, useResolvedTheme } from './lib/hooks.js';
import { Splash, Start } from './screens/Start.jsx';
import { CameraDenied, CameraLive, CameraSetup } from './screens/Camera.jsx';
import { Live } from './screens/Live.jsx';
import { Cameras, Clip, Events, Zones } from './screens/Cameras.jsx';
import { Devices, Settings } from './screens/Settings.jsx';
import { AddCamera, ConnectNest, ConnectRing, ConnectStream, ConnectUsb, ConnectWyze, Guided, HubSetup, TeslaClips } from './screens/Add.jsx';
import { PairCode, PairDone, PairScan } from './screens/Pairing.jsx';
import { Flash } from './screens/Flash.jsx';
import { Account, AccountLinked, AccountPasskeys, AccountPassword } from './screens/Account.jsx';
import { Household, HouseholdGroup, HouseholdGroups, HouseholdInvite, HouseholdMember } from './screens/Household.jsx';
import { InstallHub, RemoteChoice, SetupFlow, SetupHealth, SignInMethods } from './screens/Setup.jsx';

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
      return b === 'clip' ? <Clip key={parts[2] || 'sample'} eventId={parts[2]} /> : <Events />;
    case 'zones':
      return <Zones key={b || 'pick'} camId={b} />;
    case 'settings':
      return <Settings />;
    case 'devices':
      return <Devices />;
    case 'flash':
      return <Flash />;
    case 'account':
      if (b === 'passkeys') return <AccountPasskeys />;
      if (b === 'password') return <AccountPassword />;
      if (b === 'linked') return <AccountLinked />;
      return <Account />;
    case 'household':
      if (b === 'invite') return <HouseholdInvite />;
      if (b === 'groups') return <HouseholdGroups />;
      if (b === 'member') return <HouseholdMember key={parts[2]} id={parts[2]} />;
      if (b === 'group') return <HouseholdGroup key={parts[2]} id={parts[2]} />;
      return <Household />;
    case 'install':
      return <InstallHub />;
    case 'setup':
      if (!b) return <SetupHealth />;
      // "remote" asks which way; the two remote guides are their own pages.
      if (b === 'sign-in') return <SignInMethods />;
      return b === 'remote' ? <RemoteChoice /> : <SetupFlow key={b} flow={b} />;
    case 'signin':
      // The hub sends people back here after Google or Apple sign-in, with what went wrong in the address.
      return <HubSetup address={params.address} code={params.code} error={params.message} />;
    case 'join':
      return <HubSetup invite={params.invite} />;
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
          return <HubSetup address={params.address} code={params.code} />;
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
  useHubSync();
  React.useEffect(() => {
    adoptOwnSession();
  }, []);
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
