/** Escape characters that are special in Telegram HTML parse mode. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format an ISO timestamp as `DD/MM/YY HH:mm:ss` in a given timezone.
 * Timezone defaults to DISPLAY_TZ env var, else UTC. Falls back to the raw
 * string if the date can't be parsed.
 * @param {string} iso
 * @param {string} [tz]
 * @returns {string}
 */
export function formatTimestamp(iso, tz = process.env.DISPLAY_TZ || 'UTC') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Build the alert text for a DOWN check result (Telegram HTML parse mode).
 * @param {import('./checks.js').CheckResult} r
 * @returns {string}
 */
export function formatDownMessage(r) {
  const reason = r.error || (r.statusCode != null ? `HTTP ${r.statusCode}` : 'unknown');
  return [
    `🔴 <b>${escapeHtml(r.name)}</b> is DOWN`,
    escapeHtml(r.url),
    `Reason: ${escapeHtml(reason)}`,
    `Checked: ${escapeHtml(formatTimestamp(r.checkedAt))}`,
  ].join('\n');
}

/**
 * Send a message via the Telegram Bot API. Never throws.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.token]
 * @param {string} [opts.chatId]
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:string}>}
 */
export async function sendTelegram(text, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const token = opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send');
    return { ok: false, skipped: true };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return { ok: !!res.ok };
  } catch (err) {
    console.error('[telegram] send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'send failed' };
  }
}
