import { loadTargets } from '../lib/targets.js';
import { runChecks } from '../lib/checks.js';
import { sendTelegram, formatSummaryMessage } from '../lib/telegram.js';
import { requireSecret } from '../lib/request.js';

/**
 * GET /api/heartbeat?key=SECRET
 * Always sends ONE Telegram summary listing every target's status (UP or DOWN),
 * regardless of ALWAYS_NOTIFY. Point a separate, lower-frequency scheduler at
 * this (e.g. cron-job.org every hour) so you get a periodic "all clear" report
 * on top of the failure-only alerts from /api/cron.
 */
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (!requireSecret(req, res)) return;

  try {
    const results = await runChecks(await loadTargets());
    const down = results.filter((r) => !r.ok);

    let alertsSent = 0;
    if (results.length > 0) {
      const r = await sendTelegram(formatSummaryMessage(results, { title: '🕐 Hourly status' }));
      if (r?.ok) alertsSent = 1;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      checkedAt: new Date().toISOString(),
      mode: 'heartbeat',
      checked: results.length,
      down: down.length,
      alertsSent,
      results,
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err?.message || 'internal error' }));
  }
}
