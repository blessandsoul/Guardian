import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegram, formatDownMessage, formatTimestamp, formatSummaryMessage } from '../lib/telegram.js';

test('formatSummaryMessage shows all-operational header when everything is UP', async () => {
  const msg = formatSummaryMessage([
    { name: 'A', url: 'u', ok: true, statusCode: 200, responseMs: 100, error: null, checkedAt: '2026-06-01T10:00:00.000Z' },
    { name: 'B', url: 'u', ok: true, statusCode: 200, responseMs: 50, error: null, checkedAt: '2026-06-01T10:00:00.000Z' },
  ]);
  assert.match(msg, /All systems operational<\/b> \(2\)/);
  assert.match(msg, /✅ A — 200 · 100ms/);
  assert.match(msg, /✅ B — 200 · 50ms/);
});

test('formatSummaryMessage prepends a title line when provided', async () => {
  const msg = formatSummaryMessage(
    [{ name: 'A', url: 'u', ok: true, statusCode: 200, responseMs: 10, error: null, checkedAt: '2026-06-01T10:00:00.000Z' }],
    { title: '🕐 Hourly status' },
  );
  assert.match(msg, /^<b>🕐 Hourly status<\/b>\n/);
  assert.match(msg, /All systems operational/);
});

test('formatSummaryMessage shows down count and reason when something is DOWN', async () => {
  const msg = formatSummaryMessage([
    { name: 'A', url: 'u', ok: true, statusCode: 200, responseMs: 100, error: null, checkedAt: '2026-06-01T10:00:00.000Z' },
    { name: 'B', url: 'u', ok: false, statusCode: 500, responseMs: 80, error: 'HTTP 500', checkedAt: '2026-06-01T10:00:00.000Z' },
  ]);
  assert.match(msg, /1 of 2 DOWN/);
  assert.match(msg, /🔴 B — HTTP 500/);
});

test('formatSummaryMessage groups by project with Server/Client lines', async () => {
  const msg = formatSummaryMessage([
    { group: 'Tulip', label: 'Server', name: 'Tulip Server', url: 'u', ok: true, statusCode: 200, responseMs: 120, error: null, checkedAt: '2026-06-01T10:00:00.000Z' },
    { group: 'Tulip', label: 'Client', name: 'Tulip Client', url: 'u', ok: false, statusCode: 502, responseMs: 80, error: 'HTTP 502', checkedAt: '2026-06-01T10:00:00.000Z' },
    { group: 'GLOW', label: 'Server', name: 'GLOW Server', url: 'u', ok: true, statusCode: 200, responseMs: 90, error: null, checkedAt: '2026-06-01T10:00:00.000Z' },
  ]);
  assert.match(msg, /1 of 3 DOWN/);
  assert.match(msg, /<b>Tulip<\/b>/);
  assert.match(msg, /Server — ✅ 200 · 120ms/);
  assert.match(msg, /Client — 🔴 HTTP 502/);
  assert.match(msg, /<b>GLOW<\/b>/);
});

test('formatDownMessage uses "Group Label" title when grouped', async () => {
  const msg = formatDownMessage({
    group: 'AIStaff', label: 'Client', name: 'AIStaff Client', url: 'https://aistaff.ge/',
    ok: false, statusCode: 500, responseMs: 10, error: 'HTTP 500', checkedAt: '2026-06-01T10:00:00.000Z',
  });
  assert.match(msg, /<b>AIStaff Client<\/b> is DOWN/);
});

test('formatTimestamp renders DD/MM/YY HH:mm:ss for a given timezone', async () => {
  // 2026-06-01T10:00:00Z is 14:00 in Asia/Tbilisi (UTC+4)
  assert.equal(formatTimestamp('2026-06-01T10:00:00.000Z', 'Asia/Tbilisi'), '01/06/26 14:00:00');
  assert.equal(formatTimestamp('2026-06-01T10:00:00.000Z', 'UTC'), '01/06/26 10:00:00');
});

test('formatTimestamp returns the raw value for an unparseable date', async () => {
  assert.equal(formatTimestamp('not-a-date'), 'not-a-date');
});

test('sendTelegram posts to the correct URL with chat_id and text', async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true };
  };
  const res = await sendTelegram('hello world', {
    fetchImpl: fakeFetch,
    token: 'TOKEN123',
    chatId: '999',
  });
  assert.equal(res.ok, true);
  assert.equal(captured.url, 'https://api.telegram.org/botTOKEN123/sendMessage');
  assert.equal(captured.init.method, 'POST');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.chat_id, '999');
  assert.equal(body.text, 'hello world');
  assert.equal(body.parse_mode, 'HTML');
});

test('sendTelegram includes message_thread_id when a topic is set', async () => {
  let captured;
  const fakeFetch = async (url, init) => { captured = JSON.parse(init.body); return { ok: true }; };
  await sendTelegram('hi', { fetchImpl: fakeFetch, token: 'T', chatId: '-1001', topicId: '42' });
  assert.equal(captured.message_thread_id, 42);
  assert.equal(captured.chat_id, '-1001');
});

test('sendTelegram omits message_thread_id when no topic is set', async () => {
  let captured;
  const fakeFetch = async (url, init) => { captured = JSON.parse(init.body); return { ok: true }; };
  await sendTelegram('hi', { fetchImpl: fakeFetch, token: 'T', chatId: '999', topicId: '' });
  assert.equal('message_thread_id' in captured, false);
});

test('sendTelegram swallows fetch errors and returns ok:false', async () => {
  const fakeFetch = async () => { throw new Error('network down'); };
  const res = await sendTelegram('x', { fetchImpl: fakeFetch, token: 'T', chatId: '1' });
  assert.equal(res.ok, false);
  assert.match(res.error, /network down/);
});

test('sendTelegram skips when not configured and does not call fetch', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true }; };
  const res = await sendTelegram('x', { fetchImpl: fakeFetch, token: '', chatId: '' });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, true);
  assert.equal(called, false);
});

test('formatDownMessage includes name, url, reason and escapes HTML', async () => {
  const msg = formatDownMessage({
    name: 'My <App>',
    url: 'https://x.test/health',
    ok: false,
    statusCode: 502,
    responseMs: 12,
    error: 'HTTP 502',
    checkedAt: '2026-06-01T10:00:00.000Z',
  });
  assert.match(msg, /is DOWN/);
  assert.match(msg, /My &lt;App&gt;/); // escaped
  assert.match(msg, /https:\/\/x\.test\/health/);
  assert.match(msg, /HTTP 502/);
});

test('formatDownMessage renders the timestamp as DD/MM/YY HH:mm:ss', async () => {
  process.env.DISPLAY_TZ = 'UTC';
  const msg = formatDownMessage({
    name: 'A', url: 'u', ok: false, statusCode: 500, responseMs: 1, error: 'HTTP 500',
    checkedAt: '2026-06-01T10:00:00.000Z',
  });
  assert.match(msg, /Checked: 01\/06\/26 10:00:00/);
  delete process.env.DISPLAY_TZ;
});

test('formatDownMessage falls back to status code when no error string', async () => {
  const msg = formatDownMessage({
    name: 'A', url: 'u', ok: false, statusCode: 503, responseMs: 1, error: null,
    checkedAt: '2026-06-01T10:00:00.000Z',
  });
  assert.match(msg, /HTTP 503/);
});
