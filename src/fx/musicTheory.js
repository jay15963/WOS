// Music theory for the generative score: modes, diatonic chords, Markov progressions with cadences,
// voice leading (smallest total movement between voicings), motif-based melodies, arpeggio figures.
// Pitches are MIDI numbers; "semis" are semitones above the tonic.

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const MAJORISH = new Set(['ionian', 'mixolydian']);
// degrees whose triad is not diminished / augmented in that mode
const ALLOWED = {
  ionian: [0, 1, 2, 3, 4, 5], mixolydian: [0, 1, 3, 4, 5, 6], dorian: [0, 1, 2, 3, 4, 6],
  aeolian: [0, 2, 3, 4, 5, 6], phrygian: [0, 1, 2, 3, 5, 6], harmonic: [0, 3, 4, 5],
};
// weighted transitions between scale degrees (0 = tonic)
const MAJOR_T = {
  0: [[3, 3], [5, 3], [4, 2], [1, 1.5], [2, 0.5]], 1: [[4, 3], [3, 1], [5, 1]], 2: [[5, 2], [3, 2], [1, 1]],
  3: [[0, 3], [4, 2.5], [1, 1.5], [5, 1]], 4: [[0, 4], [5, 2], [3, 1]], 5: [[3, 3], [1, 2], [4, 1.5], [2, 0.6]], 6: [[0, 2], [2, 1]],
};
const MINOR_T = {
  0: [[5, 3], [3, 2.5], [6, 2.5], [2, 1.2], [4, 1], [1, 0.6]], 1: [[4, 2], [6, 1], [0, 1.5]], 2: [[5, 2], [6, 2], [3, 1.5]],
  3: [[0, 2.5], [6, 2], [4, 1.5], [2, 1]], 4: [[0, 3], [5, 1.5], [3, 1]], 5: [[6, 3], [2, 2], [3, 1.5], [0, 1]], 6: [[0, 3], [2, 2.5], [5, 1]],
};

export function pickW(list, r) {
  let s = 0;
  for (const e of list) s += e[1];
  let x = r() * s;
  for (const e of list) { x -= e[1]; if (x <= 0) return e[0]; }
  return list[list.length - 1][0];
}
export const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
export const rr = (a, b, r) => a + (b - a) * r();

// chord on a scale degree: stacked thirds. ext: '' | '7' | '9' | 'add9' | 'sus2' | 'sus4' | '6' | '5' (power)
export function chordSemis(mode, deg, ext = '') {
  const S = MODES[mode] || MODES.ionian;
  const pc = (k) => S[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
  const n = [pc(0), pc(2), pc(4)];
  if (ext === 'sus2') n[1] = pc(1);
  else if (ext === 'sus4') n[1] = pc(3);
  else if (ext === '5') n.splice(1, 1);
  if (ext === '7') n.push(pc(6));
  if (ext === '9') n.push(pc(6), pc(8));
  if (ext === 'add9') n.push(pc(8));
  if (ext === '6') n.push(pc(5));
  return n;
}

export function progression(mode, bars, r, { start = 0, cadence = 'full' } = {}) {
  const T = MAJORISH.has(mode) ? MAJOR_T : MINOR_T;
  const ok = ALLOWED[mode] || [0, 1, 2, 3, 4, 5, 6];
  const out = [start];
  for (let b = 1; b < bars; b++) {
    const prev = out[b - 1];
    let opts = (T[prev] || [[0, 1]]).filter(([d]) => ok.includes(d) && d !== prev);
    if (b === bars - 1) {
      if (cadence === 'full') opts = [[0, 1]];
      else if (cadence === 'half') opts = [[4, 2], [3, 1.5], [6, 1.5], [5, 1]].filter(([d]) => ok.includes(d) && d !== prev);
    } else if (b === bars - 2 && cadence === 'full') {
      opts = [[4, 2.5], [3, 2], [6, 1.2], [1, 0.8]].filter(([d]) => ok.includes(d) && d !== prev);
    }
    if (!opts.length) opts = [[prev === 0 ? 3 : 0, 1]].filter(([d]) => ok.includes(d));
    if (!opts.length) opts = [[0, 1]];
    out.push(pickW(opts, r));
  }
  return out;
}

const combos = (arr, k, start = 0, cur = [], out = []) => {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
};

// n-note voicing of `semis` over `tonic` within [lo, hi] that moves least from `prev` (sorted MIDI list)
export function voiceChord(semis, tonic, prev, { lo = 52, hi = 76, n = 4, center = 63 } = {}) {
  const pcs = [...new Set(semis.map((s) => (((tonic + s) % 12) + 12) % 12))];
  const rootPc = pcs[0], thirdPc = pcs[1];
  const pool = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) pool.push(m);
  const k = Math.min(n, pool.length);
  let best = null, bc = Infinity;
  for (const c of combos(pool, k)) {
    const set = new Set(c.map((m) => m % 12));
    if (!set.has(rootPc) || (pcs.length > 1 && !set.has(thirdPc))) continue;
    let cost = 0;
    for (let i = 1; i < c.length; i++) {
      const iv = c[i] - c[i - 1];
      if (iv < 2) cost += 6;            // no minor seconds
      if (c[i - 1] < 57 && iv < 3) cost += 3; // muddy low clusters
      if (iv > 9) cost += (iv - 9) * 0.6; // big holes
    }
    cost += (pcs.length - set.size) * 1.5;   // prefer every chord tone present
    const mean = c.reduce((a, b) => a + b, 0) / c.length;
    cost += Math.abs(mean - center) * 0.12;
    if (prev && prev.length) {
      for (let i = 0; i < c.length; i++) cost += Math.abs(c[i] - prev[Math.min(i, prev.length - 1)]) * 0.5;
    }
    if (cost < bc) { bc = cost; best = c; }
  }
  return best || pool.slice(0, k);
}

export function scaleNotes(tonic, mode, lo, hi) {
  const S = MODES[mode] || MODES.ionian, out = [];
  for (let m = lo; m <= hi; m++) if (S.includes((((m - tonic) % 12) + 12) % 12)) out.push(m);
  return out;
}
const nearestIdx = (arr, m) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - m); if (d < bd) { bd = d; bi = i; } }
  return bi;
};

// Motif-based melody over one phrase. chords: [{ semis }] per bar. cells: rhythm cells (beats; negative =
// rest) per bar. Returns { notes: [{ beat, dur, midi, vel }], motif } — pass `motif` back to repeat it.
export function melody({ chords, tonic, mode, beats = 4, range = [64, 84], cells, endCell, r, motif = null, reuse = 0.6, end = 'tonic', arc = 3, density = 1 }) {
  const sc = scaleNotes(tonic, mode, range[0] - 2, range[1] + 2);
  const notes = [];
  const center = (range[0] + range[1]) / 2;
  let ci = nearestIdx(sc, motif?.start ?? center);
  const steps = [], cellsUsed = [];
  const bars = chords.length;
  let j = 0, prevStep = 0;
  for (let b = 0; b < bars; b++) {
    const pcs = chords[b].semis.map((s) => (((tonic + s) % 12) + 12) % 12);
    const isTone = (m) => pcs.includes(((m % 12) + 12) % 12);
    let cell;
    if (b === bars - 1 && endCell) cell = endCell;
    else if (motif && b < 2 && r() < reuse + 0.3) cell = motif.cells[b];
    else if (motif && b === 2 && r() < reuse) cell = motif.cells[0];
    else cell = pick(cells, r);
    cellsUsed.push(cell);
    let pos = 0;
    for (let k = 0; k < cell.length; k++) {
      const dur = cell[k];
      if (dur < 0 || (density < 1 && r() > density && k > 0 && b < bars - 1)) { pos += Math.abs(dur); continue; }
      const u = (b * beats + pos) / (bars * beats);
      const strong = pos % 2 === 0 || dur >= 1.5;
      const target = nearestIdx(sc, center + arc * Math.sin(Math.PI * u) - arc * 0.3);
      let next;
      const last = b === bars - 1 && k === cell.length - 1;
      if (last) {
        const want = end === 'tonic' ? [tonic % 12] : pcs.slice(0, 2);
        let bi = ci, bd = Infinity;
        for (let i = Math.max(0, ci - 5); i <= Math.min(sc.length - 1, ci + 5); i++) {
          if (!want.includes(sc[i] % 12)) continue;
          const d = Math.abs(i - ci) + Math.abs(i - target) * 0.3;
          if (d < bd) { bd = d; bi = i; }
        }
        next = bi;
      } else if (motif && motif.steps[j] != null && b < 3 && r() < reuse) {
        next = ci + motif.steps[j];
        if (strong && !isTone(sc[Math.max(0, Math.min(sc.length - 1, next))])) next += isTone(sc[Math.min(sc.length - 1, next + 1)] ?? 0) ? 1 : -1;
      } else if (strong) {
        const cand = [];
        for (let i = Math.max(0, ci - 4); i <= Math.min(sc.length - 1, ci + 4); i++) {
          if (!isTone(sc[i])) continue;
          const st = Math.abs(i - ci);
          cand.push([i, (st === 0 ? 0.7 : st <= 2 ? 2.2 : 0.8) / (1 + Math.abs(i - target) * 0.35)]);
        }
        next = cand.length ? pickW(cand, r) : ci;
      } else {
        const opts = [[-2, 0.5], [-1, 2], [1, 2], [2, 0.5], [0, 0.5]];
        const bias = Math.sign(target - ci);
        next = ci + pickW(opts.map(([s, w]) => [s, w * (Math.sign(s) === bias ? 1.4 : 1)]), r);
      }
      if (Math.abs(prevStep) >= 3 && !last) next = ci - Math.sign(prevStep); // gap fill after a leap
      next = Math.max(0, Math.min(sc.length - 1, next));
      while (sc[next] > range[1] && next > 0) next--;
      while (sc[next] < range[0] && next < sc.length - 1) next++;
      prevStep = next - ci;
      steps.push(prevStep);
      ci = next;
      const vel = 0.55 + (strong ? 0.12 : 0) + Math.sin(Math.PI * u) * 0.12 + (r() - 0.5) * 0.08;
      notes.push({ beat: b * beats + pos, dur: last ? Math.max(dur, 2) : dur, midi: sc[ci], vel });
      j++;
      pos += dur;
    }
  }
  return { notes, motif: motif || { cells: cellsUsed.slice(0, 2), steps, start: notes[0]?.midi ?? center } };
}

// arpeggio figure over a voicing (sorted MIDI). pattern: 'up' | 'updown' | 'broken' | 'travis' | 'wave'
export function arpeggio(voicing, beats, sub, pattern, r, { bass = null, vel = 0.5, startBeat = 0, len = 1.6 } = {}) {
  const v = voicing.slice().sort((a, b) => a - b), n = v.length, out = [];
  const steps = Math.round(beats * sub);
  const seqs = {
    up: (i) => v[i % n],
    updown: (i) => { const p = (n - 1) * 2 || 1, k = i % p; return v[k < n ? k : p - k]; },
    broken: (i) => v[[0, 2, 1, 3, 2, 1][i % 6] % n],
    wave: (i) => { const k = [0, 1, 2, 3, 2, 3, 1, 2][i % 8]; return v[k % n] + (i % 8 === 5 ? 12 : 0); },
    travis: (i) => (i % 2 === 0 ? (bass != null ? (i % 4 === 0 ? bass : bass + 7) : v[0]) : v[1 + ((i >> 1) % Math.max(1, n - 1))]),
  };
  const f = seqs[pattern] || seqs.up;
  for (let i = 0; i < steps; i++) {
    const accent = i % sub === 0 ? 0.1 : 0;
    out.push({ beat: startBeat + i / sub, dur: len, midi: f(i), vel: vel + accent + (r() - 0.5) * 0.1 });
  }
  return out;
}
