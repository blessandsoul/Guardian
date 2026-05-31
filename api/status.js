import { loadTargets } from '../lib/targets.js';
import { runChecks } from '../lib/checks.js';

/**
 * GET /api/status
 * Runs all health checks live and returns JSON. Read-only — never alerts.
 * Used by the dashboard.
 */
export default async function handler(req, res) {
  try {
    const results = await runChecks(await loadTargets());
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify({ checkedAt: new Date().toISOString(), results }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err?.message || 'internal error' }));
  }
}
