/**
 * Local helper: run all checks once and print results.
 *   node scripts/run-once.js            # just check + print
 *   node scripts/run-once.js --notify   # also send Telegram for DOWN targets
 *
 * For --notify, set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your environment
 * (or a .env you load yourself). Reads targets from targets.json.
 */
import { loadTargets } from '../lib/targets.js';
import { runChecks } from '../lib/checks.js';
import { sendTelegram, formatDownMessage } from '../lib/telegram.js';

const notify = process.argv.includes('--notify');

const targets = await loadTargets();
const results = await runChecks(targets);

console.table(
  results.map((r) => ({
    name: r.name,
    status: r.ok ? 'UP' : 'DOWN',
    code: r.statusCode ?? '-',
    ms: r.responseMs,
    error: r.error ?? '',
  })),
);

const down = results.filter((r) => !r.ok);
console.log(`\n${results.length} checked, ${down.length} down.`);

if (notify && down.length) {
  for (const r of down) {
    const res = await sendTelegram(formatDownMessage(r));
    console.log(`telegram[${r.name}]: ${res.ok ? 'sent' : (res.skipped ? 'skipped (not configured)' : 'failed')}`);
  }
}
