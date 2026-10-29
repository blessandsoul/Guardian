/**
 * Shared incident state for stateless Vercel functions, using Upstash's Redis
 * REST protocol. No process-local fallback: losing state would re-enable spam.
 */
const LOCK_MS = 90_000; // Outlives the function's configured 60-second deadline.
const SAVE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
return 1`;
const RELEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

/** Credentials stay in headers; provider errors never echo secrets to callers. */
export function createStore() {
  // Vercel's marketplace connection uses PREFIX_KV_REST_API_* names. Manual
  // Upstash credentials take precedence as a pair; never mix the two sources.
  const manual = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN;
  const url = manual ? process.env.UPSTASH_REDIS_REST_URL : process.env.UPSTASH_KV_REST_API_URL;
  const token = manual ? process.env.UPSTASH_REDIS_REST_TOKEN : process.env.UPSTASH_KV_REST_API_TOKEN;
  const key = process.env.GUARDIAN_STATE_KEY || 'guardian:{monitor}:v1';
  if (!url || !token) throw new Error('Incident storage is not configured');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash) throw new Error('Incident storage requires a clean HTTPS URL');

  async function command(args) {
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
      const data = await response.json();
      if (!response.ok || data.error || !Object.hasOwn(data, 'result')) throw new Error();
      return data.result;
    } catch {
      throw new Error('Incident storage is unavailable');
    }
  }

  return {
    async read() {
      const raw = await command(['GET', key]);
      if (raw === null) return null;
      let state;
      try { state = JSON.parse(raw); } catch { /* Reject corruption rather than reset deduplication. */ }
      if (state?.version !== 1 || !Array.isArray(state.results) || !state.incidents
        || typeof state.incidents !== 'object' || Array.isArray(state.incidents)
        || !Number.isFinite(Date.parse(state.checkedAt))
        || state.results.some((r) => !r || typeof r.ok !== 'boolean' || !['up', 'pending', 'down'].includes(r.state))
        || Object.values(state.incidents).some((incident) => !incident
          || !Number.isSafeInteger(incident.failures) || incident.failures < 0
          || typeof incident.notifiedDown !== 'boolean'
          || (incident.downSince !== null && !Number.isFinite(Date.parse(incident.downSince))))) {
        throw new Error('Incident storage contains invalid state');
      }
      return state;
    },
    async acquire(owner) {
      return await command(['SET', `${key}:lock`, owner, 'NX', 'PX', LOCK_MS]) === 'OK';
    },
    async save(owner, state) {
      // A function whose lease expired must not overwrite a newer run's state.
      const saved = await command(['EVAL', SAVE, 2, `${key}:lock`, key, owner, JSON.stringify(state)]);
      if (saved !== 1) throw new Error('Monitor lock was lost');
    },
    async release(owner) {
      // Compare-and-delete prevents an old invocation from unlocking a new one.
      await command(['EVAL', RELEASE, 1, `${key}:lock`, owner]);
    },
  };
}
