import React from 'react';
import { Button } from '@omniship-labs/design-beacon/Button';
import { href } from '../lib/router.js';
import { ChevronLeftIcon } from './icons.jsx';

// Presentational primitives for Lookabout that aren't exported by
// @omniship-labs/design-beacon 0.1.0 (Switch, Badge, Card, Input) or are new
// for this app (SegmentedControl, list groups, pills). Built from the same
// tokens so they read as part of the system; promote upstream if other
// projects need them.

export const mono = (size = 11, wide = false) => ({
  fontFamily: 'var(--font-mono)',
  fontWeight: 500,
  fontSize: size,
  letterSpacing: wide ? 'var(--tracking-wide)' : 'var(--tracking-label)',
});

export const display = (size, extra) => ({
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  fontSize: size,
  letterSpacing: 'var(--tracking-tight)',
  color: 'var(--text-strong)',
  ...extra,
});

export const cardStyle = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
};

/** Full-height page column. Follows the app theme (System / Light / Dark). */
export function Page({ pad = '48px var(--lk-side) 28px', gap = 18, align, children }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--surface-page)',
        color: 'var(--text-body)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 'var(--lk-col)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: align,
          padding: pad,
          gap,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const Spacer = () => <div style={{ flexGrow: 1 }} />;

export function Eyebrow({ size = 11, children, style }) {
  return <span style={{ ...mono(size, true), color: 'var(--text-muted)', ...style }}>{children}</span>;
}

export function Note({ size = 12, center = false, children, style }) {
  return (
    <span
      style={{
        fontSize: size,
        lineHeight: size >= 13 ? 1.5 : 1.45,
        color: 'var(--text-muted)',
        textAlign: center ? 'center' : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** 44px back chevron plus an optional mono eyebrow or a title beside it. */
export function BackBar({ to, eyebrow, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: eyebrow ? 8 : 4 }}>
      <a
        href={href(to)}
        aria-label="Back"
        style={{
          width: 44,
          height: 44,
          marginLeft: -10,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-strong)',
        }}
      >
        <ChevronLeftIcon size={22} />
      </a>
      {eyebrow ? <Eyebrow size={12}>{eyebrow}</Eyebrow> : null}
      {title ? <h1 style={display(26)}>{title}</h1> : null}
    </div>
  );
}

/**
 * Cta — the design system Button at app sizes.
 * `primary` is the one Beacon action per view; `outline` and `secondary` for the rest.
 */
export function Cta({ variant = 'primary', height, style, children, ...rest }) {
  const dsVariant = variant === 'outline' ? 'ghost' : variant;
  return (
    <Button
      variant={dsVariant}
      fullWidth
      style={{
        height: height || (variant === 'primary' ? 52 : 48),
        boxSizing: 'border-box',
        padding: '0 18px',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontWeight: variant === 'outline' ? 500 : 600,
        fontSize: variant === 'primary' ? 16 : 15,
        letterSpacing: 0,
        ...(variant === 'secondary' ? { border: '1px solid var(--border-strong)' } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Button>
  );
}

/** Switch — 44 × 26 track. On = Ink in light, success in dark. */
export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        width: 44,
        height: 26,
        border: 0,
        borderRadius: 'var(--radius-pill)',
        padding: 3,
        boxSizing: 'border-box',
        display: 'flex',
        background: checked ? 'var(--lk-switch-on)' : 'var(--border-strong)',
        transition: 'background var(--dur-base) var(--ease-out)',
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 'var(--radius-pill)',
          background: 'var(--osl-white)',
          transform: checked ? 'translateX(18px)' : 'none',
          transition: 'transform var(--dur-base) var(--ease-out)',
        }}
      />
    </button>
  );
}

/** SegmentedControl — 2–3 options: mode, appearance, audio mix. */
export function Segmented({ label, options, value, onChange, height = 44, compact = false }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: 4,
        padding: compact ? 3 : 4,
        background: 'var(--surface-sunken)',
        border: compact ? 0 : '1px solid var(--lk-seg-border)',
        borderRadius: compact ? 10 : 'var(--radius-md)',
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              height,
              border: 0,
              borderRadius: compact ? 8 : 9,
              background: on ? 'var(--lk-seg-on)' : 'transparent',
              boxShadow: on && !compact ? 'var(--lk-seg-shadow)' : 'none',
              font: `${on ? 600 : 500} ${compact ? 13 : 14}px var(--font-sans)`,
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              transition: 'background var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Labelled text input. `emphasis` draws the strong focus-style border from the design. */
export function Field({ label, hint, error, monoFont = false, size = 16, height = 44, emphasis = false, style, ...input }) {
  const id = React.useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        style={{
          height,
          width: '100%',
          boxSizing: 'border-box',
          padding: `0 ${height > 50 ? 16 : 14}px`,
          border: emphasis ? '1.5px solid var(--text-strong)' : '1px solid var(--border-strong)',
          borderRadius: height > 50 ? 'var(--radius-md)' : 'var(--radius-sm)',
          background: 'var(--surface-card)',
          font: `500 ${size}px var(--font-${monoFont ? 'mono' : 'sans'})`,
          letterSpacing: monoFont && size > 14 ? 'var(--tracking-label)' : undefined,
          color: 'var(--text-strong)',
        }}
        {...input}
      />
      {error ? <span role="alert" style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--osl-danger)' }}>{error}</span> : null}
      {hint && !error ? <Note>{hint}</Note> : null}
    </div>
  );
}

/** List group card; children are rows and get hairlines between them. */
export function Group({ pad = '0 14px', children, style }) {
  return (
    <div
      className="lk-group"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const rowBase = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  boxSizing: 'border-box',
  width: '100%',
  textAlign: 'left',
  textDecoration: 'none',
  color: 'inherit',
};

/** A row in a Group. Pass `to` for a link row or `onClick` for a button row. */
export function Row({ minHeight = 52, to, onClick, children, style, ...rest }) {
  const s = { ...rowBase, minHeight, padding: '7px 0', ...style };
  if (to) return <a href={href(to)} style={s} {...rest}>{children}</a>;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ ...s, border: 0, borderRadius: 0, background: 'transparent' }} {...rest}>
        {children}
      </button>
    );
  }
  return <div style={s} {...rest}>{children}</div>;
}

export function RowText({ title, sub, weight = 500, muted = false }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flexGrow: 1 }}>
      <span
        style={{
          fontSize: 14,
          fontWeight: weight,
          color: muted ? 'var(--text-muted)' : 'var(--text-strong)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {sub ? <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text-muted)' }}>{sub}</span> : null}
    </span>
  );
}

const pillTones = {
  success: { background: 'var(--osl-success)', color: 'var(--osl-ink)' },
  warning: { background: 'var(--osl-warning)', color: 'var(--osl-ink)' },
  accent: { background: 'var(--accent)', color: 'var(--text-on-accent)' },
  outline: { border: '1px solid var(--border-strong)', color: 'var(--text-body)' },
  scrim: { background: 'var(--lk-scrim)', color: 'var(--text-strong)' },
  caution: { border: '1px solid var(--osl-warning)', color: 'var(--osl-warning)' },
};

/** Mono status pill: LIVE, MOTION, HEARS SOUND, 3 CAMS, VIA HUB. */
export function Pill({ tone = 'outline', small = false, children, style }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        ...mono(small ? 10 : 11),
        padding: small ? '3px 8px' : '4px 10px',
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        ...pillTones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Filter chip, 36 tall. */
export function Chip({ active, onClick, height = 36, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        height,
        padding: `0 ${height >= 36 ? 14 : 12}px`,
        flexShrink: 0,
        borderRadius: 'var(--radius-pill)',
        border: active ? '1px solid transparent' : '1px solid var(--border-strong)',
        background: active ? 'var(--text-strong)' : 'transparent',
        color: active ? 'var(--surface-sunken)' : 'var(--text-body)',
        font: `${active ? 600 : 500} 13px var(--font-sans)`,
        transition: 'background var(--dur-fast) var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}

/** Numbered steps card. A step is a string, or an array where nested arrays are bold. */
export function Steps({ items }) {
  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 12 }}>
          <span
            style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-inverse)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ...mono(11),
              letterSpacing: 0,
              color: 'var(--text-on-dark)',
            }}
          >
            {i + 1}
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-body)' }}>
            {Array.isArray(item)
              ? item.map((part, j) =>
                  Array.isArray(part) ? <strong key={j} style={{ color: 'var(--text-strong)' }}>{part[0]}</strong> : part
                )
              : item}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Warning banner: camera offline, brand connection stopped. */
export function Banner({ icon, title, children, actions }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 10,
        padding: actions ? '14px 16px' : '12px 14px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--osl-warning)',
        background: 'var(--lk-warning-tint)',
      }}
    >
      {icon ? <span style={{ color: 'var(--osl-warning)', marginTop: 1, display: 'flex' }}>{icon}</span> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: actions ? 10 : 2 }}>
        <span style={{ fontSize: actions ? 15 : 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-body)' }}>{children}</span>
        {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
    </div>
  );
}

/** Success status box used in the guided hub / Pi / ESP32 flows. */
export function StatusBox({ label, children, progress }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 16px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--osl-success)',
        background: 'var(--lk-success-tint)',
      }}
    >
      <span style={{ ...mono(11, true), color: 'var(--osl-success)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{children}</span>
      {progress != null ? <Bar value={progress} tone="success" /> : null}
    </div>
  );
}

/** 6px bar: per-camera sound level, progress, volume. */
export function Bar({ value, tone = 'strong', style }) {
  const colors = { strong: 'var(--text-strong)', success: 'var(--osl-success)', warning: 'var(--osl-warning)' };
  return (
    <span
      style={{
        display: 'block',
        flexGrow: 1,
        height: 6,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-sunken)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <span
        style={{
          display: 'block',
          height: 6,
          borderRadius: 'var(--radius-pill)',
          width: `${value}%`,
          background: colors[tone],
          transition: 'width var(--dur-base) var(--ease-out)',
        }}
      />
    </span>
  );
}

/** Bar with an invisible range input on top, so it works as a slider. */
export function SliderBar({ label, value, onChange }) {
  return (
    <span style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center', height: 44 }}>
      <Bar value={value} />
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
      />
    </span>
  );
}

/** Checkbox row mark used when picking cameras found in an account or on the hub. */
export function CheckMark({ on }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        boxSizing: 'border-box',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: on ? 'var(--osl-success)' : 'transparent',
        border: on ? 0 : '1.5px solid var(--border-strong)',
        color: 'var(--osl-ink)',
      }}
    >
      {on ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : null}
    </span>
  );
}
