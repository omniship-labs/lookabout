import React from 'react';
import { announce } from '../lib/hooks.js';
import { activeIndex, finishCheck, finishesFlow, localProgress, reopen, restore, runCheck, setValues, startCheck } from '../lib/wizard.js';
import { Cta, Note, display, mono } from './ui.jsx';
import { CheckIcon, ChevronDownIcon, WarningIcon } from './icons.jsx';

// Shared step UI for setup flows (issue #49): hub pairing today; hub
// install, remote access, Google and Apple sign-in next (issues #53–#56).
//
// <Wizard flow="hub-pair" steps={[...]} onDone={(values) => …} />
//
// A step:
//   id, title
//   guide     what to do: one paragraph, or (for several actions in order) a short numbered list; each a string,
//             or an array where nested arrays are bold
//   copy      [{ label, text }]   boxes with a Copy button (commands, redirect URLs)
//   links     [{ label, href }]   deep links, opened in a new tab
//             (guide, copy and links can also be (values) => the same, for addresses typed earlier)
//   body      (ctx) => node       the thing to do: fields, pickers
//   ready     (values) => bool    false keeps the button disabled (nothing typed yet)
//   check     async (ctx) => summary | { summary, values }
//             Throw an Error whose message says, for the person, what went wrong.
//             Leave out for a manual step: the button then just confirms.
//   checkLabel, checkingLabel, confirmLabel   (checkLabel can also be (values) => text)
//   plan      [{ host, sends }]   who the check contacts and what it sends, shown before it runs
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {steps.length > 1 ? <Progress current={current} total={steps.length} done={done} /> : null}
      {current > 0 ? <FinishedSteps steps={steps.slice(0, current)} progress={progress} onChange={(id) => setProgress((p) => reopen(steps, p, id))} /> : null}
      {!done ? (
        <StepBody
          key={steps[current].id}
          step={steps[current]}
          status={progress.steps[steps[current].id]}
          values={progress.values}
          set={set}
          headingRef={(el) => {
            headings.current[steps[current].id] = el;
          }}
          onCheck={() => run(steps[current], current)}
          single={steps.length === 1}
        />
      ) : (
        <p style={{ margin: 0, fontSize: 16, color: 'var(--text-strong)' }}>That’s everything.</p>
      )}
    </div>
  );
}

/** Where you are: one short segment per step, and a plain line of words. */
function Progress({ current, total, done }) {
  const label = done ? 'All steps done' : `Step ${current + 1} of ${total}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div role="img" aria-label={label} style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 'var(--radius-pill)',
              background: i < current || done ? 'var(--text-strong)' : i === current ? 'color-mix(in srgb, var(--text-strong) 40%, transparent)' : 'var(--border)',
              transition: 'background var(--dur-base, 200ms) var(--ease-out, ease-out)',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

/** What is already done, folded away until asked for. */
function FinishedSteps({ steps, progress, onChange }) {
  return (
    <details className="lk-fold">
      <summary
        className="lk-sum"
        style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}
      >
        <span style={{ color: 'var(--osl-success)', display: 'flex' }}><CheckIcon size={16} strokeWidth={2.5} /></span>
        {steps.length} step{steps.length === 1 ? '' : 's'} done
        <span style={{ color: 'var(--text-muted)', display: 'flex', marginLeft: 'auto' }}><ChevronDownIcon size={16} /></span>
      </summary>
      <ul style={{ listStyle: 'none', margin: 0, padding: '2px 0 6px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((step) => {
          const status = progress.steps[step.id];
          return (
            <li key={step.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 }}>
                <span style={{ fontSize: 14, color: 'var(--text-strong)' }}>{step.title}</span>
                {status && status.summary ? <span style={{ fontSize: 13, color: 'var(--text-muted)', wordBreak: 'break-word' }}>{status.summary}</span> : null}
              </span>
              <button type="button" onClick={() => onChange(step.id)} style={linkButton}>
                Change<span className="lk-sr"> {step.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The step to work on: no box, no badge, just what to do. */
function StepBody({ step, status, values, set, headingRef, onCheck, single }) {
  const id = React.useId();
  const state = status?.state || 'todo';
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
        : pick(step.checkLabel) || 'Check';
  return (
    <section aria-labelledby={id} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* A flow of one step already has its title on the page: keep the heading for screen readers only. */}
      <h2 id={id} ref={headingRef} tabIndex={-1} className={single ? 'lk-sr' : undefined} style={single ? undefined : display(24, { lineHeight: 1.2, outline: 'none' })}>{step.title}</h2>
      {guide ? <Guide items={guide} /> : null}
      {copies.map((c) => <CopyBox key={c.label} label={c.label} text={c.text} />)}
      {links && links.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 600, minHeight: 32, display: 'inline-flex', alignItems: 'center', color: 'var(--text-strong)' }}>
              {l.label} ↗
            </a>
          ))}
        </div>
      ) : null}
      {step.body ? <fieldset disabled={checking} style={fieldset}>{step.body({ values, set })}</fieldset> : null}
      {(step.plan || []).map((p) => (
        <span key={p.host} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Contacts <strong style={{ color: 'var(--text-body)', fontWeight: 600 }}>{p.host}</strong> · sends {p.sends.charAt(0).toLowerCase() + p.sends.slice(1)}
        </span>
      ))}
      {state === 'failed' ? (
        <p role="alert" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, color: 'var(--osl-danger)' }}>
          <span style={{ display: 'flex', marginTop: 2 }}><WarningIcon size={16} /></span>
          {status.reason}
        </p>
      ) : null}
      <Cta disabled={checking || !ready} onClick={onCheck}>{label}</Cta>
      {step.note ? <Note center>{step.note}</Note> : null}
    </section>
  );
}

const fieldset = { margin: 0, padding: 0, border: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 };

const linkButton = {
  minHeight: 44,
  padding: '0 4px',
  border: 0,
  background: 'transparent',
  font: '500 14px var(--font-sans)',
  color: 'var(--text-muted)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  flexShrink: 0,
};

const bodyText = { margin: 0, fontSize: 16, lineHeight: 1.55, color: 'var(--text-body)' };

function renderPart(item) {
  return Array.isArray(item)
    ? item.map((part, j) => (Array.isArray(part) ? <strong key={j} style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{part[0]}</strong> : part))
    : item;
}

/** What to do. One thing is a sentence; several in order are a short numbered list. */
function Guide({ items }) {
  if (items.length === 1) return <p style={bodyText}>{renderPart(items[0])}</p>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, ...bodyText }}>
          <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
          <span>{renderPart(item)}</span>
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
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)' }}>
        <code ref={box} style={{ ...mono(13), letterSpacing: 0, lineHeight: 1.6, color: 'var(--text-strong)', flexGrow: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'pre' }}>
          {text}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          style={{ flexShrink: 0, minWidth: 64, height: 36, padding: '0 12px', borderRadius: 'var(--radius-sm)', border: 0, background: 'var(--surface-card)', font: '600 13px var(--font-sans)', color: 'var(--text-strong)' }}
        >
          {copied || 'Copy'}
        </button>
      </div>
    </div>
  );
}
