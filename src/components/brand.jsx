import React from 'react';

// Lookabout brand marks, built from tokens: the ring is a camera lens, the
// crescent is the night watch and carries the one Beacon moment.

function Eye({ px, small, margin, animate, second }) {
  return (
    <svg
      aria-hidden="true"
      width={px}
      height={px}
      viewBox="0 0 40 40"
      className={second ? 'lk-eye2' : undefined}
      style={{ margin, overflow: 'visible' }}
    >
      <circle cx="20" cy="20" r={small ? 16 : 16.5} fill="none" stroke="currentColor" strokeWidth={small ? 8 : 7} />
      <path
        className={animate ? 'lk-moon' : undefined}
        d={small ? 'M20 11A9 9 0 1 0 29 20A9 9 0 0 1 20 11Z' : 'M20 13A7 7 0 1 0 27 20A7 7 0 0 1 20 13Z'}
        fill="var(--accent)"
      />
    </svg>
  );
}

/**
 * LensWordmark — lowercase "lookabout" where both o's are a lens ring + moon.
 * Sizes used in the app: 24 (header), 26 (sidebar), 56 (launch screen).
 * `animate` plays the launch animation once and rests on the full mark.
 */
export function LensWordmark({ size = 24, animate = false, style }) {
  const small = size < 40;
  const px = Math.round(size * (small ? 0.54 : 0.5536));
  const unit = small ? 0.5 : size / 56;
  return (
    <span
      role="img"
      aria-label="Lookabout"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: size,
        lineHeight: small ? undefined : 1,
        letterSpacing: '-0.03em',
        color: 'var(--text-strong)',
        ...style,
      }}
    >
      <span>l</span>
      <Eye px={px} small={small} animate={animate} margin={`0 ${unit}px 0 ${unit * 2}px`} />
      <Eye px={px} small={small} animate={animate} second margin={`0 ${unit}px`} />
      <span>kabout</span>
    </span>
  );
}

/** AppIcon — Ink tile, paper ring, Beacon moon. Ring and moon thicken under 32px. */
export function AppIcon({ size = 40, label, style }) {
  const v =
    size >= 44
      ? { r: 19, w: 5, d: 'M32 23A9 9 0 1 0 41 32A9 9 0 0 1 32 23Z' }
      : size >= 20
        ? { r: 19, w: 6, d: 'M32 22A10 10 0 1 0 42 32A10 10 0 0 1 32 22Z' }
        : { r: 18, w: 8, d: 'M32 21A11 11 0 1 0 43 32A11 11 0 0 1 32 21Z' };
  return (
    <svg
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{ flexShrink: 0, ...style }}
    >
      <rect width="64" height="64" rx="14" fill="var(--surface-inverse)" />
      <circle cx="32" cy="32" r={v.r} fill="none" stroke="var(--text-on-dark)" strokeWidth={v.w} />
      <path d={v.d} fill="var(--accent)" />
    </svg>
  );
}

/** LensGlyph — the bare one-colour mark. `quiet` draws the empty-state version. */
export function LensGlyph({ size = 24, quiet = false }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke={quiet ? 'var(--border-strong)' : 'currentColor'}
        strokeWidth={quiet ? 6 : 7}
      />
      <path d="M32 21.5A10.5 10.5 0 1 0 42.5 32A10.5 10.5 0 0 1 32 21.5Z" fill="currentColor" />
    </svg>
  );
}
