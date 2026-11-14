import React from 'react';

// Stroke icons from the Lookabout design. All decorative: pair them with text
// or put an aria-label on the control.

function Icon({ size = 20, strokeWidth = 2, children, style }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

export const VideoIcon = (p) => (
  <Icon {...p}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></Icon>
);
export const PhoneIcon = (p) => (
  <Icon {...p}><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></Icon>
);
export const LockIcon = (p) => (
  <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>
);
export const ChevronLeftIcon = (p) => <Icon {...p}><path d="M15 18l-6-6 6-6" /></Icon>;
export const ChevronDownIcon = (p) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const FullscreenIcon = (p) => (
  <Icon {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></Icon>
);
export const MicIcon = (p) => (
  <Icon {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" /></Icon>
);
export const MusicIcon = (p) => (
  <Icon {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Icon>
);
export const BulbIcon = (p) => (
  <Icon {...p}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /></Icon>
);
export const SnapshotIcon = (p) => (
  <Icon {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Icon>
);
export const GridIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </Icon>
);
export const ClockIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Icon>;
export const BellIcon = (p) => (
  <Icon {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></Icon>
);
export const PlusIcon = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const SpeakerIcon = (p) => (
  <Icon {...p}><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></Icon>
);
export const SwapIcon = (p) => <Icon {...p}><path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7" /></Icon>;
export const WarningIcon = (p) => (
  <Icon {...p}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></Icon>
);
export const WifiOffIcon = (p) => (
  <Icon {...p}><path d="M1 1l22 22M16.7 16.7A7 7 0 0 1 12 18.4M5 12.6a10 10 0 0 1 3.2-2.7M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.7-2.9M8.5 16a4 4 0 0 1 5.1-.4M12 20h.01" /></Icon>
);
export const CameraOffIcon = (p) => (
  <Icon {...p}><path d="M1 1l22 22M15 15v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3M9 6h4a2 2 0 0 1 2 2v3.3l1 1L23 7v10" /></Icon>
);
export const CheckIcon = (p) => <Icon {...p}><path d="M20 6L9 17l-5-5" /></Icon>;
export const RecordIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="4" /></Icon>;

export function PlayIcon({ size = 16 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon({ size = 16 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function SpinnerIcon({ size = 36 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 40 40" className="lk-spin">
      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border-strong)" strokeWidth="4" />
      <path d="M20 4a16 16 0 0 1 16 16" fill="none" stroke="var(--text-strong)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function BatteryLowIcon() {
  return (
    <svg aria-hidden="true" width="40" height="22" viewBox="0 0 40 22">
      <rect x="1" y="1" width="34" height="20" rx="4" fill="none" stroke="var(--osl-warning)" strokeWidth="2" />
      <rect x="36" y="7" width="3" height="8" rx="1" fill="var(--osl-warning)" />
      <rect x="4" y="4" width="5" height="14" rx="1.5" fill="var(--osl-warning)" />
    </svg>
  );
}
