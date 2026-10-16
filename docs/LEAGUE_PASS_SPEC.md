# League pass: link once, share with the league

Spec date: 2026-10-16. Owner-approved.

## Problem

Larry reads a **private** ESPN league, so every request needs someone's `espn_s2` and `SWID` cookies. Today they live only in each device's localStorage. George and Sid (both in the league) have to redo the cookie and league-ID setup over and over:
- iPhone keeps Safari and home-screen-app storage separate, so linking in one does not carry to the other.
- Safari clears site data after about 7 days without a visit for sites not on the home screen.
- ESPN cookies expire on logout and otherwise roughly yearly.

## The fix, in one paragraph

The owner links his ESPN account once and creates a **league pass**. Larry's server stores the league's cookies **encrypted** and hands out **invite codes**. A friend enters a code once (or taps a link) and picks their team. From then on their device holds only a pass id and secret, never cookies. The proxy looks up the cookies server-side. When the cookies expire, the owner re-links once and everyone keeps working. Invites can be revoked.

**This deliberately reverses the CLAUDE.md rule "No server-side cookie storage."** Update that line to describe the league pass and its safeguards.

---

## 1. Storage

- **Netlify Blobs**, store name `league-pass`, one record per pass:
  ```
  {
    passId,                       // random 16 bytes, base64url
    leagueId, seasonId,
    cookiesEnc,                   // AES-256-GCM of {espn_s2, swid}, with iv and tag
    ownerTokenHash,               // SHA-256 of the owner token
    invites: [{ id, codeHash, label, createdAt, revokedAt|null, lastUsedAt }],
    createdAt, updatedAt, cookiesUpdatedAt, cookieStatus: "ok"|"expired"
  }
  ```
- Encryption key: env var `LEAGUE_PASS_KEY` (32 random bytes, base64). The owner sets it in Netlify site settings. The function refuses to run without it. Never commit a key; the repo is public.
- Secrets (owner token, invite codes) are stored **hashed only**. Compare with `crypto.timingSafeEqual`.
- `@netlify/blobs` is a runtime dependency of the function. Add it however Netlify functions bundle dependencies in this repo, and note it in CLAUDE.md.

## 2. Function `netlify/functions/league-pass.js`

Same origin allowlist, per-IP rate limit and payload caps as `larry-chat.js`.

| Action (POST, JSON) | Who | Does |
|---|---|---|
| `create` | owner | Body: `leagueId`, `seasonId`, `espn_s2`, `swid`. Verifies the cookies by calling ESPN `mSettings` for that league (must return 200). Stores the record. Returns `passId`, `ownerToken` (shown once), and a first invite. |
| `invite` | owner (`ownerToken`) | Creates an invite with a `label` ("George"). Returns the code and link once. |
| `revoke` | owner | Revokes one invite by id. That device stops working on its next request. |
| `update-cookies` | owner | New cookies after expiry; re-verifies with ESPN; sets `cookieStatus` ok. |
| `status` | owner or invitee | Returns league name, invite labels and last-used dates (owner), `cookieStatus`. **Never returns cookies.** |
| `join` | anyone with a code | Body: `code`. Returns `passId` and a per-device `deviceSecret` (stored hashed under that invite) plus the league's team list for the team picker. A code can be joined from up to 3 devices (phone, iPad, computer); beyond that the owner issues another. |

**Invite code format:** 10 characters from an unambiguous alphabet (no 0/O/1/I), shown as `ABCD-EFGHJK`. Short enough to type on a phone, about 50 bits, behind the rate limit. Also offer a link: `https://larrybball.netlify.app/join#code=ABCD-EFGHJK`. The code sits in the URL **fragment**, so it never reaches server logs.

## 3. Proxy changes (`espn-proxy.js`)

- Accept `x-larry-pass: <passId>.<deviceSecret>` as an alternative to `x-espn-s2` / `x-espn-swid`.
- With a pass:
  - Look up the record.
  - Verify the device secret against a non-revoked invite.
  - Decrypt the cookies and forward the request.
  - **Take `leagueId` from the record, ignoring any `x-espn-league-id` header**, so a pass can only ever read its own league.
- Only the existing read endpoint (`lm-api-reads`, GET) is reachable. A pass grants no write access to ESPN, and none exists today. Keep it that way.
- On ESPN 401 with a pass:
  - Set `cookieStatus: "expired"` on the record.
  - Return 401 with `{ reason: "pass-expired" }`.
- Per-pass rate limit (e.g. 120 requests a minute) on top of the per-IP one. Draft-night polling every 4s from 3 phones is about 45 requests a minute, well inside it.
- Never log cookies, codes, secrets or the pass header.

## 4. App changes

**Owner device**
- Settings, "League pass" card:
  - "Create league pass" (uses the cookies already on the device).
  - Invite list with labels, last used, and Revoke.
  - "New invite" shows the code big, with Copy and Share buttons.
- Store `ownerToken` in `S.espn.passOwner` (localStorage).
- When the owner re-links with the bookmarklet or wizard after an expiry, automatically call `update-cookies`.

**Invitee device**
- Wizard step 1 gets **"Join with a league pass code"** above the cookie steps.
  - Enter the code, pick your team, done.
  - Store only `{ passId, deviceSecret }` in `S.espn.pass`, never cookies.
- `/join` page (new HTML page; **needs the home-screen icon block**, see CLAUDE.md):
  - Reads the code from the fragment and joins.
  - On iPhone, shows: "Add Larry to your Home Screen from this page, then open it and enter code ABCD-EFGHJK once more." Home-screen apps do not share Safari storage, so the code is the reliable path. Say so plainly rather than pretending the link alone works.
- **"My team" for invitees comes from the team picker, never from SWID detection.** The SWID belongs to the owner, so detection would pick the owner's team. Store the choice in `S.myTeam` as today. Larry's Move and chat use the chosen team.

**Everyone**
- The fetch layer sends `x-larry-pass` when `S.espn.pass` is set, else cookies as today. The manual cookie path keeps working unchanged.
- On `pass-expired`:
  - Invitees see "Your league pass needs a refresh. Ask Cliff to reconnect Larry."
  - The owner sees the existing reconnect banner, which also refreshes the pass.
- On a revoked pass: "This league pass was turned off. Enter a new code."

## 5. Tests

- **Crypto:** encrypt/decrypt round trip, wrong key fails, tampered ciphertext fails.
- **Auth:**
  - A wrong secret is rejected.
  - A revoked invite is rejected.
  - A 4th device on one code is rejected.
  - Owner actions require the owner token.
- **League pinning:** a pass request carrying another league id still reads the pass's league.
- **No leakage:** no response body from any action contains `espn_s2` or `swid` (assert on every action).
- **Expiry:** a 401 sets `cookieStatus` expired; `update-cookies` clears it.
- **App:**
  - The invitee path stores no cookies in localStorage.
  - The team picker sets `S.myTeam`.
  - Requests carry `x-larry-pass`.
- All existing gates: `node --check`, `npm test`, `npx tsc --noEmit`, ASCII, CACHE_VERSION bump.

## 6. Rollout

1. Owner sets `LEAGUE_PASS_KEY` in Netlify (Claude Code prints the one-line command to generate it).
2. Ship to `main`.
3. Owner: Settings, League pass, Create, then New invite for George and for Sid, and send each their code.
4. George and Sid: open Larry from the home screen, choose "Join with a league pass code", and pick their team.
5. Reviewer verification:
   - Create a pass.
   - Join from a clean browser profile with no cookies.
   - Confirm the league loads, the right team is selected, localStorage holds no cookies, revoke works, and the Draft Room live sync works through the pass.

## Out of scope

- Multiple leagues per device.
- Leagues other than this one beyond what the design already allows.
- Any ESPN write access.
