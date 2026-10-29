import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkTarget, runChecks } from '../lib/checks.js';

/** Start a stub HTTP server with custom routing. Returns { base, close }. */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('200 response → UP', async () => {
  const srv = await startServer((req, res) => { res.statusCode = 200; res.end('ok'); });
  try {
    const r = await checkTarget({ name: 'ok', url: `${srv.base}/` });
    assert.equal(r.ok, true);
    assert.equal(r.statusCode, 200);
    assert.equal(r.error, null);
    assert.ok(typeof r.responseMs === 'number');
    assert.ok(r.checkedAt);
  } finally {
    await srv.close();
  }
});

test('500 response → DOWN with HTTP 500', async () => {
  const srv = await startServer((req, res) => { res.statusCode = 500; res.end('boom'); });
  try {
    const r = await checkTarget({ name: 'fail', url: `${srv.base}/` });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, 500);
    assert.equal(r.error, 'HTTP 500');
  } finally {
    await srv.close();
  }
});

test('slow response past timeout → DOWN with timeout', async () => {
  const srv = await startServer((req, res) => {
    setTimeout(() => { res.statusCode = 200; res.end('late'); }, 300);
  });
  try {
    const r = await checkTarget({ name: 'slow', url: `${srv.base}/`, timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.statusCode, null);
    assert.match(r.error, /timeout/);
  } finally {
    await srv.close();
  }
});

test('connection refused → DOWN', async () => {
  // Bind a server, capture its port, then close it so the port is refused.
  const srv = await startServer((req, res) => res.end('x'));
  const base = srv.base;
  await srv.close();
  const r = await checkTarget({ name: 'refused', url: `${base}/`, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.statusCode, null);
  assert.ok(r.error);
});

test('expectStatus mismatch → DOWN', async () => {
  const srv = await startServer((req, res) => { res.statusCode = 200; res.end('ok'); });
  try {
    const r = await checkTarget({ name: 'expect', url: `${srv.base}/`, expectStatus: 201 });
    assert.equal(r.ok, false);
    assert.match(r.error, /expected 201/);
  } finally {
    await srv.close();
  }
});

test('expectStatus match → UP', async () => {
  const srv = await startServer((req, res) => { res.statusCode = 201; res.end('created'); });
  try {
    const r = await checkTarget({ name: 'expect-ok', url: `${srv.base}/`, expectStatus: 201 });
    assert.equal(r.ok, true);
    assert.equal(r.statusCode, 201);
  } finally {
    await srv.close();
  }
});

test('runChecks runs all targets and never throws', async () => {
  const srv = await startServer((req, res) => { res.statusCode = 200; res.end('ok'); });
  try {
    const results = await runChecks([
      { name: 'a', url: `${srv.base}/` },
      { name: 'b', url: `${srv.base}/` },
    ]);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok));
  } finally {
    await srv.close();
  }
});

test('runChecks confirms a timeout before reporting DOWN', async () => {
  let requests = 0;
  const srv = await startServer((req, res) => {
    requests += 1;
    if (requests === 1) return;
    res.end('recovered');
  });
  try {
    const [result] = await runChecks([
      { name: 'transient', url: srv.base, timeoutMs: 50 },
    ]);
    assert.equal(result.ok, true, 'a successful confirmation must suppress the outage');
    assert.equal(result.statusCode, 200);
    assert.equal(requests, 2);
  } finally {
    await srv.close();
  }
});

test('runChecks reports a persistent HTTP failure after three attempts', async () => {
  let requests = 0;
  const srv = await startServer((req, res) => {
    requests += 1;
    res.statusCode = 503;
    res.end('unavailable');
  });
  try {
    const [result] = await runChecks([{ name: 'outage', url: srv.base }]);
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 503);
    assert.equal(requests, 3, 'confirm failure without retrying indefinitely');
  } finally {
    await srv.close();
  }
});

test('runChecks stops confirming as soon as an HTTP failure recovers', async () => {
  let requests = 0;
  const srv = await startServer((req, res) => {
    requests += 1;
    res.statusCode = requests === 1 ? 502 : 200;
    res.end();
  });
  try {
    const [result] = await runChecks([{ name: 'recovering', url: srv.base }]);
    assert.equal(result.ok, true);
    assert.equal(requests, 2);
  } finally {
    await srv.close();
  }
});

test('runChecks never retries a failed POST check', async () => {
  let requests = 0;
  const srv = await startServer((req, res) => {
    requests += 1;
    res.statusCode = 500;
    res.end();
  });
  try {
    const [result] = await runChecks([{ name: 'post', url: srv.base, method: 'POST' }]);
    assert.equal(result.ok, false);
    assert.equal(requests, 1, 'confirmation must not repeat a possible side effect');
  } finally {
    await srv.close();
  }
});

test('header-only checks release response bodies before returning', async () => {
  for (const status of [200, 503]) {
    let released = false;
    const response = new Response(new ReadableStream({ cancel() { released = true; } }), { status });
    const result = await checkTarget({ name: 'stream', url: 'https://example.test' }, async () => response);
    assert.equal(result.statusCode, status);
    assert.equal(released, true, 'unread bodies must not retain connections across warm invocations');
  }
});
