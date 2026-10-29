import { readSnapshot } from '../lib/monitor.js';

/**
 * GET /api/status
 * Reads the latest scheduled snapshot. Dashboard refreshes cannot confirm an
 * incident or contradict the hourly report with independent network probes.
 */
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    const snapshot = await readSnapshot();
    res.statusCode = 200;
    res.end(JSON.stringify(snapshot));
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: err?.message || 'internal error' }));
  }
}
