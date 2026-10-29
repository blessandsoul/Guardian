import { createHash, randomUUID } from 'node:crypto';
import { loadTargets } from './targets.js';
import { runChecks } from './checks.js';
import { createStore } from './store.js';
import { sendTelegram, formatDownMessage, formatRecoveryMessage, formatSummaryMessage } from './telegram.js';

const FAILURE_THRESHOLD = 2;
const MIN_RUN_INTERVAL_MS = 4 * 60_000;
const STALE_AFTER_MS = 10 * 60_000;

/** Public snapshots omit incident bookkeeping and expose stale monitor data. */
export function publicSnapshot(state) {
  return {
    checkedAt: state.checkedAt,
    stale: Date.now() - Date.parse(state.checkedAt) > STALE_AFTER_MS,
    checked: state.results.length,
    down: state.results.filter((r) => r.state === 'down').length,
    pending: state.results.filter((r) => r.state === 'pending').length,
    results: state.results,
  };
}

/** Both the dashboard and hourly report use the same completed cron snapshot. */
export async function readSnapshot() {
  const state = await createStore().read();
  if (!state) throw new Error('No monitor snapshot yet; run the scheduled cron check first');
  return publicSnapshot(state);
}

/**
 * Serialize probes, confirmation counters and notification acknowledgements.
 * Only scheduled runs change incidents; dashboard refreshes and hourly reports
 * cannot count as extra evidence or generate additional outage alerts.
 */
export async function runMonitor() {
  const store = createStore();
  const owner = randomUUID();
  if (!await store.acquire(owner)) return { skipped: 'monitor is already running' };

  try {
    const previous = await store.read();
    const age = previous ? Date.now() - Date.parse(previous.checkedAt) : Infinity;
    // Scheduler retries in the same interval must not confirm an outage twice.
    if (age < MIN_RUN_INTERVAL_MS) return { ...publicSnapshot(previous), skipped: 'recent check', alertsSent: 0 };

    const targets = await loadTargets();
    const probes = await runChecks(targets);
    const state = { version: 1, checkedAt: new Date(Date.now()).toISOString(), results: [], incidents: {} };
    const notifications = [];
    for (const [index, probe] of probes.entries()) {
      const target = targets[index];
      // Names may change without creating a new incident; URL/method/expectation
      // changes describe a different probe and must not inherit an old outage.
      const key = createHash('sha256').update(JSON.stringify([
        target.url, (target.method || 'GET').toUpperCase(), target.expectStatus ?? null,
      ])).digest('hex');
      const old = previous?.incidents[key];
      const incident = {
        failures: probe.ok ? 0 : (age <= STALE_AFTER_MS ? old?.failures || 0 : 0) + 1,
        notifiedDown: old?.notifiedDown === true,
        downSince: old?.downSince || (probe.ok ? null : state.checkedAt),
      };
      const status = probe.ok ? 'up' : incident.failures >= FAILURE_THRESHOLD ? 'down' : 'pending';
      state.incidents[key] = incident;
      state.results.push({ ...probe, state: status, consecutiveFailures: incident.failures });
      if (status === 'down' && !incident.notifiedDown) notifications.push({ key, type: 'down', probe });
      if (probe.ok && incident.notifiedDown) notifications.push({ key, type: 'recovery', probe });
      if (probe.ok && !incident.notifiedDown) incident.downSince = null;
    }

    // Persist evidence before delivery. Delivery failures remain unacknowledged
    // and eligible next run; successful sends are acknowledged while locked.
    await store.save(owner, state);
    const alwaysNotify = /^(1|true|yes|on)$/i.test(String(process.env.ALWAYS_NOTIFY || '').trim());
    let alertsSent = 0;
    let deliveryFailed = false;
    if ((alwaysNotify && probes.length) || notifications.length) {
      const text = alwaysNotify ? formatSummaryMessage(state.results) : notifications.map(({ type, probe }) => (
        type === 'down' ? formatDownMessage(probe) : formatRecoveryMessage(probe)
      )).join('\n\n');
      const delivery = await sendTelegram(text);
      if (delivery.ok) {
        alertsSent = 1;
        for (const notification of notifications) {
          const incident = state.incidents[notification.key];
          incident.notifiedDown = notification.type === 'down';
          if (notification.type === 'recovery') incident.downSince = null;
        }
        // Redis and Telegram cannot share a transaction. A termination between
        // send and this save can duplicate delivery; never acknowledge before send.
        await store.save(owner, state);
      } else deliveryFailed = true;
    }
    return { ...publicSnapshot(state), mode: alwaysNotify ? 'heartbeat' : 'incident-transitions', alertsSent, deliveryFailed };
  } finally {
    await store.release(owner).catch(() => console.warn('[monitor] Lock release failed; lease will expire'));
  }
}
