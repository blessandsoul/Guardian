import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Explicit discovery works on Node 18+ and Windows without shell globbing.
// In particular, never auto-run scripts/test-alert.mjs: it can send real alerts.
const directory = new URL('../test/', import.meta.url);
const files = readdirSync(directory).filter((file) => file.endsWith('.test.js')).sort()
  .map((file) => fileURLToPath(new URL(file, directory)));
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
