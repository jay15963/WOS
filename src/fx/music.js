// Generative, original music (written in code => free of copyright by construction).
//
// music.setMood('menu'|'day'|'night'|'dawn'|'rain'|'cave'|'danger'|'home')
// A *piece* = a few phrases (4 bars each) in one key / mode / tempo / arrangement, generated just in time
// (Markov harmony with cadences, voice-led chords, motif-based melodies, arpeggios, humanised timing and
// velocity), then a long silence (Minecraft-like; music.setGap('cont'|'short'|'normal'|'long')).
// 'danger' starts within ~0.2 s with drums and loops while the threat lasts, then ends on a final hit.
// Calm mood changes let the current phrase finish; strong ones (cave, home, rain, menu) end the piece early.
// Scheduling: a 100 ms tick with 0.35 s lookahead; notes are AudioBufferSources (cached renders) or a few
// native oscillators; every node is disconnected when its note ends (stats.live stays bounded).

import { mulberry, clamp } from './sfxDsp.js';
import { chordSemis, progression, voiceChord, melody, arpeggio, pick, pickW, rr } from './musicTheory.js';
import { BUF_INST, LIVE, NoteBank, instWet, instGain, mtof } from './musicInstruments.js';

export const MOODS = ['menu', 'day', 'night', 'dawn', 'rain', 'cave', 'danger', 'home'];
export const GAPS = { cont: [2, 6], short: [15, 35], normal: [45, 110], long: [150, 300] };
const STRONG = new Set(['cave', 'home', 'rain', 'menu']);
const LOOK = 0.35;
const genAhead = (p) => (p.S.gen === 'danger' ? 1.6 : 5);

// rhythm cells (beats; negative = rest)
const FLOW = [[1, 1, 2], [2, 1, 1], [1.5, 0.5, 2], [1, 0.5, 0.5, 2], [3, 1], [2, 2], [-1, 1, 2], [0.5, 0.5, 1, 2], [-2, 1, 1]];
const CALM = [[2, 2], [3, 1], [-1, 3], [4], [-2, 2], [1, 3], [2, -2], [-1, 1.5, 1.5]];
const ENDS = [[2, 2], [1, 3], [-1, 3], [4], [3, -1]];
const DRIVE = [[2, 1, 1], [1.5, 0.5, 2], [3, 1], [1, 1, 2]];

// moods: key centres (MIDI tonic), modes [name, weight], tempo, phrases per piece, chord colours and
// a few arrangements (instrument roles)
const SPECS = {
  menu: { keys: [62], modes: [['ionian', 1]], bpm: [66, 70], phrases: [6, 8], gap: [5, 10], theme: true,
    ext: { 0: ['add9', ''], 3: ['7', 'add9'], 5: ['7', ''], 4: ['sus4', ''], 1: ['7'] },
    arr: [{ pad: 'strings', padVel: 0.5, arp: 'harp', arpPat: 'wave', arpSub: 2, arpVel: 0.48, mel: 'flute', melRange: [69, 88], cells: FLOW, melP: 0.9, bass: 'pbass', sparkle: 'celesta', sparkP: 0.35 }] },
  day: { keys: [60, 67, 62, 65], modes: [['ionian', 4], ['mixolydian', 1]], bpm: [72, 84], phrases: [4, 6],
    ext: { 0: ['add9', '', '7'], 3: ['7', 'add9', ''], 5: ['7', ''], 4: ['sus4', '', '7'], 1: ['7', ''] },
    arr: [
      { pad: 'pad', padVel: 0.45, arp: 'guitar', arpPat: 'travis', arpSub: 2, arpVel: 0.5, mel: 'flute', melRange: [67, 86], cells: FLOW, melP: 0.8, bass: 'pbass', bassP: 0.7, sparkle: 'celesta', sparkP: 0.15 },
      { pad: 'pad', padVel: 0.4, arp: 'harp', arpPat: 'updown', arpSub: 2, arpVel: 0.45, mel: 'kalimba', melRange: [69, 88], cells: FLOW, melP: 0.75, bass: 'pbass', hits: 'epiano', hitPat: [0, 2.5], hitVel: 0.3 },
      { pad: 'strings', padVel: 0.42, arp: 'epiano', arpPat: 'broken', arpSub: 2, arpVel: 0.4, mel: 'flute', melRange: [67, 84], cells: FLOW, melP: 0.8, bass: 'pbass', bassP: 0.8 },
    ] },
  dawn: { keys: [67, 62, 69], modes: [['ionian', 1]], bpm: [58, 64], phrases: [3, 5],
    ext: { 0: ['add9', 'sus2'], 3: ['add9', '7'], 4: ['sus4', 'sus2'], 5: ['7', 'add9'], 1: ['7', 'sus4'] },
    arr: [
      { pad: 'pad', padVel: 0.5, arp: 'harp', arpPat: 'up', arpSub: 1, arpVel: 0.42, mel: 'flute', melRange: [71, 88], cells: CALM, melP: 0.6, grace: 0.3, sparkle: 'bell', sparkP: 0.15 },
      { pad: 'strings', padVel: 0.45, arp: 'kalimba', arpPat: 'wave', arpSub: 1, arpVel: 0.4, mel: 'celesta', melRange: [72, 91], cells: CALM, melP: 0.6 },
    ] },
  night: { keys: [57, 64, 62, 59], modes: [['dorian', 3], ['aeolian', 2]], bpm: [52, 60], phrases: [3, 5],
    ext: { 0: ['7', '9', 'add9'], 3: ['7', ''], 5: ['7'], 6: ['', 'add9'], 2: ['7'], 4: ['7'] },
    arr: [
      { pad: 'choir', padVel: 0.45, hits: 'epiano', hitPat: [0, 2.5], hitVel: 0.34, mel: 'celesta', melRange: [72, 88], cells: CALM, melP: 0.6, bass: 'pbass', bassP: 0.6 },
      { pad: 'pad', padVel: 0.42, arp: 'epiano', arpPat: 'up', arpSub: 1, arpVel: 0.36, mel: 'flute', melRange: [64, 81], cells: CALM, melP: 0.55, bass: 'pbass', bassP: 0.5 },
    ] },
  rain: { keys: [64, 62, 59], modes: [['dorian', 2], ['aeolian', 2]], bpm: [60, 68], phrases: [4, 6],
    ext: { 0: ['7', '9'], 3: ['7', ''], 5: ['7', 'add9'], 6: ['', '6'], 2: ['7'], 4: ['7'] },
    arr: [
      { pad: 'strings', padVel: 0.42, hits: 'epiano', hitPat: [0, 1.5, 3], hitVel: 0.3, mel: 'epiano', melRange: [67, 84], cells: FLOW, melP: 0.7, bass: 'pbass' },
      { pad: 'pad', padVel: 0.42, arp: 'harp', arpPat: 'broken', arpSub: 2, arpVel: 0.38, mel: 'kalimba', melRange: [69, 86], cells: CALM, melP: 0.5, bass: 'pbass', bassP: 0.6 },
    ] },
  home: { keys: [65, 70, 63, 60], modes: [['ionian', 3], ['mixolydian', 1]], bpm: [62, 70], phrases: [4, 6],
    ext: { 0: ['', 'add9', '6'], 3: ['7', ''], 5: ['7', ''], 4: ['', '7'], 1: ['7'] },
    arr: [
      { pad: 'pad', padVel: 0.38, arp: 'guitar', arpPat: 'travis', arpSub: 2, arpVel: 0.5, mel: 'celesta', melRange: [72, 88], cells: CALM, melP: 0.7 },
      { pad: 'strings', padVel: 0.38, arp: 'guitar', arpPat: 'updown', arpSub: 2, arpVel: 0.48, mel: 'flute', melRange: [67, 84], cells: FLOW, melP: 0.7, bass: 'pbass', bassP: 0.5 },
    ] },
  cave: { keys: [61, 56, 63], modes: [['phrygian', 2], ['aeolian', 1]], bpm: [48, 54], phrases: [3, 5], gen: 'cave' },
  danger: { keys: [62, 64, 57], modes: [['harmonic', 2], ['phrygian', 1]], bpm: [104, 114], phrases: [9999, 9999], gen: 'danger', bars: 2 },
};

const gauss = (r) => (r() + r() + r() - 1.5) * 0.8;

export class Music {
  constructor(engine) {
    this.e = engine;
    this.mood = null;
    this.cur = null;
    this.fading = [];
    this.nextAt = 0;
    this.intensity = 0.6;    // danger layers (0..1), set by the audio director
    this.started = false;
    this.bank = null;
    this.stats = { pieces: 0, phrases: 0, notes: 0, live: 0, maxLive: 0, genMs: 0, schedMs: 0 };
    let g = 'normal';
    try { g = localStorage.getItem('wos.audio.musicGap') || 'normal'; } catch { /* ignore */ }
    this.gapMode = GAPS[g] ? g : 'normal';
  }
  get ctx() { return this.e.ctx; }
  now() { return this._simNow ?? this.ctx.currentTime; }

  setGap(mode) {
    if (!GAPS[mode]) return;
    this.gapMode = mode;
    try { localStorage.setItem('wos.audio.musicGap', mode); } catch { /* ignore */ }
    if (!this.cur && this.ctx) this.nextAt = Math.min(this.nextAt, this.now() + this._gap(this.mood));
  }
  _gap(mood) {
    const S = SPECS[mood];
    const [a, b] = S?.gap || GAPS[this.gapMode];
    return rr(a, b, Math.random);
  }

  // called once the AudioContext exists (unlock)
  begin(now) {
    if (this.started) return;
    this.started = true;
    this.bank = new NoteBank(this.ctx, this.e.lowEnd ? 1.4e6 : 2.4e6, this.e.pool || null);
    this.nextAt = now + (this.mood === 'menu' ? 0.5 : 4 + Math.random() * 4);
  }

  setMood(m) {
    if (!SPECS[m] || m === this.mood) return;
    const prev = this.mood;
    this.mood = m;
    if (!this.ctx || !this.started) return;
    const now = this.now(), p = this.cur;
    if (m === 'danger') {
      if (p && p.mood === 'danger' && !p.closed) { p.ending = false; return; }
      if (p && p.mood !== 'danger') this._fade(p, 1.2);
      this._start('danger', now + 0.12);
      return;
    }
    if (p && p.mood === 'danger') { if (!p.ending) { p.ending = true; p.nextGap = rr(14, 26, Math.random); this._truncate(p, now); } return; }
    if (p) {
      if (STRONG.has(m) || STRONG.has(p.mood)) { p.ending = true; p.nextGap = rr(3, 7, Math.random); this._truncate(p, now); }
      return;
    }
    // idle: strong changes bring the next piece closer; leaving the menu starts soon
    if (prev === 'menu') this.nextAt = Math.min(this.nextAt, now + rr(3, 6, Math.random));
    else if (STRONG.has(m)) this.nextAt = Math.min(this.nextAt, now + rr(6, 14, Math.random));
  }

  stopAll(fade = 1.5) {
    if (this.cur) this._fade(this.cur, fade);
    this.cur = null;
  }
  // silence for a while (player died…)
  rest(sec, fade = 3) {
    if (!this.ctx || !this.started) return;
    this.stopAll(fade);
    this.nextAt = Math.max(this.nextAt, this.now() + sec);
  }

  // offline rendering for tests: simulate the scheduler over `sec` seconds
  renderFor(mood, sec, step = 0.1) {
    this.mood = null;
    this.setMood(mood);
    this.nextAt = 0;
    for (let t = 0; t < sec; t += step) { this._simNow = t; this.tick(t); }
    this._simNow = undefined;
  }

  // ---------- scheduling ----------
  tick(now) {
    if (!this.started) return;
    const t0 = performance.now();
    const p = this.cur;
    if (p) {
      if (!p.ending && p.phrasesLeft > 0 && p.t0 - now < genAhead(p)) this._phrase(p);
      if (!p.ending && p.phrasesLeft <= 0) p.ending = true;
      if (p.ending && !p.closed && p.mood === 'danger' && p.t0 - now < genAhead(p)) this._dangerEnd(p);
      if (p.ending && !p.closed && p.mood !== 'danger') p.closed = true;
      while (p.queue.length && p.queue[0].t < now + LOOK) this._note(p, p.queue.shift());
      if (p.closed && !p.queue.length && now > p.t0) {
        this.cur = null;
        this.nextAt = p.t0 + 3 + (p.nextGap ?? this._gap(p.mood));
        p.deadAt = p.t0 + 9;
        this.fading.push(p);
      }
    } else if (this.mood && now >= this.nextAt && this.e.enabled) {
      this._start(this.mood, now + 1.0); // lead time: the synth worker renders the first notes
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const q = this.fading[i];
      if (now > q.deadAt) { this._dispose(q); this.fading.splice(i, 1); }
    }
    this.bank?.pump(this.cur && this.cur.t0 - now < 2 ? 6 : 3);
    this.stats.schedMs += performance.now() - t0;
  }

  _start(mood, at) {
    const ctx = this.ctx, S = SPECS[mood];
    const r = mulberry((Math.random() * 4294967296) >>> 0);
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.e.musicBus);
    const sends = {};
    for (const [k, v] of [['lo', 0.14], ['mid', 0.32], ['hi', 0.55]]) { const g = ctx.createGain(); g.gain.value = v; g.connect(this.e.musicSend); sends[k] = g; }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1 + Math.random() * 0.4;
    lfo.start(at);
    const modeName = pickW(S.modes, r);
    const p = {
      mood, S, r, out, sends, lfo, t0: at, queue: [], ending: false, closed: false,
      tonic: S.theme ? S.keys[0] : pick(S.keys, r), mode: modeName, bpm: rr(S.bpm[0], S.bpm[1], r), beats: 4, bars: S.bars || 4,
      phrasesLeft: Math.round(rr(S.phrases[0], S.phrases[1] + 0.99, r) - 0.49), idx: 0,
      arr: S.arr ? pick(S.arr, r) : null, st: { deg: 0, prevV: null, motif: null }, notes: new Set(), bounds: [], buses: {},
    };
    this.cur = p;
    this.stats.pieces++;
    this._phrase(p);
    return p;
  }

  _fade(p, sec) {
    const now = this.now();
    p.out.gain.cancelScheduledValues(now);
    p.out.gain.setValueAtTime(p.out.gain.value, now);
    p.out.gain.setTargetAtTime(0, now, sec / 4);
    for (const k in p.sends) { p.sends[k].gain.cancelScheduledValues(now); p.sends[k].gain.setTargetAtTime(0, now, sec / 3); }
    p.queue.length = 0;
    p.closed = true;
    p.deadAt = now + sec + 6;
    if (this.cur === p) this.cur = null;
    this.fading.push(p);
  }

  // drop phrases that have not started yet (the current one ends naturally)
  _truncate(p, now) {
    const b = p.bounds.find((x) => x > now + 0.05);
    if (b == null) return;
    p.queue = p.queue.filter((e) => e.t < b - 0.03);
    p.t0 = b;
    p.bounds = p.bounds.filter((x) => x < b);
  }

  _dispose(p) {
    for (const n of p.notes) this._release(p, n);
    p.notes.clear();
    try { p.lfo.stop(); } catch { /* ignore */ }
    try { p.lfo.disconnect(); p.out.disconnect(); for (const k in p.sends) p.sends[k].disconnect(); for (const k in p.buses) p.buses[k].disconnect(); } catch { /* ignore */ }
  }

  // one phrase -> absolute-time events in p.queue
  _phrase(p) {
    const t0 = performance.now();
    const r = p.r, last = p.phrasesLeft === 1;
    const gen = p.S.gen === 'cave' ? genCave : p.S.gen === 'danger' ? genDanger : genTonal;
    const { events, beats } = gen(p, r, this, last);
    const spb = 60 / p.bpm, barB = p.beats;
    const rit = last && p.S.gen !== 'danger' ? 0.22 : 0;
    const lastBar = beats - barB;
    const timeOf = (b) => {
      let t = b * spb;
      if (rit && b > lastBar) { const x = b - lastBar; t += (spb * rit * x * x) / (2 * barB); }
      return p.t0 + t;
    };
    for (const ev of events) {
      const human = p.S.gen === 'danger' ? 0.004 : 0.012;
      const t = Math.max(p.t0, timeOf(ev.b) + gauss(r) * human + (ev.off || 0));
      const dur = Math.max(0.05, timeOf(ev.b + ev.d) - timeOf(ev.b));
      p.queue.push({ t, inst: ev.inst, m: ev.m, v: clamp(ev.v * (1 + (r() - 0.5) * 0.12), 0.05, 1.2), dur, pan: ev.pan ?? 0, o: ev.o, vr: ev.vr | 0 });
      if (BUF_INST[ev.inst]) this.bank?.want(ev.inst, ev.m, ev.vr | 0);
    }
    p.queue.sort((a, b) => a.t - b.t);
    p.bounds.push(p.t0);
    if (p.bounds.length > 4) p.bounds.shift();
    p.t0 = timeOf(beats);
    p.phrasesLeft--;
    p.idx++;
    this.stats.phrases++;
    this.stats.genMs += performance.now() - t0;
  }

  _dangerEnd(p) {
    p.closed = true;
    const spb = 60 / p.bpm;
    const evs = [
      { b: 0, inst: 'taiko', m: 0, v: 1, d: 2 }, { b: 0, inst: 'boom', m: 0, v: 0.8, d: 3 },
      { b: 0.5, inst: 'taiko', m: 1, v: 0.6, d: 1 },
    ];
    const ch = voiceChord(chordSemis(p.mode, 0, ''), p.tonic, p.st.prevV, { lo: 50, hi: 70, n: 4 });
    for (const m of ch) evs.push({ b: 0, inst: 'strings', m, v: 0.4, d: 4, o: { att: 0.05, rel: 2.5 }, pan: (m % 5 - 2) * 0.15 });
    for (const ev of evs) p.queue.push({ t: p.t0 + ev.b * spb, inst: ev.inst, m: ev.m, v: ev.v, dur: ev.d * spb, pan: ev.pan || 0, o: ev.o, vr: 0 });
    p.queue.sort((a, b) => a.t - b.t);
    p.t0 += 4 * spb + 2;
  }

  // shared per-piece buses: 5 stereo positions x 3 reverb amounts (a note is just source -> gain -> bus)
  _bus(p, wet, pan) {
    const k = Math.round(clamp(pan, -1, 1) * 2.5) + 3;
    const key = wet + k;
    let b = p.buses[key];
    if (!b) {
      const ctx = this.ctx;
      b = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (b.pan) b.pan.value = (k - 3) / 2.5;
      b.connect(p.out);
      b.connect(p.sends[wet] || p.sends.mid);
      p.buses[key] = b;
    }
    return b;
  }

  _note(p, ev) {
    const ctx = this.ctx;
    const dest = this._bus(p, instWet(ev.inst), ev.pan);
    const f = mtof(ev.m);
    const loud = f > 440 ? Math.pow(440 / f, 0.18) : 1;
    const gain = instGain(ev.inst) * ev.v * loud;
    const n = { dest, src: null, nodes: null, lfoTap: null };
    if (BUF_INST[ev.inst]) {
      const b = this.bank.get(ev.inst, ev.m, ev.vr);
      if (!b) return;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b;
      g.gain.value = gain;
      src.connect(g); g.connect(dest);
      src.start(ev.t);
      n.src = src; n.nodes = [g];
      src.onended = () => this._release(p, n);
    } else if (LIVE[ev.inst]) {
      const L = LIVE[ev.inst].play(ctx, ev.t, ev.dur, f, gain, dest, p.lfo, this.e.lowEnd ? { ...ev.o, lowEnd: true } : ev.o || {});
      n.src = L.first; n.nodes = L.nodes; n.lfoTap = L.lfoTap || null;
      L.first.onended = () => this._release(p, n);
    } else return;
    p.notes.add(n);
    this.stats.notes++;
    this.stats.live++;
    if (this.stats.live > this.stats.maxLive) this.stats.maxLive = this.stats.live;
  }

  _release(p, n) {
    if (n.done) return;
    n.done = true;
    p.notes.delete(n);
    this.stats.live--;
    try {
      if (n.lfoTap) p.lfo.disconnect(n.lfoTap);
      for (const x of n.nodes || []) x.disconnect();
      n.src?.disconnect();
    } catch { /* already disconnected */ }
  }
}

// ---------- generators: (piece, rng, music, isLastPhrase) -> { events, beats } ----------
function extOf(S, deg, r) { const l = S.ext?.[deg]; return l ? pick(l, r) : ''; }

function genTonal(p, r, music, last) {
  const S = p.S, A = p.arr, beats = p.beats, bars = p.bars;
  const theme = S.theme && (p.idx === 0 || p.idx === 3);
  const tr = theme ? mulberry(0x5eed + (p.idx === 3 ? 7 : 0)) : r; // menu: the same opening every time
  const cadence = last ? 'full' : p.idx === 0 ? 'open' : pick(['half', 'open', 'full', 'half'], tr);
  const degs = theme ? [0, 5, 3, 4] : progression(p.mode, bars, tr, { start: p.st.deg, cadence });
  if (theme && last) degs[3] = 0;
  const chords = degs.map((d) => ({ deg: d, semis: chordSemis(p.mode, d, extOf(S, d, tr)) }));
  const ev = [];
  const panArp = A.arp === 'guitar' ? -0.25 : 0.25;
  for (let b = 0; b < bars; b++) {
    const c = chords[b], at = b * beats;
    const v = voiceChord(c.semis, p.tonic, p.st.prevV, { lo: 52, hi: 74, n: 4 });
    p.st.prevV = v;
    const root = ((p.tonic + c.semis[0]) % 12 + 12) % 12;
    const bassM = 36 + ((root - 36 % 12 + 12) % 12) + (root < 4 ? 12 : 0);
    if (A.pad) {
      const lowPad = A.pad === 'choir' ? -12 : 0;
      v.forEach((m, i) => ev.push({ b: at, inst: A.pad, m: m + lowPad, v: A.padVel ?? 0.45, d: beats + 0.15, pan: (i / (v.length - 1 || 1) - 0.5) * 0.7, o: A.pad === 'choir' ? { vowel: 'oo' } : undefined }));
    }
    if (A.bass && r() < (A.bassP ?? 0.8)) {
      ev.push({ b: at, inst: A.bass, m: bassM, v: 0.55, d: beats * 0.9, pan: 0 });
      if (beats === 4 && r() < 0.35) ev.push({ b: at + 2.5, inst: A.bass, m: bassM + 7, v: 0.4, d: 1.5, pan: 0 });
    }
    if (A.arp) {
      const arpV = A.arp === 'guitar' ? v.map((m) => (m > 69 ? m - 12 : m)).sort((x, y) => x - y) : v.map((m) => m + 12);
      const fig = arpeggio(arpV, beats, A.arpSub, A.arpPat, r, { bass: A.arpPat === 'travis' ? bassM + 12 : null, vel: A.arpVel ?? 0.45, startBeat: at, len: 2 });
      // breathe: drop a few notes and sometimes the whole last bar of the figure
      for (const n of fig) {
        if (r() < 0.08 && n.beat % 1) continue;
        if (last && b === bars - 1 && n.beat - at >= 2) continue;
        ev.push({ b: n.beat, inst: A.arp, m: Math.min(93, n.midi), v: n.vel, d: n.dur, pan: panArp + (r() - 0.5) * 0.2 });
      }
      if (last && b === bars - 1) for (const m of arpV) ev.push({ b: at + 2, inst: A.arp, m, v: 0.4, d: 2, pan: panArp, off: (m - arpV[0]) * 0.004 });
    }
    if (A.hits) {
      for (const hb of A.hitPat || [0]) {
        v.forEach((m, i) => ev.push({ b: at + hb, inst: A.hits, m, v: A.hitVel ?? 0.32, d: 1.5, pan: (i - 1.5) * 0.12, off: i * 0.012 }));
      }
    }
    if (A.sparkle && r() < (A.sparkP ?? 0.2)) {
      const m = v[v.length - 1] + 12 + (r() < 0.5 ? 0 : 7);
      ev.push({ b: at + pick([1.5, 2.5, 3, 3.5], r), inst: A.sparkle, m: Math.min(96, m), v: 0.35, d: 2, pan: (r() - 0.5) * 0.9 });
    }
  }
  // melody (motif kept for the whole piece: A A' B A'' feeling)
  const melOn = A.mel && (theme || r() < (A.melP ?? 0.7));
  if (melOn) {
    const res = melody({ chords, tonic: p.tonic, mode: p.mode, beats, range: A.melRange || [67, 86], cells: A.cells || FLOW, endCell: pick(ENDS, tr), r: tr,
      motif: p.st.motif, reuse: S.theme ? 0.85 : 0.6, end: last || cadence === 'full' ? 'tonic' : 'chord', density: A.mel === 'kalimba' ? 0.85 : 1 });
    if (!p.st.motif || theme) p.st.motif = res.motif;
    for (const n of res.notes) {
      if (A.grace && r() < A.grace && n.dur >= 1) ev.push({ b: Math.max(0, n.beat - 0.12), inst: A.mel, m: n.midi + 2, v: n.vel * 0.6, d: 0.12, pan: 0.1 });
      ev.push({ b: n.beat, inst: A.mel, m: n.midi, v: n.vel * (A.mel === 'flute' ? 0.9 : 1), d: n.dur * (A.mel === 'flute' ? 0.92 : 1.6), pan: 0.08, o: A.mel === 'strings' ? { vib: 9 } : undefined });
    }
  }
  // next phrase starts where the harmony left off
  p.st.deg = cadence === 'full' ? 0 : pick([0, degs[bars - 1]], r);
  if (p.st.deg !== 0 && r() < 0.5) p.st.deg = 0;
  return { events: ev, beats: bars * beats };
}

// cave: low drone, dark choir changing every 2 bars, sparse bells / kalimba "drops" with echoes
function genCave(p, r, music, last) {
  const beats = p.beats, bars = p.bars, ev = [], len = bars * beats;
  const low = 36 + (((p.tonic % 12) - 0 + 12) % 12);
  ev.push({ b: 0, inst: 'drone', m: low, v: 0.55, d: len + 0.5, pan: 0, o: { att: p.idx === 0 ? 5 : 2.5, rel: 4 } });
  const degs = progression(p.mode, 2, r, { start: p.st.deg, cadence: last ? 'full' : 'open' });
  degs.forEach((d, k) => {
    const v = voiceChord(chordSemis(p.mode, d, pick(['', 'sus2', '5'], r)), p.tonic, p.st.prevV, { lo: 48, hi: 67, n: 3, center: 57 });
    p.st.prevV = v;
    v.forEach((m, i) => ev.push({ b: k * 8, inst: 'choir', m, v: 0.42, d: 8.2, pan: (i - 1) * 0.35, o: { vowel: 'oo', att: 2.5, rel: 3 } }));
  });
  p.st.deg = degs[1];
  const pent = [0, 3, 5, 7, 10];
  const n = 2 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const b = Math.floor(r() * (len - 2) * 2) / 2;
    const m = p.tonic + 12 + pick(pent, r) + (r() < 0.4 ? 12 : 0);
    const inst = r() < 0.55 ? 'bell' : 'kalimba';
    const pan = (r() - 0.5) * 1.2;
    ev.push({ b, inst, m, v: 0.5, d: 3, pan });
    if (inst === 'kalimba' && r() < 0.6) { ev.push({ b: b + 0.75, inst, m, v: 0.26, d: 2, pan: -pan }); ev.push({ b: b + 1.5, inst, m, v: 0.12, d: 2, pan }); }
  }
  if (r() < 0.22) ev.push({ b: 0, inst: 'boom', m: 0, v: 0.22, d: 4 });
  return { events: ev, beats: len };
}

// danger: taiko / frame drum grooves, low staccato string ostinato, dark sustained chords, a tense motif
const GROOVES = [
  [[0, 0, 1], [1.5, 1, 0.6], [2, 0, 0.9], [3, 1, 0.6], [3.5, 1, 0.7]],
  [[0, 0, 1], [0.75, 1, 0.55], [1.5, 0, 0.85], [2.5, 1, 0.6], [3, 0, 0.9], [3.5, 2, 0.6]],
  [[0, 0, 1], [1, 2, 0.5], [1.5, 1, 0.65], [2, 0, 0.85], [2.75, 2, 0.5], [3, 1, 0.7], [3.5, 1, 0.75]],
];
function genDanger(p, r, music) {
  const beats = 4, bars = p.bars, ev = [], len = bars * beats;
  const I = clamp(music.intensity ?? 0.6, 0.2, 1);
  const first = p.idx === 0;
  if (first) { ev.push({ b: 0, inst: 'boom', m: 0, v: 0.9, d: 4 }); ev.push({ b: 0, inst: 'taiko', m: 0, v: 1, d: 2 }); }
  const degs = progression(p.mode, bars, r, { start: p.st.deg, cadence: 'open' });
  p.st.deg = pick([0, 0, degs[bars - 1]], r);
  if (!p.st.groove || r() < 0.3) p.st.groove = pick(GROOVES, r);
  for (let b = 0; b < bars; b++) {
    const at = b * beats, d = degs[b];
    const semis = chordSemis(p.mode, d, d === 4 ? '' : pick(['', '5'], r));
    const root = (((p.tonic + semis[0]) % 12) + 12) % 12;
    const low = 38 + ((root - 2 + 12) % 12);
    // drums (the first bar of a fresh piece builds up with a roll)
    if (first && b === 0) {
      for (let k = 2; k < 16; k++) ev.push({ b: k * 0.25, inst: 'frame', m: 2, v: 0.25 + (k / 16) * 0.5, d: 0.2, pan: 0.2 * (k % 2 ? 1 : -1), vr: k % 2 });
    } else {
      for (const [hb, voice, vel] of p.st.groove) ev.push({ b: at + hb, inst: 'taiko', m: voice, v: vel * (0.75 + I * 0.25), d: 1, pan: voice === 2 ? 0.25 : voice === 1 ? -0.2 : 0, vr: r() < 0.5 ? 1 : 0 });
      if (I > 0.35) for (let k = 0; k < 8; k++) if (k % 2 === 1 || r() < 0.25) ev.push({ b: at + k * 0.5, inst: 'frame', m: k % 4 === 3 ? 1 : 2, v: 0.35 + (k % 4 === 3 ? 0.2 : 0), d: 0.3, pan: 0.3, vr: k % 2 });
      if (I > 0.6) for (let k = 0; k < 16; k++) ev.push({ b: at + k * 0.25, inst: 'shaker', m: 0, v: k % 4 === 2 ? 0.7 : 0.4, d: 0.2, pan: -0.35, vr: k % 2 });
    }
    // ostinato: staccato low strings in 8ths
    const pat = [0, 0, 12, 0, 0, 7, 12, 7];
    for (let k = 0; k < 8; k++) ev.push({ b: at + k * 0.5, inst: 'spicc', m: low + pat[k], v: k % 4 === 0 ? 0.62 : 0.45, d: 0.22, pan: -0.15, vr: k & 1 });
    // dark sustained chord
    const v = voiceChord(semis, p.tonic, p.st.prevV, { lo: 50, hi: 70, n: 3, center: 60 });
    p.st.prevV = v;
    v.forEach((m, i) => ev.push({ b: at, inst: 'strings', m, v: 0.32, d: beats, pan: (i - 1) * 0.3, o: { att: 0.5, rel: 0.8 } }));
  }
  // tense motif every other phrase
  if (p.idx % 2 === 1) {
    const chords = degs.map((d) => ({ semis: chordSemis(p.mode, d, '') }));
    const res = melody({ chords, tonic: p.tonic, mode: p.mode, beats, range: [62, 79], cells: DRIVE, endCell: [2, 2], r, motif: p.st.motif, reuse: 0.7, end: 'chord', arc: 4 });
    p.st.motif ||= res.motif;
    for (const n of res.notes) ev.push({ b: n.beat, inst: 'strings', m: n.midi, v: 0.42 + n.vel * 0.2, d: n.dur, pan: 0.1, o: { att: 0.08, rel: 0.4, vib: 12 } });
  }
  if (p.idx % 4 === 3) ev.push({ b: len - 2, inst: 'swell', m: 0, v: 0.6, d: 2 });
  return { events: ev, beats: len };
}
