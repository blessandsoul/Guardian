import { loadTargets } from '../lib/targets.js';
import { runChecks } from '../lib/checks.js';
import { sendTelegram, formatDownMessage, formatSummaryMessage } from '../lib/telegram.js';
import { requireSecret } from '../lib/request.js';

/** True when ALWAYS_NOTIFY is set to a truthy-ish value (1/true/yes/on). */
function alwaysNotifyEnabled() {
  const v = String(process.env.ALWAYS_NOTIFY ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * GET /api/cron?key=SECRET
 * Called every ~5 minutes by an external scheduler (e.g. cron-job.org).
 *
 * - Default: sends a Telegram alert for every target currently DOWN.
 * - When ALWAYS_NOTIFY is enabled: instead sends ONE heartbeat summary message
 *   every run listing every target's status (UP or DOWN). Flip the env var off
 *   in Vercel to return to alert-only-on-failure — no code change needed.
 */
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (!requireSecret(req, res)) return;

  try {
    const results = await runChecks(await loadTargets());
    const down = results.filter((r) => !r.ok);
    const alwaysNotify = alwaysNotifyEnabled();

    let alertsSent = 0;
    if (alwaysNotify && results.length > 0) {
      // Heartbeat mode: one summary message every run.
      const r = await sendTelegram(formatSummaryMessage(results));
      if (r?.ok) alertsSent = 1;
    } else {
      // Default: one alert per DOWN target.
      const alerts = await Promise.allSettled(
        down.map((r) => sendTelegram(formatDownMessage(r))),
      );
      alertsSent = alerts.filter(
        (a) => a.status === 'fulfilled' && a.value?.ok,
      ).length;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      checkedAt: new Date().toISOString(),
      mode: alwaysNotify ? 'heartbeat' : 'alert-on-down',
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
