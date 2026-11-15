// State for setup wizards (HANDOVER G2). Kept apart from the component so the
// rules can be checked without a browser.
//
// A wizard's progress is { steps: { [stepId]: { state, reason, summary } }, values }.
//   state    todo | checking | passed | failed   (same words as the hub's
//            /api/setup/{flow} in docs/hub-auth.md)
//   reason   why a check failed, for the person
//   summary  one line shown on a passed step ("Home hub · 112 GB free")
//   values   what the person typed, shared by every step of the flow
//
// Rules:
//   - A step is open to work on only when every step before it has passed.
//   - Passing a step opens the next one; failing keeps it open with the reason.
//   - Going back to a passed step ("Change") sets it and every later step to todo.

export const STATES = ['todo', 'checking', 'passed', 'failed'];

const blank = () => ({ state: 'todo', reason: '', summary: '' });

/** Progress for `steps`, from whatever was saved (or nothing). Never trusts the saved order. */
export function restore(steps, saved) {
  const out = { steps: {}, values: { ...(saved && typeof saved.values === 'object' ? saved.values : {}) } };
  let allPassed = true;
  steps.forEach((step) => {
    const s = saved && saved.steps && saved.steps[step.id];
    let state = s && STATES.includes(s.state) ? s.state : 'todo';
    if (state === 'checking') state = 'todo'; // the page was closed mid-check: nothing is still running
    if (!allPassed) state = 'todo'; // a later step can't stay passed past an unfinished one
    out.steps[step.id] = state === 'todo' ? blank() : { state, reason: state === 'failed' ? String(s.reason || '') : '', summary: state === 'passed' ? String(s.summary || '') : '' };
    if (state !== 'passed') allPassed = false;
  });
  return out;
}

/** Index of the step to work on: the first that hasn't passed, or steps.length when all have. */
export function activeIndex(steps, progress) {
  const i = steps.findIndex((step) => progress.steps[step.id]?.state !== 'passed');
  return i === -1 ? steps.length : i;
}

export const isLocked = (steps, progress, index) => index > activeIndex(steps, progress);
export const isDone = (steps, progress) => activeIndex(steps, progress) === steps.length;

function setStep(progress, id, step) {
  return { ...progress, steps: { ...progress.steps, [id]: step } };
}

export function setValues(progress, patch) {
  return { ...progress, values: { ...progress.values, ...patch } };
}

/** The step's check has started. Refused (returns progress unchanged) if the step is locked or passed. */
export function startCheck(steps, progress, id) {
  const index = steps.findIndex((s) => s.id === id);
  if (index === -1 || index !== activeIndex(steps, progress)) return progress;
  return setStep(progress, id, { state: 'checking', reason: '', summary: '' });
}

/** The check finished. `result` is { ok: true, summary } or { ok: false, reason }. */
export function finishCheck(steps, progress, id, result) {
  if (progress.steps[id]?.state !== 'checking') return progress;
  return setStep(progress, id, result.ok
    ? { state: 'passed', reason: '', summary: String(result.summary || '') }
    : { state: 'failed', reason: String(result.reason || 'That didn’t work. Try again.'), summary: '' });
}

/**
 * Runs a step's check and says how it went, as finishCheck takes it plus any
 * values the check wants kept. A check returns a summary string or
 * { summary, values }, and throws an Error whose message is the reason it
 * failed. A step without a check (a manual confirm) always passes.
 */
export async function runCheck(step, ctx) {
  try {
    const out = step.check ? await step.check(ctx) : '';
    const rich = out && typeof out === 'object';
    return { ok: true, summary: String((rich ? out.summary : out) || ''), values: rich && out.values ? out.values : null };
  } catch (err) {
    const reason = err && typeof err.message === 'string' && err.message.trim() ? err.message : 'That didn’t work. Try again.';
    return { ok: false, reason, values: null };
  }
}

/** Whether passing step `index` finishes the flow. */
export const finishesFlow = (steps, index, result) => result.ok && index === steps.length - 1;

/** Go back to a passed step: it and every step after it start again. */
export function reopen(steps, progress, id) {
  const index = steps.findIndex((s) => s.id === id);
  if (index === -1) return progress;
  const next = { ...progress, steps: { ...progress.steps } };
  steps.slice(index).forEach((s) => {
    next.steps[s.id] = blank();
  });
  return next;
}

/**
 * Keeps a flow's progress in this browser. Used where there's no hub to save
 * to yet (pairing, the Pages install wizard). `secret` names values never
 * written to storage (pairing codes, keys, passwords).
 *
 * A hub-backed store with the same { load, save, clear } shape goes on
 * /api/setup/{flow} once the hub has it (docs/hub-auth.md, "Setup wizards").
 */
export function localProgress(flow, { secret = [], storage } = {}) {
  const key = `lookabout-wizard:${flow}`;
  const area = () => storage || window.localStorage;
  return {
    load() {
      try {
        const raw = area().getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null; // storage blocked or garbage: start from the top
      }
    },
    save(progress) {
      const values = { ...progress.values };
      secret.forEach((k) => delete values[k]);
      try {
        area().setItem(key, JSON.stringify({ steps: progress.steps, values }));
      } catch {
        // Storage blocked: progress just isn't remembered.
      }
    },
    clear() {
      try {
        area().removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}
