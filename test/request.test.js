import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvidedKey, requireSecret } from '../lib/request.js';

test('getProvidedKey reads ?key= from req.query', () => {
  assert.equal(getProvidedKey({ query: { key: 'abc' } }), 'abc');
});

test('getProvidedKey parses ?key= from req.url when query absent', () => {
  assert.equal(getProvidedKey({ url: '/api/cron?key=xyz' }), 'xyz');
});

test('getProvidedKey reads Authorization: Bearer header', () => {
  assert.equal(getProvidedKey({ headers: { authorization: 'Bearer tok123' } }), 'tok123');
});

test('getProvidedKey returns null when nothing provided', () => {
  assert.equal(getProvidedKey({ headers: {} }), null);
});

test('requireSecret returns false and writes 401 on mismatch', () => {
  process.env.CRON_SECRET = 'right';
  let code, body;
  const res = { set statusCode(v) { code = v; }, end(b) { body = b; } };
  const ok = requireSecret({ query: { key: 'wrong' } }, res);
  assert.equal(ok, false);
  assert.equal(code, 401);
  assert.match(body, /unauthorized/);
  delete process.env.CRON_SECRET;
});

test('requireSecret returns true when key matches', () => {
  process.env.CRON_SECRET = 'right';
  const res = { set statusCode(_v) {}, end() {} };
  assert.equal(requireSecret({ query: { key: 'right' } }, res), true);
  delete process.env.CRON_SECRET;
});
