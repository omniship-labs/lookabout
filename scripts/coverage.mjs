// Web test coverage for the PR check (npm run coverage).
//
// Node's test runner only measures files that a test loads, so a file with no
// tests at all wouldn't show up and the total would look better than it is.
// This script therefore also fails when a file in src/lib isn't loaded by any
// test, unless it is listed in UNTESTED below. It also fails when a listed
// file now has tests: take it off the list.
//
// Raise the floors when tests add coverage; never lower them to get a change
// through. Screens and components (JSX) aren't measured: they're checked in a
// browser (see AGENTS.md).

import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';

const FLOORS = { lines: 83, branches: 96, functions: 82 };

// src/lib files with no tests yet, and why. Shrink this list; don't grow it.
const UNTESTED = {
  'flash.js': 'Web Serial and esptool-js; needs a browser',
  'hooks.js': 'React hooks',
  'router.js': 'React hook around location.hash',
  'sampleData.js': 'sample content, no logic',
  'snapshot.js': 'reads the app store (React); its naming is in snapshotName.js',
  'store.js': 'React store',
};

const run = spawnSync(process.execPath, [
  '--test',
  // A fixed reporter, so the report below always has the same shape
  // (Node 24's default for CI is 'spec', which prefixes lines differently).
  '--test-reporter=tap',
  '--experimental-test-coverage',
  '--test-coverage-include=src/lib/**',
  `--test-coverage-lines=${FLOORS.lines}`,
  `--test-coverage-branches=${FLOORS.branches}`,
  `--test-coverage-functions=${FLOORS.functions}`,
  'tests/**/*.test.mjs',
], { encoding: 'utf8' });
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);

const report = run.stdout.slice(run.stdout.search(/^[#ℹ] start of coverage report/m), run.stdout.search(/^[#ℹ] end of coverage report/m));
const measured = new Set([...report.matchAll(/^[#ℹ]\s+([\w.-]+\.js)\s+\|/gm)].map((m) => m[1]));
const files = readdirSync('src/lib').filter((f) => f.endsWith('.js'));
const problems = [];
if (!measured.size) problems.push('No coverage report found in the test output; the script needs updating for this Node version.');
for (const f of files) {
  if (!measured.has(f) && !UNTESTED[f]) problems.push(`src/lib/${f} has no tests. Add some in tests/, or list it in UNTESTED in scripts/coverage.mjs with the reason.`);
  if (measured.has(f) && UNTESTED[f]) problems.push(`src/lib/${f} has tests now: take it off UNTESTED in scripts/coverage.mjs.`);
}
for (const f of Object.keys(UNTESTED)) {
  if (!files.includes(f)) problems.push(`UNTESTED in scripts/coverage.mjs lists ${f}, which isn't in src/lib any more.`);
}

const total = report.match(/^[#ℹ] all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = total
    ? [['lines', total[1]], ['branches', total[2]], ['functions', total[3]]].map(([k, v]) => `| ${k} | ${v}% | ${FLOORS[k]}% |`)
    : ['| (no report) | | |'];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Web coverage (src/lib)', '', '| | now | floor |', '|---|---|---|', ...rows, '',
    `Not measured yet: ${Object.keys(UNTESTED).join(', ')}.`, '',
    ...problems.map((p) => `- ❌ ${p}`), '',
  ].join('\n'));
}
for (const p of problems) console.error(`coverage: ${p}`);
if (total) {
  const roomy = Object.entries(FLOORS).filter(([k], i) => Number(total[i + 1]) - FLOORS[k] >= 3);
  if (roomy.length) console.log(`coverage: ${roomy.map(([k]) => k).join(', ')} is 3+ points over its floor; raise FLOORS in scripts/coverage.mjs.`);
}
process.exit(run.status || (problems.length ? 1 : 0));
