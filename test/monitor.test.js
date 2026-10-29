import { test } from 'node:test';
import assert from 'node:assert/strict';
import cron from '../api/cron.js';
import heartbeat from '../api/heartbeat.js';
import status from '../api/status.js';

/** Fake only external HTTP services; handlers and incident processing stay real. */
function services(t) {
  const env = {
    CRON_SECRET: 'test-secret', TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: 'test-chat', ALWAYS_NOTIFY: 'off',
    UPSTASH_REDIS_REST_URL: 'https://redis.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-redis-token', GUARDIAN_STATE_KEY: 'test:guardian',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const backend = {
    values: new Map(), telegrams: [], probes: 0, failed: true,
    storeAvailable: true, deliveryOk: true, loseLock: false, now: Date.parse('2026-10-29T15:00:00Z'),
    nextRun() { this.now += 5 * 60 * 1000; },
  };
  t.mock.method(Date, 'now', () => backend.now);
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url) === env.UPSTASH_REDIS_REST_URL) {
      assert.equal(init.headers.authorization, 'Bearer test-redis-token');
      if (!backend.storeAvailable) return Response.json({ error: 'unavailable' }, { status: 503 });
      const [command, ...args] = JSON.parse(init.body);
      let result;
      if (command === 'GET') result = backend.values.get(args[0]) ?? null;
      else if (command === 'SET') {
        if (args.includes('NX') && backend.values.has(args[0])) result = null;
        else { backend.values.set(args[0], args[1]); result = 'OK'; }
      } else if (command === 'EVAL') {
        const [script, keyCount, ...rest] = args;
        const keys = rest.slice(0, Number(keyCount));
        const argv = rest.slice(Number(keyCount));
        if (backend.values.get(keys[0]) !== argv[0]) result = 0;
        else if (script.includes("redis.call('SET'")) {
          backend.values.set(keys[1], argv[1]); result = 1;
        } else { backend.values.delete(keys[0]); result = 1; }
      } else assert.fail(`Unexpected Redis command: ${command}`);
      return Response.json({ result });
    }
    if (String(url).startsWith('https://api.telegram.org/')) {
      backend.telegrams.push(JSON.parse(init.body).text);
      return Response.json({ ok: backend.deliveryOk });
    }
    backend.probes += 1;
    if (backend.loseLock) backend.values.set('test:guardian:lock', 'new-owner');
    const fail = backend.failed && String(url) === 'https://api.aistaff.ge/api/v1/health';
    return new Response(null, { status: fail ? 503 : 200 });
  });
  return backend;
}

async function invoke(handler, authorized = true) {
  let body;
  const res = { statusCode: 200, setHeader() {}, end(value) { body = JSON.parse(value); } };
  await handler({ headers: { authorization: authorized ? 'Bearer test-secret' : 'Bearer wrong' } }, res);
  return { code: res.statusCode, body };
}

test('one failed scheduled run is pending and sends no outage alert', async (t) => {
  const backend = services(t);
  const response = await invoke(cron);
  assert.equal(response.code, 200);
  assert.equal(backend.telegrams.length, 0);
  assert.equal(response.body.pending, 1);
  assert.equal(response.body.down, 0);
});

test('a sustained outage sends one alert and one recovery across scheduled runs', async (t) => {
  const backend = services(t);
  await invoke(cron);
  backend.nextRun();
  const outage = await invoke(cron);
  assert.equal(outage.body.down, 1);
  assert.equal(backend.telegrams.length, 1);
  assert.match(backend.telegrams[0], /unreachable from Guardian/);
  assert.ok(backend.values.has('test:guardian'), 'incident must survive a Vercel instance replacement');
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 1, 'the same outage must not alert every five minutes');
  backend.failed = false;
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 2);
  assert.match(backend.telegrams[1], /RECOVERED/);
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 2, 'healthy runs must not repeat recovery');
});

test('a duplicate scheduler invocation cannot confirm an outage', async (t) => {
  const backend = services(t);
  await invoke(cron);
  const probeCount = backend.probes;
  await invoke(cron);
  assert.equal(backend.probes, probeCount);
  assert.equal(backend.telegrams.length, 0);
});

test('overlapping cron invocations do not probe or send alerts while a lock is held', async (t) => {
  const backend = services(t);
  backend.values.set('test:guardian:lock', 'another-instance');
  const response = await invoke(cron);
  assert.equal(response.code, 202);
  assert.equal(backend.probes, 0);
  assert.equal(backend.telegrams.length, 0);
});

test('unavailable incident storage stops checks and alerts instead of falling back to spam', async (t) => {
  const backend = services(t);
  backend.storeAvailable = false;
  const response = await invoke(cron);
  assert.equal(response.code, 503);
  assert.equal(backend.probes, 0);
  assert.equal(backend.telegrams.length, 0);
});

test('a rejected Telegram delivery remains eligible for the next scheduled run', async (t) => {
  const backend = services(t);
  await invoke(cron);
  backend.deliveryOk = false;
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 1);
  backend.deliveryOk = true;
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 2);
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 2, 'only accepted deliveries may suppress later alerts');
});

test('hourly summaries and dashboard use the saved cron snapshot without new probes', async (t) => {
  const backend = services(t);
  backend.failed = false;
  const checked = await invoke(cron);
  const probeCount = backend.probes;
  backend.failed = true;
  const summary = await invoke(heartbeat);
  const dashboard = await invoke(status);
  assert.equal(summary.code, 200);
  assert.equal(backend.probes, probeCount);
  assert.deepEqual(dashboard.body.results, checked.body.results);
  assert.equal(dashboard.body.checkedAt, checked.body.checkedAt);
  assert.match(backend.telegrams[0], /All systems operational/);
});

test('old monitor data produces a stale warning instead of an hourly all clear', async (t) => {
  const backend = services(t);
  backend.failed = false;
  await invoke(cron);
  backend.now += 11 * 60 * 1000;
  await invoke(heartbeat);
  const dashboard = await invoke(status);
  assert.equal(dashboard.body.stale, true);
  assert.match(backend.telegrams[0], /stale/i);
  assert.doesNotMatch(backend.telegrams[0], /All systems operational/);
});

test('an unauthorized cron request never touches targets, state, or Telegram', async (t) => {
  const backend = services(t);
  const response = await invoke(cron, false);
  assert.equal(response.code, 401);
  assert.equal(backend.probes, 0);
  assert.equal(backend.values.size, 0);
  assert.equal(backend.telegrams.length, 0);
});

test('a healthy scheduled run resets an unconfirmed failure streak', async (t) => {
  const backend = services(t);
  await invoke(cron);
  backend.failed = false;
  backend.nextRun();
  await invoke(cron);
  assert.equal(backend.telegrams.length, 0, 'an unconfirmed failure has no recovery notification');
  backend.failed = true;
  backend.nextRun();
  const response = await invoke(cron);
  assert.equal(response.body.pending, 1);
  assert.equal(backend.telegrams.length, 0);
});

test('a gap in monitoring cannot turn an old isolated failure into a confirmed outage', async (t) => {
  const backend = services(t);
  await invoke(cron);
  backend.now += 11 * 60 * 1000;
  const response = await invoke(cron);
  assert.equal(response.body.pending, 1);
  assert.equal(backend.telegrams.length, 0);
});

test('a lost lock prevents state writes and alerts without deleting the new owner lock', async (t) => {
  const backend = services(t);
  backend.loseLock = true;
  const response = await invoke(cron);
  assert.equal(response.code, 503);
  assert.equal(backend.values.has('test:guardian'), false);
  assert.equal(backend.values.get('test:guardian:lock'), 'new-owner');
  assert.equal(backend.telegrams.length, 0);
});

test('corrupt saved state is not silently reset into duplicate alerts', async (t) => {
  const backend = services(t);
  backend.values.set('test:guardian', '{broken');
  const response = await invoke(cron);
  assert.equal(response.code, 503);
  assert.equal(backend.probes, 0);
  assert.equal(backend.telegrams.length, 0);
  assert.equal(backend.values.get('test:guardian'), '{broken');
});

test('malformed incident fields stop processing instead of losing notification history', async (t) => {
  const backend = services(t);
  await invoke(cron);
  const state = JSON.parse(backend.values.get('test:guardian'));
  Object.values(state.incidents)[0].notifiedDown = 'true';
  backend.values.set('test:guardian', JSON.stringify(state));
  backend.nextRun();
  const response = await invoke(cron);
  assert.equal(response.code, 503);
  assert.equal(backend.telegrams.length, 0);
});
