import React from 'react';
import { navigate } from '../lib/router.js';
import { PAIRING_CODE_PATTERN } from '../lib/camera.js';
import { BackBar, Cta, Field, Page, Spacer, display, mono } from '../components/ui.jsx';
import { CheckIcon } from '../components/icons.jsx';

/** Viewer pairing A: scan the code on the camera's screen. */
export function PairScan() {
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    let stream;
    let timer;
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        return; // No camera or not allowed: typing the code still works.
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (videoRef.current) videoRef.current.srcObject = stream;
      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.map((c) => c.rawValue.toUpperCase()).map((v) => v.split('/').pop()).find((v) => PAIRING_CODE_PATTERN.test(v));
            if (hit) navigate(`/pair/code?code=${encodeURIComponent(hit)}`);
          } catch {
            // Frame not ready yet.
          }
        }, 500);
      }
    };
    start();
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Page>
      <BackBar to="/add" title="Pair a camera" />
      <div
        style={{
          position: 'relative',
          height: 420,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-label="Camera viewfinder for scanning the QR code"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <span style={{ position: 'absolute', top: 14, ...mono(11), color: 'var(--text-muted)' }}>VIEWFINDER</span>
        <div style={{ position: 'relative', width: 220, height: 220, boxSizing: 'border-box', borderRadius: 'var(--radius-xl)', border: '3px solid var(--text-strong)' }} />
      </div>
      <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-body)', textAlign: 'center' }}>
        Point at the code on the camera’s screen.
      </span>
      <Spacer />
      <Cta variant="outline" href="#/pair/code">Type the code instead</Cta>
    </Page>
  );
}

/** Viewer pairing B: type the word code. */
export function PairCode({ initial = '' }) {
  const [code, setCode] = React.useState(initial);
  const [error, setError] = React.useState('');
  const pair = (e) => {
    e.preventDefault();
    if (PAIRING_CODE_PATTERN.test(code.trim())) navigate('/pair/done');
    else setError('That code doesn’t match a camera nearby. Check the camera screen.');
  };
  return (
    <Page>
      <form onSubmit={pair} style={{ display: 'contents' }}>
        <BackBar to="/pair" title="Type the code" />
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Two words and a number, shown under the QR code on the camera.
        </p>
        <Field
          label="Pairing code"
          monoFont
          size={22}
          height={56}
          emphasis
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="FERN-42-OTTER"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError('');
          }}
          error={error}
          hint="Codes expire after 10 minutes."
        />
        <Spacer />
        <Cta type="submit" disabled={!code.trim()}>Pair</Cta>
      </form>
    </Page>
  );
}

/** Viewer pairing C: paired. */
export function PairDone() {
  return (
    <Page pad="140px 24px 28px" gap={16} align="center">
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 'var(--radius-pill)',
          background: 'var(--osl-success)',
          color: 'var(--osl-ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckIcon size={34} strokeWidth={2.5} />
      </div>
      <h1 style={display(28, { textAlign: 'center' })}>Nursery is paired</h1>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 'var(--leading-normal)', color: 'var(--text-body)', textAlign: 'center' }}>
        Its key is saved on this phone only. Nobody else can watch unless you pair them too.
      </p>
      <Spacer />
      <Cta href="#/live">Open live view</Cta>
      <Cta variant="outline" href="#/add">Pair another camera</Cta>
    </Page>
  );
}
