import { readSnapshot } from '../lib/monitor.js';
import { sendTelegram, formatSummaryMessage, formatTimestamp } from '../lib/telegram.js';
import { requireSecret } from '../lib/request.js';

/**
 * GET /api/heartbeat?key=SECRET
 * Sends the last scheduled snapshot, without running a competing set of probes.
 * Missing or stale evidence must never produce a fresh "all clear".
 */
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (!requireSecret(req, res)) return;

  try {
    const snapshot = await readSnapshot();
    let alertsSent = 0;
    if (snapshot.results.length > 0) {
      const text = snapshot.stale
        ? `⚠️ Guardian monitor data is stale.\nLast completed check: ${formatTimestamp(snapshot.checkedAt)}\nCurrent service status is unknown.`
        : formatSummaryMessage(snapshot.results, { title: '🕐 Hourly status' });
      const r = await sendTelegram(text);
      if (r?.ok) alertsSent = 1;
    }

    res.statusCode = snapshot.results.length && !alertsSent ? 502 : 200;
    res.end(JSON.stringify({
      ...snapshot,
      mode: 'heartbeat',
      alertsSent,
    }));
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: err?.message || 'internal error' }));
  }
}
