# Browser checks against a real hub (the `browser` job in `.github/workflows/build.yml`; `npm run browser` locally)

These drive the built web app in Chromium (Playwright) against a real hub process,
with a virtual authenticator for the passkey step. They are the "seen working" check
for the sign-in, Household and Account screens. They need no go2rtc, camera or Pi.

```sh
npm run build                 # needs NODE_AUTH_TOKEN (#41)
npm install --no-save playwright   # not in package.json; browsers: npx playwright install chromium
npm run browser               # starts a fresh hub on port 8799 per script, runs 1 to 4, stops it
```

`tests/browser/run.sh` does the orchestration (and `WEB_DIR=…` picks another build folder). Screenshots and the hub log
go to `tests/browser/out/` (`SCR=…` changes that). To run one script by hand, start a hub the same way
(`LOOKABOUT_IN_CONTAINER=1 PYTHONPATH=hub python3 -m lookabout_hub --data $SCR/data --port 8799 --web dist --no-mdns --name "Smoke hub"`)
and run scripts 1, 2, 3 in order against one fresh hub, and 4 against another.

`playwright` has to be resolvable (`npm i -D playwright`, or run where it is installed globally).
Script 4's Google discovery step contacts accounts.google.com for real if the machine can reach it (and says so if not).

What they do **not** cover: the look (CI builds with the real design package, but nothing asserts how it looks; they were
first written against stand-in tokens), a real Google or Apple sign-in, a hardware passkey, Safari or Firefox, or video.
