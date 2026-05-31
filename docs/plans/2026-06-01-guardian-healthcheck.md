# Guardian Health-Check Monitor — Implementation Plan

## Overview

Build a free, Vercel-hosted Node.js service that checks a list of HTTP endpoints,
serves an HTML status dashboard at `/`, and sends a Telegram message for every
endpoint found DOWN when its `/api/cron` endpoint is hit (every 5 min by an
external scheduler, cron-job.org). See spec:
`docs/superpowers/specs/2026-06-01-guardian-healthcheck-design.md`.

## Current State

Empty repo (git initialized) containing only the design spec and this plan. No
`package.json`, no source. Node 18+ available locally.

## Desired End State

- `GET /api/status` returns JSON `CheckResult[]` after running live checks.
- `GET /api/cron?key=SECRET` runs checks, sends Telegram for each DOWN target,
  returns a JSON summary; returns `401` on bad/missing secret.
- `GET /` serves an HTML+CSS dashboard that fetches `/api/status` and shows a
  card per target with UP/DOWN badge, status code, response time, last checked,
  and error; auto-refreshes ~30s.
- Unit tests pass for check classification and telegram payload building.
- README documents env vars, deploy, and cron-job.org setup.

## What We're NOT Doing

- No slow/degraded detection, no response-body matching (deferred).
- No database / persisted state; no state-change-only alerting or reminders.
- No uptime history, charts, multi-channel routing, or auth on `/api/status`.
- No TypeScript; plain JS (ESM).

## Implementation Approach

Native `fetch` + `AbortController` for checks (no runtime deps). ESM modules
(`"type": "module"`). Shared logic in `lib/`, thin Vercel handlers in `api/`.
Tests with Node's built-in `node:test` + `node:assert` against a local
`http.createServer` stub (no test-framework dep). TDD per step where practical.

## Step 1: Project scaffold

### Files to Change
- `package.json` — `"type": "module"`, scripts: `test`, `dev`; engines node >=18.
- `.gitignore` — `node_modules`, `.env`, `.vercel`.
- `vercel.json` — minimal; ensure `public/` static + `api/` functions (Vercel
  defaults handle this, but pin `nodejs` runtime if needed).
- `targets.json` — example with 2 placeholder targets + comment in README.
- `.env.example` — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`.

### Verification
- [ ] `node --input-type=module -e "import('./targets.json', {with:{type:'json'}})"` style load OK, or simpler: targets loaded via `fs.readFile` (decide in Step 2).
- [ ] `npm test` runs (even with zero tests) without error.

## Step 2: `lib/checks.js` (TDD)

### Files to Change
- `lib/checks.js` — exports `checkTarget(target)` and `runChecks(targets)`.
- `test/checks.test.js` — write first.

### Implementation Details
- `checkTarget`: `AbortController` with `timeoutMs` (default 10000). `fetch(url,
  {method: target.method||'GET', signal})`. Measure `responseMs` with
  `performance.now()`. Classify:
  - thrown error (abort/network) → `{ok:false, statusCode:null, error}` (abort →
    `error:"timeout"`).
  - `expectStatus` set and `res.status !== expectStatus` → DOWN `HTTP <status>`.
  - else `res.ok` (2xx) → UP; non-2xx → DOWN `HTTP <status>`.
  - `checkedAt` = ISO string. (Note: `new Date()` is fine at runtime in app code;
    only the Workflow sandbox forbids it.)
- `runChecks`: `Promise.allSettled` over targets; never throws.
- Load targets: `lib/targets.js` reads `targets.json` via
  `fs.readFile(new URL('../targets.json', import.meta.url))` + `JSON.parse`.

### Verification
- [ ] Tests: stub server returns 200 → UP; 500 → DOWN `HTTP 500`; delayed past
      timeout → DOWN `timeout`; closed port → DOWN with error; `expectStatus:201`
      vs 200 → DOWN.
- [ ] `npm test` green.

## Step 3: `lib/telegram.js` (TDD)

### Files to Change
- `lib/telegram.js` — `sendTelegram(text)` and `formatDownMessage(result)`.
- `test/telegram.test.js`.

### Implementation Details
- `sendTelegram`: POST to
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage` with JSON
  `{chat_id: TELEGRAM_CHAT_ID, text, parse_mode:'HTML', disable_web_page_preview:true}`.
  Wrap in try/catch; log + return `{ok:false}` on failure (never throw).
- `formatDownMessage(r)`: `🔴 <b>${name}</b> is DOWN\n${url}\nReason: ${error||'HTTP '+statusCode}\n${checkedAt}`.
- Inject `fetch` and env for testability (params with defaults), so tests pass a
  fake fetch and assert URL + body; assert thrown fetch is swallowed.

### Verification
- [ ] Tests assert correct endpoint, chat_id, text; error path returns `{ok:false}`.
- [ ] `npm test` green.

## Step 4: `api/status.js`

### Files to Change
- `api/status.js` — default export `(req,res)` Vercel handler.

### Implementation Details
- `runChecks(await loadTargets())`; `res.setHeader('content-type','application/json')`;
  `res.end(JSON.stringify(results))`. No alerts. Set `Cache-Control: no-store`.

### Verification
- [ ] Local invocation returns JSON array; manual `vercel dev` later.

## Step 5: `api/cron.js`

### Files to Change
- `api/cron.js` — default export handler.

### Implementation Details
- Read secret from `req.query.key` or `Authorization: Bearer`. If
  `!CRON_SECRET || provided !== CRON_SECRET` → `res.statusCode=401; end('unauthorized')`.
- `const results = await runChecks(await loadTargets())`.
- `const down = results.filter(r=>!r.ok)`; for each `await sendTelegram(formatDownMessage(r))`.
- Respond `{checked: results.length, down: down.length, results}`.
- Wrap body in try/catch → `500` on unexpected error.

### Verification
- [ ] Bad key → 401. Good key with a broken target → JSON shows it in `down`.

## Step 6: `public/index.html` dashboard

### Files to Change
- `public/index.html` — self-contained HTML + `<style>` + `<script>`.

### Implementation Details
- Fetch `/api/status`, render a card grid: name, url (link), colored badge
  (green UP / red DOWN), `HTTP <code>` or error, `<ms> ms`, relative "checked
  Xs ago". Header with title + last-updated. Auto-refresh via `setInterval` 30s
  (re-fetch, no full reload). Clean modern minimal CSS (system font, cards,
  subtle shadows, dark-friendly). Loading + fetch-error states.

### Verification
- [ ] Open locally against `/api/status`; cards render; broken target shows red.

## Step 7: README + final wiring

### Files to Change
- `README.md` — setup, env vars, `targets.json` editing, deploy to Vercel,
  cron-job.org 5-min setup (`https://<app>.vercel.app/api/cron?key=<CRON_SECRET>`),
  local dev (`vercel dev` or `npm test`).
- `vercel.json` — confirm final config.

### Verification
- [ ] `npm test` all green.
- [ ] README steps are concrete and copy-pasteable.

## Plan Review Checklist
- [x] Executable with zero prior context (file paths, signatures, behaviors given).
- [x] Each step independently verifiable (tests / manual checks).
- [x] Specific file paths and function names.
- [x] Scope boundaries explicit.
- [x] References TDD for lib steps.
