/**
 * Local dev server — serves the dashboard and API without the Vercel CLI.
 *   node --env-file-if-exists=.env scripts/dev-server.mjs
 *   (or: npm run dev:local)
 *
 * Routes:
 *   GET /            -> public/index.html (dashboard)
 *   GET /api/status  -> live checks as JSON
 *   GET /api/cron    -> live checks + Telegram alerts (needs ?key=CRON_SECRET)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import statusHandler from '../api/status.js';
import cronHandler from '../api/cron.js';
import heartbeatHandler from '../api/heartbeat.js';

const port = Number(process.env.PORT) || 3000;
const indexUrl = new URL('../public/index.html', import.meta.url);

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  try {
    if (pathname === '/api/status') return void statusHandler(req, res);
    if (pathname === '/api/cron') return void cronHandler(req, res);
    if (pathname === '/api/heartbeat') return void heartbeatHandler(req, res);
    if (pathname === '/' || pathname === '/index.html') {
      const html = await readFile(indexUrl);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    }
    res.statusCode = 404;
    res.end('Not found');
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err?.message || err));
  }
});

server.listen(port, () => {
  console.log(`Guardian dev server running:`);
  console.log(`  Dashboard : http://localhost:${port}/`);
  console.log(`  Status    : http://localhost:${port}/api/status`);
  console.log(`  Cron      : http://localhost:${port}/api/cron?key=<CRON_SECRET>`);
  console.log(`  Heartbeat : http://localhost:${port}/api/heartbeat?key=<CRON_SECRET>`);
});
