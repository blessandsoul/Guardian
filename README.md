# Guardian

A tiny, free health-check monitor. It pings a list of your endpoints, shows a
live status **dashboard**, and sends you a **Telegram** message whenever one is
down. Hosted free on **Vercel**, with a free external scheduler providing the
5-minute heartbeat.

```
cron-job.org ──(every 5 min)──▶ https://<app>.vercel.app/api/cron?key=SECRET
                                         │ runs all checks
                                         ├─ any DOWN → Telegram message
                                         └─ returns JSON summary

browser ─────────────────────▶ https://<app>.vercel.app/   (HTML dashboard)
```

## Why an external scheduler?

Vercel's free (Hobby) plan **caps cron jobs at once per day** and is serverless
(no always-on process, so `setInterval` can't drive a recurring task). So we host
the app on Vercel and let a free scheduler (**cron-job.org**) call `/api/cron`
every 5 minutes. Everything stays on free tiers.

## What counts as "down"

- Any non-2xx HTTP status (500, 502, 503, 404, …)
- No response: request timeout (default 8s), connection refused, DNS/TLS failure
- Optional per-target `expectStatus` — if set, only that exact status is "up"

(Slow-response and response-body checks are intentionally left for later.)

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /` | HTML dashboard (calls `/api/status`, auto-refreshes ~30s) |
| `GET /api/status` | Runs checks live, returns JSON. Read-only, never alerts. |
| `GET /api/cron?key=SECRET` | Runs checks **and** sends Telegram for each DOWN target. Secret-protected. |

## Configure your targets

Edit [`targets.json`](targets.json):

```json
[
  { "name": "My API", "url": "https://api.example.com/health" },
  { "name": "Marketing site", "url": "https://example.com", "timeoutMs": 8000, "expectStatus": 200 }
]
```

Per target: `name` and `url` are required; `method` (default `GET`),
`timeoutMs` (default `8000`), and `expectStatus` (default: any 2xx is OK) are
optional.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in a
local `.env` if you run locally — see `.env.example`):

| Variable | What |
|----------|------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | The chat that receives alerts |
| `CRON_SECRET` | A long random string that protects `/api/cron` |

> Don't have the Telegram values? Create a bot with **@BotFather** to get the
> token, send your bot a message, then open
> `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[].message.chat.id`.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project**, import the repo, and deploy (no build step
   needed — Vercel serves `public/` and the `api/` functions automatically).
3. Add the three environment variables above, then **Redeploy**.
4. Confirm the dashboard loads at `https://<app>.vercel.app/`.

## Set up the 5-minute heartbeat (cron-job.org)

1. Create a free account at <https://cron-job.org>.
2. **Create cronjob** with:
   - **URL:** `https://<app>.vercel.app/api/cron?key=<CRON_SECRET>`
   - **Schedule:** every 5 minutes
3. Save. It will now hit `/api/cron` every 5 minutes; you'll get a Telegram
   message for any target that's down.

> Prefer not to put the secret in the URL? Configure cron-job.org to send an
> `Authorization: Bearer <CRON_SECRET>` header instead — `/api/cron` accepts either.

## Run locally

```bash
# one-off check, prints a table
node scripts/run-once.js

# also send Telegram alerts for down targets (needs the env vars set)
node scripts/run-once.js --notify

# full Vercel emulation (dashboard + functions)
npx vercel dev
```

## Tests

```bash
npm test
```

Unit tests cover the check classification (`lib/checks.js`) and the Telegram
payload/error handling (`lib/telegram.js`).
