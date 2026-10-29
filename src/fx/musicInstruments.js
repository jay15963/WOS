// Instruments of the generative score (all synthesised, no samples).
// - Buffer instruments: each note is rendered once in JS (Karplus-Strong harp / nylon guitar / bass, FM
//   electric piano, additive celesta and bells, modal kalimba / marimba, membrane drums) and cached
//   (LRU by sample count) — playing a note is one AudioBufferSource.
// - Live instruments (sustained): pads, soft strings, breathy flute, choir and drones are built from a few
//   native oscillators (PeriodicWave) + filters per note, so their length is free and CPU stays low.

import { ks, modal, tone, burst, biquad, normalize, fadeIO, toBuffer, mulberry, hashStr, mtof, clamp, buf, dcBlock } from './sfxDsp.js';

const TAU = Math.PI * 2;

const tail = (d, sr, sec) => {
  const n = Math.min(d.length, Math.ceil(sec * sr));
  for (let i = 0; i < n; i++) d[d.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
  return d;
};

// ---------- buffer instruments: render(midi, r, variant) -> Float32Array ----------
export const BUF_INST = {
  harp: { gain: 0.42, wet: 'mid', render(m, r, v, sr) {
    const f = mtof(m);
    const dur = clamp(2.5 * Math.pow(262 / f, 0.35), 1.1, 2.6);
    const d = buf(sr, dur);
    ks(d, sr, 0, dur, f, { t60: clamp(3.4 * Math.pow(262 / f, 0.6), 0.8, 6), bright: 0.55, pos: 0.13, r });
    burst(d, sr, 0, 0.006, { r, type: 'bp', f: Math.min(f * 4, 9000), q: 2, amp: 0.05 });
    biquad(d, sr, 'peak', 300, 1, 2);
    biquad(d, sr, 'lp', 6500, 0.6);
    return tail(d, sr, 0.35);
  } },
  guitar: { gain: 0.46, wet: 'lo', render(m, r, v, sr) {
    const f = mtof(m);
    const dur = clamp(2.4 * Math.pow(196 / f, 0.3), 1.1, 2.6);
    const d = buf(sr, dur);
    ks(d, sr, 0, dur, f, { t60: clamp(2.4 * Math.pow(196 / f, 0.5), 0.7, 4), bright: 0.36, pos: 0.18, r });
    biquad(d, sr, 'peak', 105, 1.4, 5);
    biquad(d, sr, 'peak', 210, 1.2, 2.5);
    biquad(d, sr, 'peak', 2500, 0.8, -3);
    biquad(d, sr, 'lp', 4200, 0.6);
    return tail(d, sr, 0.3);
  } },
  pbass: { gain: 0.5, wet: 'lo', render(m, r, v, sr) {
    const f = mtof(m), d = buf(sr, 2.2);
    ks(d, sr, 0, 2.4, f, { t60: 2.2, bright: 0.14, pos: 0.25, r });
    tone(d, sr, 0, 2.3, f, f, 0.35, { a: 0.006, dec: 1.8 });
    biquad(d, sr, 'lp', 1100, 0.6);
    return tail(d, sr, 0.4);
  } },
  epiano: { gain: 0.36, wet: 'mid', render(m, r, v, sr) {
    const f = mtof(m);
    const dur = clamp(2.8 * Math.pow(262 / f, 0.3), 1.2, 3.0), tau = clamp(1.6 * Math.pow(262 / f, 0.5), 0.45, 3.6);
    const d = buf(sr, dur), n = d.length, tr = Math.min(14, 9000 / f);
    const w = (TAU * f) / sr;
    // per-sample decays as multipliers (no exp in the loop)
    const qa = Math.exp(-1 / (0.0025 * sr)), kD = Math.exp(-1 / (tau * sr)), kI = Math.exp(-1 / (0.35 * sr)), kT = Math.exp(-1 / (0.025 * sr)), k2 = Math.exp(-1 / (tau * 0.5 * sr));
    let a = 1, eD = 1, eI = 1, eT = 0.12, e2 = 0.08, pc = 0, pt = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      a *= qa; eD *= kD; eI *= kI; e2 *= k2;
      pc += w; p2 += w * 2;
      if (pc > TAU) pc -= TAU;
      if (p2 > TAU) p2 -= TAU;
      const mod = Math.sin(pc);
      let y = Math.sin(pc + (0.18 + 1.4 * eI) * mod) * (1 - a) * eD + Math.sin(p2 + 0.5 * mod) * e2;
      if (eT > 1e-4) { pt += w * tr; if (pt > TAU) pt -= TAU; y += Math.sin(pt) * eT; eT *= kT; }
      d[i] = y;
    }
    biquad(d, sr, 'lp', 7000, 0.6);
    return tail(d, sr, 0.3);
  } },
  celesta: { gain: 0.3, wet: 'hi', render(m, r, v, sr) {
    const f = mtof(m), T = clamp(2.0 * Math.pow(523 / f, 0.4), 0.6, 2.4);
    const d = buf(sr, T * 1.05);
    modal(d, sr, 0, f, [[1, 1, T], [2, 0.3, T * 0.45], [3, 0.1, T * 0.25], [4.07, 0.06, T * 0.18], [5.95, 0.04, 0.12]], 1, { r, soft: 0.001, spread: 0.002 });
    burst(d, sr, 0, 0.004, { r, type: 'bp', f: 3000, q: 1, amp: 0.04 });
    return tail(d, sr, 0.2);
  } },
  bell: { gain: 0.26, wet: 'hi', render(m, r, v, sr) {
    const f = mtof(m), T = clamp(3.4 * Math.pow(392 / f, 0.3), 1.4, 3.4);
    const d = buf(sr, T * 1.02);
    modal(d, sr, 0, f, [[0.5, 0.3, T * 1.3], [1, 1, T], [1.19, 0.35, T * 0.8], [1.5, 0.25, T * 0.6], [2, 0.3, T * 0.5], [2.52, 0.15, T * 0.4], [3.01, 0.12, T * 0.3], [4.17, 0.08, T * 0.2]], 1, { r, soft: 0.003, spread: 0.004 });
    return tail(d, sr, 0.4);
  } },
  kalimba: { gain: 0.34, wet: 'hi', render(m, r, v, sr) {
    const f = mtof(m), T = clamp(1.7 * Math.pow(392 / f, 0.4), 0.5, 2.4);
    const d = buf(sr, T * 1.05);
    modal(d, sr, 0, f, [[1, 1, T], [5.95, 0.16, T * 0.12], [10.8, 0.04, 0.04]], 1, { r, soft: 0.0015, spread: 0.002 });
    burst(d, sr, 0, 0.006, { r, type: 'lp', f: 1500, amp: 0.12 });
    return tail(d, sr, 0.2);
  } },
  marimba: { gain: 0.34, wet: 'mid', render(m, r, v, sr) {
    const f = mtof(m), T = clamp(1.3 * Math.pow(262 / f, 0.55), 0.35, 2.2);
    const d = buf(sr, T * 1.05);
    modal(d, sr, 0, f, [[1, 1, T], [3.99, 0.28, T * 0.25], [10.65, 0.06, T * 0.08]], 1, { r, soft: 0.002, spread: 0.002 });
    burst(d, sr, 0, 0.008, { r, type: 'lp', f: 2000, amp: 0.1 });
    return tail(d, sr, 0.2);
  } },
  spicc: { gain: 0.34, wet: 'mid', render(m, r, v, sr) {
    const f = mtof(m), d = buf(sr, 0.42), n = d.length;
    const H = Math.min(18, Math.floor(9000 / f));
    for (const det of [0.997, 1.003]) {
      for (let h = 1; h <= H; h++) {
        const w = (TAU * f * det * h) / sr, a = (1 / h) * Math.pow(0.9, h), ph0 = r() * TAU, k2 = 2 * Math.cos(w);
        let s0 = Math.sin(ph0), s1 = Math.sin(ph0 + w);
        for (let i = 0; i < n; i++) { d[i] += s0 * a; const s2 = k2 * s1 - s0; s0 = s1; s1 = s2; }
      }
    }
    const att = Math.floor(0.012 * sr), kd = Math.exp(-1 / (0.09 * sr));
    let e = 1;
    for (let i = 0; i < n; i++) { d[i] *= (i < att ? i / att : 1) * e; e *= kd; }
    burst(d, sr, 0, 0.03, { r, type: 'bp', f: Math.min(f * 6, 8000), q: 1, amp: 0.05 });
    biquad(d, sr, 'lp', Math.min(7000, f * 8), 0.6);
    return tail(d, sr, 0.05);
  } },
  // drums: `m` is the drum voice (0, 1, 2), the variant adds a second take
  taiko: { gain: 0.62, wet: 'mid', drum: true, render(m, r, v, sr) {
    const d = buf(sr, 1.6), f0 = [58, 82, 124][m % 3] * (1 + (r() - 0.5) * 0.04);
    const dec = m % 3 === 2 ? 0.6 : 1.3;
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      ph += (TAU * f0 * (1 + 1.2 * Math.exp(-t / 0.025))) / sr;
      d[i] += Math.sin(ph) * Math.exp((-6.9 * t) / dec);
    }
    modal(d, sr, 0.001, f0, [[1.59, 0.3, 0.45], [2.14, 0.18, 0.3], [2.3, 0.12, 0.25], [2.65, 0.08, 0.2]], 1, { r });
    burst(d, sr, 0, 0.025, { r, type: 'lp', f: 2500, a: 0.0005, amp: 0.45 });
    burst(d, sr, 0, 0.3, { r, color: 'pink', type: 'lp', f: 420, a: 0.002, amp: 0.3 });
    return tail(d, sr, 0.2);
  } },
  frame: { gain: 0.32, wet: 'mid', drum: true, render(m, r, v, sr) {
    const d = buf(sr, 0.6), k = m % 3;
    const f0 = [165, 230, 200][k], dec = [0.45, 0.15, 0.07][k];
    tone(d, sr, 0, dec * 1.3, f0 * 1.15, f0, 0.9, { a: 0.001, dec });
    if (k === 1) burst(d, sr, 0, 0.04, { r, type: 'bp', f: 2500, q: 0.9, a: 0.0005, amp: 0.6 });
    burst(d, sr, 0, 0.012, { r, type: 'lp', f: 3000, a: 0.0004, amp: 0.35 });
    return tail(d, sr, 0.05);
  } },
  shaker: { gain: 0.12, wet: 'lo', drum: true, render(m, r, v, sr) {
    const d = buf(sr, 0.12);
    burst(d, sr, 0, 0.07, { r, type: 'hp', f: 5500, a: 0.012, amp: 1 });
    burst(d, sr, 0.03, 0.05, { r, type: 'hp', f: 6500, a: 0.006, amp: 0.4 });
    return d;
  } },
  boom: { gain: 0.62, wet: 'mid', drum: true, render(m, r, v, sr) {
    const d = buf(sr, 2.6);
    tone(d, sr, 0, 2.5, 62, 32, 1, { a: 0.002, dec: 2.2 });
    burst(d, sr, 0, 1.5, { r, color: 'brown', type: 'lp', f: 220, a: 0.003, amp: 0.5 });
    burst(d, sr, 0, 0.04, { r, color: 'pink', type: 'lp', f: 2000, amp: 0.3 });
    return tail(d, sr, 0.4);
  } },
  swell: { gain: 0.22, wet: 'hi', drum: true, render(m, r, v, sr) {
    const d = buf(sr, 2.2);
    burst(d, sr, 0, 2.1, { r, type: 'hp', f: 4000, shape: 'swell', pow: 3, amp: 0.6 });
    burst(d, sr, 0, 2.1, { r, color: 'pink', type: 'bp', f: 1200, q: 0.8, shape: 'swell', pow: 2.5, amp: 0.4 });
    return d;
  } },
};

// one note, finished (DC-free, normalised, faded): pure function, also run by the synth worker
export function renderNote(inst, m, v, sr) {
  const def = BUF_INST[inst];
  if (!def) return null;
  const r = mulberry(hashStr(inst) ^ (m * 2654435761) ^ (v * 40503));
  const d = def.render(m, r, v, sr);
  dcBlock(d);
  normalize(d, 0.9);
  fadeIO(d, sr, 0.3, 3);
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) d[i] = 0;
  return d;
}

// ---------- note cache (LRU by sample count; renders in the synth worker when there is one) ----------
export class NoteBank {
  constructor(ctx, cap = 2.4e6, pool = null) {
    this.ctx = ctx;
    this.cap = cap;           // samples kept (≈ 4 bytes each)
    this.pool = pool;
    this.map = new Map();
    this.pending = new Set();
    this.total = 0;
    this.queue = [];
    this.renderMs = 0;
    this.renders = 0;
  }
  key(inst, m, v) { return inst + ':' + m + ':' + (v | 0); }
  get(inst, m, v = 0) {
    const k = this.key(inst, m, v);
    let e = this.map.get(k);
    if (!e) e = this._render(inst, m, v, k);
    if (e) e.last = performance.now();
    return e ? e.buf : null;
  }
  want(inst, m, v = 0) {
    const k = this.key(inst, m, v);
    if (this.map.has(k) || this.pending.has(k) || !BUF_INST[inst]) return;
    const sr = this.ctx.sampleRate;
    if (this.pool?.ok && this.pool.run({ kind: 'note', inst, m, v, sr }, (res) => {
      this.pending.delete(k);
      if (res.ok && !this.map.has(k)) this._store(k, res.data[0], sr);
    })) { this.pending.add(k); return; }
    if (!this.queue.some((q) => q[3] === k)) this.queue.push([inst, m, v, k]);
  }
  pump(budgetMs = 3) {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const [inst, m, v, k] = this.queue.shift();
      if (!this.map.has(k)) this._render(inst, m, v, k);
    }
  }
  _render(inst, m, v, k) {
    const t0 = performance.now();
    const sr = this.ctx.sampleRate;
    const d = renderNote(inst, m, v, sr);
    if (!d) return null;
    this.renderMs += performance.now() - t0;
    return this._store(k, d, sr);
  }
  _store(k, d, sr) {
    const e = { buf: toBuffer(this.ctx, d, sr), n: d.length, last: performance.now() };
    this.map.set(k, e);
    this.total += e.n;
    this.renders++;
    if (this.total > this.cap) this._evict();
    return e;
  }
  _evict() {
    const list = [...this.map.entries()].sort((a, b) => a[1].last - b[1].last);
    const now = performance.now();
    for (const [k, e] of list) {
      if (this.total <= this.cap * 0.8) break;
      if (now - e.last < 20000) continue; // may still be scheduled
      this.map.delete(k);
      this.total -= e.n;
    }
  }
}

// ---------- live instruments ----------
const WAVES = new WeakMap();
function wave(ctx, kind) {
  let W = WAVES.get(ctx);
  if (!W) { W = {}; WAVES.set(ctx, W); }
  if (W[kind]) return W[kind];
  const N = 32, re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    let a = 0;
    if (kind === 'warm') a = 1 / Math.pow(n, 1.45) * (n % 2 ? 1 : 0.8);
    else if (kind === 'saw') a = (1 / n) * Math.pow(0.94, n);
    else if (kind === 'flute') a = [0, 1, 0.18, 0.06, 0.025, 0.01][n] || 0;
    else if (kind === 'choir') a = 1 / Math.pow(n, 1.15);
    else if (kind === 'drone') a = [0, 1, 0.12, 0.3, 0.05, 0.1][n] || 0;
    im[n] = a;
  }
  W[kind] = ctx.createPeriodicWave(re, im);
  return W[kind];
}
const NOISE = new WeakMap();
function noiseBuf(ctx) {
  let b = NOISE.get(ctx);
  if (!b) {
    const sr = ctx.sampleRate, n = sr * 2, r = mulberry(99);
    b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    fadeIO(d, sr, 20, 20);
    NOISE.set(ctx, b);
  }
  return b;
}

// envelope helper: 0 -> peak (attack) -> hold until `end`, release (time constant rel/4)
function env(g, t, att, peak, end, rel) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + att);
  g.gain.setValueAtTime(peak, Math.max(t + att, end));
  g.gain.setTargetAtTime(0, Math.max(t + att, end), Math.max(0.02, rel / 4));
}

// LIVE[inst](ctx, t, dur (s), f (Hz), vel, out (node), lfo (vibrato OscillatorNode | null)) -> stop time
export const LIVE = {
  pad: { gain: 0.065, wet: 'hi', play(ctx, t, dur, f, vel, out, lfo, o = {}) {
    const att = o.att ?? 1.4, rel = o.rel ?? 2.4, end = t + Math.max(att, dur), stop = end + rel * 1.3;
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.value = Math.min(8000, f * (o.open ?? 3) + 500);
    env(g, t, att, vel, end, rel);
    const w = wave(ctx, 'warm');
    let first = null;
    for (const det of o.lowEnd ? [0] : [-6, 6]) {
      const os = ctx.createOscillator();
      os.setPeriodicWave(w); os.frequency.value = f; os.detune.value = det + (Math.random() - 0.5) * 3;
      os.connect(lp); os.start(t); os.stop(stop);
      first ||= os;
    }
    lp.connect(g); g.connect(out);
    return { stop, first, nodes: [lp, g] };
  } },
  strings: { gain: 0.045, wet: 'mid', play(ctx, t, dur, f, vel, out, lfo, o = {}) {
    const att = o.att ?? 0.45, rel = o.rel ?? 0.9, end = t + Math.max(att, dur), stop = end + rel * 1.3;
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.6;
    const bright = o.bright ?? 1;
    lp.frequency.value = Math.min(7500, (f * 4 + 900) * bright);
    env(g, t, att, vel, end, rel);
    let vg = null;
    if (lfo && o.vib && dur > 0.4) {
      vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(o.vib, t + Math.min(0.8, dur * 0.6));
      lfo.connect(vg);
    }
    const w = wave(ctx, 'saw');
    let first = null;
    for (const det of [-6, 5, 0]) {
      const os = ctx.createOscillator();
      os.setPeriodicWave(w); os.frequency.value = f; os.detune.value = det + (Math.random() - 0.5) * 3;
      if (vg) vg.connect(os.detune);
      os.connect(lp); os.start(t); os.stop(stop);
      first ||= os;
    }
    lp.connect(g); g.connect(out);
    return { stop, first, nodes: vg ? [lp, g, vg] : [lp, g], lfoTap: vg };
  } },
  flute: { gain: 0.15, wet: 'mid', play(ctx, t, dur, f, vel, out, lfo, o = {}) {
    const att = o.att ?? 0.075, rel = o.rel ?? 0.16, end = t + Math.max(att, dur), stop = end + rel * 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + att);
    g.gain.linearRampToValueAtTime(vel * 1.06, t + Math.max(att, dur) * 0.6);
    g.gain.setValueAtTime(vel * 1.06, Math.max(t + att, end));
    g.gain.setTargetAtTime(0, Math.max(t + att, end), rel / 4);
    const os = ctx.createOscillator();
    os.setPeriodicWave(wave(ctx, 'flute')); os.frequency.value = f;
    let vg = null;
    if (lfo && dur > 0.35) {
      vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(o.vib ?? 11, t + Math.min(0.7, dur * 0.7));
      lfo.connect(vg); vg.connect(os.detune);
    }
    os.connect(g);
    // breath: pink noise band around the note, plus a short "chiff" at the attack
    const nb = noiseBuf(ctx);
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.02; bp.Q.value = 5;
    const ng = ctx.createGain(); ng.gain.value = 0.9;
    ns.connect(bp); bp.connect(ng); ng.connect(g);
    const cg = ctx.createGain(), cbp = ctx.createBiquadFilter();
    cbp.type = 'bandpass'; cbp.frequency.value = Math.min(9000, f * 2.2); cbp.Q.value = 2;
    cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(vel * 1.4, t + 0.012); cg.gain.setTargetAtTime(0, t + 0.014, 0.02);
    ns.connect(cbp); cbp.connect(cg); cg.connect(out);
    g.connect(out);
    ns.start(t, Math.random() * 1.5); ns.stop(stop);
    os.start(t); os.stop(stop);
    return { stop, first: os, nodes: vg ? [g, bp, ng, cg, cbp, ns, vg] : [g, bp, ng, cg, cbp, ns], lfoTap: vg };
  } },
  choir: { gain: 0.06, wet: 'hi', play(ctx, t, dur, f, vel, out, lfo, o = {}) {
    const att = o.att ?? 1.6, rel = o.rel ?? 2.2, end = t + Math.max(att, dur), stop = end + rel * 1.3;
    const g = ctx.createGain();
    env(g, t, att, vel, end, rel);
    const [F1, F2] = o.vowel === 'ah' ? [720, 1150] : [380, 760];
    const b1 = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter();
    b1.type = b2.type = 'bandpass'; b1.frequency.value = F1; b1.Q.value = 3; b2.frequency.value = F2; b2.Q.value = 5;
    const g2 = ctx.createGain(); g2.gain.value = 0.55;
    const w = wave(ctx, 'choir');
    let first = null;
    for (const det of [-9, 8]) {
      const os = ctx.createOscillator();
      os.setPeriodicWave(w); os.frequency.value = f; os.detune.value = det;
      os.connect(b1); os.connect(b2); os.start(t); os.stop(stop);
      first ||= os;
    }
    b2.connect(g2); b1.connect(g); g2.connect(g); g.connect(out);
    return { stop, first, nodes: [b1, b2, g2, g] };
  } },
  drone: { gain: 0.07, wet: 'hi', play(ctx, t, dur, f, vel, out, lfo, o = {}) {
    const att = o.att ?? 3, rel = o.rel ?? 3, end = t + Math.max(att, dur), stop = end + rel * 1.3;
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(2000, f * 6); lp.Q.value = 0.5;
    env(g, t, att, vel, end, rel);
    const w = wave(ctx, 'drone');
    let first = null;
    for (const [mul, det] of [[1, -4], [1, 4], [1.5, 0]]) {
      const os = ctx.createOscillator();
      os.setPeriodicWave(w); os.frequency.value = f * mul; os.detune.value = det;
      os.connect(lp); os.start(t); os.stop(stop);
      first ||= os;
    }
    lp.connect(g); g.connect(out);
    return { stop, first, nodes: [lp, g] };
  } },
};

export const instWet = (inst) => (BUF_INST[inst] || LIVE[inst])?.wet || 'mid';
export const instGain = (inst) => (BUF_INST[inst] || LIVE[inst])?.gain ?? 0.3;
export { mtof };
