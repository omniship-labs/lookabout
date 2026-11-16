# Browser checks against a real hub (by hand, not part of `npm test`)

These drive the built web app in Chromium (Playwright) against a real hub process,
with a virtual authenticator for the passkey step. They are the "seen working" check
for the sign-in, Household and Account screens. They need no go2rtc, camera or Pi.

```sh
npm run build                                   # needs NODE_AUTH_TOKEN (#41)
export SCR=$(mktemp -d)                         # state shared between the scripts
cd hub && python3 -m lookabout_hub --data $SCR/data --port 8799 --web ../dist --no-mdns --name "Smoke hub" &
cd ..                                           # then, in order, each against the same fresh hub:
SCR=$SCR node tests/browser/1-first-admin-household.cjs   # first admin, group, invite (writes admin-state.json, invite.txt; script 3 signs in again with the same fixed smoke-test credentials)
SCR=$SCR node tests/browser/2-passkey-and-invite.cjs      # passkey (virtual authenticator), join by invite, sign out
SCR=$SCR node tests/browser/3-google-redirect.cjs         # the "Continue with Google" redirect (no Google account needed)
```

`playwright` has to be resolvable (`npm i -D playwright`, or run where it is installed globally).
A hub that already has an admin needs a fresh `--data` folder to run script 1 again.

What they do **not** cover: the look (they were first run with stand-in design tokens), a real Google or
Apple sign-in, a hardware passkey, Safari or Firefox, or video.
