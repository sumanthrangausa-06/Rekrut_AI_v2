# Build Log — #1660: OAuth fetches unbounded (class of #1659)

- **Branch:** `nova/1660-oauth-timeouts` (based on `origin/dev` @ b94ea00ec)
- **Date:** 2026-10-22
- **Persona:** Nova (implementation); STOP 1 posted on issue #1660
- **Files changed:** `routes/auth.js` only (5 insertions, 0 deletions) + this log

## Defect class

Server-side `fetch()` calls to OAuth providers with **no timeout**: if the
provider accepts the connection and never replies, the request — and the
user's login — hangs indefinitely. #1659 fixed this class in
`routes/candidate.js` and one LinkedIn userinfo call in `routes/auth.js`
(that hunk was approved in the #1659 review, then reverted as a scoping move
into this issue). #1660 covers the remaining five unbounded provider fetches
in `routes/auth.js`. The Polsia fetch in the same file is a different surface
and is tracked separately as #1666 — intentionally not touched here.

## The five sites (all get `signal: AbortSignal.timeout(5000)`)

| # | Flow | Endpoint | Line (dev @ b94ea00ec) |
|---|------|----------|------------------------|
| 1 | Google OAuth callback — token exchange | `https://oauth2.googleapis.com/token` | :802 |
| 2 | Google OAuth callback — userinfo | `https://www.googleapis.com/oauth2/v2/userinfo` | :828 |
| 3 | LinkedIn OAuth callback — token exchange | `https://www.linkedin.com/oauth/v2/accessToken` | :1079 |
| 4 | LinkedIn OAuth callback — userinfo | `https://api.linkedin.com/v2/userinfo` | :1105 |
| 5 | `POST /oauth/refresh` — Google refresh-token exchange | `https://oauth2.googleapis.com/token` (`grant_type=refresh_token`) | :1496 |

Site 4 restores, byte-for-byte, the reviewed form from commit fe9505a89
(`signal:` line inserted after the `headers:` line).

No auth logic, error shapes, or redirects were changed.

## Per-flow abort trace (what the user sees when the fetch times out)

`AbortSignal.timeout` rejects the fetch with a `TimeoutError` after 5s.
Every one of the five fetches is `await`ed inside its handler's `try` block,
so the abort lands in the handler's existing outer `catch` — no unhandled
rejection, no fake success anywhere:

1. **Google token exchange** and **2. Google userinfo** — both inside
   `GET /google/callback`'s try. Catch logs `Google OAuth error:` and
   redirects: link mode → `/settings?oauth_error=Authentication failed`;
   login mode → `/login?error=Authentication failed`.
3. **LinkedIn token exchange** and **4. LinkedIn userinfo** — both inside
   `GET /linkedin/callback`'s try. Catch logs `LinkedIn OAuth error:` and
   redirects with the same two shapes (`/settings?oauth_error=Authentication
   failed` in link mode, `/login?error=Authentication failed` otherwise).
5. **Google refresh-token exchange** — inside `POST /oauth/refresh`'s try.
   Catch logs `OAuth refresh error:` and returns
   `500 {"error":"Token refresh failed"}`. No token row is written (the
   `UPDATE oauth_connections` runs only after a successful parse), so a
   stalled provider can never produce a stored fake token.

## Red / green proof

Harness: `evidence-1660/proof-harness.js` (kept with the run evidence, not
shipped). It mounts the **real** `routes/auth.js` handlers on a local Express
server and drives them over real HTTP, with the global `fetch` replaced by a
provider stub whose endpoints accept-and-never-reply and honour
`AbortSignal` exactly like real fetch (reject with `signal.reason`).
Limits, honestly: the socket layer itself is not exercised — the stub models
a stalled provider at the fetch boundary, which is the layer where the
missing timeout lives. For the refresh scenario only, the DB boundary is
stubbed (one prepared `oauth_connections` row + the user row
`authMiddleware` looks up); the DB is not the layer under test.

- **RED** (pristine `origin/dev` b94ea00ec, `evidence-1660/red.log`): all
  five flows **hung past the 15s ceiling** — LinkedIn callback (token),
  Google callback (token), Google refresh, LinkedIn callback (userinfo),
  Google callback (userinfo).
- **GREEN** (this branch, `evidence-1660/green.log`): all five flows fail
  honestly at **~5.0s** — callbacks return `302` to
  `/login?error=Authentication failed` with a logged `TimeoutError`;
  refresh returns `500 {"error":"Token refresh failed"}`. 0 hung.

## Scope notes

- Polsia fetch (`/verify-payment`, ~:1561) untouched — #1666.
- No other fetch in `routes/auth.js` exists; a full-file grep for `fetch(`
  before the change returned exactly the six call sites (five above + Polsia).
