import React from 'react';
import { href } from '../lib/router.js';
import { usePrefersReducedMotion } from '../lib/hooks.js';
import { LensWordmark } from '../components/brand.jsx';
import { Eyebrow, Page, Spacer, display, mono } from '../components/ui.jsx';
import { LockIcon, PhoneIcon, VideoIcon } from '../components/icons.jsx';

/** Launch screen: the wordmark animation plays once, then rests on the full mark. */
export function Splash({ onDone }) {
  const reduced = usePrefersReducedMotion();
  React.useEffect(() => {
    // The mark is complete at 80% of the 6 s animation.
    const id = setTimeout(onDone, reduced ? 1200 : 4900);
    return () => clearTimeout(id);
  }, [onDone, reduced]);
  return (
    <div
      data-theme="dark"
      onClick={onDone}
      style={{
        minHeight: '100dvh',
        boxSizing: 'border-box',
        background: 'var(--surface-page)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingBottom: 40,
      }}
    >
      <Spacer />
      <LensWordmark size={56} animate />
      <Spacer />
      <span style={{ ...mono(11, true), color: 'var(--text-muted)' }}>AN OMNISHIP LABS PROJECT</span>
    </div>
  );
}

function RoleCard({ to, primary, icon, title, children }) {
  return (
    <a
      href={href(to)}
      className="lk-role"
      style={{
        textDecoration: 'none',
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        padding: 20,
        background: 'var(--surface-card)',
        border: primary ? '1.5px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: primary ? 'var(--lk-raised-shadow)' : 'var(--lk-card-shadow)',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-md)',
          background: primary ? 'var(--accent)' : 'var(--surface-inverse)',
          color: primary ? 'var(--text-on-accent)' : 'var(--text-on-dark)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', color: 'var(--text-strong)' }}>{title}</span>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>{children}</span>
      </div>
    </a>
  );
}

/** 1 · Start: pick a role for this device. */
export function Start() {
  return (
    <Page pad="56px var(--lk-side) 28px" gap={28}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <LensWordmark size={24} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow size={12}>STEP 1 OF 2</Eyebrow>
        <h1 style={display(34, { lineHeight: 1.05 })}>What should this device do?</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 'var(--leading-normal)' }}>
          Any phone, laptop or webcam works. Pick a role here, then pair it with your other device.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RoleCard to="/camera/setup" primary icon={<VideoIcon size={24} />} title="Use as a camera">
          Point it at the crib or the door. It streams to your viewers and can sit with the screen off.
        </RoleCard>
        <RoleCard to="/live" icon={<PhoneIcon size={24} />} title="Use as a viewer">
          Watch and listen from your phone. Get alerts for crying, sound or motion.
        </RoleCard>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '14px 16px',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--lk-strip-border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span style={{ color: 'var(--osl-success)', display: 'flex' }}><LockIcon size={18} /></span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-body)' }}>
          Video goes device to device, end-to-end encrypted. Nothing is uploaded unless you add a home hub.
        </span>
      </div>

      <Spacer />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...mono(11), color: 'var(--text-muted)' }}>
        <span>BY OMNISHIP LABS</span>
        <span>AGPL-3.0</span>
      </div>
    </Page>
  );
}
