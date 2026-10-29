// SFX catalogue: every sound is synthesised offline (sfxDsp.js) into a few variants, lazily on first use
// (or prewarmed in idle time), and cached as AudioBuffers. A play picks a variant (never the same twice in a
// row) and jitters pitch / level, so repeated actions never sound mechanical.
//
// def: { v: variants, sec, sr?, gain, bus: 'sfx'|'ui'|'amb', rev (reverb send), pj (pitch jitter, semitones),
//        vj (level jitter 0..1), gap (min s between two plays, non-spatial), render(d, sr, r, k) }

import { buf, mulberry, hashStr, burst, mode, modal, tone, voiced, ks, biquad, normalize, fadeIO, trim, dcBlock, mix, toBuffer, adEnv } from './sfxDsp.js';

const SR = 32000;

// ---------- shared building blocks ----------
const thump = (d, sr, t, f0, f1, amp, dec = 0.08) => tone(d, sr, t, dec * 1.4, f0, f1, amp, { a: 0.002, dec });
const click = (d, sr, t, r, amp = 0.5, f = 3500) => burst(d, sr, t, 0.006, { r, type: 'hp', f, a: 0.0004, amp });
const wood = (d, sr, t, f0, amp, r, len = 1) => modal(d, sr, t, f0, [[1, 0.8, 0.09 * len], [2.3, 0.5, 0.065 * len], [3.9, 0.32, 0.045 * len], [5.6, 0.16, 0.03 * len]], amp, { r });
const metal = (d, sr, t, f0, amp, r, len = 1) => modal(d, sr, t, f0, [[1, 0.6, 0.35 * len], [2.76, 0.42, 0.22 * len], [5.4, 0.28, 0.12 * len], [8.93, 0.16, 0.07 * len]], amp, { r, spread: 0.01 });
const crunch = (d, sr, t, r, f, amp, dur = 0.05) => burst(d, sr, t, dur, { r, type: 'bp', f, q: 1.1, a: 0.002, amp, grain: 0.8, grainRate: 2600, grainMs: 1.6 });
const bellTone = (d, sr, t, f, amp, dec = 1) => {
  tone(d, sr, t, dec * 1.1, f, f, amp, { a: 0.003, dec });
  tone(d, sr, t, dec * 0.6, f * 2.01, f * 2.01, amp * 0.22, { a: 0.002, dec: dec * 0.5 });
  tone(d, sr, t, dec * 0.35, f * 3.02, f * 3.02, amp * 0.08, { a: 0.002, dec: dec * 0.3 });
};
const creak = (d, sr, t, dur, f0, f1, amp, r) => {
  const n = Math.ceil(dur * sr), tmp = new Float32Array(n);
  voiced(tmp, sr, 0, dur, (u) => f0 * Math.pow(f1 / f0, u) * (1 + 0.04 * Math.sin(u * 40 + r() * 6)), (u) => Math.pow(Math.sin(Math.PI * u), 0.6),
    { formants: [[900 + r() * 300, 3, 1], [2200 + r() * 500, 4, 0.6]], tilt: 0.5, harm: 18, noise: 0.15, rough: 0.35, r });
  mix(d, tmp, Math.floor(t * sr), amp);
};
const rustle = (d, sr, t, dur, r, amp, f = 3200) => burst(d, sr, t, dur, { r, color: 'pink', type: 'bp', f, q: 0.7, a: dur * 0.25, amp, grain: 0.7, grainRate: 1300 });
const bubble = (d, sr, t, r, amp) => { const f = 500 + r() * 700; tone(d, sr, t, 0.035, f, f * (2 + r()), amp, { a: 0.002, dec: 0.03 }); };

// footstep helper: heel + toe
const steps = (fn) => ({ v: 6, sec: 0.26, gain: 0.3, rev: 0.04, pj: 1.3, vj: 0.2, render: fn });

export const SFX = {
  // ---------- footsteps (surface-aware 'step' picks one) ----------
  step_grass: steps((d, sr, r) => {
    thump(d, sr, 0.004, 95 + r() * 25, 50, 0.3, 0.05);
    burst(d, sr, 0, 0.1, { r, color: 'pink', type: 'bp', f: 1700 + r() * 1300, q: 0.7, a: 0.006, amp: 0.8, grain: 0.6, grainRate: 900 });
    burst(d, sr, 0.045 + r() * 0.03, 0.08, { r, color: 'pink', type: 'bp', f: 2600 + r() * 1500, q: 0.9, a: 0.004, amp: 0.45, grain: 0.7, grainRate: 1100 });
    burst(d, sr, 0.002, 0.05, { r, type: 'hp', f: 5200, amp: 0.1, grain: 0.9, grainRate: 1500 });
  }),
  step_dirt: steps((d, sr, r) => {
    thump(d, sr, 0.003, 85 + r() * 20, 45, 0.45, 0.06);
    burst(d, sr, 0, 0.08, { r, color: 'pink', type: 'lp', f: 750 + r() * 300, a: 0.004, amp: 0.7 });
    burst(d, sr, 0.004, 0.07, { r, type: 'hp', f: 3200, amp: 0.18, grain: 0.85, grainRate: 900 });
    burst(d, sr, 0.05 + r() * 0.025, 0.06, { r, color: 'pink', type: 'lp', f: 1000, amp: 0.35 });
  }),
  step_sand: steps((d, sr, r) => {
    thump(d, sr, 0.004, 70 + r() * 15, 45, 0.2, 0.05);
    burst(d, sr, 0, 0.14, { r, type: 'bp', f: 2800 + r() * 900, q: 0.6, a: 0.014, amp: 0.75, grain: 0.5, grainRate: 2200, grainMs: 1.4 });
    burst(d, sr, 0.06 + r() * 0.03, 0.09, { r, type: 'bp', f: 3600, q: 0.6, a: 0.01, amp: 0.4, grain: 0.5, grainRate: 2200 });
  }),
  step_gravel: steps((d, sr, r) => {
    thump(d, sr, 0.003, 85, 50, 0.3, 0.05);
    burst(d, sr, 0, 0.1, { r, type: 'bp', f: 2600, q: 0.8, amp: 0.3, grain: 0.7, grainRate: 1200 });
    const n = 14 + Math.floor(r() * 14);
    for (let k = 0; k < n; k++) mode(d, sr, 0.13 * Math.pow(r(), 1.6), 1900 + r() * 4200, (0.12 + r() * 0.3) * (1 - k / n * 0.5), 0.008 + r() * 0.014);
  }),
  step_stone: steps((d, sr, r) => {
    click(d, sr, 0, r, 0.6, 2800);
    modal(d, sr, 0.001, 300 + r() * 150, [[1, 0.5, 0.05], [2.3, 0.3, 0.032], [3.9, 0.2, 0.02]], 0.7, { r });
    burst(d, sr, 0.004, 0.05, { r, type: 'bp', f: 3000, q: 1.2, amp: 0.22 });
    click(d, sr, 0.05 + r() * 0.025, r, 0.32, 3000);
    modal(d, sr, 0.051, 380 + r() * 120, [[1, 0.3, 0.03], [2.4, 0.2, 0.02]], 0.4, { r });
  }),
  step_wood: steps((d, sr, r, k) => {
    const f0 = 150 + r() * 45;
    click(d, sr, 0, r, 0.35, 2400);
    wood(d, sr, 0.001, f0, 0.85, r, 0.9);
    wood(d, sr, 0.05 + r() * 0.022, f0 * (1.1 + r() * 0.12), 0.45, r, 0.6);
    if (k === 3) creak(d, sr, 0.03, 0.12, 430, 380, 0.12, r);
  }),
  step_water: steps((d, sr, r) => {
    burst(d, sr, 0, 0.17, { r, color: 'pink', type: 'bp', f: 1000 + r() * 400, f1: 480, q: 0.8, a: 0.01, amp: 0.8 });
    burst(d, sr, 0.01, 0.18, { r, color: 'brown', type: 'lp', f: 320, amp: 0.4 });
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) bubble(d, sr, 0.02 + r() * 0.15, r, 0.22);
    burst(d, sr, 0.03, 0.08, { r, type: 'hp', f: 4000, amp: 0.12, grain: 0.9, grainRate: 600 });
  }),
  step_snow: steps((d, sr, r) => {
    thump(d, sr, 0.004, 75, 50, 0.2, 0.05);
    burst(d, sr, 0, 0.15, { r, type: 'bp', f: 1300 + r() * 500, q: 0.6, a: 0.02, amp: 0.7, grain: 0.85, grainRate: 1800, grainMs: 1.2 });
    burst(d, sr, 0.065, 0.08, { r, type: 'bp', f: 1800, q: 0.7, a: 0.01, amp: 0.4, grain: 0.85, grainRate: 1800, grainMs: 1.2 });
  }),
  step_mud: steps((d, sr, r) => {
    burst(d, sr, 0, 0.12, { r, color: 'brown', type: 'lp', f: 520, a: 0.006, amp: 0.6 });
    burst(d, sr, 0.03, 0.12, { r, color: 'pink', type: 'bp', f: 380, f1: 1000, q: 3, a: 0.02, amp: 0.45 });
    tone(d, sr, 0.1 + r() * 0.04, 0.03, 300, 700, 0.18, { a: 0.002, dec: 0.025 });
  }),
  step_soft: steps((d, sr, r) => {
    thump(d, sr, 0.004, 80, 50, 0.3, 0.05);
    burst(d, sr, 0, 0.1, { r, color: 'pink', type: 'lp', f: 600, a: 0.008, amp: 0.6 });
    burst(d, sr, 0.05, 0.06, { r, color: 'pink', type: 'lp', f: 700, amp: 0.3 });
  }),

  // ---------- impacts ----------
  hit: { v: 5, sec: 0.26, gain: 0.55, rev: 0.12, pj: 1.5, vj: 0.15, render(d, sr, r) {
    tone(d, sr, 0, 0.15, 130 + r() * 30, 52, 0.9, { a: 0.002, dec: 0.12 });
    burst(d, sr, 0, 0.08, { r, type: 'lp', f: 1600, f1: 500, a: 0.001, amp: 0.7 });
    burst(d, sr, 0.001, 0.02, { r, type: 'bp', f: 3000, q: 1, amp: 0.3 });
  } },
  crit: { v: 3, sec: 0.5, gain: 0.7, rev: 0.25, pj: 1, vj: 0.1, render(d, sr, r) {
    tone(d, sr, 0, 0.2, 150 + r() * 25, 45, 1, { a: 0.002, dec: 0.17 });
    burst(d, sr, 0, 0.1, { r, type: 'lp', f: 2200, f1: 500, a: 0.001, amp: 0.8 });
    burst(d, sr, 0, 0.13, { r, type: 'hp', f: 2500, f1: 6500, shape: 'bell', amp: 0.35 });
    modal(d, sr, 0.005, 1150 + r() * 80, [[1, 0.22, 0.32], [1.5, 0.13, 0.24], [2.02, 0.07, 0.15]], 1, { r });
  } },
  hit_metal: { v: 4, sec: 0.5, gain: 0.32, rev: 0.2, pj: 1, vj: 0.15, render(d, sr, r) {
    click(d, sr, 0, r, 0.6, 4500);
    metal(d, sr, 0.001, 900 + r() * 600, 0.8, r);
    thump(d, sr, 0, 140, 70, 0.35, 0.08);
  } },
  block: { v: 4, sec: 0.36, gain: 0.55, rev: 0.15, pj: 1, vj: 0.15, render(d, sr, r) {
    modal(d, sr, 0.001, 180 + r() * 40, [[1, 0.8, 0.12], [2.45, 0.5, 0.08], [4.1, 0.3, 0.05]], 0.9, { r });
    thump(d, sr, 0, 110, 60, 0.6, 0.1);
    burst(d, sr, 0, 0.05, { r, type: 'lp', f: 1200, amp: 0.5 });
    mode(d, sr, 0.002, 1800 + r() * 300, 0.08, 0.16);
  } },
  shield_up: { v: 3, sec: 0.25, gain: 0.32, rev: 0.08, pj: 1, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.12, { r, color: 'pink', type: 'bp', f: 700, q: 0.9, shape: 'bell', amp: 0.5 });
    wood(d, sr, 0.08, 210 + r() * 30, 0.45, r, 0.7);
  } },
  chop: { v: 5, sec: 0.32, gain: 0.55, rev: 0.25, pj: 1.4, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.03, { r, type: 'bp', f: 1400, q: 1.2, a: 0.0005, amp: 0.8 });
    wood(d, sr, 0.001, 170 + r() * 60, 0.9, r, 1.3);
    burst(d, sr, 0.008, 0.05, { r, type: 'hp', f: 3500, amp: 0.25, grain: 0.8, grainRate: 1200 });
    thump(d, sr, 0, 120, 70, 0.4, 0.07);
  } },
  mine: { v: 5, sec: 0.42, sr: 24000, gain: 0.5, rev: 0.3, pj: 1.4, vj: 0.15, render(d, sr, r) {
    modal(d, sr, 0, 1500 + r() * 500, [[1, 0.5, 0.12], [1.52, 0.3, 0.09], [2.4, 0.2, 0.06]], 0.8, { r });
    burst(d, sr, 0, 0.04, { r, type: 'hp', f: 2200, a: 0.0005, amp: 0.8 });
    burst(d, sr, 0.003, 0.07, { r, color: 'pink', type: 'lp', f: 600, amp: 0.5 });
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) mode(d, sr, 0.05 + r() * 0.25, 2500 + r() * 2500, 0.1 + r() * 0.15, 0.015);
  } },
  arrow_wood: { v: 4, sec: 0.34, gain: 0.4, rev: 0.15, pj: 1, vj: 0.15, render(d, sr, r) {
    click(d, sr, 0, r, 0.5, 2500);
    modal(d, sr, 0.001, 220 + r() * 50, [[1, 0.7, 0.06], [2.7, 0.4, 0.04]], 0.8, { r });
    tone(d, sr, 0.01, 0.28, 95 + r() * 10, 85, 0.3, (u, t) => adEnv(t, 0.003, 0.25) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 28 * t)));
  } },
  arrow_ground: { v: 4, sec: 0.16, gain: 0.32, rev: 0.06, pj: 1, vj: 0.15, render(d, sr, r) {
    thump(d, sr, 0, 100, 50, 0.5, 0.06);
    burst(d, sr, 0, 0.08, { r, color: 'pink', type: 'lp', f: 900, amp: 0.6 });
    burst(d, sr, 0.003, 0.05, { r, type: 'hp', f: 3000, amp: 0.2, grain: 0.8 });
  } },
  swing_blade: { v: 5, sec: 0.24, gain: 0.38, rev: 0.06, pj: 1.5, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.2, { r, color: 'pink', type: 'bp', f: 600 + r() * 200, f1: 2600 + r() * 800, q: 1.6, shape: 'bell', pow: 1.6, amp: 0.85 });
    burst(d, sr, 0.04, 0.14, { r, type: 'hp', f: 4200, shape: 'bell', amp: 0.18 });
    mode(d, sr, 0.06, 3300 + r() * 500, 0.025, 0.2);
  } },
  swing_heavy: { v: 4, sec: 0.32, gain: 0.42, rev: 0.06, pj: 1.2, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.28, { r, color: 'pink', type: 'bp', f: 250 + r() * 80, f1: 1000 + r() * 200, q: 1.2, shape: 'bell', pow: 1.4, amp: 0.9 });
    burst(d, sr, 0.03, 0.22, { r, color: 'brown', type: 'lp', f: 500, shape: 'bell', amp: 0.35 });
  } },
  swing_light: { v: 4, sec: 0.16, gain: 0.3, rev: 0.04, pj: 1.6, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.13, { r, color: 'pink', type: 'bp', f: 700, f1: 1800, q: 1.4, shape: 'bell', amp: 0.8 });
  } },
  swing_spear: { v: 4, sec: 0.18, gain: 0.36, rev: 0.05, pj: 1.4, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.14, { r, color: 'pink', type: 'bp', f: 1100, f1: 3600, q: 2.2, shape: 'bell', pow: 2.5, amp: 0.85 });
  } },
  bow: { v: 4, sec: 0.46, gain: 0.5, rev: 0.12, pj: 1, vj: 0.12, render(d, sr, r) {
    ks(d, sr, 0, 0.4, 105 + r() * 20, { t60: 0.35, bright: 0.3, pos: 0.45, amp: 0.8, r });
    thump(d, sr, 0, 70, 45, 0.5, 0.07);
    burst(d, sr, 0.01, 0.22, { r, color: 'pink', type: 'bp', f: 2500, f1: 1200, q: 1.5, shape: 'bell', amp: 0.4 });
  } },
  death: { v: 3, sec: 0.65, gain: 0.5, rev: 0.25, pj: 1, vj: 0.1, render(d, sr, r) {
    tone(d, sr, 0, 0.5, 95, 38, 0.8, { a: 0.003, dec: 0.35 });
    burst(d, sr, 0, 0.5, { r, color: 'brown', type: 'lp', f: 500, f1: 150, a: 0.005, amp: 0.6 });
    rustle(d, sr, 0.02, 0.3, r, 0.22, 1500);
  } },

  // ---------- gathering, food, healing ----------
  pickup: { v: 4, sec: 0.2, gain: 0.3, rev: 0.12, pj: 1, vj: 0.1, render(d, sr, r) {
    const f = 520 + r() * 90;
    tone(d, sr, 0, 0.05, f, f * 1.9, 0.8, { a: 0.002, dec: 0.04 });
    tone(d, sr, 0.05, 0.1, f * 1.5, f * 1.5, 0.5, { a: 0.003, dec: 0.08 });
    click(d, sr, 0, r, 0.12, 3000);
  } },
  herb_pick: { v: 4, sec: 0.34, gain: 0.36, rev: 0.1, pj: 1.2, vj: 0.15, render(d, sr, r) {
    rustle(d, sr, 0, 0.25, r, 0.6, 3500);
    burst(d, sr, 0.12, 0.012, { r, type: 'bp', f: 2200, q: 2, a: 0.0005, amp: 0.7 });
    mode(d, sr, 0.12, 1300 + r() * 200, 0.3, 0.03);
  } },
  heal: { v: 2, sec: 1.15, sr: 24000, gain: 0.36, rev: 0.4, pj: 0.4, vj: 0.08, render(d, sr, r) {
    crunch(d, sr, 0, r, 2000, 0.45, 0.08);
    crunch(d, sr, 0.12, r, 1700, 0.4, 0.08);
    bellTone(d, sr, 0.22, 1318.5, 0.25, 0.7);
    bellTone(d, sr, 0.3, 1661.2, 0.2, 0.65);
    bellTone(d, sr, 0.38, 1975.5, 0.16, 0.6);
    burst(d, sr, 0.2, 0.6, { r, type: 'hp', f: 6000, shape: 'bell', amp: 0.04 });
  } },
  eat: { v: 4, sec: 0.62, sr: 24000, gain: 0.34, rev: 0.04, pj: 1.4, vj: 0.15, render(d, sr, r) {
    const n = 3 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const t = k * 0.13 + r() * 0.02;
      crunch(d, sr, t, r, 1800 + r() * 1400, 0.7, 0.045);
      thump(d, sr, t, 160, 110, 0.18, 0.03);
    }
    burst(d, sr, n * 0.13 + 0.02, 0.09, { r, color: 'pink', type: 'lp', f: 400, shape: 'bell', amp: 0.25 });
  } },
  splash: { v: 4, sec: 0.36, sr: 24000, gain: 0.4, rev: 0.25, pj: 1.2, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.26, { r, type: 'bp', f: 900, f1: 420, q: 0.8, a: 0.005, amp: 0.7 });
    for (let k = 0; k < 3; k++) bubble(d, sr, 0.04 + r() * 0.15, r, 0.2);
    burst(d, sr, 0.02, 0.12, { r, type: 'hp', f: 3500, amp: 0.15, grain: 0.9, grainRate: 500 });
  } },
  // swimming (deep water): a stroke = the arm slapping in, a pouring slosh, bubbles and drops falling back
  swim_stroke: { v: 5, sec: 0.8, sr: 24000, gain: 0.22, rev: 0.18, pj: 1.2, vj: 0.15, render(d, sr, r) {
    burst(d, sr, 0, 0.05, { r, type: 'bp', f: 1400 + r() * 400, q: 0.9, a: 0.003, amp: 0.4 });
    burst(d, sr, 0.02, 0.45, { r, color: 'pink', type: 'bp', f: 900 + r() * 200, f1: 420, q: 0.9, a: 0.06, amp: 0.8, grain: 0.35, grainRate: 300 });
    burst(d, sr, 0.05, 0.5, { r, color: 'brown', type: 'lp', f: 380, a: 0.08, amp: 0.45 });
    const n = 4 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) bubble(d, sr, 0.15 + r() * 0.45, r, 0.1 + r() * 0.1);
    burst(d, sr, 0.25, 0.4, { r, type: 'hp', f: 3500, amp: 0.1, grain: 0.9, grainRate: 120 });
  } },
  swim_tread: { v: 4, sec: 0.75, sr: 24000, gain: 0.16, rev: 0.15, pj: 1.5, vj: 0.2, render(d, sr, r) {
    burst(d, sr, 0, 0.65, { r, color: 'pink', type: 'bp', f: 550 + r() * 200, q: 0.8, shape: 'bell', pow: 1.5, amp: 0.7, grain: 0.3, grainRate: 200 });
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) bubble(d, sr, 0.1 + r() * 0.5, r, 0.15);
  } },
  splash_in: { v: 3, sec: 1.05, sr: 24000, gain: 0.55, rev: 0.25, pj: 1, vj: 0.1, render(d, sr, r) {
    tone(d, sr, 0, 0.16, 90, 45, 0.5, { a: 0.003, dec: 0.12 });
    burst(d, sr, 0, 0.55, { r, type: 'bp', f: 1300 + r() * 300, f1: 380, q: 0.8, a: 0.004, amp: 0.9 });
    burst(d, sr, 0.02, 0.75, { r, color: 'pink', type: 'lp', f: 520, a: 0.03, amp: 0.5 });
    for (let k = 0; k < 9; k++) bubble(d, sr, 0.1 + r() * 0.75, r, 0.12 + r() * 0.12);
    burst(d, sr, 0.01, 0.4, { r, type: 'hp', f: 4000, amp: 0.2, grain: 0.5, grainRate: 400 });
  } },
  splash_out: { v: 3, sec: 0.95, sr: 24000, gain: 0.42, rev: 0.2, pj: 1, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.3, { r, color: 'pink', type: 'bp', f: 700, f1: 1100, q: 0.9, shape: 'bell', amp: 0.6 });
    const n = 10 + Math.floor(r() * 7);
    for (let k = 0; k < n; k++) { const f = 900 + r() * 900, t = 0.15 + Math.pow(r(), 1.4) * 0.7; tone(d, sr, t, 0.045, f, f * 2.4, 0.35 * (1 - (t - 0.15) / 0.8), { a: 0.001, dec: 0.04 }); }
    burst(d, sr, 0.1, 0.6, { r, type: 'hp', f: 3000, amp: 0.15, grain: 0.8, grainRate: 200 });
  } },
  plop: { v: 4, sec: 0.16, gain: 0.25, rev: 0.3, pj: 1.5, vj: 0.2, render(d, sr, r) {
    tone(d, sr, 0, 0.035, 300 + r() * 100, 900, 0.7, { a: 0.001, dec: 0.03 });
    burst(d, sr, 0, 0.06, { r, type: 'lp', f: 800, amp: 0.4 });
    bubble(d, sr, 0.035, r, 0.3);
  } },
  drip: { v: 6, sec: 0.12, gain: 0.16, rev: 0.8, pj: 2, vj: 0.3, render(d, sr, r) {
    const f = 900 + r() * 800;
    tone(d, sr, 0, 0.045, f, f * 2.5, 0.8, { a: 0.001, dec: 0.04 });
    tone(d, sr, 0.012, 0.06, f * 1.8, f * 3, 0.35, { a: 0.001, dec: 0.05 });
  } },
  ignite: { v: 2, sec: 0.95, sr: 24000, gain: 0.45, rev: 0.25, pj: 0.8, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.75, { r, color: 'pink', type: 'bp', f: 300, f1: 1500, q: 0.9, a: 0.12, amp: 0.8 });
    burst(d, sr, 0.05, 0.8, { r, color: 'brown', type: 'lp', f: 300, a: 0.15, amp: 0.4 });
    for (let k = 0; k < 7; k++) click(d, sr, 0.15 + r() * 0.7, r, 0.2 + r() * 0.3, 1500 + r() * 2500);
  } },
  crackle: { v: 8, sec: 0.06, gain: 0.12, bus: 'amb', rev: 0.12, pj: 3, vj: 0.5, render(d, sr, r) {
    burst(d, sr, 0, 0.008 + r() * 0.02, { r, type: 'hp', f: 1500 + r() * 2500, a: 0.0004, amp: 1 });
    if (r() < 0.4) burst(d, sr, 0.015, 0.03, { r, type: 'bp', f: 800 + r() * 700, q: 1.5, amp: 0.5 });
  } },
  tree_creak: { v: 2, sec: 1.2, sr: 24000, gain: 0.3, rev: 0.3, pj: 1, vj: 0.1, render(d, sr, r) {
    const n = Math.ceil(0.9 * sr), tmp = new Float32Array(n);
    voiced(tmp, sr, 0, 0.9, (u) => 60 + 30 * Math.sin(Math.PI * u) + 8 * Math.sin(u * 30), (u) => Math.pow(Math.sin(Math.PI * u), 0.8),
      { formants: [[220, 3, 1], [480, 4, 0.6], [900, 5, 0.3]], harm: 10, noise: 0.15, rough: 0.25, r });
    mix(d, tmp, 0, 0.6);
    burst(d, sr, 0.85, 0.06, { r, type: 'bp', f: 1200, q: 1, a: 0.0005, amp: 0.9 });
    burst(d, sr, 0.86, 0.1, { r, type: 'hp', f: 3000, amp: 0.3, grain: 0.8 });
  } },
  tree_fall: { v: 2, sec: 1.45, sr: 24000, gain: 0.6, rev: 0.3, pj: 1, vj: 0.1, render(d, sr, r) {
    tone(d, sr, 0, 0.6, 55, 30, 0.9, { a: 0.003, dec: 0.55 });
    burst(d, sr, 0, 0.8, { r, color: 'brown', type: 'lp', f: 900, f1: 200, a: 0.004, amp: 0.8 });
    rustle(d, sr, 0, 1.1, r, 0.5, 3500);
    for (let k = 0; k < 5; k++) burst(d, sr, r() * 0.4, 0.02, { r, type: 'bp', f: 1500 + r() * 1500, q: 1.5, a: 0.0005, amp: 0.4 });
  } },

  // ---------- corpses (agent I): butchering, bones, flies ----------
  butcher: { v: 5, sec: 0.5, sr: 24000, gain: 0.3, rev: 0.08, pj: 1.3, vj: 0.15, render(d, sr, r) {
    // knife slice, a wet squelch and a short tear
    burst(d, sr, 0, 0.07, { r, type: 'bp', f: 2600 + r() * 1200, f1: 1600, q: 1.4, a: 0.004, amp: 0.55 });
    burst(d, sr, 0.03, 0.16, { r, color: 'brown', type: 'lp', f: 600, a: 0.01, amp: 0.55 });
    burst(d, sr, 0.05, 0.18, { r, color: 'pink', type: 'bp', f: 320 + r() * 120, f1: 950, q: 3, a: 0.02, amp: 0.5 });
    burst(d, sr, 0.14 + r() * 0.08, 0.17, { r, type: 'bp', f: 1500 + r() * 600, q: 1.1, a: 0.01, amp: 0.45, grain: 0.85, grainRate: 900, grainMs: 1.5 });
    if (r() < 0.5) tone(d, sr, 0.2 + r() * 0.15, 0.04, 260, 520, 0.12, { a: 0.003, dec: 0.035 });
  } },
  bones: { v: 4, sec: 0.75, sr: 24000, gain: 0.3, rev: 0.15, pj: 1.3, vj: 0.15, render(d, sr, r) {
    // dry, hollow bones knocking and sliding against each other
    const n = 6 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const t = Math.pow(r(), 1.3) * 0.55;
      modal(d, sr, t, 900 + r() * 900, [[1, 0.6, 0.03], [2.6, 0.3, 0.02], [4.1, 0.15, 0.012]], (0.35 + r() * 0.5) * (1 - t), { r });
    }
    burst(d, sr, 0.05, 0.4, { r, type: 'bp', f: 2400, q: 0.9, amp: 0.15, grain: 0.8, grainRate: 300 });
  } },
  flies: { v: 2, sec: 3.0, sr: 16000, gain: 0.1, bus: 'amb', rev: 0.1, pj: 0.8, vj: 0.15, render(d, sr, r) {
    // a small swarm: each fly a buzzing wingbeat that wanders in pitch and distance (wavetable, cheap)
    const n = d.length, out = new Float32Array(n), TL = 512, tab = new Float32Array(TL + 1);
    for (let i = 0; i <= TL; i++) { const x = (2 * Math.PI * i) / TL; tab[i] = Math.sin(x) + 0.5 * Math.sin(2 * x) + 0.3 * Math.sin(3 * x); }
    for (let k = 0; k < 5 + Math.floor(r() * 3); k++) {
      const f0 = 170 + r() * 90, wr = 0.4 + r() * 0.8, wp = r() * 6, ar = 0.3 + r() * 0.7, ap = r() * 6;
      let ph = 0, inc = 0, a = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 31) === 0) {
          const t = i / sr;
          inc = (TL * f0 * (1 + 0.08 * Math.sin(2 * Math.PI * wr * t + wp) + 0.02 * Math.sin(2 * Math.PI * 7 * t))) / sr;
          a = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * ar * t + ap), 2);
        }
        ph += inc;
        if (ph >= TL) ph -= TL;
        const j = ph | 0;
        out[i] += (tab[j] + (tab[j + 1] - tab[j]) * (ph - j)) * a;
      }
    }
    biquad(out, sr, 'bp', 520, 0.8);
    normalize(out, 1);
    const f = Math.floor(0.45 * sr);
    for (let i = 0; i < f; i++) { const k = i / f; out[i] *= k; out[n - 1 - i] *= k; }
    mix(d, out, 0, 1);
  } },

  // ---------- construction ----------
  blueprint: { v: 3, sec: 0.46, gain: 0.25, rev: 0.25, pj: 0.6, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.22, { r, color: 'pink', type: 'bp', f: 2200, q: 0.8, shape: 'bell', amp: 0.5, grain: 0.4 });
    bellTone(d, sr, 0.03, 1046.5, 0.25, 0.25);
    bellTone(d, sr, 0.09, 1568, 0.2, 0.25);
  } },
  build_hit: { v: 6, sec: 0.26, gain: 0.48, rev: 0.22, pj: 1.3, vj: 0.15, render(d, sr, r) {
    click(d, sr, 0, r, 0.7, 3000);
    modal(d, sr, 0.001, 260 + r() * 80, [[1, 0.8, 0.08], [2.3, 0.5, 0.06], [3.9, 0.35, 0.04]], 0.85, { r });
    const fn = 2600 + r() * 600;
    mode(d, sr, 0.001, fn, 0.18, 0.09);
    mode(d, sr, 0.001, fn * 1.48, 0.1, 0.06);
    thump(d, sr, 0, 140, 80, 0.35, 0.05);
  } },
  build_done: { v: 2, sec: 1.25, sr: 24000, gain: 0.48, rev: 0.32, pj: 0.5, vj: 0.08, render(d, sr, r) {
    modal(d, sr, 0, 105, [[1, 0.9, 0.3], [2.2, 0.5, 0.18], [3.7, 0.3, 0.1]], 0.9, { r });
    click(d, sr, 0, r, 0.4, 2200);
    burst(d, sr, 0.01, 0.45, { r, color: 'pink', type: 'lp', f: 900, shape: 'bell', amp: 0.35 });
    bellTone(d, sr, 0.12, 784, 0.22, 0.8);
    bellTone(d, sr, 0.2, 1174.7, 0.18, 0.8);
    bellTone(d, sr, 0.28, 1568, 0.12, 0.8);
  } },
  decon: { v: 3, sec: 0.85, sr: 24000, gain: 0.34, rev: 0.25, pj: 1, vj: 0.12, render(d, sr, r) {
    creak(d, sr, 0, 0.24, 520 + r() * 80, 420, 0.4, r);
    const ts = [0.18, 0.27, 0.34, 0.46];
    ts.forEach((t, k) => wood(d, sr, t + r() * 0.03, 420 - k * 50 + r() * 60, 0.7 - k * 0.1, r, 0.8));
    thump(d, sr, 0.45, 90, 50, 0.5, 0.12);
    burst(d, sr, 0.45, 0.3, { r, color: 'pink', type: 'lp', f: 800, shape: 'bell', amp: 0.25 });
  } },
  raze: { v: 2, sec: 1.05, sr: 24000, gain: 0.5, rev: 0.3, pj: 0.8, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.7, { r, type: 'hp', f: 2500, a: 0.02, amp: 0.45 });
    for (let k = 0; k < 10; k++) click(d, sr, r() * 0.8, r, 0.2 + r() * 0.3, 1500 + r() * 2000);
    thump(d, sr, 0.1, 80, 40, 0.6, 0.25);
    burst(d, sr, 0.1, 0.6, { r, color: 'brown', type: 'lp', f: 600, amp: 0.5 });
    burst(d, sr, 0, 0.6, { r, color: 'pink', type: 'bp', f: 900, f1: 300, shape: 'bell', amp: 0.35 });
  } },
  // roofs (agent J): a built roof gives way (timbers crack, tiles slide, a heavy thud, dust) / a cave ceiling falls
  roof_collapse: { v: 2, sec: 2.2, sr: 24000, gain: 0.62, rev: 0.32, pj: 0.8, vj: 0.1, render(d, sr, r) {
    creak(d, sr, 0, 0.35, 420 + r() * 60, 260, 0.45, r);
    for (let k = 0; k < 5; k++) wood(d, sr, 0.22 + k * 0.07 + r() * 0.04, 380 - k * 40 + r() * 70, 0.75 - k * 0.08, r, 0.7);
    for (let k = 0; k < 26; k++) click(d, sr, 0.35 + r() * 1.1, r, 0.12 + r() * 0.25, 1800 + r() * 2600); // tiles / straw sliding
    thump(d, sr, 0.5, 70, 35, 0.9, 0.3);
    thump(d, sr, 0.68, 95, 45, 0.5, 0.2);
    burst(d, sr, 0.5, 1.5, { r, color: 'brown', type: 'lp', f: 700, f1: 260, shape: 'bell', amp: 0.55 });
    burst(d, sr, 0.45, 1.2, { r, color: 'pink', type: 'bp', f: 1400, q: 0.6, shape: 'bell', amp: 0.22, grain: 0.6, grainRate: 900 });
  } },
  cave_in: { v: 2, sec: 2.6, sr: 22050, gain: 0.7, rev: 0.45, pj: 0.6, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 2.2, { r, color: 'brown', type: 'lp', f: 420, f1: 160, shape: 'bell', amp: 0.75 }); // the rumble
    thump(d, sr, 0.15, 55, 28, 1.0, 0.45);
    for (let k = 0; k < 18; k++) {
      const t = 0.1 + r() * 1.7;
      crunch(d, sr, t, r, 600 + r() * 1400, 0.25 + r() * 0.35, 0.04 + r() * 0.05); // rocks hitting the floor
      if (k % 3 === 0) thump(d, sr, t, 110 + r() * 60, 60, 0.35, 0.08);
    }
    burst(d, sr, 0.3, 1.6, { r, color: 'pink', type: 'hp', f: 2600, shape: 'bell', amp: 0.12, grain: 0.8, grainRate: 1400 }); // gravel trickle
  } },
  rotate: { v: 3, sec: 0.12, gain: 0.24, bus: 'ui', rev: 0, pj: 0.8, vj: 0.1, render(d, sr, r) {
    modal(d, sr, 0, 1200, [[1, 0.6, 0.02], [2.1, 0.3, 0.015]], 0.8, { r });
    modal(d, sr, 0.045, 1450, [[1, 0.6, 0.02], [2.1, 0.3, 0.015]], 0.7, { r });
  } },
  door_open: { v: 3, sec: 0.6, gain: 0.26, rev: 0.2, pj: 1, vj: 0.1, render(d, sr, r) {
    modal(d, sr, 0, 2300 + r() * 200, [[1, 0.5, 0.03], [1.6, 0.3, 0.02]], 0.6, { r });
    click(d, sr, 0, r, 0.4, 3000);
    creak(d, sr, 0.04, 0.38, 300 + r() * 50, 430 + r() * 80, 0.45, r);
    burst(d, sr, 0.05, 0.3, { r, color: 'pink', type: 'lp', f: 500, shape: 'bell', amp: 0.3 });
  } },
  door_close: { v: 3, sec: 0.46, gain: 0.3, rev: 0.22, pj: 1, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.15, { r, color: 'pink', type: 'lp', f: 600, shape: 'bell', amp: 0.3 });
    modal(d, sr, 0.12, 85 + r() * 15, [[1, 0.9, 0.15], [1.9, 0.6, 0.1], [3.3, 0.35, 0.06]], 0.9, { r });
    burst(d, sr, 0.12, 0.06, { r, type: 'lp', f: 900, amp: 0.5 });
    modal(d, sr, 0.16, 2100, [[1, 0.4, 0.025], [1.7, 0.25, 0.018]], 0.5, { r });
  } },
  chest_open: { v: 3, sec: 0.42, gain: 0.24, rev: 0.15, pj: 1, vj: 0.1, render(d, sr, r) {
    modal(d, sr, 0, 2500, [[1, 0.4, 0.025], [1.6, 0.25, 0.018]], 0.5, { r });
    creak(d, sr, 0.03, 0.22, 480 + r() * 60, 620, 0.35, r);
    wood(d, sr, 0.25, 240 + r() * 40, 0.4, r, 0.6);
  } },
  chest_close: { v: 3, sec: 0.32, gain: 0.28, rev: 0.15, pj: 1, vj: 0.1, render(d, sr, r) {
    modal(d, sr, 0, 140 + r() * 20, [[1, 0.8, 0.12], [2.3, 0.5, 0.07], [3.8, 0.3, 0.05]], 0.9, { r });
    burst(d, sr, 0, 0.05, { r, type: 'lp', f: 1000, amp: 0.4 });
    modal(d, sr, 0.04, 2300, [[1, 0.4, 0.025], [1.6, 0.25, 0.018]], 0.45, { r });
  } },
  chest_rummage: { v: 3, sec: 0.56, gain: 0.3, rev: 0.12, pj: 1, vj: 0.15, render(d, sr, r) {
    const n = 4 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) wood(d, sr, r() * 0.42, 300 + r() * 400, 0.3 + r() * 0.3, r, 0.4);
    rustle(d, sr, 0.02, 0.4, r, 0.35, 1500);
  } },
  craft_done: { v: 2, sec: 0.95, sr: 24000, gain: 0.3, rev: 0.28, pj: 0.3, vj: 0.06, bus: 'ui', render(d, sr, r) {
    const k = (t, f, a) => modal(d, sr, t, f, [[1, 0.7, 0.55], [5.9, 0.12, 0.08]], a, { r, spread: 0.002 });
    k(0, 659.3, 0.8); k(0.09, 784, 0.75); k(0.18, 1046.5, 0.7);
    mode(d, sr, 0, 2900, 0.15, 0.12);
  } },
  equip: { v: 3, sec: 0.32, gain: 0.28, rev: 0.08, pj: 1, vj: 0.1, render(d, sr, r) {
    rustle(d, sr, 0, 0.2, r, 0.5, 1800);
    mode(d, sr, 0.08, 2400 + r() * 300, 0.3, 0.1);
    mode(d, sr, 0.08, 3600 + r() * 300, 0.15, 0.06);
  } },

  // ---------- interface ----------
  ui_click: { v: 3, sec: 0.06, gain: 0.2, bus: 'ui', rev: 0, pj: 0.6, vj: 0.08, gap: 0.025, render(d, sr, r) {
    modal(d, sr, 0, 2100, [[1, 0.6, 0.025], [1.63, 0.35, 0.018], [2.9, 0.2, 0.01]], 1, { r });
    click(d, sr, 0, r, 0.3, 4000);
  } },
  ui_hover: { v: 2, sec: 0.03, gain: 0.06, bus: 'ui', rev: 0, pj: 0.4, vj: 0.05, gap: 0.04, render(d, sr, r) {
    modal(d, sr, 0, 3200, [[1, 0.5, 0.015], [1.7, 0.25, 0.01]], 1, { r });
  } },
  ui_open: { v: 2, sec: 0.36, gain: 0.22, bus: 'ui', rev: 0.12, pj: 0.3, vj: 0.06, gap: 0.08, render(d, sr, r) {
    burst(d, sr, 0, 0.16, { r, color: 'pink', type: 'bp', f: 900, f1: 2600, q: 0.9, shape: 'bell', amp: 0.45 });
    bellTone(d, sr, 0.02, 784, 0.35, 0.16);
    bellTone(d, sr, 0.08, 1174.7, 0.3, 0.2);
  } },
  ui_close: { v: 2, sec: 0.3, gain: 0.2, bus: 'ui', rev: 0.1, pj: 0.3, vj: 0.06, gap: 0.08, render(d, sr, r) {
    burst(d, sr, 0, 0.14, { r, color: 'pink', type: 'bp', f: 2400, f1: 800, q: 0.9, shape: 'bell', amp: 0.42 });
    bellTone(d, sr, 0, 1174.7, 0.28, 0.14);
    bellTone(d, sr, 0.06, 784, 0.3, 0.18);
  } },
  hotbar: { v: 2, sec: 0.1, gain: 0.18, bus: 'ui', rev: 0.02, pj: 0, vj: 0.05, gap: 0.03, render(d, sr, r) {
    modal(d, sr, 0, 1600, [[1, 0.6, 0.05], [2.01, 0.25, 0.03], [3, 0.12, 0.02]], 1, { r, spread: 0 });
    click(d, sr, 0, r, 0.2, 3500);
  } },
  zoom: { v: 2, sec: 0.2, gain: 0.07, bus: 'ui', rev: 0, pj: 0.5, vj: 0.1, gap: 0.12, render(d, sr, r) {
    burst(d, sr, 0, 0.18, { r, color: 'pink', type: 'bp', f: 600, f1: 1800, q: 1.4, shape: 'bell', amp: 0.6 });
  } },
  error: { v: 1, sec: 0.32, gain: 0.2, bus: 'ui', rev: 0.05, pj: 0, vj: 0.05, gap: 0.2, render(d, sr) {
    tone(d, sr, 0, 0.1, 330, 320, 0.55, { a: 0.006, dec: 0.09 }, 'tri');
    tone(d, sr, 0.11, 0.15, 262, 255, 0.55, { a: 0.006, dec: 0.13 }, 'tri');
    tone(d, sr, 0, 0.26, 131, 128, 0.2, { a: 0.01, dec: 0.22 });
  } },
  levelup: { v: 1, sec: 2.4, sr: 24000, gain: 0.34, bus: 'ui', rev: 0.45, pj: 0, vj: 0, render(d, sr, r) {
    [523.25, 659.25, 784, 1046.5, 1318.5].forEach((f, k) => ks(d, sr, k * 0.07, 2.2, f, { t60: 1.6, bright: 0.7, pos: 0.12, amp: 0.55, r }));
    [1046.5, 1318.5, 1568].forEach((f) => modal(d, sr, 0.36, f, [[1, 0.25, 1.8], [2, 0.08, 0.9], [3, 0.04, 0.5], [4.2, 0.03, 0.3]], 1, { r, spread: 0.003 }));
    burst(d, sr, 0.3, 1.2, { r, type: 'hp', f: 6000, shape: 'bell', amp: 0.05 });
    tone(d, sr, 0, 1.6, 261.6, 261.6, 0.22, (u) => Math.sin(Math.PI * u));
  } },
  sleep: { v: 1, sec: 1.9, sr: 24000, gain: 0.26, bus: 'ui', rev: 0.4, pj: 0, vj: 0, render(d, sr) {
    bellTone(d, sr, 0, 784, 0.3, 1.2); bellTone(d, sr, 0.28, 659.3, 0.28, 1.2); bellTone(d, sr, 0.56, 523.25, 0.3, 1.3);
  } },
  respawn: { v: 1, sec: 1.5, sr: 24000, gain: 0.32, bus: 'ui', rev: 0.4, pj: 0, vj: 0, render(d, sr, r) {
    burst(d, sr, 0, 0.8, { r, type: 'hp', f: 5000, shape: 'swell', amp: 0.15 });
    tone(d, sr, 0.1, 1.2, 523.25, 523.25, 0.3, (u) => Math.sin(Math.PI * u));
    tone(d, sr, 0.3, 1.1, 784, 784, 0.2, (u) => Math.sin(Math.PI * u));
  } },

  // ---------- the player's body (heard "from inside": bus ui, no reverb) ----------
  heartbeat: { v: 2, sec: 0.55, sr: 16000, gain: 0.4, bus: 'ui', rev: 0, pj: 0.3, vj: 0.05, render(d, sr, r) {
    const beat = (t, a) => {
      tone(d, sr, t, 0.16, 62, 38, a, { a: 0.008, dec: 0.13 });
      tone(d, sr, t, 0.1, 110, 70, a * 0.35, { a: 0.004, dec: 0.07 });
      burst(d, sr, t, 0.05, { r, color: 'brown', type: 'lp', f: 180, a: 0.004, amp: a * 0.3 });
    };
    beat(0, 1); beat(0.17, 0.7);
    biquad(d, sr, 'lp', 400, 0.7);
  } },
  shiver: { v: 3, sec: 0.9, sr: 24000, gain: 0.2, bus: 'ui', rev: 0, pj: 1, vj: 0.15, render(d, sr, r) {
    // teeth chattering: a fast train of small enamel clicks over a shaky breath
    const rate = 18 + r() * 8;
    for (let t = 0.03; t < 0.75; t += (0.8 + r() * 0.4) / rate) modal(d, sr, t, 2200 + r() * 900, [[1, 0.5, 0.012], [1.7, 0.25, 0.008]], 0.35 + r() * 0.3, { r });
    const n = Math.ceil(0.85 * sr), b = new Float32Array(n);
    burst(b, sr, 0, 0.85, { r, color: 'pink', type: 'bp', f: 1300, q: 0.9, shape: 'bell', amp: 0.3 });
    for (let i = 0; i < n; i++) b[i] *= 0.55 + 0.45 * Math.sin((2 * Math.PI * 9 * i) / sr);
    mix(d, b, 0, 1);
  } },
  breath_cold: { v: 3, sec: 1.2, sr: 24000, gain: 0.2, bus: 'ui', rev: 0, pj: 1, vj: 0.15, render(d, sr, r) {
    // a shaky, trembling exhale
    const n = Math.ceil(1.1 * sr), b = new Float32Array(n), trem = 8 + r() * 3;
    burst(b, sr, 0, 1.1, { r, color: 'pink', type: 'bp', f: 950 + r() * 200, q: 0.8, shape: 'bell', pow: 1.2, amp: 1 });
    for (let i = 0; i < n; i++) b[i] *= 0.45 + 0.55 * Math.abs(Math.sin((Math.PI * trem * i) / sr));
    mix(d, b, 0, 1);
  } },
  stomach: { v: 3, sec: 1.3, sr: 16000, gain: 0.3, bus: 'ui', rev: 0, pj: 1.5, vj: 0.15, render(d, sr, r) {
    const ph = r() * 6;
    voiced(d, sr, 0, 1.15, (u) => 70 + 35 * Math.sin(u * 9 + ph) + 12 * Math.sin(u * 23), (u) => Math.pow(Math.sin(Math.PI * u), 0.8),
      { formants: [[180, 2, 1], [420, 3, 0.6]], tilt: 1.3, rough: 0.25, am: 0.5, amRate: 12, noise: 0.2, r });
    for (let k = 0; k < 3; k++) tone(d, sr, 0.3 + r() * 0.7, 0.06, 150, 300, 0.25, { a: 0.004, dec: 0.05 });
    biquad(d, sr, 'lp', 900, 0.7);
  } },
  drip_body: { v: 5, sec: 0.5, sr: 24000, gain: 0.12, bus: 'ui', rev: 0, pj: 2, vj: 0.3, render(d, sr, r) {
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const t = r() * 0.4, f = 1400 + r() * 1200;
      tone(d, sr, t, 0.03, f, f * 1.7, 0.7, { a: 0.001, dec: 0.025 });
      burst(d, sr, t + 0.004, 0.01, { r, type: 'hp', f: 3000, amp: 0.25 });
    }
  } },
  queasy: { v: 2, sec: 1.1, sr: 16000, gain: 0.22, bus: 'ui', rev: 0, pj: 1, vj: 0.1, render(d, sr, r) {
    // a closed-mouth, uneasy "mmmh"
    voiced(d, sr, 0, 1.0, (u) => 115 - 25 * u + 6 * Math.sin(u * 14), (u) => Math.pow(Math.sin(Math.PI * u), 0.9),
      { formants: [[300, 4, 1], [650, 5, 0.35], [2400, 6, 0.08]], tilt: 1.5, noise: 0.08, r });
  } },

  // ---------- wildlife & ambience voices (bus amb) ----------
  bird_chirp: { v: 6, sec: 0.6, sr: 16000, gain: 0.07, bus: 'amb', rev: 0.35, pj: 2, vj: 0.3, render(d, sr, r) {
    const n = 2 + Math.floor(r() * 4), base = 2600 + r() * 1600, gap = 0.09 + r() * 0.04;
    for (let k = 0; k < n; k++) tone(d, sr, k * gap, 0.06, base * (0.9 + r() * 0.15), base * 1.45, 0.9, { a: 0.006, dec: 0.05 });
  } },
  bird_warble: { v: 4, sec: 1.2, sr: 16000, gain: 0.06, bus: 'amb', rev: 0.35, pj: 2, vj: 0.3, render(d, sr, r) {
    const f = 3000 + r() * 1500, dur = 0.5 + r() * 0.6;
    tone(d, sr, 0, dur, f, f * (0.8 + r() * 0.4), 0.8, (u) => Math.min(1, u * 12) * Math.min(1, (1 - u) * 8), 'sine', { rate: 18 + r() * 14, depth: 0.1 });
  } },
  bird_call: { v: 4, sec: 0.7, sr: 16000, gain: 0.07, bus: 'amb', rev: 0.4, pj: 1, vj: 0.2, render(d, sr, r) {
    const f = 620 + r() * 180;
    tone(d, sr, 0, 0.22, f * 1.26, f * 1.22, 0.8, { a: 0.02, dec: 0.2 });
    tone(d, sr, 0.3, 0.32, f, f * 0.97, 0.8, { a: 0.02, dec: 0.3 });
  } },
  bird_dove: { v: 3, sec: 1.5, sr: 16000, gain: 0.06, bus: 'amb', rev: 0.4, pj: 1, vj: 0.2, render(d, sr, r) {
    const f = 420 + r() * 60;
    const seq = [[0, 0.25, 1, 0.97], [0.32, 0.4, 1.18, 1.1], [0.8, 0.22, 1, 0.97], [1.08, 0.24, 1, 0.95]];
    for (const [t, dur, a, b] of seq) tone(d, sr, t, dur, f * a, f * b, 0.7, (u) => Math.pow(Math.sin(Math.PI * u), 0.7));
    biquad(d, sr, 'lp', 1400, 0.7);
  } },
  bird_song: { v: 4, sec: 1.6, sr: 16000, gain: 0.07, bus: 'amb', rev: 0.35, pj: 1.5, vj: 0.25, render(d, sr, r) {
    let t = 0;
    const n = 6 + Math.floor(r() * 6);
    let f = 2400 + r() * 1400;
    for (let k = 0; k < n && t < 1.45; k++) {
      const dur = 0.04 + r() * 0.08;
      const f1 = f * (0.8 + r() * 0.5);
      tone(d, sr, t, dur, f, f1, 0.7 + r() * 0.3, (u) => Math.sin(Math.PI * u), 'sine', r() < 0.3 ? { rate: 40, depth: 0.05 } : null);
      t += dur + 0.015 + r() * 0.06;
      f = Math.max(1800, Math.min(5200, f1 * (0.85 + r() * 0.35)));
    }
  } },
  woodpecker: { v: 2, sec: 1.0, sr: 16000, gain: 0.08, bus: 'amb', rev: 0.4, pj: 1, vj: 0.2, render(d, sr, r) {
    const n = 12 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) modal(d, sr, k * 0.045, 1100 + r() * 60, [[1, 0.6, 0.02], [2.3, 0.3, 0.012]], 1 - k / n * 0.6, { r });
  } },
  wings: { v: 3, sec: 0.42, sr: 16000, gain: 0.18, bus: 'amb', rev: 0.15, pj: 1, vj: 0.2, render(d, sr, r) {
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) burst(d, sr, k * (0.065 + r() * 0.015), 0.06, { r, color: 'pink', type: 'bp', f: 600 + r() * 200, q: 0.8, shape: 'bell', amp: 0.7 - k * 0.08 });
  } },
  cricket: { v: 6, sec: 0.3, sr: 16000, gain: 0.045, bus: 'amb', rev: 0.2, pj: 1, vj: 0.3, render(d, sr, r) {
    const f = 4300 + r() * 700, n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) tone(d, sr, k * 0.045, 0.025, f, f, 1, { a: 0.003, dec: 0.02 });
  } },
  owl: { v: 2, sec: 1.45, sr: 16000, gain: 0.2, bus: 'amb', rev: 0.6, pj: 1, vj: 0.15, render(d, sr, r) {
    const f = 330 + r() * 50;
    tone(d, sr, 0, 0.35, f, f * 0.92, 0.9, (u) => Math.pow(Math.sin(Math.PI * u), 0.8));
    tone(d, sr, 0.55, 0.22, f * 1.02, f * 0.9, 0.6, (u) => Math.pow(Math.sin(Math.PI * u), 0.8));
    tone(d, sr, 0.85, 0.45, f, f * 0.88, 0.8, (u) => Math.pow(Math.sin(Math.PI * u), 0.8));
    biquad(d, sr, 'lp', 900, 0.7);
  } },
  frog: { v: 4, sec: 0.32, sr: 24000, gain: 0.12, bus: 'amb', rev: 0.25, pj: 2, vj: 0.3, render(d, sr, r) {
    for (let k = 0; k < 2; k++) voiced(d, sr, k * 0.13, 0.09, (u) => (150 + r() * 30) * (1 - u * 0.25), (u) => Math.sin(Math.PI * u),
      { formants: [[520 + r() * 200, 3, 1], [1100, 4, 0.4]], harm: 12, tilt: 0.8, rough: 0.1, am: 0.7, amRate: 45, r });
  } },
  duck: { v: 3, sec: 0.42, sr: 24000, gain: 0.2, bus: 'amb', rev: 0.2, pj: 1.5, vj: 0.2, render(d, sr, r) {
    for (let k = 0; k < 2; k++) voiced(d, sr, k * 0.18, 0.13, (u) => 260 - u * 40, (u) => adEnv(u, 0.1, 0.9),
      { formants: [[900, 5, 1], [1900, 6, 0.7], [2700, 6, 0.4]], tilt: 0.6, harm: 16, rough: 0.06, noise: 0.2, r });
  } },
  bee: { v: 2, sec: 1.0, sr: 16000, gain: 0.08, bus: 'amb', rev: 0.1, pj: 2, vj: 0.3, render(d, sr, r) {
    tone(d, sr, 0, 0.95, 210 + r() * 30, 220, 0.6, (u) => Math.sin(Math.PI * u), 'saw', { rate: 9, depth: 0.04 });
    biquad(d, sr, 'bp', 600, 1.5);
  } },
  squirrel: { v: 2, sec: 0.5, sr: 24000, gain: 0.1, bus: 'amb', rev: 0.25, pj: 1.5, vj: 0.2, render(d, sr, r) {
    const n = 6 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) tone(d, sr, k * 0.04, 0.02, 2200 + r() * 300, 2800, 0.8, { a: 0.002, dec: 0.018 });
  } },
  water_blub: { v: 4, sec: 0.16, gain: 0.1, bus: 'amb', rev: 0.3, pj: 2, vj: 0.3, render(d, sr, r) {
    bubble(d, sr, 0, r, 0.8);
    burst(d, sr, 0, 0.08, { r, color: 'brown', type: 'lp', f: 500, amp: 0.4 });
  } },
  rain_drop: { v: 8, sec: 0.03, gain: 0.03, bus: 'amb', rev: 0.1, pj: 3, vj: 0.5, render(d, sr, r) {
    const f = 2500 + r() * 2500;
    tone(d, sr, 0, 0.012, f, f * 1.3, 0.8, { a: 0.0005, dec: 0.01 });
    click(d, sr, 0, r, 0.3, 3000);
  } },
  roof_drop: { v: 8, sec: 0.07, gain: 0.07, bus: 'amb', rev: 0.08, pj: 3, vj: 0.5, render(d, sr, r) {
    modal(d, sr, 0, 400 + r() * 500, [[1, 0.5, 0.03], [2.2, 0.25, 0.02]], 1, { r });
    burst(d, sr, 0, 0.01, { r, type: 'lp', f: 1500, amp: 0.3 });
  } },
  cave_rumble: { v: 2, sec: 2.1, sr: 16000, gain: 0.22, bus: 'amb', rev: 0.7, pj: 2, vj: 0.2, render(d, sr, r) {
    burst(d, sr, 0, 1.8, { r, color: 'brown', type: 'lp', f: 400, a: 0.2, amp: 0.7, grain: 0.5, grainRate: 30, grainMs: 40 });
    for (let k = 0; k < 4; k++) modal(d, sr, 0.3 + r() * 1.2, 150 + r() * 150, [[1, 0.5, 0.15], [2.2, 0.3, 0.08]], 0.4, { r });
  } },
  thunder_near: { v: 2, sec: 6, sr: 16000, gain: 0.7, bus: 'amb', rev: 0.4, pj: 1, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 0.35, { r, type: 'hp', f: 1500, a: 0.002, amp: 0.8, grain: 0.5, grainRate: 200 });
    burst(d, sr, 0.03, 5.5, { r, color: 'brown', type: 'lp', f: 1100, f1: 90, a: 0.08, amp: 1, grain: 0.35, grainRate: 9, grainMs: 220 });
    burst(d, sr, 0.9 + r() * 0.6, 3.5, { r, color: 'brown', type: 'lp', f: 400, f1: 70, a: 0.3, amp: 0.6, grain: 0.4, grainRate: 6, grainMs: 300 });
  } },
  thunder_far: { v: 2, sec: 6, sr: 16000, gain: 0.55, bus: 'amb', rev: 0.5, pj: 1, vj: 0.1, render(d, sr, r) {
    burst(d, sr, 0, 5.5, { r, color: 'brown', type: 'lp', f: 520, f1: 70, a: 0.5, amp: 1, grain: 0.45, grainRate: 5, grainMs: 300 });
  } },
  wolf_howl: { v: 2, sec: 3.0, sr: 16000, gain: 0.2, bus: 'amb', rev: 0.7, pj: 1, vj: 0.15, render(d, sr, r) {
    const a = 360 + r() * 50, b = 600 + r() * 60;
    voiced(d, sr, 0, 2.7, (u) => (u < 0.25 ? a + (b - a) * (u / 0.25) : u < 0.7 ? b - (b - a) * 0.12 * ((u - 0.25) / 0.45) : b * 0.88 - (b * 0.88 - a * 1.1) * ((u - 0.7) / 0.3)) * (1 + 0.012 * Math.sin(u * 60)),
      (u) => Math.min(1, u * 6) * Math.pow(1 - u, 0.6), { formants: [[420, 6, 1], [820, 6, 0.4]], harm: 8, tilt: 1.6, noise: 0.05, r });
  } },
};

// ---------- creature voices: <species>_<aggro|hurt|idle|death> ----------
const VOX = { v: 3, gain: 0.45, rev: 0.25, pj: 1.2, vj: 0.15 };
const vox = (sec, fn, o = {}) => ({ ...VOX, sec, sr: 24000, ...o, render: fn });
const F_A = [[750, 6, 1], [1150, 7, 0.6], [2500, 8, 0.25]], F_U = [[600, 6, 1], [1000, 7, 0.5], [2400, 8, 0.15]];
Object.assign(SFX, {
  wolf_aggro: vox(0.85, (d, sr, r) => voiced(d, sr, 0, 0.75, (u) => 95 + 15 * Math.sin(Math.PI * u), (u) => Math.min(1, u * 10) * Math.pow(1 - u, 0.5),
    { formants: [[480, 3, 1], [1100, 4, 0.5], [2400, 5, 0.2]], harm: 16, tilt: 0.9, rough: 0.12, am: 0.55, amRate: 28, noise: 0.25, r }), { gain: 0.5 }),
  wolf_hurt: vox(0.4, (d, sr, r) => {
    voiced(d, sr, 0, 0.18, (u) => 1100 * Math.pow(0.55, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[1200, 4, 1], [2600, 5, 0.4]], tilt: 0.8, harm: 10, noise: 0.1, r });
    voiced(d, sr, 0.2, 0.12, (u) => 900 * Math.pow(0.6, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[1100, 4, 1], [2400, 5, 0.4]], tilt: 0.8, harm: 10, noise: 0.1, r });
  }),
  wolf_idle: vox(0.4, (d, sr, r) => { burst(d, sr, 0, 0.15, { r, color: 'pink', type: 'lp', f: 700, a: 0.01, amp: 0.6 }); burst(d, sr, 0.2, 0.15, { r, color: 'pink', type: 'lp', f: 650, a: 0.01, amp: 0.5 }); }, { gain: 0.22 }),
  wolf_death: vox(0.7, (d, sr, r) => voiced(d, sr, 0, 0.6, (u) => 900 * Math.pow(0.35, u), (u) => adEnv(u, 0.03, 0.97), { formants: [[1000, 4, 1], [2300, 5, 0.4]], tilt: 0.9, harm: 10, noise: 0.12, rough: 0.05, r })),
  boar_aggro: vox(0.8, (d, sr, r) => {
    for (let k = 0; k < 2; k++) voiced(d, sr, k * 0.18, 0.16, (u) => 110 - u * 20, (u) => Math.sin(Math.PI * u), { formants: [[350, 3, 1], [800, 4, 0.5]], rough: 0.2, am: 0.6, amRate: 40, noise: 0.3, r });
    voiced(d, sr, 0.36, 0.35, (u) => 650 + 300 * Math.sin(Math.PI * u * 0.8), (u) => adEnv(u, 0.1, 0.9), { formants: [[1100, 4, 1], [2200, 5, 0.5]], rough: 0.1, noise: 0.2, r });
  }, { gain: 0.48 }),
  boar_hurt: vox(0.3, (d, sr, r) => voiced(d, sr, 0, 0.22, (u) => 900 - u * 200, (u) => adEnv(u, 0.08, 0.92), { formants: [[1100, 4, 1], [2200, 5, 0.5]], rough: 0.1, noise: 0.25, r })),
  boar_idle: vox(0.6, (d, sr, r) => { const n = 1 + Math.floor(r() * 3); for (let k = 0; k < n; k++) voiced(d, sr, k * 0.18, 0.12, (u) => 110 - u * 15, (u) => Math.sin(Math.PI * u), { formants: [[340, 3, 1], [780, 4, 0.5]], rough: 0.2, am: 0.6, amRate: 40, noise: 0.3, r }); }, { gain: 0.28 }),
  boar_death: vox(0.7, (d, sr, r) => voiced(d, sr, 0, 0.6, (u) => 800 * Math.pow(0.5, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[1000, 4, 1], [2000, 5, 0.5]], rough: 0.12, noise: 0.25, r })),
  bear_aggro: vox(1.2, (d, sr, r) => voiced(d, sr, 0, 1.1, (u) => 75 + 22 * Math.sin(Math.PI * u), (u) => Math.pow(Math.min(1, u * 3), 1.5) * Math.pow(1 - u, 0.6),
    { formants: [[300, 2.5, 1], [700, 3, 0.7], [1600, 4, 0.25]], harm: 20, tilt: 0.8, rough: 0.18, am: 0.35, amRate: 22, noise: 0.35, r }), { gain: 0.5, v: 2 }),
  bear_hurt: vox(0.5, (d, sr, r) => voiced(d, sr, 0, 0.4, (u) => 95 - u * 20, (u) => adEnv(u, 0.1, 0.9), { formants: [[320, 2.5, 1], [740, 3, 0.7], [1600, 4, 0.25]], harm: 20, tilt: 0.8, rough: 0.2, am: 0.3, noise: 0.35, r }), { gain: 0.55 }),
  bear_idle: vox(0.8, (d, sr, r) => { burst(d, sr, 0, 0.3, { r, color: 'brown', type: 'lp', f: 500, a: 0.05, amp: 0.7 }); burst(d, sr, 0.38, 0.3, { r, color: 'brown', type: 'lp', f: 450, a: 0.05, amp: 0.5 }); }, { gain: 0.3 }),
  bear_death: vox(1.1, (d, sr, r) => voiced(d, sr, 0, 1.0, (u) => 90 * Math.pow(0.55, u), (u) => adEnv(u, 0.08, 0.92), { formants: [[300, 2.5, 1], [700, 3, 0.6]], harm: 18, tilt: 0.9, rough: 0.2, noise: 0.3, r }), { gain: 0.55, v: 2 }),
  deer_aggro: vox(0.25, (d, sr, r) => voiced(d, sr, 0, 0.12, (u) => 600 - u * 120, (u) => adEnv(u, 0.1, 0.9), { formants: [[900, 4, 1], [1700, 5, 0.6]], tilt: 0.7, rough: 0.05, noise: 0.15, r }), { gain: 0.32 }),
  deer_hurt: vox(0.32, (d, sr, r) => voiced(d, sr, 0, 0.25, (u) => 700 - u * 150 + 20 * Math.sin(u * 50), (u) => adEnv(u, 0.1, 0.9), { formants: [[950, 4, 1], [1800, 5, 0.6]], tilt: 0.7, noise: 0.12, r }), { gain: 0.32 }),
  deer_idle: vox(0.2, (d, sr, r) => burst(d, sr, 0, 0.09, { r, color: 'pink', type: 'bp', f: 1000, q: 1, a: 0.01, amp: 0.7 }), { gain: 0.16 }),
  deer_death: vox(0.5, (d, sr, r) => voiced(d, sr, 0, 0.42, (u) => 650 * Math.pow(0.6, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[900, 4, 1], [1700, 5, 0.6]], tilt: 0.7, noise: 0.12, r }), { gain: 0.32 }),
  rabbit_hurt: vox(0.12, (d, sr) => tone(d, sr, 0, 0.08, 2400, 1800, 0.8, { a: 0.004, dec: 0.07 }), { gain: 0.2 }),
  rabbit_death: vox(0.18, (d, sr) => tone(d, sr, 0, 0.14, 2200, 1300, 0.8, { a: 0.004, dec: 0.13 }), { gain: 0.2 }),
  rabbit_idle: vox(0.3, (d, sr) => { thump(d, sr, 0, 90, 60, 0.6, 0.05); thump(d, sr, 0.12, 90, 60, 0.5, 0.05); }, { gain: 0.12 }),
  fox_aggro: vox(0.55, (d, sr, r) => { for (let k = 0; k < 2; k++) voiced(d, sr, k * 0.25, 0.2, (u) => 900 + 400 * Math.sin(Math.PI * u) - u * 100, (u) => adEnv(u, 0.1, 0.9), { formants: [[1300, 4, 1], [2600, 5, 0.5]], tilt: 0.7, rough: 0.08, noise: 0.2, r }); }, { gain: 0.32 }),
  fox_hurt: vox(0.25, (d, sr, r) => voiced(d, sr, 0, 0.16, (u) => 1200 * Math.pow(0.6, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[1300, 4, 1], [2600, 5, 0.4]], tilt: 0.8, noise: 0.15, r }), { gain: 0.3 }),
  fox_death: vox(0.45, (d, sr, r) => voiced(d, sr, 0, 0.38, (u) => 1100 * Math.pow(0.45, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[1200, 4, 1], [2500, 5, 0.4]], tilt: 0.8, noise: 0.15, r }), { gain: 0.3 }),
  spider_aggro: vox(0.56, (d, sr, r) => {
    burst(d, sr, 0, 0.45, { r, type: 'hp', f: 3500, a: 0.03, amp: 0.55, grain: 0.3 });
    for (let k = 0; k < 14; k++) mode(d, sr, k * 0.025 + r() * 0.006, 2200 + r() * 1000, 0.5, 0.01);
  }, { gain: 0.4 }),
  spider_hurt: vox(0.2, (d, sr, r) => voiced(d, sr, 0, 0.12, (u) => 1800 - u * 400, (u) => adEnv(u, 0.05, 0.95), { formants: [[2500, 3, 1]], noise: 0.6, harm: 6, r }), { gain: 0.32 }),
  spider_idle: vox(0.4, (d, sr, r) => { for (let k = 0; k < 9; k++) mode(d, sr, k * 0.03 + r() * 0.008, 2400 + r() * 900, 0.6, 0.008); }, { gain: 0.14 }),
  spider_death: vox(0.5, (d, sr, r) => {
    voiced(d, sr, 0, 0.3, (u) => 1600 * Math.pow(0.5, u), (u) => adEnv(u, 0.05, 0.95), { formants: [[2300, 3, 1]], noise: 0.6, harm: 6, r });
    for (let k = 0; k < 8; k++) mode(d, sr, 0.2 + k * 0.03, 2000 + r() * 800, 0.4, 0.01);
  }, { gain: 0.32 }),
  bandit_aggro: vox(0.36, (d, sr, r) => voiced(d, sr, 0, 0.28, (u) => 150 + 25 * Math.sin(Math.PI * u) - u * 30, (u) => adEnv(u, 0.12, 0.88), { formants: F_A, tilt: 1.0, harm: 24, noise: 0.12, rough: 0.04, r }), { gain: 0.32 }),
  bandit_hurt: vox(0.26, (d, sr, r) => voiced(d, sr, 0, 0.2, (u) => 135 - u * 25, (u) => adEnv(u, 0.1, 0.9), { formants: F_U, tilt: 1.1, harm: 22, noise: 0.15, rough: 0.05, r }), { gain: 0.3 }),
  bandit_death: vox(0.7, (d, sr, r) => voiced(d, sr, 0, 0.6, (u) => 145 * Math.pow(0.62, u), (u) => adEnv(u, 0.06, 0.94), { formants: F_A, tilt: 1.1, harm: 22, noise: 0.15, rough: 0.06, r }), { gain: 0.32 }),
});

export const SPECIES_VOX = new Set(['wolf', 'boar', 'bear', 'deer', 'rabbit', 'fox', 'spider', 'bandit']);

// names that other code may call with a different meaning / older name
export const ALIAS = { ui: 'ui_click', build: 'build_hit', fire: 'ignite', craft: 'craft_done', thud: 'arrow_ground' };

// every variant of one sound, finished: pure function, also run by the synth worker
export function renderSfx(name) {
  const def = SFX[name];
  if (!def) return null;
  const sr = def.sr || SR, list = [];
  for (let k = 0; k < (def.v || 1); k++) {
    const r = mulberry(hashStr(name) + k * 7919);
    let d = buf(sr, def.sec);
    def.render(d, sr, r, k);
    dcBlock(d);
    normalize(d, 0.98);
    fadeIO(d, sr, 0.5, 4);
    d = trim(d, sr);
    for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) d[i] = 0;
    list.push(d);
  }
  return { sr, list };
}

// ---------- the cache ----------
export class SfxBank {
  constructor(ctx, pool = null) {
    this.ctx = ctx;
    this.pool = pool;
    this.map = new Map();
    this.pending = new Set();
    this.samples = 0;
    this.renderMs = 0;
    this.queue = [];
  }
  has(name) { return !!SFX[name]; }
  get(name) {
    let e = this.map.get(name);
    if (!e) {
      if (!SFX[name]) return null;
      const t0 = performance.now();
      const r = renderSfx(name);
      this.renderMs += performance.now() - t0;
      e = this._store(name, r.sr, r.list);
    }
    return e;
  }
  _store(name, sr, arrays) {
    const list = arrays.map((d) => { this.samples += d.length; return toBuffer(this.ctx, d, sr); });
    const e = { def: SFX[name], list, last: -1 };
    this.map.set(name, e);
    return e;
  }
  // render in idle time: in the synth worker when available, else a little per tick (pump)
  prewarm(names) {
    for (const n of names) {
      if (!SFX[n] || this.map.has(n) || this.pending.has(n) || this.queue.includes(n)) continue;
      if (this.pool?.ok && this.pool.run({ kind: 'sfx', name: n }, (res) => {
        this.pending.delete(n);
        if (res.ok && !this.map.has(n)) this._store(n, res.sr, res.data);
      })) { this.pending.add(n); continue; }
      this.queue.push(n);
    }
  }
  pump(budgetMs = 4) {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) this.get(this.queue.shift());
  }
  pick(e) {
    const n = e.list.length;
    let k = Math.floor(Math.random() * n);
    if (n > 1 && k === e.last) k = (k + 1) % n;
    e.last = k;
    return e.list[k];
  }
}
