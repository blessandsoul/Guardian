import { performance } from 'node:perf_hooks';

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * @typedef {Object} CheckResult
 * @property {string} name
 * @property {string} url
 * @property {boolean} ok
 * @property {number|null} statusCode
 * @property {number} responseMs
 * @property {string|null} error
 * @property {string} checkedAt  ISO timestamp
 */

/**
 * Run a single HTTP health check. Never throws — failures are returned as
 * { ok: false, error }.
 *
 * @param {{name:string,url:string,method?:string,timeoutMs?:number,expectStatus?:number}} target
 * @param {typeof fetch} [fetchImpl] injectable for testing
 * @returns {Promise<CheckResult>}
 */
export async function checkTarget(target, fetchImpl = globalThis.fetch) {
  const method = target.method || 'GET';
  const timeoutMs = Number.isFinite(target.timeoutMs) ? target.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    const res = await fetchImpl(target.url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
    });
    const responseMs = Math.round(performance.now() - start);

    let ok;
    let error = null;
    if (Number.isFinite(target.expectStatus)) {
      ok = res.status === target.expectStatus;
      if (!ok) error = `HTTP ${res.status} (expected ${target.expectStatus})`;
    } else {
      ok = res.ok; // 200–299
      if (!ok) error = `HTTP ${res.status}`;
    }

    return {
      name: target.name,
      url: target.url,
      ok,
      statusCode: res.status,
      responseMs,
      error,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const responseMs = Math.round(performance.now() - start);
    const isAbort = controller.signal.aborted
      || (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
    const error = isAbort
      ? `timeout after ${timeoutMs}ms`
      : (err?.cause?.code || err?.code || err?.message || 'request failed');

    return {
      name: target.name,
      url: target.url,
      ok: false,
      statusCode: null,
      responseMs,
      error,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run all checks concurrently. Never throws.
 * @param {Array} targets
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(targets, fetchImpl = globalThis.fetch) {
  return Promise.all(targets.map((t) => checkTarget(t, fetchImpl)));
}
