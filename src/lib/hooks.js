import React from 'react';

// Breakpoints from the handoff spec:
//   phone   < 600px wide (and tablets held in portrait): bottom tab bar
//   tablet  600–1024px, landscape: icon rail
//   desktop >= 1024px: sidebar
function readLayout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w >= 1024) return 'desktop';
  if (w >= 600 && w > h && h >= 500) return 'tablet';
  return 'phone';
}

export function useLayout() {
  const [layout, setLayout] = React.useState(readLayout);
  React.useEffect(() => {
    const onResize = () => setLayout(readLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}

// Ticks once a second; returns Date.now().
export function useNow(intervalMs = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatClock(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function useClock() {
  return formatClock(useNow(15000));
}

export function useResolvedTheme(pref) {
  const [systemDark, setSystemDark] = React.useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  React.useEffect(() => {
    if (resolved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }, [resolved]);
  return resolved;
}

export function usePrefersReducedMotion() {
  return React.useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
}

// Battery Status API where the browser has it (Chromium); null elsewhere.
export function useBattery() {
  const [battery, setBattery] = React.useState(null);
  React.useEffect(() => {
    let manager;
    let cancelled = false;
    const read = () => {
      if (!cancelled && manager) setBattery({ level: Math.round(manager.level * 100), charging: manager.charging });
    };
    if (navigator.getBattery) {
      navigator.getBattery().then((m) => {
        manager = m;
        read();
        m.addEventListener('levelchange', read);
        m.addEventListener('chargingchange', read);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (manager) {
        manager.removeEventListener('levelchange', read);
        manager.removeEventListener('chargingchange', read);
      }
    };
  }, []);
  return battery;
}

// Polite live-region announcements (cry and motion alerts, feed swaps).
let announcer = null;
export function setAnnouncer(fn) {
  announcer = fn;
}
export function announce(message) {
  if (announcer) announcer(message);
}

export function haptic() {
  if (navigator.vibrate) navigator.vibrate(10);
}

/** The address a `make()` promise resolves with, or '' until it has (and if it fails). Runs again when `deps` change. */
export function useAsyncUrl(make, deps) {
  const [url, setUrl] = React.useState('');
  React.useEffect(() => {
    let stale = false;
    setUrl('');
    make().then((u) => !stale && setUrl(u), () => {});
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return url;
}

/** An object URL for a file fetched with the session (a clip or thumbnail); freed when done. */
export function useBlobUrl(fetchBlob, deps) {
  const [url, setUrl] = React.useState('');
  React.useEffect(() => {
    let stale = false;
    let made = '';
    setUrl('');
    fetchBlob().then((blob) => {
      if (stale) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }, () => {});
    return () => {
      stale = true;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return url;
}
