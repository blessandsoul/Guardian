/**
 * One-off proof that the DOWN -> Telegram alert path works.
 * Checks a deliberately-broken URL and sends a real Telegram alert.
 *   node --env-file=.env scripts/test-alert.mjs
 */
import { checkTarget } from '../lib/checks.js';
import { sendTelegram, formatDownMessage } from '../lib/telegram.js';

const target = { name: 'TEST (httpstat 500)', url: 'https://httpstat.us/500', timeoutMs: 8000 };
const r = await checkTarget(target);
console.log('check result:', r);

if (!r.ok) {
  const res = await sendTelegram(formatDownMessage(r));
  console.log('telegram:', res.ok ? 'SENT ✅ (check your phone)' : res.skipped ? 'skipped (env not set)' : 'failed: ' + res.error);
} else {
  console.log('target unexpectedly UP — no alert sent');
}
