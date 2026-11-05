// Calibration of the winter attacks by numbers (docs/REINOS.md §16): node tools/raid-calib.mjs [attacks] [seed]
// A sample of places shaped like a world's realm (the kinds, walls, sizes and levels of seed 4242: ~77 % villages — half
// of them with a palisade —, ~17 % castles, ~6 % cities; most of the world at level 18, the places near the start lower)
// and the three families; prints the loss rate, the hordes' share, the guards and monsters dead. The game measures the
// same on the real realm (game.raids.dbg.calibrate, scenario WA3).
import { lossRate, guardsOf, fight, planWave, furyOf, unitStats, powerVs, FAMILY_MOB } from '../src/game/raidsim.js';
import { RAID } from '../src/game/content/raids.js';

const N = +(process.argv[2] || 20000), seed = +(process.argv[3] || 4242);
let a = seed >>> 0;
const R = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const places = [];
for (let i = 0; i < 400; i++) {
  const r = R(), kind = r < 0.77 ? 'village' : r < 0.94 ? 'castle' : 'city';
  const walls = kind === 'village' ? (R() < 0.5 ? 'palisade' : null) : 'stone';
  const pop = kind === 'village' ? 38 + Math.floor(R() * 14) : kind === 'castle' ? 26 + Math.floor(R() * 10) : 190 + Math.floor(R() * 60);
  const near = R() < 0.08, glv = near ? 1 + Math.floor(R() * 6) : 18, mlv = near ? Math.min(18, 3 + Math.floor(R() * 4)) : 18;
  const fam = ['ice', 'ice', 'bone', 'sand'][Math.floor(R() * 4)];
  const s = { kind, walls, pop };
  places.push({ kind, walls, pop, fam, giantOk: true, glv, mlv, guards: guardsOf(s), dark: (2.6 + R() * 5) * 32.5 });
}
const res = lossRate(places, N, R);
console.log(`attacks ${res.n} · lost ${res.lost} (${(res.rate * 100).toFixed(2)} %) · hordes ${res.horde} (lost ${res.hordeLost}, ${(100 * res.hordeLost / Math.max(1, res.horde)).toFixed(1)} %) · normal lost ${res.lost - res.hordeLost} (${(100 * (res.lost - res.hordeLost) / Math.max(1, res.n - res.horde)).toFixed(2)} %)`);
console.log(`guards dead ${(res.guardsDead * 100).toFixed(1)} % · monsters dead ${(res.monstersDead * 100).toFixed(1)} %`);
// by kind
for (const kind of ['village', 'castle', 'city']) {
  for (const w of kind === 'village' ? ['palisade', null] : ['stone']) {
    const L = places.filter((p) => p.kind === kind && p.walls === w);
    if (!L.length) continue;
    const r = lossRate(L, Math.round(N / 4), R);
    console.log(`  ${kind}${w ? ' ' + w : ' open'}: lost ${(r.rate * 100).toFixed(2)} % (horde ${(100 * r.hordeLost / Math.max(1, r.horde)).toFixed(0)} %, normal ${(100 * (r.lost - r.hordeLost) / Math.max(1, r.n - r.horde)).toFixed(2)} %) · guards dead ${(r.guardsDead * 100).toFixed(1)} %`);
  }
}
// a few samples
const P = places.find((p) => p.kind === 'village' && p.walls && p.glv === 18);
const W = planWave(P, R, { horde: false });
console.log('village sample', JSON.stringify({ g: P.guards, wave: { n: W.n, fury: +W.fury.toFixed(2), sp: W.species } }), JSON.stringify(fight(P, W, R)));
const g = unitStats('guard', 18, { kind: 'village' }), m = unitStats('walker', 18);
console.log('guard', g.hp, g.dps.toFixed(1), g.armor, '· walker', m.hp, m.dps.toFixed(1), '· raw power ratio', (powerVs(g, m) / powerVs(m, g)).toFixed(2), '· fury', furyOf(P).toFixed(2), 'par', RAID.par, FAMILY_MOB.ice);
