# Guardian — Health-Check Monitor & Telegram Alerter

**Date:** 2026-06-01
**Status:** Approved design

## Purpose

A small Node.js API, hosted free on Vercel, that periodically checks the health
of a list of my server endpoints and notifies me on Telegram when one is down.
It also serves a simple HTML dashboard at `/` showing the current status of
every monitored project.

"Start simple" is an explicit goal — slow-response detection and response-body
matching are intentionally deferred to a future iteration.

## Constraints & Platform Decision

- **Host:** Vercel Hobby (free) plan.
- **Key constraint:** Vercel is serverless (no always-on process, so `setInterval`
  cannot drive a recurring task) and the Hobby plan caps cron jobs at **once per
  day** (verified against Vercel docs, 2026-03-04). An expression like `*/5 * * * *`
  fails at deploy.
- **Resolution:** A free external scheduler (**cron-job.org**) calls a secret-protected
  `/api/cron` endpoint every 5 minutes. Vercel hosts the app + dashboard; cron-job.org
  provides the 5-minute heartbeat. Everything stays on free tiers.

```
cron-job.org ──(every 5 min)──▶ https://<app>.vercel.app/api/cron?key=SECRET
                                         │ runs all checks
                                         ├─ any DOWN → Telegram message
                                         └─ returns JSON summary

browser ─────────────────────▶ https://<app>.vercel.app/   (HTML dashboard)
                                         └─ calls /api/status (live checks)
```

## Architecture

Stateless serverless functions on Node 18+ using the native global `fetch`
(no `node-fetch` dependency). Plain HTML + CSS dashboard, no front-end framework.
Because every cron run is independent and the alert policy is "every failed
check", **no database or persisted state is required**.

### Components

| Unit | Responsibility | Interface | Depends on |
|------|----------------|-----------|------------|
| `lib/checks.js` | Run one HTTP health check per target; classify UP/DOWN | `runChecks(targets) → CheckResult[]` | native `fetch`, `targets.json` |
| `lib/telegram.js` | Send a message via Telegram Bot API | `sendTelegram(text) → Promise` | env vars, native `fetch` |
| `api/status.js` | HTTP handler: run checks, return JSON | `GET /api/status` | `lib/checks` |
| `api/cron.js` | HTTP handler: verify secret, run checks, alert on every DOWN, return JSON | `GET /api/cron?key=` | `lib/checks`, `lib/telegram` |
| `public/index.html` | Dashboard UI; fetches `/api/status` and renders cards | served at `/` | `/api/status` |
| `targets.json` | List of endpoints to monitor | data | — |

### File layout

```
api/status.js
api/cron.js
lib/checks.js
lib/telegram.js
public/index.html
targets.json
vercel.json
package.json
README.md
.gitignore
```

## Data Flow

1. **Scheduled path:** cron-job.org → `GET /api/cron?key=SECRET` → verify secret →
   `runChecks(targets)` → for each result where `ok === false`, `sendTelegram(...)`
   → respond `{ checked, down, results }`.
2. **Dashboard path:** browser → `GET /` (static HTML) → JS `fetch('/api/status')` →
   `runChecks(targets)` → JSON → render cards. Page auto-refreshes every ~30s.

## Data Shapes

**`targets.json`** — array of:
```json
{
  "name": "Florca API",
  "url": "https://florca.example.com/health",
  "method": "GET",        // optional, default "GET"
  "timeoutMs": 10000,     // optional, default 10000
  "expectStatus": 200     // optional; default = any 2xx is OK
}
```

**`CheckResult`** (returned by `runChecks`):
```json
{
  "name": "Florca API",
  "url": "https://florca.example.com/health",
  "ok": true,
  "statusCode": 200,       // null if no response
  "responseMs": 142,
  "error": null,           // string when ok === false (e.g. "timeout", "HTTP 502")
  "checkedAt": "2026-06-01T10:00:00.000Z"
}
```

## Failure Classification (this iteration)

A target is **DOWN** (`ok: false`) when any of:
- Response status is not 2xx (or not equal to `expectStatus` when that is set).
- No response within `timeoutMs` (timeout via `AbortController`).
- Connection error: refused, DNS failure, TLS error, etc. (any thrown `fetch` error).

Otherwise **UP** (`ok: true`). No slow/degraded tier and no body matching in v1.

## Alerting

- **Policy:** every failed check. Each `/api/cron` run sends one Telegram message
  for every target currently DOWN. (Stateless — matches serverless; accepted that
  a service down for an hour produces ~12 messages.)
- **Transport:** Telegram Bot API `sendMessage` via
  `https://api.telegram.org/bot<TOKEN>/sendMessage`.
- **Message content:** project name, URL, the failure reason (HTTP code or error),
  and timestamp.
- **`/api/status` never sends Telegram** — it is read-only for the dashboard.

## Security

- `/api/cron` requires a secret: `?key=<CRON_SECRET>` (or `Authorization` header)
  compared against the `CRON_SECRET` env var; mismatch → `401`. Prevents strangers
  from triggering checks/alert spam.
- `/api/status` is unauthenticated (read-only, runs checks but sends no alerts).
  Acceptable for a personal tool; noted as a known trade-off.

## Configuration (env vars on Vercel)

- `TELEGRAM_BOT_TOKEN` — bot token (user already has it).
- `TELEGRAM_CHAT_ID` — destination chat id (user already has it).
- `CRON_SECRET` — shared secret protecting `/api/cron`.

## Error Handling

- A single target failing/throwing must not abort the whole run — checks run with
  `Promise.allSettled` semantics; each target maps to its own `CheckResult`.
- Telegram send failures are caught and logged; they must not crash `/api/cron`.
- `/api/cron` returns `200` with a summary even when some targets are down (the
  endpoint itself succeeded); it returns `401` only on bad secret and `500` only
  on an unexpected internal error.

## Testing

- Unit-test `lib/checks.js` classification logic against a local stub HTTP server
  (or mocked `fetch`): 2xx → UP, 500 → DOWN, timeout → DOWN, connection error → DOWN,
  `expectStatus` mismatch → DOWN.
- Unit-test `lib/telegram.js` builds the correct URL/payload (mock `fetch`); verify
  send errors are swallowed.
- Manual: run `/api/status` and `/api/cron` locally (e.g. `vercel dev` or a tiny
  local server shim) against a real and a deliberately-broken target; confirm
  dashboard renders and a Telegram message arrives.

## README Contents

- Setting the 3 env vars on Vercel.
- Editing `targets.json`.
- Deploying to Vercel.
- Exact cron-job.org setup: URL `https://<app>.vercel.app/api/cron?key=<CRON_SECRET>`,
  schedule every 5 minutes.
- Local development instructions.

## Deferred (future, explicitly out of scope for v1)

- Slow-response / "degraded" detection with thresholds.
- Response-body / JSON matching.
- State-change-only alerting + reminders (would need persisted state, e.g. Vercel KV).
- Per-target alert routing, uptime history, charts.
