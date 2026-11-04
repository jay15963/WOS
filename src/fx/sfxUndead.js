// Sounds of the night's dead of the warm lands (docs/NIGHT-DEAD.md; merged into the SFX catalogue by sfxBank.js; same
// format and DSP). Creature voices follow the `<species>_<aggro|hurt|death|idle>` names (fx/audio.js growl / hit /
// death / voice routes; SPECIES_VOX):
//   skeleton_*        rattles: dry bones knocking (aggro: a hollow wheeze through the teeth and a clatter; hurt: a
//                     crack; death: the whole skeleton clattering down; idle: a few loose clicks)
//   mummy_*           groans: a deep dry moan through the wraps (aggro: rising; hurt: a grunt and linen tearing;
//                     death: a fading moan and sand pouring out; idle: a low moan)
//   skeleton_giant_*  a cavernous howl rattling its ribs / a great bone cracking / a heap of huge bones collapsing
//   mummy_giant_*     a long, deep groan of a buried king / a heavy grunt / a moan and a sand avalanche
// Effects (fx/undeadfx.js, fx/giantfx.js): bones_fall (a skeleton falling apart at sunrise), sand_pour (a mummy
// pouring into sand), giant_step_dry (a giant's step on dry ground), giant_smash_dry (a blow on dry ground: a boom,
// rubble and dust), bone_land (a thrown giant bone landing), slab_land (a sarcophagus lid crashing down).
import { burst, mode, modal, tone, voiced, mix } from './sfxDsp.js';

const thump = (d, sr, t, f0, f1, amp, dec = 0.08) => tone(d, sr, t, dec * 1.4, f0, f1, amp, { a: 0.002, dec });
const click = (d, sr, t, r, amp = 0.5, f = 3500) => burst(d, sr, t, 0.006, { r, type: 'hp', f, a: 0.0004, amp });
const crunch = (d, sr, t, r, f, amp, dur = 0.05) => burst(d, sr, t, dur, { r, type: 'bp', f, q: 1.1, a: 0.002, amp, grain: 0.8, grainRate: 2600, grainMs: 1.6 });
// one dry bone knock: a hollow little modal ring
const knock = (d, sr, t, r, f, amp) => modal(d, sr, t, f, [[1, 0.6, 0.035], [2.7, 0.32, 0.022], [4.3, 0.16, 0.012]], amp, { r });
// n bone knocks spread over `span` seconds (denser at the start)
function rattle(d, sr, r, t0, span, n, f0, f1, amp) {
  for (let k = 0; k < n; k++) { const t = t0 + Math.pow(r(), 1.25) * span; knock(d, sr, t, r, f0 + r() * (f1 - f0), amp * (0.45 + r() * 0.55) * (1 - (t - t0) / (span * 1.6))); }
}
// a voiced moan into its own buffer, mixed in
function moan(d, sr, r, t0, dur, f, env, o) { const n = Math.ceil(dur * sr), tmp = new Float32Array(n); voiced(tmp, sr, 0, dur, f, env, { r, ...o }); mix(d, tmp, Math.floor(t0 * sr), o.amp ?? 0.9); }
// sand: a hiss of grains (band noise with grain), louder in the middle
const sand = (d, sr, r, t0, dur, amp, f = 3200) => burst(d, sr, t0, dur, { r, color: 'pink', type: 'bp', f, q: 0.6, shape: 'bell', pow: 1.2, amp, grain: 0.75, grainRate: 2400, grainMs: 1.2 });

const V = (sec, gain, fn, o = {}) => ({ v: 3, sec, sr: 24000, gain, rev: 0.22, pj: 1.2, vj: 0.15, ...o, render: fn });
const FM = [[420, 3, 1], [900, 4, 0.5], [2300, 5, 0.15]]; // a dry, hollow throat

export const UNDEAD_SFX = {
  // ---------- skeletons ----------
  skeleton_aggro: V(0.8, 0.42, (d, sr, r) => {
    moan(d, sr, r, 0, 0.5, (u) => 210 - 60 * u + 12 * Math.sin(u * 50), (u) => Math.sin(Math.PI * u), { formants: [[1500, 4, 1], [3200, 5, 0.5]], tilt: 0.4, noise: 0.85, rough: 0.5, amp: 0.55 });
    rattle(d, sr, r, 0.05, 0.6, 14, 900, 2200, 0.7);
  }),
  skeleton_hurt: V(0.4, 0.42, (d, sr, r) => { click(d, sr, 0, r, 0.9, 2600); knock(d, sr, 0.001, r, 700 + r() * 400, 1); rattle(d, sr, r, 0.03, 0.25, 5, 1200, 2600, 0.5); }),
  skeleton_death: V(1.2, 0.5, (d, sr, r) => { rattle(d, sr, r, 0, 0.9, 26, 600, 2400, 0.85); thump(d, sr, 0.12, 140, 70, 0.4, 0.06); thump(d, sr, 0.42, 120, 60, 0.3, 0.05); }, { v: 3 }),
  skeleton_idle: V(0.5, 0.22, (d, sr, r) => rattle(d, sr, r, 0, 0.35, 5 + Math.floor(r() * 4), 1100, 2600, 0.6), { v: 4, pj: 1.6 }),
  // ---------- mummies ----------
  mummy_aggro: V(1.3, 0.45, (d, sr, r) => {
    moan(d, sr, r, 0, 1.15, (u) => 78 + 26 * Math.sin(Math.PI * Math.min(1, u * 1.3)) + 4 * Math.sin(u * 37), (u) => Math.pow(Math.sin(Math.PI * u), 0.8), { formants: FM, tilt: 0.95, noise: 0.45, rough: 0.6, am: 0.25, amRate: 9, amp: 0.95 });
  }),
  mummy_hurt: V(0.5, 0.4, (d, sr, r) => {
    moan(d, sr, r, 0, 0.32, (u) => 96 - 22 * u, (u) => Math.min(1, u * 8) * Math.pow(1 - u, 0.7), { formants: FM, tilt: 0.9, noise: 0.4, rough: 0.55, amp: 0.85 });
    burst(d, sr, 0.02, 0.18, { r, type: 'bp', f: 2600, q: 0.8, a: 0.004, amp: 0.35, grain: 0.85, grainRate: 1400, grainMs: 1.4 }); // linen tearing
  }),
  mummy_death: V(1.8, 0.48, (d, sr, r) => {
    moan(d, sr, r, 0, 1.2, (u) => 88 * Math.pow(0.55, u), (u) => Math.min(1, u * 6) * Math.pow(1 - u, 0.6), { formants: FM, tilt: 0.95, noise: 0.5, rough: 0.6, amp: 0.85 });
    sand(d, sr, r, 0.35, 1.3, 0.55);
  }, { v: 2 }),
  mummy_idle: V(1.6, 0.26, (d, sr, r) => moan(d, sr, r, 0, 1.4, (u) => 70 + 10 * Math.sin(Math.PI * u), (u) => Math.sin(Math.PI * u), { formants: FM, tilt: 1, noise: 0.35, rough: 0.45, am: 0.3, amRate: 6, amp: 0.8 }), { rev: 0.35 }),
  // ---------- the giants ----------
  skeleton_giant_aggro: V(1.5, 0.55, (d, sr, r) => {
    moan(d, sr, r, 0, 1.25, (u) => 58 + 22 * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 10 * u, (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.7), { formants: [[300, 2.5, 1], [700, 3.5, 0.6], [1900, 5, 0.25]], tilt: 0.85, noise: 0.7, rough: 0.7, amp: 0.9 });
    rattle(d, sr, r, 0.1, 1.1, 22, 400, 1300, 0.55);
  }, { v: 2, rev: 0.4 }),
  skeleton_giant_hurt: V(0.6, 0.48, (d, sr, r) => { thump(d, sr, 0, 120, 60, 0.7, 0.1); click(d, sr, 0.002, r, 0.9, 1800); knock(d, sr, 0.003, r, 320 + r() * 120, 1); rattle(d, sr, r, 0.05, 0.4, 8, 500, 1200, 0.45); }),
  skeleton_giant_death: V(2.2, 0.6, (d, sr, r) => {
    moan(d, sr, r, 0, 1.0, (u) => 62 * Math.pow(0.6, u), (u) => Math.min(1, u * 6) * Math.pow(1 - u, 0.6), { formants: [[300, 2.5, 1], [700, 3.5, 0.6]], tilt: 0.9, noise: 0.6, rough: 0.7, amp: 0.7 });
    for (let k = 0; k < 6; k++) thump(d, sr, 0.5 + k * 0.17 + r() * 0.06, 90 + r() * 30, 40, 0.6, 0.12);
    rattle(d, sr, r, 0.45, 1.5, 34, 350, 1500, 0.7);
  }, { v: 2, rev: 0.45 }),
  mummy_giant_aggro: V(1.7, 0.55, (d, sr, r) => {
    moan(d, sr, r, 0, 1.5, (u) => 52 + 18 * Math.sin(Math.PI * Math.min(1, u * 1.2)) + 3 * Math.sin(u * 31), (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.7), { formants: [[340, 2.5, 1], [760, 3.5, 0.55], [2000, 5, 0.2]], tilt: 0.95, noise: 0.5, rough: 0.7, am: 0.3, amRate: 7, amp: 0.95 });
    burst(d, sr, 0, 1.4, { r, color: 'brown', type: 'lp', f: 260, shape: 'bell', amp: 0.3 });
  }, { v: 2, rev: 0.45 }),
  mummy_giant_hurt: V(0.7, 0.48, (d, sr, r) => moan(d, sr, r, 0, 0.55, (u) => 66 - 16 * u, (u) => Math.min(1, u * 8) * Math.pow(1 - u, 0.8), { formants: [[360, 3, 1], [800, 4, 0.5]], tilt: 0.9, noise: 0.35, rough: 0.7, amp: 0.9 })),
  mummy_giant_death: V(2.4, 0.6, (d, sr, r) => {
    moan(d, sr, r, 0, 1.5, (u) => 64 * Math.pow(0.5, u), (u) => Math.min(1, u * 5) * Math.pow(1 - u, 0.55), { formants: [[340, 2.5, 1], [760, 3.5, 0.5]], tilt: 0.95, noise: 0.5, rough: 0.7, amp: 0.85 });
    sand(d, sr, r, 0.5, 1.8, 0.8, 2400); burst(d, sr, 0.5, 1.6, { r, color: 'brown', type: 'lp', f: 400, shape: 'bell', amp: 0.4 });
  }, { v: 2, rev: 0.45 }),
  // ---------- effects ----------
  bones_fall: V(1.1, 0.45, (d, sr, r) => { rattle(d, sr, r, 0, 0.8, 22, 700, 2600, 0.8); thump(d, sr, 0.15, 160, 80, 0.3, 0.05); }, { v: 4, rev: 0.18 }),
  sand_pour: V(1.6, 0.4, (d, sr, r) => { sand(d, sr, r, 0, 1.5, 0.9); burst(d, sr, 0.05, 1.2, { r, color: 'brown', type: 'lp', f: 500, shape: 'bell', amp: 0.25 }); }, { v: 3, rev: 0.2 }),
  giant_step_dry: { v: 4, sec: 0.45, sr: 22050, gain: 0.5, rev: 0.16, pj: 1, vj: 0.15, render(d, sr, r) {
    thump(d, sr, 0, 60 + r() * 10, 30, 1, 0.18);
    burst(d, sr, 0.005, 0.15, { r, color: 'brown', type: 'lp', f: 500, f1: 180, a: 0.003, amp: 0.6 });
    burst(d, sr, 0.01, 0.12, { r, type: 'bp', f: 2600 + r() * 600, q: 0.7, a: 0.004, amp: 0.3, grain: 0.7, grainRate: 2200 }); // dry earth, sand
  } },
  giant_smash_dry: { v: 3, sec: 1.6, sr: 22050, gain: 0.75, rev: 0.4, pj: 0.8, vj: 0.1, render(d, sr, r) {
    thump(d, sr, 0, 56, 26, 1.1, 0.42); thump(d, sr, 0.004, 115, 55, 0.6, 0.12);
    burst(d, sr, 0, 0.9, { r, color: 'brown', type: 'lp', f: 650, f1: 150, shape: 'bell', amp: 0.75 });
    click(d, sr, 0.002, r, 0.7, 2000);
    for (let k = 0; k < 14; k++) crunch(d, sr, 0.05 + 0.8 * Math.pow(r(), 1.5), r, 600 + r() * 1400, 0.18 + r() * 0.25, 0.04 + r() * 0.05); // rubble raining
    sand(d, sr, r, 0.05, 1.2, 0.35, 2800);
  } },
  bone_land: { v: 3, sec: 1.0, sr: 22050, gain: 0.6, rev: 0.3, pj: 1, vj: 0.12, render(d, sr, r) { thump(d, sr, 0, 95, 42, 0.9, 0.18); knock(d, sr, 0.002, r, 380 + r() * 120, 1); rattle(d, sr, r, 0.04, 0.5, 8, 500, 1400, 0.45); burst(d, sr, 0.02, 0.4, { r, color: 'pink', type: 'lp', f: 900, amp: 0.25 }); } },
  slab_land: { v: 3, sec: 1.2, sr: 22050, gain: 0.65, rev: 0.32, pj: 0.9, vj: 0.12, render(d, sr, r) {
    thump(d, sr, 0, 80, 36, 1, 0.24); click(d, sr, 0, r, 0.9, 2400);
    modal(d, sr, 0.002, 260 + r() * 80, [[1, 0.6, 0.06], [2.4, 0.4, 0.04], [3.9, 0.25, 0.03]], 0.9, { r });
    for (let k = 0; k < 12; k++) crunch(d, sr, 0.03 + 0.6 * Math.pow(r(), 1.6), r, 900 + r() * 1800, 0.2 + r() * 0.25, 0.03 + r() * 0.04);
    sand(d, sr, r, 0.04, 0.8, 0.3, 2600);
  } },
};
// (a giant's roar at the start of its smash: its aggro voice — fx/giantfx.js plays it by the telegraph kind)
UNDEAD_SFX.skeleton_giant_roar = UNDEAD_SFX.skeleton_giant_aggro;
UNDEAD_SFX.mummy_giant_roar = UNDEAD_SFX.mummy_giant_aggro;
