# Hub accounts and access: API contract

Status: **owner's answers in (15 Nov 2026), ready for sign-off** (issue #48).
Built in the hub so far (G3, `hub/lookabout_hub/accounts.py`, `webauthn.py`, `oidc.py`, `vault.py`, `server.py`):
local accounts, passkeys, Google and Apple sign-in, the app token exchange, provider settings, first admin,
sessions, invites, camera groups and grants, sharing, tickets, the audit log, route enforcement and no CORS, the
move from pairing keys. **Not built:** the setup wizard endpoints (`/api/setup/{flow}…`) and remote access.
Passkeys, Google and Apple are tested against stand-ins (a software authenticator, a fake provider): **never tried
with a real device, Google account or Apple developer account.**
Where the build added to or settled something this document left open, it says so under
[As built](#as-built). Task numbers below are the GitHub issues' titles:
G1–G10 are #48–#57 (epic #13), F1 is #43, F5 is #47, E4 is #39. The hub today has pairing keys only (B3, `hub/lookabout_hub/pairing.py`);
this document is what replaces them. It is written to be language-neutral:
the hub is Python (B9), but nothing below depends on that.

The owner's decisions on the open questions are listed at the end
([Decisions](#decisions-15-nov-2026)) and marked **(Q1)**, **(Q2)**… where they apply.

## What this covers

- Who can sign in to a hub, and how (local accounts, Google, Apple).
- Households: members, the two roles, camera groups with view or manage access, invites.
- How every existing hub route is authorised once accounts exist.
- The endpoints the setup wizards (G2, G6–G10) call to save progress and run checks.
- Moving from today's pairing keys to accounts.

Not covered: alerts (B8), the phone-to-phone path (C), remote video transport
details beyond what authorisation needs (G7).

## Ground rules

1. **Everything lives on the hub.** The public Pages site has no accounts, no
   backend and no video. A sign-in screen on Pages could gate nothing.
2. **No shared OmniShip login service.** Google and Apple sign-in use the
   owner's own keys, stored on their hub. Nothing is uploaded anywhere else.
3. **Local accounts always work**, so a hub with no internet and no domain is
   fully usable.
4. **Deny by default.** Every route that isn't listed as open needs a session.
   Every route that names a camera, event or clip checks that camera.
5. **A hub can't be exposed until this is enforced.** Remote access (G7)
   refuses to switch on unless an admin with a strong credential exists and
   the checks in [Enforcement](#enforcement) are in place (see also F1, F5).

## Terms

| Term | Meaning |
|---|---|
| Household | Everyone who uses one hub. One hub has exactly one household. |
| Member | A person in the household: `id`, `name`, `email`, `role`, `cameras`, `status`. |
| Role | `admin` or `member`. Admins see every camera and can change anything. Members see only the cameras their grants give them. (The handover's "viewer" role is `member` here, since a member can also manage cameras.) |
| Camera group | A named set of cameras, made by admins: "Nursery", "Outside". A camera can be in several groups. A camera in no group is seen by admins only. Adding a camera to a group gives it to everyone with a grant on that group. **(Q6)** |
| Grant | A member's access to one group: `view` or `manage`. A member with several grants covering one camera gets the highest level. |
| `view` | Live video, snapshots, events and clips of the group's cameras, and seeing their zones. |
| `manage` | Everything in `view`, plus for the group's cameras: delete events and clips, edit motion zones and sensitivity, rename the camera, and **share the group** (give other members `view` on it, never `manage`). A manager can take back only the shares they made, never a grant an admin made. Adding or removing cameras, and the groups themselves, stay admin-only. |
| Identity | A way a member signs in: a password, a passkey, a Google account (`sub`), an Apple account (`sub`). A member can have several. |
| Session | Proof that a member signed in on one device. Browser sessions are cookies; app sessions are bearer tokens. Each one is listed under Paired devices and can be ended there. |
| Media ticket | A short-lived, single-camera token for places that can't send a cookie or header (an `<img>` on another origin, a native player). Replaces today's `?token=`. |

## Conventions

- All routes are under `/api` on the hub's own origin, the same as today
  (`hub/lookabout_hub/server.py`). The task list's shorthand `GET /me` means
  `GET /api/me`, and so on.
- Bodies are JSON unless stated. Times are Unix seconds (as the hub uses today).
- Errors keep today's shape and add a stable `code` the apps can switch on:

  ```json
  { "error": "Sign in to see this camera.", "code": "not_signed_in" }
  ```

  `error` is a sentence for the person; `code` is for the app.

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | The body is wrong; `error` says what. |
| 401 | `not_signed_in` | No session, or it has ended or been revoked. |
| 403 | `admin_only` | A member tried something only an admin may do. |
| 403 | `manage_only` | A member with `view` on a camera tried a `manage` action on it. |
| 403 | `not_yours` | A manager tried to take back a grant someone else made. |
| 403 | `bad_origin` | A cookie-authenticated change came from another site (see [CSRF](#csrf-and-origins)). |
| 404 | `not_found` | No such thing, **or the caller may not see it** (see below). |
| 409 | `conflict` | E.g. removing or demoting the last admin, inviting an email that's already a member. |
| 423 | `setup_required` | The hub has no admin yet; only setup routes work. |
| 429 | `too_many_tries` | Rate limit or lockout. `Retry-After` header is set. |

A camera, event or clip the caller can't see answers **404, not 403**, so the
API doesn't confirm which cameras exist. The web app shows its "No access"
state for any 404 on a direct `/live/<id>` link (G3); it can't and needn't
tell "doesn't exist" from "not yours".

## Sessions

### Browser on the hub's own origin (the normal case)

The hub serves the React app (G5 decision), so the dashboard and the API share
one origin. A successful sign-in sets:

```
Set-Cookie: lk_session=<random 32 bytes, base64url>; Path=/; HttpOnly; SameSite=Lax; Secure (when served over https); Max-Age=2592000
```

- The hub stores only a hash of the value, as it does for pairing keys now.
- Lifetime 30 days, sliding: a request in the last 7 days of a session extends
  it. **(Q1)** While remote access is on, sessions last **7 days** (sliding the
  same way, the last 2 days extend it); switching remote access on shortens
  sessions that already exist.
- Signing out, an admin removing the member, or ending the session under
  Paired devices deletes it on the hub; the next request gets 401.
- Changing a member's role or grants takes effect on their next request
  (the hub reads the member on every request; nothing is cached in the cookie).

### Native apps (iOS, Android)

Apps can't share the browser's cookie, so they get a bearer token:

```
Authorization: Bearer <token>
```

This is the same header the hub accepts today. The token is a session like any
other (listed under Paired devices, revocable, tied to one member). Apps get one
by signing in through the hub in a system browser sheet (`ASWebAuthenticationSession`
/ Custom Tabs) with `?app=1`, which ends on `lookabout://hub/signed-in?code=…`;
the app swaps that one-time code for the token at `POST /api/auth/token`
(PKCE-protected, so another app catching the redirect can't use it).

### Media tickets

`<video>`/`<img>` on the hub origin send the cookie, so the web dashboard
needs no tickets. Where a header or cookie can't be sent:

`POST /api/cameras/{id}/ticket` → `{ "ticket": "…", "expires": 1763400000 }`

- Valid for one camera (or one clip), 5 minutes, any number of requests within
  that time (MJPEG reconnects, video range requests).
- Accepted as `?ticket=` on `stream.mjpeg`, `snapshot.jpg` and `/api/clips/{name}`.
- **`?token=` (a full session in a URL) stops being accepted** once tickets
  exist. URLs end up in logs, history and Referer headers.

## Sign-in

### `GET /api/auth/providers` (open)

What the sign-in screen should show. Only enabled providers are listed.

```json
{
  "hub": { "id": "a1b2c3d4e5f60718", "name": "Home hub" },
  "setup_required": false,
  "providers": [
    { "id": "local", "password": true, "passkey": true },
    { "id": "google", "label": "Continue with Google" },
    { "id": "apple", "label": "Continue with Apple" }
  ]
}
```

### `POST /api/auth/login/{provider}`

| `provider` | Body | Result |
|---|---|---|
| `local` | `{ "email", "password" }` | 200 `{ me }` + cookie (or `{ token, me }` with `?app=1`) |
| `passkey` | `{ "credential" }` (WebAuthn assertion) | same |
| `google`, `apple` | `{ "return_to": "/cameras" }` | 200 `{ "redirect": "https://accounts.google.com/…" }`; the app sends the browser there |

Passkey sign-in first calls `POST /api/auth/passkey/options` (open) for a
challenge. The WebAuthn relying party id is the hub's host name, so **a passkey
made on `lookabout.local` won't work on the public tunnel address and vice
versa.** **(Q2)** The hub accepts that: a person adds one passkey per address
they use (Account shows which addresses each passkey works on, and offers
"Add a passkey for this address" when signed in on one that has none). Sign-in
at home never depends on the internet.

Google and Apple come back to:

- `GET /api/auth/callback/google?code=…&state=…`
- `POST /api/auth/callback/apple` (Apple uses `form_post`)

The hub checks `state` (bound to a short-lived cookie), the PKCE verifier and
the ID token's `nonce`, `aud`, `iss` and signature, then looks up the identity:

1. A member already has this Google/Apple `sub` → signed in.
2. Otherwise, a **pending invite** matches the token's email **and the provider
   says the email is verified** → the identity is attached to that member, the
   member becomes `active`, signed in.
3. Otherwise → back to the sign-in screen with "This account isn't part of this
   household. Ask an admin to invite you." No member is created.

Apple may hide the email (private relay). An invite to `x@gmail.com` won't
match a relay address; the member then needs an invite link (below).

### `POST /api/auth/logout`

Ends the current session. 204.

### `POST /api/auth/token` (apps only)

`{ "code", "code_verifier" }` → `{ "token", "me" }`.

### Rate limiting and lockout

- Per client address and per account: 10 failed sign-ins in 15 minutes →
  429 for 15 minutes for that account from that address. A successful sign-in
  from elsewhere is unaffected (no remote lock-out of the owner).
- Setup code, invite links and pairing codes: 5 wrong tries cancel the code
  (as `pairing.py` does today).
- Every sign-in, failure, lockout, invite, role change and provider change is
  written to the audit log (`GET /api/admin/audit`, admins only, newest first,
  kept 90 days).

## First admin

A fresh hub has no members. Until one exists, every route except the open ones
and `/api/setup/*` answers **423 `setup_required`**, and the hub's first-run
page shows a one-time **setup code** (also printed in the container log and by
`install.sh`).

`POST /api/setup/first-admin`

```json
{ "setup_code": "K7QM-2XPA", "name": "Sam", "email": "sam@example.com", "password": "…" }
```

→ 201 `{ me }` + cookie. A passkey can be added straight after with
`POST /api/me/passkeys`. The setup code then stops working; another is never
shown unless the hub is reset (`docker compose run hub --reset-admin`, which
needs shell access to the Pi).

Password rules: at least 10 characters, checked against a short built-in list
of common passwords. Stored with scrypt or Argon2id. "Strong credential" for
G7 means: a passkey, or a password of at least 14 characters. **(Q3)** Every
admin must have one before remote access can be switched on; an admin with
only a shorter password is asked to change it first.

## Me

### `GET /api/me`

```json
{
  "member": { "id": "m-3f2a", "name": "Sam", "email": "sam@example.com", "role": "admin" },
  "household": { "id": "a1b2c3d4e5f60718", "name": "Home" },
  "session": { "id": "s-91c0", "kind": "browser", "device": "Mac browser", "expires": 1766000000 },
  "cameras": "all",
  "groups": "all",
  "sign_in": { "password": true, "passkeys": 1, "google": "sam@gmail.com", "apple": null }
}
```

For an admin, `cameras` and `groups` are `"all"`. For a member they say what
their grants work out to:

```json
"cameras": { "cam-1a2b": "manage", "cam-9f00": "view" },
"groups": [ { "id": "g-nursery", "name": "Nursery", "level": "manage" },
            { "id": "g-outside", "name": "Outside", "level": "view" } ]
```

The web app's `useVisibleCameras()` (G3) uses `cameras` only to decide what to
*show* and which buttons to offer (Delete, Zones, Rename, Share on `manage`);
the hub checks everything itself anyway.

### Also under `/api/me`

| Route | What |
|---|---|
| `PATCH /api/me` | `{ name }` |
| `PUT /api/me/password` | `{ current, new }` |
| `POST /api/me/passkeys`, `DELETE /api/me/passkeys/{id}` | add (two calls: options, then attestation) / remove |
| `POST /api/me/link/{google\|apple}` | attach a provider identity to yourself (same redirect dance as sign-in) |
| `DELETE /api/me/link/{google\|apple}` | detach; refused (409) if it's your last way in |
| `GET /api/me/sessions`, `DELETE /api/me/sessions/{id}` | your own devices |

## Household

### `GET /api/household` (any member)

Members get the member list without emails or grants (just names and roles),
which managers need to pick someone to share with. Admins get everything:

```json
{
  "household": { "id": "a1b2c3d4e5f60718", "name": "Home" },
  "members": [
    { "id": "m-3f2a", "name": "Sam", "email": "sam@example.com", "role": "admin",
      "status": "active", "grants": [], "last_seen": 1763390000 },
    { "id": "m-77de", "name": "Grandma", "email": "gran@example.com", "role": "member",
      "status": "active", "last_seen": 1763300000,
      "grants": [ { "group": "g-nursery", "level": "manage", "by": "m-3f2a" } ] },
    { "id": "m-a011", "name": "", "email": "alex@example.com", "role": "member",
      "status": "invited", "invited": 1763380000,
      "grants": [ { "group": "g-nursery", "level": "view", "by": "m-77de" } ] }
  ],
  "groups": [
    { "id": "g-nursery", "name": "Nursery", "cameras": ["cam-1a2b"] },
    { "id": "g-outside", "name": "Outside", "cameras": ["cam-9f00", "cam-c3d4"] }
  ]
}
```

`by` is who made the grant: an admin, or the manager who shared the group.

### `POST /api/household/invites` (admin)

```json
{ "email": "alex@example.com", "role": "member", "grants": [ { "group": "g-nursery", "level": "view" } ] }
```

→ 201 with the new pending member, plus:

```json
{ "invite_link": "https://hub.example.com/#/join?invite=Q3J…", "expires": 1764000000 }
```

- With Google or Apple on, the invitee just signs in with a matching verified
  email (above).
- With local accounts only, there's no way to prove an email address (the hub
  sends no mail), so the admin passes on the **invite link**. Opening it lets
  the person choose a password or passkey for that pending member. Link: one
  use, 7 days.
- The hub never sends email itself **(Q4)**: the admin passes the link on by
  message or chat. The Invite screen offers Copy and the browser's Share.

`DELETE /api/household/invites/{member_id}` cancels a pending invite.

### `PATCH /api/household/members/{id}` (admin)

Any of `{ "role": "admin" | "member", "grants": [ { "group", "level" } ], "name" }`.
`grants` replaces the member's whole list, including shares managers made.
Unknown group ids → 400. Demoting the last admin → 409.

### `DELETE /api/household/members/{id}` (admin)

Ends all their sessions and removes their identities. Removing the last admin → 409.

### Groups (admin)

| Route | What |
|---|---|
| `POST /api/household/groups` | `{ name, cameras: [ids] }` → 201 with the group |
| `PATCH /api/household/groups/{id}` | any of `{ name, cameras }`; `cameras` replaces the list |
| `DELETE /api/household/groups/{id}` | removes the group and every grant on it; its cameras stay |

The Add camera flow asks which groups a new camera joins (none ticked by default,
so a new camera is admin-only until an admin shares it).

### Sharing (managers and admins)

| Route | What |
|---|---|
| `POST /api/groups/{id}/shares` | `{ member }` gives that member `view` on the group. Needs `manage` on it. Inviting someone new is still admin-only. 409 if they already have a grant on it. |
| `DELETE /api/groups/{id}/shares/{member}` | Takes back a `view` grant. A manager can take back only the ones they made (`by` is them); others → 403 `not_yours`. |

### `GET /api/household/sessions` (admin)

Every session of every member, for the Paired devices screen; `DELETE
/api/household/sessions/{id}` ends one. This replaces `/api/viewers`.

## Provider settings (admin)

### `GET /api/admin/auth/providers`

```json
{
  "public_url": "https://hub.example.com",
  "local": { "enabled": true, "password": true, "passkey": true },
  "google": { "enabled": true, "client_id": "1234-abc.apps.googleusercontent.com",
              "has_secret": true, "redirect_uri": "https://hub.example.com/api/auth/callback/google" },
  "apple": { "enabled": false, "services_id": "", "team_id": "", "key_id": "",
             "has_key": false, "redirect_uri": "https://hub.example.com/api/auth/callback/apple",
             "secret_expires": null }
}
```

Secrets (`client_secret`, the Apple `.p8` key) are **write-only**: they go in on
`PUT` and come back only as `has_secret` / `has_key`. They're encrypted on the
data volume with a key kept in a separate file (`hub-data/keys/`), so a copy of
the SQLite file alone doesn't hold them. **(Q5)** The key file stays on the
volume: nothing for the owner to set up. It mainly protects copies of the
database; anyone with the whole SD card has both.

### `PUT /api/admin/auth/providers`

The same shape; send only what changes. Rules:

- `local.enabled` can't be turned off while it's the only way any admin signs in.
- `google.enabled` / `apple.enabled` need `public_url` on https and the
  provider's wizard to have passed (G8, G9). Otherwise 409 with the step that's missing.

## Cameras, streams, events and clips

### Visibility

A member can see camera `C` if they're an admin or one of their grants is on a
group that holds `C`; they can manage `C` if one such grant is `manage`. What
each level allows is under [Terms](#terms). "Sees `{id}`" and "manages `{id}`"
below mean exactly that.

### Enforcement

Every route the hub has today, with what it needs once accounts exist.
**This table is what G7's "per-camera auth is enforced on every stream path"
check verifies**, route by route.

| Route (today) | Needs | Notes |
|---|---|---|
| `GET /` and the app's files | open | The app shows sign-in itself. |
| `GET /api/hub` | open | While remote access is on, unauthenticated callers get only `name`, `version`, `setup_required`. |
| `POST /api/pairing/code`, `POST /api/pair` | see [Moving from pairing keys](#moving-from-pairing-keys) | |
| `GET /api/cameras` | member | **Filtered** to visible cameras. |
| `POST /api/cameras`, `POST /api/cameras/test` | admin | |
| `PATCH /api/cameras/{id}` (rename) | manages `{id}` | |
| `DELETE /api/cameras/{id}` | admin | |
| `GET /api/cameras/{id}/snapshot.jpg` | sees `{id}` | session or ticket |
| `GET /api/cameras/{id}/stream.mjpeg` | sees `{id}` | session or ticket |
| `POST /api/cameras/{id}/webrtc` | sees `{id}` | The SDP answer is the only way into go2rtc's media port; go2rtc's own API (1984) and RTSP (8554) stay bound to localhost and **must never be exposed or tunnelled**. |
| `POST /api/cameras/{id}/ticket` | sees `{id}` | new |
| `GET /api/cameras/{id}/zones` | sees `{id}` | |
| `PUT /api/cameras/{id}/zones` | manages `{id}` | |
| `GET /api/usb` | admin | |
| `GET /api/events` | member | **Filtered** to visible cameras. An event of a deleted camera is admin-only. |
| `DELETE /api/events/{id}` | manages the event's camera | Today any paired viewer can. Deletes the clip too. **(Q6)** |
| `GET /api/clips/{name}` | sees the event's camera | The hub maps the file name to its event; a name with no event → 404. Session or ticket. |
| `GET /api/settings` | member | |
| `PATCH /api/settings` | admin | |
| `GET`/`PATCH`/`DELETE /api/viewers…` | replaced by `/api/me/sessions` and `/api/household/sessions` | |
| Remote video (G7: MSE/HLS over https) | sees `{id}` | Same check, same ticket. |
| Everything new in this doc | as stated per route | |

The hub's tests get one case per row: no session → 401; member without the
camera → 404; member with `view` → 200 for reading, 403 `manage_only` for a
manage route; member with `manage` → 200; admin → 200.

### CSRF and origins

- Today the hub answers every request with `Access-Control-Allow-Origin: *`.
  With cookies that must go. New rule: requests that carry the cookie are only
  accepted from the hub's own origins (its LAN address and, if set, its
  `public_url`). For `POST`, `PUT`, `PATCH`, `DELETE` with the cookie, the
  `Origin` header must be one of those, or 403 `bad_origin`.
- Bearer-token requests (apps) don't use cookies, so they aren't exposed to
  CSRF. Native apps aren't browsers and need no CORS.
- `SameSite=Lax` plus the origin check is the CSRF defence; no separate token.
- **No cross-origin access at all (Q7).** The hub stops sending
  `Access-Control-Allow-*` headers, including `Access-Control-Allow-Private-Network`,
  so no other website (the Pages site included) can read from it. Pages only
  explains, flashes boards, generates the install files and links to "Open my
  hub" (G5). For development, `npm run dev` proxies `/api` to a hub (a Vite
  `server.proxy` setting), so the dev page is same-origin too.

## Setup wizards

The wizard component (G2) stores progress on the hub so a flow can be resumed
from another device, and so G10 can show every flow's health. Checks that need
the hub (anything about Docker, disk, the tunnel, Google's or Apple's
endpoints) run **on the hub**, which reports the result.

Flows and their step ids:

| Flow | Steps |
|---|---|
| `hub-install` (G6) | `docker`, `container`, `volume`, `mdns`, `first-admin` |
| `remote-cloudflare` (G7) | `domain`, `tunnel`, `certificate`, `reach-self`, `locked-down` |
| `remote-tailscale` (G7) | `tailnet`, `funnel-or-private`, `certificate`, `reach-self`, `locked-down` |
| `google` (G8) | `public-url`, `console`, `client`, `discovery`, `test-sign-in` |
| `apple` (G9) | `public-url`, `developer`, `identifiers`, `key`, `token-endpoint`, `test-sign-in` |

All admin-only, except `hub-install` before the first admin exists (open on the
hub's LAN address only, and only until `first-admin` passes).

### `GET /api/setup` → every flow's summary (for G10)

```json
{ "flows": [ { "flow": "google", "state": "failed", "failed_step": "test-sign-in", "checked": 1763390000 } ] }
```

### `GET /api/setup/{flow}`

```json
{
  "flow": "google",
  "steps": [
    { "id": "public-url", "state": "passed", "checked": 1763390000 },
    { "id": "client", "state": "failed", "reason": "That client ID doesn't look like a Google one. It ends in .apps.googleusercontent.com.", "checked": 1763390100 },
    { "id": "discovery", "state": "todo" }
  ],
  "values": { "client_id": "1234-abc" }
}
```

`state` is one of `todo`, `checking`, `passed`, `failed`. `reason` is a sentence
for the person, present when `failed`. `values` holds what the person typed
that isn't secret, so the form refills on another device.

### `GET /api/setup/{flow}/{step}/plan`

What the check will do before it runs, so the wizard can show it first
(handover rule: each check names the host it contacts and what it sends):

```json
{ "contacts": [ { "host": "accounts.google.com", "sends": "Nothing but the request for Google's public sign-in settings." } ] }
```

An empty list means the check stays on the hub.

### `POST /api/setup/{flow}/{step}/verify`

Body: the step's input (e.g. `{ "client_id": "…", "client_secret": "…" }`) or
`{}` when there's nothing to type. Secrets in the body are stored encrypted, as
for providers, and never returned. Answer: the step as in `GET`, after the
check. A check that takes long answers 202 with `state: "checking"`; the
wizard polls `GET /api/setup/{flow}` every 2 s.

A step can only be verified once every earlier step is `passed` (else 409).
Verifying a step again sets every later step back to `todo`.

### `PUT /api/setup/{flow}/{step}`

`{ "state": "passed" }` for steps that are a manual confirm ("I've created the
client in the Google console"). Only allowed on steps the flow marks manual.

### Pages and the hub install wizard

The Pages site is https and can't call `http://lookabout.local` (mixed
content, E4). So in G6 the Pages wizard steps before the hub is running are
**manual confirm, kept in the browser** (localStorage), and once the hub is up
the person continues on the hub's own first-run page, where the checks are
real. The wizard component supports both stores (G2).

## Moving from pairing keys

Today: anyone on the LAN can open the hub page, make a pairing code and pair a
viewer, and the first viewer is the `owner` (`store.py`, `viewers.role`).

When accounts ship:

1. On first start of the new version, if viewers exist and no members do, the
   hub enters `setup_required` and shows a setup code as for a fresh hub. Old
   keys keep working **read-only** (camera list, video, events) until the first
   admin is made, so nobody loses their monitor during the upgrade.
2. When the first admin is created, **every old viewer key is ended (Q8)**.
   Each device then signs in once, as a member the admin has invited. The
   hub's first-run page says so before the admin confirms, with the list of
   devices that will be signed out.
3. Pairing codes stay as the **app sign-in shortcut**: a signed-in admin makes
   a code (or the QR from B3) *for a member* in the dashboard, and
   `POST /api/pair` with that code returns a bearer session for that member.
   Managers can't make these (inviting people stays with admins).
   The hub page's open "Show a pairing code" button goes away.
4. `?token=` on stream and clip URLs is replaced by tickets.

## Preview provider (web only, G3)

Until a hub with accounts exists, the web app has a **preview** provider that
"signs in" as one of the sample members from `sampleData.js`, so G3 and G4 can
be built and checked. It's labelled as a preview on the sign-in screen, lives
only in the web app, makes no requests, and is **not security**: it hides
nothing from anyone who opens the developer tools. The hub never offers it.

## Decisions (15 Nov 2026)

The owner's answers to the draft's questions:

- **Q1. Session length:** 30 days, sliding; **7 days while remote access is on.**
- **Q2. Passkeys:** one passkey per address (home name and public name). Sign-in
  at home never needs the internet.
- **Q3. Before remote access:** every admin has a passkey or a password of 14+
  characters.
- **Q4. Email:** the hub never sends any. Local-only invites go by a link the
  admin passes on.
- **Q5. Provider secrets:** encrypted with a key file on the hub's volume.
- **Q6. Who can delete events and clips:** asked as "admins only or viewers";
  the owner chose a third way: **camera groups with managers.** Admins group
  cameras and grant members `view` or `manage` per group. `manage` allows
  deleting events and clips, editing zones, renaming the camera and sharing
  the group (`view` only) with other members. This replaces per-camera access
  lists.
- **Q7. Pages to hub:** dropped. The hub sends no CORS headers.
- **Q8. Old pairing keys:** all ended when the first admin is created;
  every device signs in again once.

## As built

Details the first build settled (G3):

- `POST /api/auth/join` `{ invite, name, password }` accepts an invite link: it activates the
  pending member and signs them in (cookie, or `{ token, me }` with `?app=1`).
- `GET /api/setup/state` (open) → `{ setup_required, setup_code, devices }`. The code is returned
  only to callers on a private or loopback address; `devices` is how many old pairing keys will be
  ended. A wrong code five times replaces it with a new one, printed in the log.
- `POST /api/pairing/code` is admin-only and takes `{ member }` (default: the admin). `POST /api/pair`
  returns `{ token, member, hub }`.
- `GET /api/cameras` adds `access` (`view` or `manage`) to each camera.
- `POST /api/cameras` takes optional `groups: [ids]` for the new camera.
- A member answers `GET /api/household` with `members` (id, name, role; active ones only) and
  `groups` (id, name, level).
- Login attempts count per email **and** client address; behind a tunnel on the same machine the
  address is taken from `X-Forwarded-For`.
- Tickets are kept in memory: a hub restart ends them.
- The session cookie is `Secure` when the request carries `X-Forwarded-Proto: https`.
- `OPTIONS` answers 405: nothing is allowed cross-origin.
- **Passkeys.** `POST /api/auth/passkey/options` (open) → `{ options }` with a challenge and the hub's address as
  `rpId` (the host in the address bar, without the port); `POST /api/auth/login/passkey` `{ credential }` signs in
  (cookie, or `?app=1`). Adding one: `POST /api/me/passkeys/options`, then `POST /api/me/passkeys`
  `{ credential, name }`. `GET /api/me/passkeys` lists them with the address each works on (`rp_id`) and
  `this_address`; `DELETE /api/me/passkeys/{id}`. Challenges last 5 minutes and work once. Attestation is not
  checked (a passkey proves the key, not the make of device). ES256, EdDSA and RS256 keys. A sign count that
  doesn't go up is refused as a copied key. One passkey per member per address (Q2), made as discoverable
  credentials so no email is needed. WebAuthn needs a host name, not an IP address: a hub opened as
  `http://192.168.1.5:8787` can't use passkeys (browsers refuse); `lookabout.local` can.
- **Google and Apple.** `POST /api/auth/login/{google|apple}` `{ return_to, app?, code_challenge? }` → `{ redirect }`
  and a `lk_oauth` state cookie (`SameSite=None; Secure` for Apple, whose answer is a cross-site POST, so Apple's
  callback is the one route that skips the Origin check; state, nonce and the cookie guard it). The callback
  redirects to `return_to` (a path on the hub only) with the session cookie, or to
  `/#/signin?error=<code>&message=…` with `not_invited`, `bad_state`, `cancelled`, `provider_refused`,
  `unreachable`, `already_linked` or `sign_in_failed`. Google uses PKCE; Apple's client secret is made per request
  from the `.p8` key (ES256, 10 minutes). ID tokens must be RS256 with a key from the provider's published set.
- **Apps.** With `app: true` and a `code_challenge` (S256) the callback ends on
  `lookabout://hub/signed-in?code=…`; `POST /api/auth/token` `{ code, code_verifier, device }` → `{ token, me }`.
  The code works once, for 5 minutes, and a wrong verifier uses it up.
- **Linking.** `POST /api/me/link/{google|apple}` starts the same dance for the signed-in member;
  `DELETE /api/me/link/{provider}` refuses (409) if it is their last way in. Passkeys count as ways in too.
- **Provider settings.** `GET`/`PUT /api/admin/auth/providers` as drawn above, plus `local.password` and
  `local.passkey` switches. Turning Google or Apple on needs `public_url` on https and the client details, but
  **not yet** a passed wizard (G8, G9 aren't built): the hub says what is missing. Passwords can't be turned off
  while an admin has no passkey or linked account; both can't be off. Secrets are sealed with a key in
  `keys/vault.key` on the volume (mode 600) and never returned.
- Passkeys count as a strong credential (Q3) for remote access.
