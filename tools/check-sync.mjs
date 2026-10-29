// Multiplayer sync lint (docs/SYNC.md §4.1). node tools/check-sync.mjs  (npm run check) — exit 1 on violations.
// Scans src/**/*.js line by line (comments ignored). A line ending with `// sync-ok: <reason>` is exempt
// (the reason is mandatory and reviewable). Rules:
//   R1  raw world mutation (addObject / removeObject / mineRock) outside world.js, game/mut/**, net/snapshot.js
//   R2  entity list mutation outside game/mut/**, net/entities.js, net/session.js, game/game.js, mobs.js, bandits.js
//   R3  ground-loot list mutation outside game/mut/loot.js, game/systems.js
//   R4  assignment to a replicated field outside game/mut/**, autotile.js (mask/orient), net/snapshot.js
//   R5  tile grid writes (solid[], noGrow[], occ[], path[] / pathPlan[]) outside game/mut/**, world/world.js, game/nav.js
//   R6  Math.random / Date.now / performance.now / game.player in game/mut/** (except roll.js, own.js)
//   R7  random ids (id = …Math.random…)
//   R8  Math.random in shared-state code (world/**, net/**, economy / building / save modules…)
//   R9  every net.emit / net.request / toOwner literal is defined; every definition has doc + args and is used
//   R10 every exported *System() returns an object with a `sync:` tag
//   R11 src/version.js and sw.js VERSION match the code (node tools/stamp.mjs)
//   R12 every creature species / structure / flora / crop kind has art contract names
//   R13 every src/game/mut/*.js module is imported by src/game/mut/index.js (its ops get registered)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, computeIds, readStamp, swVersion } from './stamp.mjs';

const rel = (p) => relative(ROOT, p).split(sep).join('/');
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.js')) files.push(rel(p));
  }
})(join(ROOT, 'src'));
files.sort();

const out = [];
const report = (rule, file, line, msg) => out.push(`${rule} ${file}:${line} ${msg}`);
const inMut = (f) => f.startsWith('src/game/mut/');

// strip comments, keep code (good enough for this code base: no '//' inside regex literals at line ends)
function codeOf(line, state) {
  let s = line;
  if (state.block) {
    const e = s.indexOf('*/');
    if (e < 0) return '';
    s = s.slice(e + 2); state.block = false;
  }
  let res = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (q) { res += c; if (c === '\\') { res += n ?? ''; i++; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; res += c; continue; }
    if (c === '/' && n === '/') break;
    if (c === '/' && n === '*') { const e = s.indexOf('*/', i + 2); if (e < 0) { state.block = true; break; } i = e + 1; continue; }
    res += c;
  }
  return res;
}

const RULES = [
  { id: 'R1', re: /\b(addObject|removeObject|mineRock)\s*\(/, ok: (f) => f === 'src/world/world.js' || inMut(f) || f === 'src/net/snapshot.js', msg: 'mutação direta do mundo fora de uma op (use defineOp em src/game/mut/)' },
  { id: 'R2', re: /\bentities\.(push|splice|unshift|pop|shift)\b|\bentities\s*=(?!=)/, ok: (f) => inMut(f) || ['src/net/entities.js', 'src/net/session.js', 'src/game/game.js', 'src/game/mobs.js', 'src/game/bandits.js'].includes(f), msg: 'lista de entidades alterada fora dos módulos de criaturas/rede' },
  { id: 'R3', re: /\bloot\.(push|splice)\b|\bgame\.loot\s*=(?!=)/, ok: (f) => f === 'src/game/mut/loot.js' || f === 'src/game/systems.js', msg: 'itens no chão alterados fora de mut/loot.js (use loot.add / loot.take)' },
  { id: 'R4', re: /\.(stump|stumpAt|fall|fallDir|gone|prog|born|progress|blueprint|mask|orient|working|fire|lit|broken|brokenAt|stage|growth|removed|store|decon)\s*(=(?!=)|\+=|-=)/, ok: (f, m) => inMut(f) || f === 'src/net/snapshot.js' || (f === 'src/game/autotile.js' && /\.(mask|orient)/.test(m[0])), msg: 'campo replicado alterado fora de uma op' },
  { id: 'R5', re: /\bsolid\[[^\]]+\]\s*=(?!=)|\bnoGrow\[[^\]]+\]\s*(=(?!=)|\+\+|--|\+=|-=)|\bocc\[[^\]]+\]\s*(=(?!=)|\+\+|--|\+=|-=)|\bpath(?:Plan)?\[[^\]]+\]\s*=(?!=)/, ok: (f) => inMut(f) || f === 'src/world/world.js' || f === 'src/game/nav.js', msg: 'grade de tiles alterada fora de uma op' },
  { id: 'R6', re: /Math\.random|Date\.now|performance\.now|\bgame\.player\b/, ok: (f) => !inMut(f) || f === 'src/game/mut/roll.js' || f === 'src/game/mut/own.js', msg: 'aplicador de op impuro (aleatório / relógio / jogador local) — passe o valor nos args' },
  { id: 'R7', re: /\bid\s*[:=][^,;]*Math\.random/, ok: () => false, msg: 'id aleatório (use net.newId na autoridade)' },
  { id: 'R8', re: /Math\.random/, ok: (f) => !(f.startsWith('src/world/') || f.startsWith('src/net/') || /^src\/game\/(gathering|building|mining|farming|loot|save|crafting|work|autotile|inventory|equipment|economy|game|systems)\.js$/.test(f)), msg: 'Math.random em código de estado compartilhado (use net.roll na autoridade)' },
];

const emitted = new Map(), requested = new Map(), owned = new Map();
const defs = { op: new Map(), intent: new Map(), own: new Map() };
const sources = new Map();

for (const f of files) {
  const text = readFileSync(join(ROOT, f), 'utf8').replace(/\r\n?/g, '\n');
  sources.set(f, text);
  const lines = text.split('\n');
  const state = { block: false };
  lines.forEach((line, i) => {
    const code = codeOf(line, state);
    if (!code.trim()) return;
    const okm = /\/\/\s*sync-ok:\s*(.*)$/.exec(line);
    const exempt = okm && okm[1].trim().length >= 3;
    if (okm && !exempt) report('R0', f, i + 1, 'sync-ok sem motivo');
    for (const r of RULES) {
      const m = r.re.exec(code);
      if (m && !r.ok(f, m) && !exempt) report(r.id, f, i + 1, `${r.msg}: ${line.trim().slice(0, 110)}`);
    }
    for (const m of code.matchAll(/\bnet\.emit\(\s*'([\w.]+)'/g)) emitted.set(m[1], `${f}:${i + 1}`);
    for (const m of code.matchAll(/\bnet\.request\(\s*'([\w.]+)'/g)) requested.set(m[1], `${f}:${i + 1}`);
    for (const m of code.matchAll(/\btoOwner\([^,]+,\s*'([\w.]+)'/g)) owned.set(m[1], `${f}:${i + 1}`);
    for (const m of code.matchAll(/\bdefine(Op|Intent|Own)\(\s*'([\w.]+)'/g)) {
      const kind = m[1] === 'Op' ? 'op' : m[1] === 'Intent' ? 'intent' : 'own';
      // the definition block: until the next define / end of file
      const rest = lines.slice(i, i + 80).join('\n');
      const end = rest.slice(1).search(/\ndefine(Op|Intent|Own)\(/);
      const block = end >= 0 ? rest.slice(0, end + 1) : rest;
      if (!/\bdoc\s*:/.test(block) || !/\bargs\s*:/.test(block)) report('R9', f, i + 1, `${kind} '${m[2]}' sem doc: / args:`);
      if (defs[kind].has(m[2])) report('R9', f, i + 1, `${kind} '${m[2]}' definida duas vezes`);
      defs[kind].set(m[2], `${f}:${i + 1}`);
    }
  });
  // R10 system tags
  for (const m of text.matchAll(/^export function (\w+System)\s*\(/gm)) {
    const start = m.index;
    const next = text.slice(start + 1).search(/\n(export )?(async )?function |\nexport (const|class) /);
    const body = next >= 0 ? text.slice(start, start + 1 + next) : text.slice(start);
    if (!/\bsync\s*:\s*'(host|owner|all|cosmetic)'/.test(body)) report('R10', f, text.slice(0, start).split('\n').length, `${m[1]}() não declara sync: 'host'|'owner'|'all'|'cosmetic'`);
  }
}

// R9 registry consistency
for (const [n, at] of emitted) if (!defs.op.has(n)) report('R9', at.split(':')[0], at.split(':')[1], `net.emit('${n}') sem defineOp`);
for (const [n, at] of requested) if (!defs.intent.has(n)) report('R9', at.split(':')[0], at.split(':')[1], `net.request('${n}') sem defineIntent`);
for (const [n, at] of owned) if (!defs.own.has(n)) report('R9', at.split(':')[0], at.split(':')[1], `toOwner('${n}') sem defineOwn`);
for (const [n, at] of defs.op) if (!emitted.has(n)) report('R9', at.split(':')[0], at.split(':')[1], `op '${n}' nunca emitida`);
for (const [n, at] of defs.intent) if (!requested.has(n)) report('R9', at.split(':')[0], at.split(':')[1], `intent '${n}' nunca pedida`);
for (const [n, at] of defs.own) if (!owned.has(n)) report('R9', at.split(':')[0], at.split(':')[1], `mensagem '${n}' nunca enviada`);

// R11 stamp
{
  const cur = computeIds(), st = readStamp(), sw = swVersion();
  if (!st || st.BUILD_ID !== cur.BUILD_ID || st.ART_ID !== cur.ART_ID) report('R11', 'src/version.js', 1, `desatualizado (tem ${st?.BUILD_ID}/${st?.ART_ID}, código ${cur.BUILD_ID}/${cur.ART_ID}): rode node tools/stamp.mjs`);
  if (sw !== 'wos-' + cur.BUILD_ID) report('R11', 'sw.js', 1, `VERSION ${sw} ≠ wos-${cur.BUILD_ID}: rode node tools/stamp.mjs`);
}

// R12 art contract covers the content
{
  const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
  const { CONTRACT, hasKindArt } = await imp('src/art/contract.js');
  const { SPECIES } = await imp('src/game/content/combat.js');
  const { BUILDINGS } = await imp('src/game/content/buildings.js');
  const names = new Set(CONTRACT);
  for (const sp in SPECIES) {
    if (SPECIES[sp].pawn) continue;
    for (const d of ['s', 'n', 'e']) if (!names.has(`${sp}_${d}`)) report('R12', 'src/art/contract.js', 1, `espécie '${sp}' sem '${sp}_${d}' no contrato de arte`);
  }
  for (const t in BUILDINGS) if (!hasKindArt(names, t)) report('R12', 'src/art/contract.js', 1, `construção '${t}' sem nome no contrato de arte`);
  const flora = sources.get('src/game/flora.js') || '';
  const trees = (/const TREES = \[([^\]]*)\]/.exec(flora)?.[1] || '').match(/'[^']+'/g) || [];
  const rest = (/export const FLORA_KINDS = \[\.\.\.TREES,([^\]]*)\]/.exec(flora)?.[1] || '').match(/'[^']+'/g) || [];
  for (const k of [...trees, ...rest, "'boulder'"].map((s) => s.slice(1, -1))) if (!hasKindArt(names, k)) report('R12', 'src/art/contract.js', 1, `flora '${k}' sem nome no contrato de arte`);
  const crops = sources.get('src/game/mut/crops.js') || '';
  const block = /export const CROPS = \{([\s\S]*?)\n\};/.exec(crops)?.[1] || '';
  for (const m of block.matchAll(/^\s*(\w+)\s*:/gm)) if (!names.has(`crop_${m[1]}_0`)) report('R12', 'src/art/contract.js', 1, `plantação '${m[1]}' sem 'crop_${m[1]}_0' no contrato de arte`);
}

// R13 every mut module is registered
{
  const idx = sources.get('src/game/mut/index.js') || '';
  for (const f of files) {
    if (!inMut(f) || f.endsWith('/index.js') || f.endsWith('/roll.js')) continue;
    const name = f.split('/').pop();
    if (!idx.includes(`'./${name}'`)) report('R13', 'src/game/mut/index.js', 1, `${f} não é importado (suas ops não seriam registradas)`);
  }
}

if (out.length) {
  console.log(out.join('\n'));
  console.log(`\ncheck-sync: ${out.length} violação(ões). Corrija, ou marque a linha com // sync-ok: <motivo> se for intencional.`);
  process.exit(1);
}
console.log(`check-sync: ok (${files.length} arquivos, ${defs.op.size} ops, ${defs.intent.size} intents, ${defs.own.size} mensagens de dono)`);
