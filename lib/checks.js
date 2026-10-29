import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * @typedef {Object} CheckResult
 * @property {string} name
 * @property {string} url
 * @property {string} [group]  optional project the target belongs to
 * @property {string} [label]  optional role within the group (e.g. Server/Client)
 * @property {boolean} ok
 * @property {number|null} statusCode
 * @property {number} responseMs
 * @property {string|null} error
 * @property {string} checkedAt  ISO timestamp
 * @property {number} [attempts] number of probes used to confirm the result
 */

/**
 * Run a single HTTP health check. Never throws — failures are returned as
 * { ok: false, error }.
 *
 * @param {{name:string,url:string,group?:string,label?:string,method?:string,timeoutMs?:number,expectStatus?:number}} target
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

    // We only inspect headers. Release unread bodies so repeated checks on a
    // warm function cannot retain sockets; cleanup cannot change the HTTP result.
    try { await res.body?.cancel(); } catch { /* The observed status is authoritative. */ }

    return {
      name: target.name,
      url: target.url,
      group: target.group,
      label: target.label,
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
      group: target.group,
      label: target.label,
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
 * Run targets concurrently, confirming failures with up to three probes.
 * A success ends confirmation immediately. This filters short network failures
 * within one run; deduplication across runs requires a persistent incident store.
 * @param {Array} targets
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(targets, fetchImpl = globalThis.fetch) {
  return Promise.all(targets.map(async (target) => {
    // Only repeat safe reads: a custom POST/PUT check could have side effects.
    const method = (target.method || 'GET').toUpperCase();
    const maxAttempts = method === 'GET' || method === 'HEAD' ? MAX_ATTEMPTS : 1;
    for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
      const result = await checkTarget(target, fetchImpl);
      if (result.ok || attempts === maxAttempts) return { ...result, attempts };
      await delay(RETRY_DELAY_MS);
    }
  }));
}
