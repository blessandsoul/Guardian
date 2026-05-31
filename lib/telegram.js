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
 * Build a heartbeat summary message listing every target's status.
 * Used when ALWAYS_NOTIFY is enabled, so you get a message every run even
 * when everything is healthy.
 * @param {import('./checks.js').CheckResult[]} results
 * @returns {string}
 */
export function formatSummaryMessage(results) {
  const downCount = results.filter((r) => !r.ok).length;
  const header =
    downCount === 0
      ? `✅ <b>All systems operational</b> (${results.length})`
      : `🔴 <b>${downCount} of ${results.length} DOWN</b>`;

  const lines = results.map((r) => {
    if (r.ok) {
      return `✅ ${escapeHtml(r.name)} — ${r.statusCode} · ${r.responseMs}ms`;
    }
    const reason = r.error || (r.statusCode != null ? `HTTP ${r.statusCode}` : 'unknown');
    return `🔴 ${escapeHtml(r.name)} — ${escapeHtml(reason)}`;
  });

  const checkedAt = results[0]?.checkedAt;
  const footer = checkedAt ? `\nChecked: ${escapeHtml(formatTimestamp(checkedAt))}` : '';

  return [header, '', ...lines].join('\n') + footer;
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
  // Optional forum topic (message_thread_id) — send into a specific group topic.
  const topicId = opts.topicId ?? process.env.TELEGRAM_TOPIC_ID;

  if (!token || !chatId) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send');
    return { ok: false, skipped: true };
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (topicId !== undefined && topicId !== null && String(topicId).trim() !== '') {
    payload.message_thread_id = Number(topicId);
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: !!res.ok };
  } catch (err) {
    console.error('[telegram] send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'send failed' };
  }
}
