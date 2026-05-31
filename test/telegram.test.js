import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegram, formatDownMessage } from '../lib/telegram.js';

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

test('formatDownMessage falls back to status code when no error string', async () => {
  const msg = formatDownMessage({
    name: 'A', url: 'u', ok: false, statusCode: 503, responseMs: 1, error: null,
    checkedAt: '2026-06-01T10:00:00.000Z',
  });
  assert.match(msg, /HTTP 503/);
});
