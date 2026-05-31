import { readFile } from 'node:fs/promises';

/**
 * Load the list of monitored targets from targets.json (repo root).
 * @returns {Promise<Array<{name:string,url:string,method?:string,timeoutMs?:number,expectStatus?:number}>>}
 */
export async function loadTargets() {
  const fileUrl = new URL('../targets.json', import.meta.url);
  const raw = await readFile(fileUrl, 'utf8');
  const targets = JSON.parse(raw);
  if (!Array.isArray(targets)) {
    throw new Error('targets.json must be a JSON array');
  }
  return targets;
}
