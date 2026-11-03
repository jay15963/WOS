// Sounds of the ice giants and the ballista (merged into the SFX catalogue by sfxBank.js; same format and DSP).
//   giant_step   a heavy footfall: a low thud, the ground's crunch of snow
//   giant_roar   a deep, rough bellow (it starts its smash)
//   giant_smash  the club hitting the ground: a deep boom, cracking ice, debris raining down
//   ice_rock_land  a boulder of ice landing and bursting
//   ballista_fire  the release: the string's twang, the arms slamming the frame, the bolt hissing away
//   ballista_hit   a heavy bolt biting into wood / flesh / ice: a hard thunk
//   ballista_crank  reloading: the windlass ratchet clicking
import { burst, mode, modal, tone, voiced, mix } from './sfxDsp.js';

const thump = (d, sr, t, f0, f1, amp, dec = 0.08) => tone(d, sr, t, dec * 1.4, f0, f1, amp, { a: 0.002, dec });
const click = (d, sr, t, r, amp = 0.5, f = 3500) => burst(d, sr, t, 0.006, { r, type: 'hp', f, a: 0.0004, amp });
const crunch = (d, sr, t, r, f, amp, dur = 0.05) => burst(d, sr, t, dur, { r, type: 'bp', f, q: 1.1, a: 0.002, amp, grain: 0.8, grainRate: 2600, grainMs: 1.6 });

export const SIEGE_SFX = {
  // (about two a second while one walks: short, little reverb, so the steps stay apart)
  giant_step: { v: 4, sec: 0.45, sr: 22050, gain: 0.5, rev: 0.16, pj: 1, vj: 0.15, render(d, sr, r) {
    thump(d, sr, 0, 62 + r() * 10, 30, 1, 0.18);
    burst(d, sr, 0.005, 0.15, { r, color: 'brown', type: 'lp', f: 500, f1: 180, a: 0.003, amp: 0.6 });
    crunch(d, sr, 0.01, r, 1400 + r() * 500, 0.35, 0.09); // packed snow
  } },
  // (it starts every smash wind-up, ~1.2 s: done before the blow lands)
  giant_roar: { v: 2, sec: 1.25, sr: 22050, gain: 0.5, rev: 0.35, pj: 1.2, vj: 0.12, render(d, sr, r) {
    const n = Math.ceil(1.1 * sr), tmp = new Float32Array(n);
    voiced(tmp, sr, 0, 1.1, (u) => 62 + 26 * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 14 * u + 3 * Math.sin(u * 40), (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.7),
      { formants: [[380 + r() * 60, 3, 1], [820 + r() * 120, 4, 0.55], [2200, 5, 0.18]], tilt: 0.9, noise: 0.35, rough: 0.75, am: 0.35, amRate: 22, r });
    mix(d, tmp, 0, 0.9);
    burst(d, sr, 0, 1.0, { r, color: 'brown', type: 'lp', f: 300, shape: 'bell', amp: 0.3 });
  } },
  giant_smash: { v: 3, sec: 1.6, sr: 22050, gain: 0.75, rev: 0.4, pj: 0.8, vj: 0.1, render(d, sr, r) {
    thump(d, sr, 0, 58, 26, 1.1, 0.42);
    thump(d, sr, 0.004, 120, 55, 0.6, 0.12);
    burst(d, sr, 0, 0.9, { r, color: 'brown', type: 'lp', f: 700, f1: 160, shape: 'bell', amp: 0.75 });
    click(d, sr, 0.002, r, 0.8, 2600);
    burst(d, sr, 0.004, 0.06, { r, type: 'bp', f: 2400, q: 0.8, amp: 0.6 }); // ice cracking
    const n = 22 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) mode(d, sr, 0.05 + 0.8 * Math.pow(r(), 1.6), 2200 + r() * 4800, (0.06 + r() * 0.16) * (1 - (k / n) * 0.6), 0.03 + r() * 0.07); // shards raining
    for (let k = 0; k < 10; k++) crunch(d, sr, 0.08 + r() * 0.7, r, 500 + r() * 1100, 0.2 + r() * 0.25, 0.04 + r() * 0.05);
  } },
  ice_rock_land: { v: 3, sec: 1.0, sr: 22050, gain: 0.6, rev: 0.32, pj: 1, vj: 0.12, render(d, sr, r) {
    thump(d, sr, 0, 90, 40, 0.9, 0.2);
    click(d, sr, 0, r, 0.9, 3000);
    burst(d, sr, 0, 0.07, { r, type: 'bp', f: 2600, q: 0.8, a: 0.0005, amp: 0.8 });
    const n = 18 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) mode(d, sr, 0.02 + 0.55 * Math.pow(r(), 1.8), 2400 + r() * 5000, (0.08 + r() * 0.2) * (1 - (k / n) * 0.6), 0.03 + r() * 0.07);
    burst(d, sr, 0.02, 0.5, { r, color: 'pink', type: 'bp', f: 1600, q: 0.6, a: 0.05, amp: 0.25, grain: 0.5, grainRate: 1600 });
  } },
  ballista_fire: { v: 3, sec: 1.0, sr: 24000, gain: 0.7, rev: 0.25, pj: 0.8, vj: 0.1, render(d, sr, r) {
    // the string: a low snapping twang, the arms slamming the frame, the bolt tearing the air
    tone(d, sr, 0, 0.35, 120 + r() * 15, 70, 0.7, { a: 0.001, dec: 0.25 }, 'triangle');
    modal(d, sr, 0.004, 150 + r() * 25, [[1, 0.8, 0.14], [2.3, 0.5, 0.09], [3.9, 0.3, 0.06]], 1.1, { r });
    thump(d, sr, 0.006, 85, 40, 0.9, 0.16);
    click(d, sr, 0, r, 0.7, 2200);
    burst(d, sr, 0.03, 0.55, { r, color: 'pink', type: 'bp', f: 1400, f1: 500, q: 1.4, shape: 'bell', pow: 1.6, amp: 0.45 });
  } },
  ballista_hit: { v: 4, sec: 0.6, sr: 24000, gain: 0.7, rev: 0.22, pj: 1, vj: 0.12, render(d, sr, r) {
    thump(d, sr, 0, 110 + r() * 20, 45, 1, 0.14);
    modal(d, sr, 0.001, 210 + r() * 50, [[1, 0.8, 0.1], [2.45, 0.5, 0.07], [4.1, 0.3, 0.04]], 0.9, { r });
    burst(d, sr, 0, 0.06, { r, type: 'bp', f: 1700, q: 1.1, a: 0.0005, amp: 0.7 });
    for (let k = 0; k < 6; k++) crunch(d, sr, 0.01 + r() * 0.12, r, 1200 + r() * 1500, 0.2 + r() * 0.2, 0.025);
  } },
  giant_hurt: { v: 3, sec: 0.6, sr: 22050, gain: 0.45, rev: 0.3, pj: 1.2, vj: 0.15, render(d, sr, r) {
    const n = Math.ceil(0.5 * sr), tmp = new Float32Array(n);
    voiced(tmp, sr, 0, 0.5, (u) => 70 - u * 20, (u) => Math.min(1, u * 8) * Math.pow(1 - u, 0.8), { formants: [[420, 3, 1], [900, 4, 0.5]], tilt: 0.9, noise: 0.3, rough: 0.7, r });
    mix(d, tmp, 0, 0.9);
  } },
  giant_death: { v: 2, sec: 1.8, sr: 22050, gain: 0.5, rev: 0.45, pj: 1, vj: 0.1, render(d, sr, r) {
    const n = Math.ceil(1.4 * sr), tmp = new Float32Array(n);
    voiced(tmp, sr, 0, 1.4, (u) => 75 * Math.pow(0.55, u), (u) => Math.min(1, u * 6) * Math.pow(1 - u, 0.6), { formants: [[360, 3, 1], [760, 4, 0.5]], tilt: 0.9, noise: 0.4, rough: 0.8, r });
    mix(d, tmp, 0, 0.9);
    burst(d, sr, 0.8, 0.9, { r, color: 'brown', type: 'lp', f: 500, shape: 'bell', amp: 0.4 });
  } },
  ballista_crank: { v: 2, sec: 1.4, sr: 22050, gain: 0.32, rev: 0.12, pj: 0.6, vj: 0.1, render(d, sr, r) {
    for (let k = 0; k < 9; k++) { const t = 0.05 + k * 0.13 + r() * 0.02; click(d, sr, t, r, 0.6, 2800 + r() * 600); mode(d, sr, t, 1800 + r() * 300, 0.12, 0.04); }
    tone(d, sr, 0, 1.2, 230, 260, 0.08, { a: 0.1, dec: 1 }, 'sawtooth');
  } },
};
SIEGE_SFX.giant_aggro = SIEGE_SFX.giant_roar; // (the creature voice: aggro)
