import { runMonitor } from '../lib/monitor.js';
import { requireSecret } from '../lib/request.js';

/**
 * GET /api/cron?key=SECRET
 * Called every ~5 minutes by an external scheduler (e.g. cron-job.org).
 *
 * Retries failed probes, confirms incidents across scheduled runs, and sends
 * only incident/recovery transitions. Redis state is required; storage failures
 * return 503 rather than fall back to stateless alerts.
 */
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (!requireSecret(req, res)) return;

  try {
    const result = await runMonitor();
    res.statusCode = result.skipped === 'monitor is already running' ? 202 : result.deliveryFailed ? 502 : 200;
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: err?.message || 'internal error' }));
  }
}
