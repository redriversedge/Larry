# League pass: link once, share with a link

Spec date: 2026-10-16 (revised: link only, no codes). Owner-approved. The owner understands that the invite link itself grants read access to the league, and accepts that.

## Problem

Larry reads a **private** ESPN league, so every request needs someone's `espn_s2` and `SWID` cookies. Today they live only in each device's localStorage. George and Sid (both in the league) have to redo the cookie and league-ID setup over and over:
- iPhone keeps Safari and home-screen-app storage separate, so linking in one does not carry to the other.
- Safari clears site data after about 7 days without a visit for sites not on the home screen.
- ESPN cookies expire on logout and otherwise roughly yearly.

## The fix, in one paragraph

The owner links his ESPN account once and creates a **league pass**. Larry's server stores the league's cookies **encrypted**. The owner sends each person a **link**. They tap it, pick their team, and they are in; there is no code to type. Their device holds only the pass id and a secret from the link, never cookies, and the proxy looks up the cookies server-side. When the cookies expire, the owner re-links once and everyone keeps working. Each link can be revoked.

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
    invites: [{ id, secretHash, label, createdAt, revokedAt|null, lastUsedAt }],
    createdAt, updatedAt, cookiesUpdatedAt, cookieStatus: "ok"|"expired"
  }
  ```
- Encryption key: env var `LEAGUE_PASS_KEY` (32 random bytes, base64). The owner sets it in Netlify site settings. The function refuses to run without it. Never commit a key; the repo is public.
- Secrets (owner token, invite secrets) are stored **hashed only**. Compare with `crypto.timingSafeEqual`. Invite secrets are 32 random bytes, base64url.
- `@netlify/blobs` is a runtime dependency of the function. Add it however Netlify functions bundle dependencies in this repo, and note it in CLAUDE.md.

## 2. Function `netlify/functions/league-pass.js`

Same origin allowlist, per-IP rate limit and payload caps as `larry-chat.js`.

| Action (POST, JSON) | Who | Does |
|---|---|---|
| `create` | owner | Body: `leagueId`, `seasonId`, `espn_s2`, `swid`. Verifies the cookies by calling ESPN `mSettings` for that league (must return 200). Stores the record. Returns `passId` and `ownerToken`. |
| `invite` | owner (`ownerToken`) | Body: `label` ("George"). Creates an invite and returns its **link** once: `https://larrybball.netlify.app/join#p=<passId>.<inviteSecret>`. |
| `revoke` | owner | Revokes one invite by id. Every device that used that link stops working on its next request. |
| `update-cookies` | owner | New cookies after expiry; re-verifies with ESPN; sets `cookieStatus` ok. |
| `status` | owner or invitee | Returns league name, invite labels and last-used dates (owner), `cookieStatus`, and the team list (for the invitee's team picker). **Never returns cookies.** |

- The secret travels in the URL **fragment** (`#p=`), so it never reaches Netlify's request logs when the link is opened.
- A link can be used on any number of devices (phone, iPad, laptop) until it is revoked. One link per person, so revoking George does not affect Sid.

## 3. Proxy changes (`espn-proxy.js`)

- Accept `x-larry-pass: <passId>.<inviteSecret>` as an alternative to `x-espn-s2` / `x-espn-swid`.
- With a pass:
  - Look up the record.
  - Verify the secret against a non-revoked invite (or the owner token).
  - Decrypt the cookies and forward the request.
  - **Take `leagueId` from the record, ignoring any `x-espn-league-id` header**, so a pass can only ever read its own league.
- Only the existing read endpoint (`lm-api-reads`, GET) is reachable. A pass grants no write access to ESPN, and none exists today. Keep it that way.
- On ESPN 401 with a pass:
  - Set `cookieStatus: "expired"` on the record.
  - Return 401 with `{ reason: "pass-expired" }`.
- Per-pass rate limit (e.g. 120 requests a minute) on top of the per-IP one. Draft-night polling every 4s from 3 phones is about 45 requests a minute, well inside it.
- Never log cookies, secrets or the pass header.

## 4. App changes

**Owner device**
- Settings, "League pass" card:
  - "Create league pass" (uses the cookies already on the device).
  - "Share a link" asks for a name, then opens the phone's share sheet (`navigator.share`, with copy-link fallback) so the owner can text it directly.
  - Invite list with names, last used, and Revoke.
- Store `ownerToken` in `S.espn.passOwner` (localStorage).
- When the owner re-links with the bookmarklet or wizard after an expiry, automatically call `update-cookies`.

**Opening the link (`/join`)**
- New HTML page; **it needs the home-screen icon block**, see CLAUDE.md.
- Reads `p` from the fragment, calls `status` to confirm the link works, then shows the team picker ("Which team is yours?").
- On pick:
  - Store `{ passId, inviteSecret }` in `S.espn.pass` and the team in `S.myTeam`.
  - Never store cookies.
  - Clear the fragment from the address bar (`history.replaceState`).
  - Load the app.

**iPhone home screen, so the link alone is enough.** Home-screen web apps on iOS do not share Safari's storage, so a link opened in Safari would not carry over to the home-screen icon. Make the link survive "Add to Home Screen":
1. The `/join` page links a manifest whose `start_url` is `/#p=<passId>.<inviteSecret>`. Build it client-side as a data or blob URL, so the secret is never sent to the server. On first launch from the home screen, the app reads `p`, stores it and clears it, exactly like `/join`.
2. Banner on `/join` for iPhone: "To keep Larry on your Home Screen: tap Share, then Add to Home Screen." One sentence, no code.
3. **Verify (1) on a real iPhone.** If iOS ignores a client-built manifest, fall back to this. On first launch from the home screen with no credentials, show one button: **"Paste your Larry link"**. It reads the clipboard on tap, and the person just copies the link from the text they were sent. Still link-only, no code.
- Android and desktop share storage between the browser and the installed app, so the link just works there.

**"My team" for invitees comes from the team picker, never from SWID detection.** The SWID belongs to the owner, so detection would pick the owner's team. Larry's Move and chat use the chosen team. Settings lets an invitee change their team.

**Everyone**
- The fetch layer sends `x-larry-pass` when `S.espn.pass` is set, else cookies as today. The manual cookie path keeps working unchanged.
- On `pass-expired`:
  - Invitees see "Larry's league connection needs a refresh. Ask Cliff to reconnect."
  - The owner sees the existing reconnect banner, which also refreshes the pass.
- On a revoked link: "This Larry link was turned off. Ask Cliff for a new one."

## 5. Tests

- **Crypto:** encrypt/decrypt round trip, wrong key fails, tampered ciphertext fails.
- **Auth:**
  - A wrong secret is rejected.
  - A revoked link is rejected.
  - Owner actions require the owner token.
- **League pinning:** a pass request carrying another league id still reads the pass's league.
- **No leakage:** no response body from any action contains `espn_s2` or `swid` (assert on every action). The secret never appears in a query string.
- **Expiry:** a 401 sets `cookieStatus` expired; `update-cookies` clears it.
- **App:**
  - `/join` with a valid fragment stores the pass, no cookies, and clears the fragment.
  - The team picker sets `S.myTeam`.
  - Requests carry `x-larry-pass`.
  - The home-screen first-launch path reads `p` from `start_url`.
- All existing gates: `node --check`, `npm test`, `npx tsc --noEmit`, ASCII, CACHE_VERSION bump.

## 6. Rollout

1. Owner sets `LEAGUE_PASS_KEY` in Netlify (Claude Code prints the one-line command to generate it).
2. Ship to `main`.
3. Owner: Settings, League pass, Create, then "Share a link" for George and for Sid, and text each the link.
4. George and Sid: tap the link, pick their team. On iPhone, add to the home screen from that page.
5. Reviewer verification:
   - Create a pass.
   - Open a link in a clean browser profile with no cookies.
   - Confirm the league loads, the right team is selected, localStorage holds no cookies, revoke works, and the Draft Room live sync works through the pass.
   - Report the iPhone home-screen result (step 4.1 or the paste fallback).

## Out of scope

- Multiple leagues per device.
- Any ESPN write access.
