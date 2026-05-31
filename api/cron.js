import { loadTargets } from '../lib/targets.js';
import { runChecks } from '../lib/checks.js';
import { sendTelegram, formatDownMessage } from '../lib/telegram.js';

/** Extract the provided secret from ?key= or an `Authorization: Bearer` header. */
function getProvidedKey(req) {
  let fromQuery = req.query?.key;
  if (!fromQuery && req.url) {
    try {
      fromQuery = new URL(req.url, 'http://localhost').searchParams.get('key');
    } catch {
      /* ignore malformed url */
    }
  }
  const auth = req.headers?.authorization;
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return fromQuery || bearer || null;
}

/**
 * GET /api/cron?key=SECRET
 * Called every ~5 minutes by an external scheduler (e.g. cron-job.org).
 * Runs all checks and sends a Telegram alert for every target currently DOWN.
 */
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  const secret = process.env.CRON_SECRET;
  const provided = getProvidedKey(req);
  if (!secret || provided !== secret) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    const results = await runChecks(await loadTargets());
    const down = results.filter((r) => !r.ok);

    const alerts = await Promise.allSettled(
      down.map((r) => sendTelegram(formatDownMessage(r))),
    );
    const alertsSent = alerts.filter(
      (a) => a.status === 'fulfilled' && a.value?.ok,
    ).length;

    res.statusCode = 200;
    res.end(JSON.stringify({
      checkedAt: new Date().toISOString(),
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
