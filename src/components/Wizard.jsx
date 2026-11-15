import React from 'react';
import { announce } from '../lib/hooks.js';
import { activeIndex, finishCheck, finishesFlow, localProgress, reopen, restore, runCheck, setValues, startCheck } from '../lib/wizard.js';
import { Bar, Cta, Eyebrow, Note, Pill, cardStyle, display, mono } from './ui.jsx';
import { CheckIcon, LockIcon, SpinnerIcon, WarningIcon } from './icons.jsx';

// Shared step UI for setup flows (issue #49): hub pairing today; hub
// install, remote access, Google and Apple sign-in next (issues #53–#56).
//
// <Wizard flow="hub-pair" steps={[...]} onDone={(values) => …} />
//
// A step:
//   id, title
//   guide     numbered substeps; each a string, or an array where nested arrays are bold
//   copy      [{ label, text }]   boxes with a Copy button (commands, redirect URLs)
//   links     [{ label, href }]   deep links, opened in a new tab
//             (guide, copy and links can also be (values) => the same, for addresses typed earlier)
//   body      (ctx) => node       the thing to do: fields, pickers
//   ready     (values) => bool    false keeps the button disabled (nothing typed yet)
//   check     async (ctx) => summary | { summary, values }
//             Throw an Error whose message says, for the person, what went wrong.
//             Leave out for a manual step: the button then just confirms.
//   checkLabel, checkingLabel, confirmLabel
//   note      small print under the button
//
// ctx is { values, set(patch) }. Values are shared across the flow's steps.
// Progress is kept by `store` ({ load, save }); by default in this browser,
// with `secret` values (codes, keys) never written down. `forgetWhenDone`
// drops the saved progress once the last step passes (flows that are run
// again from the top, such as pairing). `restart` ignores saved progress
// (a link that brings its own values).

function useMounted() {
  const mounted = React.useRef(true);
  React.useEffect(() => () => {
    mounted.current = false;
  }, []);
  return mounted;
}

export function Wizard({ flow, steps, initialValues, secret, store: givenStore, forgetWhenDone = false, restart = false, onDone }) {
  const store = React.useMemo(() => givenStore || localProgress(flow, { secret }), [givenStore, flow, secret]);
  const [progress, setProgress] = React.useState(() => {
    const p = restore(steps, restart ? null : store.load());
    const given = Object.fromEntries(Object.entries(initialValues || {}).filter(([, v]) => v != null && v !== ''));
    return setValues(p, given);
  });
  const mounted = useMounted();
  const headings = React.useRef({});
  const current = activeIndex(steps, progress);
  const lastActive = React.useRef(current);
  const forgotten = React.useRef(false);

  React.useEffect(() => {
    if (!forgotten.current) store.save(progress);
  }, [store, progress]);

  // When a step passes, move focus to the next one so keyboard and screen
  // reader users land where the work is. Not on first render.
  React.useEffect(() => {
    if (current !== lastActive.current && current < steps.length) headings.current[steps[current].id]?.focus();
    lastActive.current = current;
  }, [current, steps]);

  const set = React.useCallback((patch) => setProgress((p) => setValues(p, patch)), []);

  const run = async (step, index) => {
    const ctx = { values: progress.values, set };
    setProgress((p) => startCheck(steps, p, step.id));
    const result = await runCheck(step, ctx);
    const { values } = result;
    const finished = finishesFlow(steps, index, result);
    if (finished && forgetWhenDone) {
      forgotten.current = true;
      store.clear?.();
    }
    if (mounted.current) {
      setProgress((p) => finishCheck(steps, values ? setValues(p, values) : p, step.id, result));
      announce(result.ok ? `${step.title}: done.` : `${step.title}: ${result.reason}`);
    }
    // Called even if the check's own work replaced this screen (pairing does).
    if (finished && onDone) onDone({ ...progress.values, ...values });
  };

  const done = current === steps.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Eyebrow>{done ? 'ALL STEPS DONE' : `STEP ${current + 1} OF ${steps.length}`}</Eyebrow>
        <Bar value={Math.round((current / steps.length) * 100)} tone={done ? 'success' : 'strong'} />
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((step, i) => (
          <li key={step.id}>
            <StepCard
              step={step}
              number={i + 1}
              status={progress.steps[step.id]}
              locked={i > current}
              previous={i > 0 ? steps[i - 1].title : ''}
              values={progress.values}
              set={set}
              headingRef={(el) => {
                headings.current[step.id] = el;
              }}
              onCheck={() => run(step, i)}
              onChange={() => setProgress((p) => reopen(steps, p, step.id))}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

const badgeBase = {
  flexShrink: 0,
  width: 28,
  height: 28,
  boxSizing: 'border-box',
  borderRadius: 'var(--radius-pill)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...mono(12),
  letterSpacing: 0,
};

function Badge({ state, locked, number }) {
  if (state === 'passed') {
    return <span style={{ ...badgeBase, background: 'var(--osl-success)', color: 'var(--osl-ink)' }}><CheckIcon size={16} strokeWidth={3} /></span>;
  }
  if (state === 'checking') return <span style={badgeBase}><SpinnerIcon size={24} /></span>;
  if (state === 'failed') {
    return <span style={{ ...badgeBase, border: '1.5px solid var(--osl-danger)', color: 'var(--osl-danger)' }}><WarningIcon size={15} /></span>;
  }
  if (locked) {
    return <span style={{ ...badgeBase, border: '1.5px solid var(--border-strong)', color: 'var(--text-muted)' }}><LockIcon size={14} /></span>;
  }
  return <span style={{ ...badgeBase, background: 'var(--surface-inverse)', color: 'var(--text-on-dark)' }}>{number}</span>;
}

const stateLabel = { passed: 'DONE', checking: 'CHECKING', failed: 'NOT YET' };

function StepCard({ step, number, status, locked, previous, values, set, headingRef, onCheck, onChange }) {
  const id = React.useId();
  const state = status?.state || 'todo';
  const open = !locked && state !== 'passed';
  const checking = state === 'checking';
  const ready = step.ready ? step.ready(values) : true;
  const manual = !step.check;
  const pick = (x) => (typeof x === 'function' ? x(values) : x);
  const guide = pick(step.guide);
  const copies = pick(step.copy) || [];
  const links = pick(step.links);
  const label = checking
    ? step.checkingLabel || 'Checking…'
    : state === 'failed'
      ? 'Try again'
      : manual
        ? step.confirmLabel || 'I’ve done this'
        : step.checkLabel || 'Check';

  return (
    <section
      aria-labelledby={id}
      style={{
        ...cardStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        opacity: locked ? 0.6 : 1,
        borderColor: state === 'failed' ? 'var(--osl-danger)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Badge state={state} locked={locked} number={number} />
        <h2 id={id} ref={headingRef} tabIndex={-1} style={display(17, { flexGrow: 1, minWidth: 0, lineHeight: 1.25, outline: 'none' })}>
          <span className="lk-sr">Step {number}: </span>
          {step.title}
        </h2>
        {stateLabel[state] ? (
          <Pill small tone={state === 'passed' ? 'success' : state === 'failed' ? 'caution' : 'outline'}>{stateLabel[state]}</Pill>
        ) : null}
      </div>

      {locked ? <Note size={13}>Finish “{previous}” first.</Note> : null}

      {state === 'passed' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Note size={13} style={{ flexGrow: 1, minWidth: 0 }}>{status.summary || 'Done.'}</Note>
          <button type="button" onClick={onChange} style={linkButton}>
            Change<span className="lk-sr"> {step.title}</span>
          </button>
        </div>
      ) : null}

      {open ? (
        <>
          {guide ? <Guide items={guide} /> : null}
          {copies.map((c) => <CopyBox key={c.label} label={c.label} text={c.text} />)}
          {links && links.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {links.map((l) => (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 600, minHeight: 32, display: 'inline-flex', alignItems: 'center' }}>
                  {l.label} ↗
                </a>
              ))}
            </div>
          ) : null}
          {step.body ? <fieldset disabled={checking} style={fieldset}>{step.body({ values, set })}</fieldset> : null}
          {state === 'failed' ? (
            <p role="alert" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--osl-danger)' }}>{status.reason}</p>
          ) : null}
          <Cta disabled={checking || !ready} onClick={onCheck}>{label}</Cta>
          {step.note ? <Note center>{step.note}</Note> : null}
        </>
      ) : null}
    </section>
  );
}

const fieldset = { margin: 0, padding: 0, border: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 };

const linkButton = {
  minHeight: 44,
  padding: '0 4px',
  border: 0,
  background: 'transparent',
  font: '600 14px var(--font-sans)',
  color: 'var(--lk-link)',
  flexShrink: 0,
};

/** Numbered substeps inside a step. */
function Guide({ items }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-body)' }}>
          {Array.isArray(item)
            ? item.map((part, j) => (Array.isArray(part) ? <strong key={j} style={{ color: 'var(--text-strong)' }}>{part[0]}</strong> : part))
            : item}
        </li>
      ))}
    </ol>
  );
}

async function copyText(text, node) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard access (plain http on some browsers): select it for Ctrl/Cmd+C instead.
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return false;
  }
}

/** A command or address with a Copy button. */
export function CopyBox({ label, text }) {
  const [copied, setCopied] = React.useState('');
  const box = React.useRef(null);
  React.useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(''), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const ok = await copyText(text, box.current);
    setCopied(ok ? 'Copied' : 'Selected');
    announce(ok ? `${label} copied.` : `${label} selected. Press Control or Command and C to copy.`);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <Eyebrow>{label}</Eyebrow>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 4px 4px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border)',
        }}
      >
        <code ref={box} style={{ ...mono(12), letterSpacing: 0, lineHeight: 1.6, color: 'var(--text-body)', flexGrow: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'pre' }}>
          {text}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          style={{
            flexShrink: 0,
            minWidth: 72,
            height: 40,
            padding: '0 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-strong)',
            background: 'var(--surface-card)',
            font: '600 13px var(--font-sans)',
            color: 'var(--text-strong)',
          }}
        >
          {copied || 'Copy'}
        </button>
      </div>
    </div>
  );
}
