/**
 * Extract the provided secret from a request: `?key=...` query param or an
 * `Authorization: Bearer ...` header. Returns null if neither is present.
 * @param {{ query?: Record<string,string>, url?: string, headers?: Record<string,string> }} req
 * @returns {string|null}
 */
export function getProvidedKey(req) {
  let fromQuery = req.query?.key;
  if (!fromQuery && req.url) {
    try {
      fromQuery = new URL(req.url, 'http://localhost').searchParams.get('key');
    } catch {
      /* ignore malformed url */
    }
  }
  const auth = req.headers?.authorization;
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return fromQuery || bearer || null;
}

/**
 * Verify the request carries the correct CRON_SECRET. If not, writes a 401 JSON
 * response and returns false. Returns true when authorized.
 * @param {object} req
 * @param {object} res
 * @returns {boolean}
 */
export function requireSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  const provided = getProvidedKey(req);
  if (!secret || provided !== secret) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  return true;
}
