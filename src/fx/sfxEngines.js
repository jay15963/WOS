// Sounds of the siege engines (game/siege.js; merged into the SFX catalogue by sfxBank.js; same format and DSP):
//   treb_release  the trebuchet lets go: the trigger's clack, the frame groaning, the counterweight thumping down
//   cat_fire      the catapult: the skein's snap, the arm slamming the padded bar
//   siege_impact  a stone landing: a deep boom, cracking stone and earth, rubble raining down
//   ram_hit       the ram's iron head on a gate: a hollow, booming knock and splintering wood
//   siege_roll    big wooden wheels creaking under the load
//   siege_winch   a winch's ratchet clicking (re-arming, the ramp going up)
//   ramp_drop     the tower's drawbridge slamming down on the wall-walk
import { burst, mode, modal, tone } from './sfxDsp.js';

const thump = (d, sr, t, f0, f1, amp, dec = 0.08) => tone(d, sr, t, dec * 1.4, f0, f1, amp, { a: 0.002, dec });
const click = (d, sr, t, r, amp = 0.5, f = 3500) => burst(d, sr, t, 0.006, { r, type: 'hp', f, a: 0.0004, amp });
const crunch = (d, sr, t, r, f, amp, dur = 0.05) => burst(d, sr, t, dur, { r, type: 'bp', f, q: 1.1, a: 0.002, amp, grain: 0.8, grainRate: 2600, grainMs: 1.6 });
// a wooden creak: a slow, rough friction tone
const creak = (d, sr, t, dur, f, r, amp = 0.3) => {
  for (let k = 0; k < Math.round(dur * 45); k++) { const u = k / (dur * 45); mode(d, sr, t + u * dur + r() * 0.004, f * (0.9 + 0.25 * Math.sin(u * 7)) + r() * 30, amp * (0.5 + 0.5 * Math.sin(Math.PI * u)), 0.012); }
};

export const ENGINE_SFX = {
  treb_release: { v: 2, sec: 1.8, sr: 22050, gain: 0.7, rev: 0.32, pj: 0.6, vj: 0.1, render(d, sr, r) {
    click(d, sr, 0, r, 0.9, 2400);
    thump(d, sr, 0.004, 140, 70, 0.5, 0.06);
    creak(d, sr, 0.03, 0.55, 340, r, 0.35);
    thump(d, sr, 0.45, 70, 32, 1, 0.3);              // (the counterweight bottoming out)
    burst(d, sr, 0.42, 0.7, { r, color: 'brown', type: 'lp', f: 600, f1: 180, shape: 'bell', amp: 0.55 });
    for (let k = 0; k < 6; k++) crunch(d, sr, 0.46 + r() * 0.3, r, 700 + r() * 800, 0.18 + r() * 0.2, 0.04);
  } },
  cat_fire: { v: 3, sec: 0.9, sr: 24000, gain: 0.7, rev: 0.22, pj: 0.8, vj: 0.12, render(d, sr, r) {
    tone(d, sr, 0, 0.25, 160 + r() * 20, 90, 0.5, { a: 0.001, dec: 0.18 }, 'triangle');
    modal(d, sr, 0.12, 120 + r() * 20, [[1, 0.9, 0.14], [2.2, 0.5, 0.09], [3.7, 0.3, 0.06]], 1.1, { r }); // (the arm on the padded bar)
    thump(d, sr, 0.12, 95, 42, 1, 0.16);
    click(d, sr, 0, r, 0.6, 2000);
    burst(d, sr, 0.02, 0.4, { r, color: 'pink', type: 'bp', f: 1100, f1: 400, q: 1.2, shape: 'bell', amp: 0.35 });
  } },
  siege_impact: { v: 3, sec: 1.8, sr: 22050, gain: 0.8, rev: 0.42, pj: 0.7, vj: 0.1, render(d, sr, r) {
    thump(d, sr, 0, 54, 24, 1.2, 0.45);
    thump(d, sr, 0.004, 110, 48, 0.6, 0.14);
    burst(d, sr, 0, 1.1, { r, color: 'brown', type: 'lp', f: 900, f1: 150, shape: 'bell', amp: 0.8 });
    click(d, sr, 0.002, r, 0.8, 2200);
    const n = 20 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) crunch(d, sr, 0.04 + 0.9 * Math.pow(r(), 1.5), r, 400 + r() * 1400, (0.15 + r() * 0.25) * (1 - (k / n) * 0.5), 0.03 + r() * 0.06); // rubble
  } },
  ram_hit: { v: 3, sec: 1.4, sr: 22050, gain: 0.85, rev: 0.4, pj: 0.7, vj: 0.1, render(d, sr, r) {
    thump(d, sr, 0, 72, 34, 1.2, 0.36);
    modal(d, sr, 0.002, 90 + r() * 20, [[1, 1, 0.3], [1.9, 0.6, 0.2], [3.1, 0.35, 0.12], [4.6, 0.2, 0.08]], 1.2, { r }); // (a hollow wooden gate)
    click(d, sr, 0, r, 0.9, 1800);
    burst(d, sr, 0, 0.5, { r, color: 'brown', type: 'lp', f: 700, f1: 200, shape: 'bell', amp: 0.6 });
    for (let k = 0; k < 10; k++) crunch(d, sr, 0.01 + r() * 0.2, r, 900 + r() * 1600, 0.2 + r() * 0.25, 0.03); // splinters
  } },
  siege_roll: { v: 3, sec: 1.4, sr: 22050, gain: 0.4, rev: 0.18, pj: 0.5, vj: 0.15, render(d, sr, r) {
    creak(d, sr, 0, 0.6, 260 + r() * 60, r, 0.4);
    creak(d, sr, 0.65, 0.5, 300 + r() * 60, r, 0.3);
    burst(d, sr, 0, 1.2, { r, color: 'brown', type: 'lp', f: 300, shape: 'bell', amp: 0.25 }); // (the rumble of the load)
  } },
  siege_winch: { v: 2, sec: 1.6, sr: 22050, gain: 0.34, rev: 0.12, pj: 0.5, vj: 0.1, render(d, sr, r) {
    for (let k = 0; k < 11; k++) { const t = 0.05 + k * 0.13 + r() * 0.02; click(d, sr, t, r, 0.6, 2600 + r() * 600); mode(d, sr, t, 1500 + r() * 300, 0.12, 0.05); }
    creak(d, sr, 0.1, 1.2, 220, r, 0.12);
  } },
  ramp_drop: { v: 2, sec: 1.3, sr: 22050, gain: 0.75, rev: 0.35, pj: 0.6, vj: 0.1, render(d, sr, r) {
    creak(d, sr, 0, 0.25, 380, r, 0.25);
    thump(d, sr, 0.26, 80, 36, 1.1, 0.3);
    modal(d, sr, 0.262, 130, [[1, 0.8, 0.2], [2.4, 0.5, 0.12], [3.8, 0.3, 0.08]], 1, { r });
    burst(d, sr, 0.26, 0.6, { r, color: 'brown', type: 'lp', f: 600, f1: 200, shape: 'bell', amp: 0.5 });
  } },
};
