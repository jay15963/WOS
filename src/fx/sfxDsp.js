// Offline DSP toolkit: sounds are rendered sample by sample into mono Float32Arrays, then cached as
// AudioBuffers (so playing one costs a single buffer source). Shared by the SFX bank and the music
// instruments. Everything here is original synthesis (noise, filters, modal resonators, Karplus-Strong,
// FM, formant voices) — no recorded material.

const TAU = Math.PI * 2;
const LN1000 = 6.907755; // ln(1000): -60 dB

// ---------- randomness ----------
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const buf = (sr, sec) => new Float32Array(Math.max(1, Math.ceil(sr * sec)));

// ---------- noise ----------
export function white(n, r) {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  return d;
}
export function pink(n, r) {
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return d;
}
export function brown(n, r) {
  const d = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return d;
}
export function noise(color, n, r) { return color === 'pink' ? pink(n, r) : color === 'brown' ? brown(n, r) : white(n, r); }

// ---------- filters (in place) ----------
// RBJ biquad. type: lp | hp | bp (0 dB peak) | peak | ls | hs. `f` is Hz or a function(u 0..1) -> Hz
// (coefficients refreshed every 16 samples). Works on [i0, i1).
export function biquad(d, sr, type, f, q = 0.707, gainDb = 0, i0 = 0, i1 = d.length) {
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const A = Math.pow(10, gainDb / 40);
  const coef = (fc) => {
    const w = (TAU * clamp(fc, 10, sr * 0.45)) / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let B0, B1, B2, A0, A1, A2;
    if (type === 'lp') { B0 = (1 - cw) / 2; B1 = 1 - cw; B2 = B0; A0 = 1 + al; A1 = -2 * cw; A2 = 1 - al; }
    else if (type === 'hp') { B0 = (1 + cw) / 2; B1 = -(1 + cw); B2 = B0; A0 = 1 + al; A1 = -2 * cw; A2 = 1 - al; }
    else if (type === 'bp') { B0 = al; B1 = 0; B2 = -al; A0 = 1 + al; A1 = -2 * cw; A2 = 1 - al; }
    else if (type === 'peak') { B0 = 1 + al * A; B1 = -2 * cw; B2 = 1 - al * A; A0 = 1 + al / A; A1 = -2 * cw; A2 = 1 - al / A; }
    else {
      const sA = 2 * Math.sqrt(A) * al, s = type === 'ls' ? 1 : -1;
      B0 = A * ((A + 1) - s * (A - 1) * cw + sA); B1 = 2 * s * A * ((A - 1) - s * (A + 1) * cw); B2 = A * ((A + 1) - s * (A - 1) * cw - sA);
      A0 = (A + 1) + s * (A - 1) * cw + sA; A1 = -2 * s * ((A - 1) + s * (A + 1) * cw); A2 = (A + 1) + s * (A - 1) * cw - sA;
    }
    b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
  };
  const dyn = typeof f === 'function';
  const n = i1 - i0;
  coef(dyn ? f(0) : f);
  for (let i = i0; i < i1; i++) {
    if (dyn && ((i - i0) & 15) === 0) coef(f((i - i0) / n));
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[i] = y;
  }
  return d;
}
export function onePole(d, sr, f, hp = false) {
  const k = 1 - Math.exp((-TAU * f) / sr);
  let y = 0;
  for (let i = 0; i < d.length; i++) { y += k * (d[i] - y); d[i] = hp ? d[i] - y : y; }
  return d;
}
export function dcBlock(d) {
  let x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i], y = x - x1 + 0.997 * y1; x1 = x; y1 = y; d[i] = y; }
  return d;
}

// ---------- levels / shaping ----------
export function peakOf(d) { let p = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } return p; }
export function normalize(d, peak = 1) {
  const p = peakOf(d);
  if (p > 1e-9) { const k = peak / p; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return d;
}
export function fadeIO(d, sr, inMs = 1, outMs = 6) {
  const a = Math.min(d.length, Math.ceil((inMs / 1000) * sr)), b = Math.min(d.length, Math.ceil((outMs / 1000) * sr));
  for (let i = 0; i < a; i++) d[i] *= i / a;
  for (let i = 0; i < b; i++) d[d.length - 1 - i] *= i / b;
  return d;
}
export function softClip(d, drive = 1.5) {
  const k = Math.tanh(drive);
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * drive) / k;
  return d;
}
export function mix(dst, src, i0 = 0, gain = 1) {
  const n = Math.min(src.length, dst.length - i0);
  for (let i = 0; i < n; i++) dst[i0 + i] += src[i] * gain;
  return dst;
}
// trim trailing near-silence (keeps a short fade) — saves memory for long-tail renders
export function trim(d, sr, floor = 0.0006) {
  let e = d.length - 1;
  while (e > 0 && Math.abs(d[e]) < floor) e--;
  const n = Math.min(d.length, e + Math.ceil(sr * 0.01));
  const out = n < d.length ? d.slice(0, n) : d;
  return fadeIO(out, sr, 0, 6);
}

// attack (linear) then exponential decay reaching -60 dB `dec` s after the attack
export const adEnv = (t, a, dec) => (t < a ? t / a : Math.exp((-LN1000 * (t - a)) / dec));

// ---------- generators (add into d) ----------
// shaped noise burst: { color, type, f, f1 (sweep end), q, type2, f2, q2, a (attack s), amp, grain (0..1),
// grainRate (/s), grainMs, shape: 'exp'|'bell'|'swell' }
export function burst(d, sr, t0, dur, o) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(d.length - i0, Math.ceil(dur * sr));
  if (n <= 0) return d;
  const r = o.r;
  const x = noise(o.color || 'white', n, r);
  if (o.type) biquad(x, sr, o.type, o.f1 ? (u) => o.f * Math.pow(o.f1 / o.f, u) : o.f, o.q ?? 0.7);
  if (o.type2) biquad(x, sr, o.type2, o.f2, o.q2 ?? 0.7);
  normalize(x, 1);
  const a = o.a ?? 0.003, A = o.amp ?? 1, shape = o.shape || 'exp';
  let g = 1;
  const gd = o.grain ? Math.exp(-1 / ((o.grainMs ?? 2.5) * 0.001 * sr)) : 0, gp = o.grain ? (o.grainRate ?? 400) / sr : 0;
  const na = Math.max(1, Math.floor(a * sr)), kd = Math.exp(-LN1000 / (Math.max(0.002, dur - a) * sr));
  let ed = 1;
  const pw = o.pow ?? 2;
  for (let i = 0; i < n; i++) {
    let e;
    if (shape === 'bell') e = Math.pow(Math.sin((Math.PI * i) / n), pw);
    else if (shape === 'swell') { const u = i / n; e = Math.pow(u, pw) * (u > 0.92 ? (1 - u) / 0.08 : 1); }
    else if (i < na) e = i / na;
    else { e = ed; ed *= kd; }
    if (o.grain) { if (r() < gp) g = 0.35 + r() * 0.9; else g *= gd; e *= 1 - o.grain + o.grain * g; }
    d[i0 + i] += x[i] * e * A;
  }
  return d;
}

// damped sinusoid (modal resonator): amp, freq, t60 (s) starting at t0 (s)
export function mode(d, sr, t0, f, amp, t60, ph = 0) {
  if (f <= 0 || f >= sr * 0.47 || amp === 0) return d;
  const i0 = Math.max(0, Math.floor(t0 * sr));
  const w = (TAU * f) / sr, r = Math.exp(-LN1000 / (t60 * sr)), c = 2 * r * Math.cos(w), r2 = r * r;
  const n = Math.min(d.length - i0, Math.ceil(t60 * sr * 1.02));
  if (n <= 0) return d;
  let y2 = amp * Math.sin(ph), y1 = amp * r * Math.sin(w + ph);
  d[i0] += y2;
  if (n > 1) d[i0 + 1] += y1;
  for (let i = 2; i < n; i++) { const y = c * y1 - r2 * y2; d[i0 + i] += y; y2 = y1; y1 = y; }
  return d;
}
// a struck object: list of [ratio, amp, t60] around f0, with a soft mallet (short attack ramp)
export function modal(d, sr, t0, f0, modes, amp = 1, { soft = 0.0015, r = Math.random, spread = 0.015 } = {}) {
  const tmp = new Float32Array(Math.min(d.length, Math.ceil(sr * (Math.max(...modes.map((m) => m[2])) * 1.02 + t0)) + 2));
  for (const [ratio, a, t60] of modes) mode(tmp, sr, t0, f0 * ratio * (1 + (r() - 0.5) * spread), a, t60);
  const i0 = Math.floor(t0 * sr), s = Math.max(1, Math.floor(soft * sr));
  for (let i = 0; i < s && i0 + i < tmp.length; i++) tmp[i0 + i] *= i / s;
  return mix(d, tmp, 0, amp);
}

// tone with exponential glide f0 -> f1, envelope fn(u 0..1, t) or {a, dec}; wave: sine | tri | saw (soft)
export function tone(d, sr, t0, dur, f0, f1, amp, env = null, wave = 'sine', vib = null) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(d.length - i0, Math.ceil(dur * sr));
  if (n <= 0) return d;
  let ph = 0, f = f0;
  const fk = Math.pow(f1 / f0, 1 / n);
  const fn = typeof env === 'function' ? env : null;
  const na = env && !fn ? Math.max(1, Math.floor(env.a * sr)) : 0, kd = env && !fn ? Math.exp(-LN1000 / (env.dec * sr)) : 1;
  let ed = 1;
  const vw = vib ? (TAU * vib.rate) / sr : 0, vd = vib ? Math.max(1, (vib.delay || 0.001) * n) : 1;
  for (let i = 0; i < n; i++) {
    let fr = f;
    f *= fk;
    if (vib) fr *= 1 + vib.depth * Math.sin(vw * i) * Math.min(1, i / vd);
    ph += (TAU * fr) / sr;
    if (ph > TAU) ph -= TAU;
    let s;
    if (wave === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
    else if (wave === 'saw') s = Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph) + 0.12 * Math.sin(4 * ph);
    else s = Math.sin(ph);
    let e = 1;
    if (fn) e = fn(i / n, i / sr);
    else if (env) { if (i < na) e = i / na; else { e = ed; ed *= kd; } }
    d[i0 + i] += s * e * amp;
  }
  return d;
}

// voiced source: band-limited sawtooth (polyBLEP) tilted by a one-pole lowpass + breath noise, then formant
// filters. f(u) -> Hz, env(u) -> 0..1. formants: [[freq, q, gain], ...]. rough: random period jitter (growl).
export function voiced(d, sr, t0, dur, f, env, { formants = [[600, 4, 1], [1200, 5, 0.5]], tilt = 1.1, noise: nz = 0.08, rough = 0, am = 0, amRate = 30, r = Math.random } = {}) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(d.length - i0, Math.ceil(dur * sr));
  if (n <= 0) return d;
  const src = new Float32Array(n);
  let ph = 0, jit = 0, amPh = 0, lp = 0, fr = f(0), e = env(0);
  const tl = clamp(tilt, 0.3, 2.5);
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      const u = i / n;
      fr = f(u); e = env(u);
      if (rough && (i & 63) === 0) jit = (r() - 0.5) * rough;
    }
    const dt = (fr * (1 + jit)) / sr;
    ph += dt;
    if (ph >= 1) ph -= 1;
    let s = 2 * ph - 1;
    if (ph < dt) { const t = ph / dt; s -= t + t - t * t - 1; } else if (ph > 1 - dt) { const t = (ph - 1) / dt; s -= t * t + t + t + 1; }
    const k = clamp(((fr * 4) / (tl * tl * sr)) * TAU, 0.002, 1);
    lp += k * (s - lp);
    s = tl > 1 ? lp * (1 + tl) : s * (1 - tl) + lp * tl * 1.5;
    s += (r() * 2 - 1) * nz * 2;
    if (am) { amPh += (TAU * amRate * (1 + (r() - 0.5) * 0.3)) / sr; s *= 1 - am * (0.5 + 0.5 * Math.sin(amPh)); }
    src[i] = s * e;
  }
  const out = new Float32Array(n);
  for (const [ff, q, g] of formants) {
    const c = src.slice();
    biquad(c, sr, 'bp', ff, q);
    for (let i = 0; i < n; i++) out[i] += c[i] * g;
  }
  normalize(out, 1);
  return mix(d, out, i0, 1);
}

// Karplus-Strong plucked string with fractional-delay tuning. o: { t60, bright 0..1, pos 0..0.5, amp, r }
export function ks(d, sr, t0, dur, f, o = {}) {
  const r = o.r || Math.random;
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(d.length - i0, Math.ceil(dur * sr));
  if (n <= 0 || f <= 0) return d;
  const P = sr / f;
  let L = Math.floor(P - 0.5), frac = P - 0.5 - L;
  if (frac < 0.15) { frac += 1; L -= 1; }
  L = Math.max(2, L);
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(L);
  // excitation: lowpassed noise, then a pluck-position comb, zero mean
  const bright = clamp(o.bright ?? 0.6, 0.02, 1);
  const k = 1 - Math.exp((-TAU * (300 + bright * bright * 9000)) / sr);
  let y = 0;
  for (let i = 0; i < L; i++) { y += k * (r() * 2 - 1 - y); line[i] = y; }
  const pk = Math.max(1, Math.round((o.pos ?? 0.14) * L));
  const ex = line.slice();
  for (let i = 0; i < L; i++) line[i] = ex[i] - 0.9 * ex[(i - pk + L) % L];
  let mean = 0;
  for (let i = 0; i < L; i++) mean += line[i];
  mean /= L;
  let pk2 = 0;
  for (let i = 0; i < L; i++) { line[i] -= mean; pk2 = Math.max(pk2, Math.abs(line[i])); }
  if (pk2 > 0) for (let i = 0; i < L; i++) line[i] /= pk2;
  const t60 = o.t60 ?? 2;
  const rho = Math.pow(10, -3 / (Math.max(0.05, t60) * f));
  const S = clamp(o.damp ?? 0.5, 0.05, 0.5);
  let idx = 0, prev = 0, ax = 0, ay = 0;
  const A = o.amp ?? 1;
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = line[idx];
    const lp = ((1 - S) * x + S * prev) * rho;
    prev = x;
    const out = C * lp + ax - C * ay;
    ax = lp; ay = out;
    line[idx] = out;
    tmp[i] = x;
    if (++idx >= L) idx = 0;
  }
  dcBlock(tmp);
  return mix(d, tmp, i0, A);
}

// AudioBuffer from mono data (sr may differ from the context: playback resamples)
export function toBuffer(ctx, d, sr) {
  const b = ctx.createBuffer(1, d.length, sr);
  if (b.copyToChannel) b.copyToChannel(d, 0); else b.getChannelData(0).set(d);
  return b;
}
export function toBuffer2(ctx, L, R, sr) {
  const b = ctx.createBuffer(2, L.length, sr);
  b.getChannelData(0).set(L); b.getChannelData(1).set(R);
  return b;
}

// ---------- analysis (tests) ----------
export function analyze(buffer) {
  let peak = 0, sum = 0, n = 0, nan = 0, dc = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v; dc += v; n++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -200);
  return { peak: +peak.toFixed(4), peakDb: +db(peak).toFixed(1), rmsDb: +db(rms).toFixed(1), nan, dc: +(dc / Math.max(1, n)).toFixed(5), sec: +(buffer.length / buffer.sampleRate).toFixed(2) };
}
