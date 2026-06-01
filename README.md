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
| `GET /api/heartbeat?key=SECRET` | Always sends ONE summary of all targets (UP or DOWN). Point an hourly scheduler at this for a periodic "all clear". Secret-protected. |

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
| `TELEGRAM_CHAT_ID` | The chat that receives alerts (negative id for a group, e.g. `-100…`) |
| `TELEGRAM_TOPIC_ID` | *(optional)* Forum topic id (`message_thread_id`) to post into a specific group topic |
| `CRON_SECRET` | A long random string that protects `/api/cron` |
| `DISPLAY_TZ` | *(optional)* IANA timezone for alert timestamps, e.g. `Asia/Tbilisi`. Defaults to `UTC`. |
| `ALWAYS_NOTIFY` | *(optional)* Set to `on` for a heartbeat summary every run (even when all UP). Unset/`off` = alert only on DOWN. |

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
> `Authorization: Bearer <CRON_SECRET>` header instead — both endpoints accept either.

### Optional: hourly "all clear" heartbeat

`/api/cron` (every 5 min) only messages you when something is DOWN (with
`ALWAYS_NOTIFY` off). To also get a periodic status report regardless of state,
create a **second** cron-job.org job:

- **URL:** `https://<app>.vercel.app/api/heartbeat?key=<CRON_SECRET>`
- **Schedule:** every 1 hour

You'll get a `🕐 Hourly status` summary of every service each hour, on top of the
5-minute failure alerts.

## Run locally

Env vars are loaded automatically from `.env` (via Node's `--env-file`); `.env` is
gitignored. A `CRON_SECRET` is generated for you — just add your Telegram values.

```bash
# 1. Status table in the terminal (no Telegram needed)
npm run check

# 2. Local dashboard + API at http://localhost:3000 (no Vercel CLI required)
npm run dev:local

# 3. Send real Telegram alerts for any down target (after filling .env)
node --env-file=.env scripts/run-once.js --notify

# Full Vercel emulation (optional, needs `vercel login`)
npx vercel dev
```

## Tests

```bash
npm test
```

Unit tests cover the check classification (`lib/checks.js`) and the Telegram
payload/error handling (`lib/telegram.js`).
