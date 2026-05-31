/** Escape characters that are special in Telegram HTML parse mode. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
    `Checked: ${escapeHtml(r.checkedAt)}`,
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
