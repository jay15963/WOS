// S28 (docs/SYNC.md §6): the sync lint must pass on the repo and catch a raw world mutation.
//   node tools/mp-test/lint-selftest.mjs
// 1) node tools/check-sync.mjs in the repo → expects exit 0.
// 2) same lint in a temporary copy where src/game/gathering.js gets `game.world.addObject({...})` appended →
//    expects exit 1 and an R1 violation reported at gathering.js:<line>. The repo itself is never modified.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINT = join(ROOT, 'tools', 'check-sync.mjs');
if (!existsSync(LINT)) { console.log('S28 SKIP: tools/check-sync.mjs not present'); process.exit(0); }

const run = (cwd, script) => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
const fails = [];

const r1 = run(ROOT, LINT);
console.log(`[1] check-sync on the repo → exit ${r1.status}`);
if (r1.status !== 0) { fails.push('lint does not pass on the repo'); console.log((r1.stdout + r1.stderr).trim().split('\n').slice(0, 40).join('\n')); }

const tmp = mkdtempSync(join(tmpdir(), 'wos-lint-'));
try {
  for (const p of ['src', 'tools', 'index.html', 'sw.js', 'package.json', 'manifest.webmanifest']) {
    if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(tmp, p), { recursive: true });
  }
  const file = join(tmp, 'src', 'game', 'gathering.js');
  const lines = readFileSync(file, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  lines.push('export function lintProbe(game) { game.world.addObject({ id: 1, type: \'pebble\', x: 1, y: 1 }); }', '');
  const line = lines.length - 1; // 1-based line of the injected statement
  writeFileSync(file, lines.join('\n'));
  const r2 = run(tmp, join(tmp, 'tools', 'check-sync.mjs'));
  const out = (r2.stdout || '') + (r2.stderr || '');
  const hasR1 = /\bR1\b/.test(out);
  const hasLoc = new RegExp(`gathering\\.js:${line}\\b`).test(out);
  console.log(`[2] check-sync with an injected addObject at gathering.js:${line} → exit ${r2.status}, R1 ${hasR1 ? 'reported' : 'MISSING'}, location ${hasLoc ? 'reported' : 'MISSING'}`);
  if (r2.status !== 1) fails.push(`expected exit 1 on the injected copy, got ${r2.status}`);
  if (!hasR1 || !hasLoc) { fails.push('R1 violation with file:line not reported'); console.log(out.trim().split('\n').slice(0, 30).join('\n')); }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `S28 FAIL: ${fails.join('; ')}` : 'S28 PASS');
process.exit(fails.length ? 1 : 0);
