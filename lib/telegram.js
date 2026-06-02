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
  // Prefer "Group Label" (e.g. "AIStaff Client") when available, else the name.
  const title = r.group ? `${r.group} ${r.label || ''}`.trim() : r.name;
  return [
    `🔴 <b>${escapeHtml(title)}</b> is DOWN`,
    escapeHtml(r.url),
    `Reason: ${escapeHtml(reason)}`,
    `Checked: ${escapeHtml(formatTimestamp(r.checkedAt))}`,
  ].join('\n');
}

/**
 * Build a heartbeat summary message listing every target's status.
 * Used when ALWAYS_NOTIFY is enabled (or by /api/heartbeat), so you get a
 * message even when everything is healthy.
 * @param {import('./checks.js').CheckResult[]} results
 * @param {{ title?: string }} [opts] optional title line prepended to the message
 * @returns {string}
 */
export function formatSummaryMessage(results, opts = {}) {
  const downCount = results.filter((r) => !r.ok).length;
  const titleLine = opts.title ? `<b>${escapeHtml(opts.title)}</b>\n` : '';
  const header =
    titleLine +
    (downCount === 0
      ? `✅ <b>All systems operational</b> (${results.length})`
      : `🔴 <b>${downCount} of ${results.length} DOWN</b>`);

  // One line describing a single check's status.
  const statusLine = (r) => {
    if (r.ok) return `✅ ${r.statusCode} · ${r.responseMs}ms`;
    const reason = r.error || (r.statusCode != null ? `HTTP ${r.statusCode}` : 'unknown');
    return `🔴 ${escapeHtml(reason)}`;
  };

  let body;
  const hasGroups = results.some((r) => r.group);
  if (hasGroups) {
    // Group by project, with a "Label — status" line per check (e.g. Server/Client).
    const groups = [];
    const byName = new Map();
    for (const r of results) {
      const key = r.group || r.name;
      if (!byName.has(key)) {
        const g = { key, items: [] };
        byName.set(key, g);
        groups.push(g);
      }
      byName.get(key).items.push(r);
    }
    const blocks = groups.map((g) => {
      const lines = g.items.map((r) => {
        const label = r.label || r.name;
        return `  ${escapeHtml(label)} — ${statusLine(r)}`;
      });
      return `<b>${escapeHtml(g.key)}</b>\n${lines.join('\n')}`;
    });
    body = blocks.join('\n\n');
  } else {
    // Flat list (no groups defined).
    body = results
      .map((r) => `${r.ok ? '✅' : '🔴'} ${escapeHtml(r.name)} — ${statusLine(r).replace(/^✅ |^🔴 /, '')}`)
      .join('\n');
  }

  const checkedAt = results[0]?.checkedAt;
  const footer = checkedAt ? `\n\nChecked: ${escapeHtml(formatTimestamp(checkedAt))}` : '';

  return [header, '', body].join('\n') + footer;
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
