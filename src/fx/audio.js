// Procedural audio (WebAudio, no files): mixer, spatial SFX, the soundscape around the listener and the
// generative music (music.js). One engine per page — getAudio() — usable before a game exists.
//
//   getAudio() -> Audio                    (singleton; installs the first-gesture unlock: iOS / autoplay)
//   audio.attach(game) -> audio            (main.js: listener = the player, director = moods + remote sounds)
//   audio.play(name, { x, y, volume, delay, pitch, surface, weapon, species, slot, dir })
//       x, y in world tiles (omit for interface sounds). Unknown names are ignored. Catalogue: sfxBank.js
//       (+ routes below: step, swing, hit, crit, growl, death, voice, birds, thunder, hotbar, zoom).
//   audio.music.setMood('menu'|'day'|'night'|'dawn'|'rain'|'cave'|'danger'|'home') · music.setGap(…)
//   audio.setLevel('master'|'music'|'sfx'|'amb', 0..1) · audio.enabled (mute) — persisted, applied live.
//   audio.onOp(name, args, ctx)            (net.js, before every op applies: sounds of everyone's actions)
// Spatial: stereo pan + distance (gain, air lowpass, more reverb) + occlusion by walls / rock between the
// listener and the source. Indoors (walls around the listener) and in caves the outdoor beds are muffled,
// rain turns into drumming on the roof, caves add echo. Hidden tab: fade out + suspend.

import { SfxBank, SFX, ALIAS, SPECIES_VOX } from './sfxBank.js';
import { Music } from './music.js';
import { installAudioDirector } from './audioDirector.js';
import { mulberry, analyze } from './sfxDsp.js';
import { SynthPool } from './synthPool.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = Math.random;
const KEYS = { master: 'wos.audio.volume', music: 'wos.audio.music', sfx: 'wos.audio.sfx', amb: 'wos.audio.amb' };
export const DEFAULT_LEVELS = { master: 0.85, music: 0.7, sfx: 0.9, amb: 0.8 };
const curve = (v) => v * v;
const MAKEUP = 1.8; // +5 dB: the mix peaks around -6 dBFS at default levels (the compressor catches pile-ups)
const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const SP0 = { gain: 1, pan: 0, lp: 0, wet: 1, d: 0 };
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
// rendered first after the unlock (the rest follows in the background)
const PREWARM = ['step_grass', 'step_dirt', 'step_stone', 'step_wood', 'step_sand', 'step_water', 'ui_click', 'ui_hover', 'ui_open', 'ui_close',
  'hit', 'swing_light', 'swing_blade', 'swing_heavy', 'chop', 'mine', 'pickup', 'build_hit', 'crackle', 'cricket', 'bird_chirp', 'rain_drop', 'hotbar', 'error'];

const LATE = new Set(['thunder_near', 'thunder_far', 'wolf_howl', 'cave_rumble']);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class Audio {
  constructor({ ctx = null, offline = false, levels = null } = {}) {
    this.ctx = null;
    this.offline = offline;
    this._enabled = store.get('wos.audio.enabled') !== '0';
    this.levels = {};
    for (const k in KEYS) {
      const v = parseFloat(store.get(KEYS[k]));
      this.levels[k] = Number.isFinite(v) ? clamp(v, 0, 1) : DEFAULT_LEVELS[k];
    }
    if (levels) Object.assign(this.levels, levels);
    this.lx = 0; this.ly = 0; this.viewW = 30;
    this.game = null; this.director = null; this._world = null;
    this.music = new Music(this);
    this.voices = 0;
    this.lowEnd = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 8) <= 4 && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    this.maxVoices = this.lowEnd ? 22 : 36;
    this.stats = { plays: 0, dropped: 0, deduped: 0, created: 0, ended: 0 };
    this._recent = [];
    this._gapT = Object.create(null); this._gapN = 0;
    this._hide = 1; this._duck = 1;
    this._near = { water: 0, flow: 0, waterPan: 0, marsh: 0, lush: 0.5, trees: 0, fire: 0, firePan: 0, indoor: 0, wolves: 0 };
    this._timers = { bird: 2, cricket: 0.5, owl: 15, frog: 6, crackle: 0, drip: 2, rumble: 30, blub: 8, gust: 4, howl: 40, wood: 25 };
    this._cave = 0; this.indoor = 0; this._swim = 0;
    this.body = { hp: 1, cold: 0, warm: 0 }; // the local player's state, set by the director
    this._strikeId = 0; this._lastThunder = -9;
    this._acc = 0; this._scanT = 0; this._gustOn = false;
    this._muteClickUntil = 0;
    if (ctx) this._init(ctx);
  }

  // ---------- settings ----------
  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = !!v;
    store.set('wos.audio.enabled', v ? '1' : '0');
    this._applyMaster();
  }
  get volume() { return this.levels.master; }
  set volume(v) { this.setLevel('master', v); }
  get sfxVolume() { return this.levels.sfx; }
  set sfxVolume(v) { this.setLevel('sfx', v); }
  get ambVolume() { return this.levels.amb; }
  set ambVolume(v) { this.setLevel('amb', v); }
  toggle() { this.enabled = !this.enabled; return this.enabled; }
  getLevel(k) { return this.levels[k] ?? 0; }
  setLevel(k, v, persist = true) {
    if (!(k in KEYS)) return;
    this.levels[k] = clamp(+v || 0, 0, 1);
    if (persist) store.set(KEYS[k], String(+this.levels[k].toFixed(3)));
    if (k === 'master') this._applyMaster(); else this._applyBuses();
  }
  _applyMaster(tc = 0.08) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime((this._enabled ? MAKEUP * curve(this.levels.master) : 0) * this._hide, t, tc);
  }
  _applyBuses(tc = 0.06) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, L = this.levels, d = this._duck;
    const set = (n, v) => { n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(v, t, tc); };
    set(this.musicBus, curve(L.music)); set(this.musicSend, curve(L.music));
    set(this.sfx, curve(L.sfx) * d); set(this.uiBus, curve(L.sfx)); set(this.sfxSend, curve(L.sfx) * d);
    set(this.amb, curve(L.amb) * d); set(this.ambSend, curve(L.amb) * d);
  }

  // ---------- unlock / lifecycle ----------
  // first user gesture (and every gesture while the context is not running: iOS interruptions)
  installUnlock() {
    if (this._gesture || typeof addEventListener === 'undefined') return;
    this._gesture = (e) => {
      if (e && e.isTrusted === false) return;
      if (this.ctx && this.ctx.state === 'running') return;
      this.unlock();
    };
    for (const t of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown', 'mousedown']) addEventListener(t, this._gesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => this._visibility());
    addEventListener('pagehide', () => this._visibility(true));
    addEventListener('pageshow', () => this._visibility());
  }
  unlock() {
    if (!this.ctx) {
      let ctx;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
      this._init(ctx);
    }
    const ctx = this.ctx;
    if (IOS) this._iosSession();
    if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {});
    // iOS: a sound started inside the gesture unlocks output for good
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch { /* ignore */ }
  }
  _iosSession() {
    // play through the "playback" audio session (otherwise the ring/silent switch mutes WebAudio)
    try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; } } catch { /* ignore */ }
    if (this._iosEl) { if (this._iosEl.paused && !document.hidden) this._iosEl.play().catch(() => {}); return; }
    const a = document.createElement('audio');
    a.src = silentWav(); a.loop = true; a.setAttribute('playsinline', ''); a.setAttribute('x-webkit-airplay', 'deny'); a.preload = 'auto';
    a.play().catch(() => {});
    this._iosEl = a;
  }
  _visibility(forceHidden = false) {
    if (!this.ctx) return;
    const hidden = forceHidden || document.hidden;
    clearTimeout(this._suspT);
    if (hidden) {
      this._hide = 0; this._applyMaster(0.06);
      this._suspT = setTimeout(() => { if (document.hidden || forceHidden) this.ctx.suspend().catch(() => {}); }, 400);
      this._iosEl?.pause();
    } else {
      this.ctx.resume().catch(() => {});
      this._hide = 1; this._applyMaster(0.35);
      if (this._iosEl && !navigator.audioSession) this._iosEl.play().catch(() => {});
    }
  }

  _init(ctx) {
    this.ctx = ctx;
    const g = (v, to) => { const n = ctx.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
    const L = this.levels;
    this.out = g(this.offline ? MAKEUP * curve(L.master) : 0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -7; comp.knee.value = 6; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.22;
    this.out.connect(comp); comp.connect(ctx.destination);
    this.comp = comp;
    this.musicBus = g(curve(L.music), this.out);
    // the world (effects + ambience) passes one low-pass: it closes in when the player is near death
    this.worldLP = ctx.createBiquadFilter();
    this.worldLP.type = 'lowpass'; this.worldLP.frequency.value = 20000; this.worldLP.Q.value = 0.5;
    this.worldLP.connect(this.out);
    this.sfx = g(curve(L.sfx), this.worldLP);
    this.uiBus = g(curve(L.sfx), this.out);
    this.amb = g(curve(L.amb), this.worldLP);
    // outdoor beds / critters pass one lowpass: muffled indoors and underground
    this.outdoor = ctx.createBiquadFilter();
    this.outdoor.type = 'lowpass'; this.outdoor.frequency.value = 18000; this.outdoor.Q.value = 0.5;
    this.outdoor.connect(this.amb);
    // shared reverb (generated impulse), fed post-fader by each bus
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(this.lowEnd ? 1.3 : 2.0);
    this.verbIn = g(1);
    this.verbIn.connect(this.verb);
    this.verbOut = g(0.85, this.out);
    this.verb.connect(this.verbOut);
    this.sfxSend = g(curve(L.sfx), this.verbIn);
    this.ambSend = g(curve(L.amb), this.verbIn);
    this.musicSend = g(curve(L.music), this.verbIn);
    // cave echo: feedback delay fed by the sfx + ambience buses (opened only underground)
    this.echoIn = g(0);
    this.echo = ctx.createDelay(1.0); this.echo.delayTime.value = 0.23;
    const efb = g(0.36), elp = ctx.createBiquadFilter();
    elp.type = 'lowpass'; elp.frequency.value = 1700;
    this.echoIn.connect(this.echo); this.echo.connect(elp); elp.connect(efb); efb.connect(this.echo);
    elp.connect(this.out);
    this.sfx.connect(this.echoIn); this.amb.connect(this.echoIn);
    this.pool = this.offline ? null : new SynthPool();
    this.bank = new SfxBank(ctx, this.pool);
    this.white = this._noise('white'); this.pink = this._noise('pink'); this.brown = this._noise('brown');
    this._beds();
    if (this.offline) { this.music.begin(0); return; }
    this.bank.prewarm(PREWARM);
    // then everything else in the background (big, situational ones are prewarmed when they become likely)
    setTimeout(() => this.bank.prewarm(Object.keys(SFX).filter((n) => !LATE.has(n))), 2500);
    this.music.begin(ctx.currentTime);
    this._applyMaster(0.4);
    this._poll = setInterval(() => this._tick(), 100);
    ctx.onstatechange = () => { if (ctx.state === 'running') this._applyMaster(0.3); };
  }

  // 100 ms housekeeping (runs in the menu too): music scheduler, idle renders, pause ducking
  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const duck = this.game?.ui?.pause ? 0.45 : 1;
    if (duck !== this._duck) { this._duck = duck; this._applyBuses(0.25); }
    if (ctx.currentTime - (this._mt || 0) > 0.05) { this._mt = ctx.currentTime; this.music.tick(ctx.currentTime); }
    this.bank.pump(this.music.cur ? 2 : 4);
  }

  attach(game) {
    this.game = game;
    this._world = game.world;
    if (game.quality === 'low') { this.lowEnd = true; this.maxVoices = 22; }
    this.installUnlock();
    return this; // the director is installed on the first update (game.events exists by then)
  }

  // ---------- buffers ----------
  _noise(kind, sec = 3) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), r = mulberry(kind.length * 977);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    }
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
    return buf;
  }
  // stereo hall: early reflections + decorrelated noise tail that darkens as it decays
  _impulse(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * sec);
    const buf = ctx.createBuffer(2, n, sr), r = mulberry(4242);
    const pre = Math.floor(0.011 * sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let y = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr, u = i / n;
        const k = 0.85 - 0.72 * Math.pow(u, 0.6);
        y += k * (r() * 2 - 1 - y);
        d[i] = y * Math.exp((-6.9 * t) / sec) * Math.min(1, t / 0.004);
      }
      for (let e = 0; e < 9; e++) {
        const i = pre + Math.floor((0.004 + r() * 0.07) * sr);
        if (i < n) d[i] += (r() < 0.5 ? -1 : 1) * (0.55 - e * 0.04);
      }
    }
    return buf;
  }

  // looping filtered-noise beds
  _beds() {
    const ctx = this.ctx;
    const bed = (buf, type, freq, q, dest, pan = false) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g);
      let p = null;
      if (pan && ctx.createStereoPanner) { p = ctx.createStereoPanner(); g.connect(p); p.connect(dest); } else g.connect(dest);
      src.start(0, rnd() * buf.duration);
      return { src, f, g, p, v: 0 };
    };
    const O = this.outdoor, A = this.amb;
    this.bWind = bed(this.brown, 'bandpass', 420, 0.5, O);
    this.bWind2 = bed(this.pink, 'bandpass', 1400, 2.5, O);
    this.bLeaves = bed(this.pink, 'bandpass', 3800, 0.5, O);
    this.bRain = bed(this.white, 'highpass', 900, 0.4, O);
    this.bRain2 = bed(this.pink, 'bandpass', 2600, 0.7, O);
    this.bRoof = bed(this.brown, 'bandpass', 380, 0.7, A);
    this.bRiver = bed(this.pink, 'bandpass', 650, 0.6, O, true);
    this.bLake = bed(this.brown, 'lowpass', 380, 0.7, O, true);
    this.bFire = bed(this.brown, 'lowpass', 260, 0.7, A, true);
    this.bCave = bed(this.brown, 'lowpass', 110, 0.8, A);
    // night insect chorus: narrow band, amplitude-modulated (~24 Hz pulses)
    this.bInsect = bed(this.white, 'bandpass', 4700, 7, O);
    const am = ctx.createGain(); am.gain.value = 0.5;
    this.bInsect.f.disconnect(); this.bInsect.f.connect(am); am.connect(this.bInsect.g);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 24; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); lfo.start();
  }
  _set(bed, v, tc = 0.4) {
    if (Math.abs(v - bed.v) < 0.0015 && Math.abs(v - bed.v) < bed.v * 0.03 + 1e-4) return;
    bed.v = v;
    bed.g.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }
  // bounded linear ramps: once a ramp ends the param is constant again (filters drop back to k-rate)
  _param(p, v, key, tc = 0.5) {
    const k = '_p_' + key;
    if (this[k] != null && Math.abs(this[k] - v) < Math.abs(v) * 0.02 + 1e-3) return;
    this[k] = v;
    const t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + Math.min(1.2, tc));
  }

  // ---------- world queries ----------
  _isWall(i) {
    const w = this._world;
    if (w.rock[i]) return true;
    const s = this.game?.build?.grid?.main?.get(i);
    return !!s && !s.blueprint && /^(wall|door)/.test(s.type);
  }
  // occlusion between the listener and (x, y): walls / rock tiles crossed (fences barely count)
  _occ(x, y) {
    const w = this._world;
    if (!w || !w.solid) return 0;
    const x0 = this.lx, y0 = this.ly, dx = x - x0, dy = y - y0, dist = Math.hypot(dx, dy);
    if (dist < 1.2) return 0;
    const steps = Math.min(60, Math.ceil(dist * 2));
    const sx = Math.floor(x0), sy = Math.floor(y0), ex = Math.floor(x), ey = Math.floor(y);
    let occ = 0, last = -1;
    for (let k = 1; k < steps; k++) {
      const tx = Math.floor(x0 + (dx * k) / steps), ty = Math.floor(y0 + (dy * k) / steps);
      if ((tx === sx && ty === sy) || (tx === ex && ty === ey) || !w.inBounds(tx, ty)) continue;
      const i = ty * w.W + tx;
      if (i === last) continue;
      last = i;
      if (w.rock[i]) occ += 0.9;
      else if (w.solid[i]) occ += this._isWall(i) ? (w.solid[i] === 2 ? 0.35 : 0.65) : 0.12;
      if (occ >= 2.2) break;
    }
    return occ;
  }
  _spatial(x, y, range = 14) {
    if (x == null) return SP0;
    const dx = x - this.lx, dy = (y ?? this.ly) - this.ly, d = Math.hypot(dx, dy);
    if (d > range * 2.4) return null;
    const ref = range * 0.55;
    let gain = 1 / (1 + (d / ref) * (d / ref)), lp = d > 4 ? 16000 * Math.exp(-(d - 4) / 26) : 0;
    const occ = this._occ(x, y);
    if (occ > 0) { gain *= 1 / (1 + occ * 1.3); lp = Math.min(lp || 20000, 3800 / (1 + occ * 2.5)); }
    return { gain, pan: clamp(dx / (this.viewW * 0.5), -1, 1) * 0.85, lp, wet: 1 + Math.min(1.5, d / 12), d };
  }
  // footstep surface under (x, y)
  surfaceAt(x, y) {
    const w = this._world, g = this.game;
    if (!w || x == null) return 'grass';
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!w.inBounds(tx, ty)) return 'stone';
    const i = w.idx(tx, ty), G = g?.build?.grid;
    if (G) {
      const f = G.floor?.get(i);
      if (f && !f.blueprint) return f.type === 'floor_stone' ? 'stone' : f.type === 'farm_plot' ? 'dirt' : 'wood';
      const rug = G.rug?.get(i);
      if (rug && !rug.blueprint) return 'soft';
    }
    if (w.water[i]) return 'water';
    const e = g?.env?.env;
    if ((e?.snow ?? e?.snowCover ?? 0) > 0.35) return 'snow';
    switch (w.ground[i]) {
      case 1: return 'grass';
      case 2: return 'sand';
      case 3: return 'gravel';
      case 4: case 5: return 'mud';
      case 6: return 'stone';
      case 7: return 'soft';
      default: return (w.lush ? w.lush[i] : 0.5) > 0.42 ? 'grass' : 'dirt';
    }
  }
  entityNear(x, y, r = 0.7) {
    const E = this.game?.entities;
    if (!E || x == null) return null;
    let best = null, bd = r * r;
    for (const e of E) {
      const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- SFX ----------
  play(name, o = {}) {
    if (!this.ctx || !this._enabled || (!this.offline && this.ctx.state !== 'running')) return;
    const route = ROUTES[name];
    if (route) route.call(this, o || {});
    else this._sfx(ALIAS[name] || name, o || {});
  }
  // same sound at the same place in the same moment (local prediction + op echo, two hooks): play once
  _dupe(name, o, now, spatial) {
    const R = this._recent, win = o.dedupe ?? 0.12;
    for (let i = R.length - 1; i >= 0; i--) {
      const e = R[i];
      if (now - e.t > 0.8) break;
      if (e.n !== name || now - e.t > win) continue;
      if (!spatial || (e.x != null && Math.abs(e.x - o.x) < 0.9 && Math.abs(e.y - o.y) < 0.9)) return true;
    }
    R.push({ n: name, t: now, x: spatial ? o.x : null, y: spatial ? o.y : null });
    if (R.length > 64) R.splice(0, R.length - 64);
    return false;
  }
  // was one of `names` played near (x, y) during the last `win` seconds?
  recentNear(names, x, y, win = 0.5, r = 1.2) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    for (let i = this._recent.length - 1; i >= 0; i--) {
      const e = this._recent[i];
      if (now - e.t > win) break;
      if (names.includes(e.n) && e.x != null && Math.abs(e.x - x) < r && Math.abs(e.y - y) < r) return true;
    }
    return false;
  }
  _sfx(name, o = {}) {
    const def = SFX[name];
    if (!def) return false;
    const now = this.ctx.currentTime;
    if (name === 'ui_click' && now < this._muteClickUntil) return false;
    const spatial = o.x != null && (def.bus !== 'ui' || o.world);
    if (def.gap && !o.force) {
      if (now - (this._gapT[name] ?? -9) < def.gap) return false;
      this._gapT[name] = now;
    }
    if (!o.force && this._dupe(name, o, now, spatial)) { this.stats.deduped++; return false; }
    const sp = spatial ? this._spatial(o.x, o.y, o.range || 14) : SP0;
    if (!sp) return false;
    const vol = (o.volume ?? 1) * sp.gain * def.gain * (1 + (rnd() - 0.5) * (def.vj ?? 0.1));
    if (vol < 0.003) return false;
    if (this.voices >= this.maxVoices && vol < 0.3 && !o.force) { this.stats.dropped++; return false; }
    const e = this.bank.get(name);
    const rate = Math.pow(2, ((rnd() - 0.5) * 2 * (def.pj ?? 1)) / 12) * (o.pitch ?? 1);
    const bus = def.bus === 'ui' ? this.uiBus : def.bus === 'amb' ? (o.indoor === false || o.outdoor ? this.outdoor : this.amb) : this.sfx;
    const send = def.bus === 'amb' ? this.ambSend : def.bus === 'ui' ? null : this.sfxSend;
    this._buf(this.bank.pick(e), {
      when: o.at ?? now + 0.004 + (o.delay || 0), rate, gain: vol, pan: o.pan ?? sp.pan, lp: o.lp ?? sp.lp, bus,
      wet: send ? (def.rev ?? 0.15) * sp.wet * (o.wet ?? 1) : 0, send,
    });
    this.stats.plays++;
    return true;
  }
  _buf(b, { when, rate = 1, gain = 1, pan = 0, lp = 0, bus, wet = 0, send = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const nodes = [];
    let node = src;
    if (lp && lp < 15000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
      node.connect(f); node = f; nodes.push(f);
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g); nodes.push(g);
    let out = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p); out = p; nodes.push(p);
    }
    out.connect(bus);
    if (wet > 0.01 && send) {
      const s = ctx.createGain();
      s.gain.value = Math.min(1.5, wet);
      out.connect(s); s.connect(send); nodes.push(s);
    }
    this.voices++;
    this.stats.created++;
    src.onended = () => {
      this.voices--;
      this.stats.ended++;
      try { src.disconnect(); for (const n of nodes) n.disconnect(); } catch { /* ignore */ }
    };
    src.start(Math.max(when, 0));
    return src;
  }

  // ---------- soundscape ----------
  update(game, dt) {
    if (!this.director && game.events) this.director = installAudioDirector(game, this);
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.game = game;
    this._world = game.world;
    const p = game.player, cam = game.cam;
    if (p && !p.dead) { this.lx = p.x; this.ly = p.y; } else { this.lx = cam.x; this.ly = cam.y + 0.4; }
    this.viewW = (game.R?.cssW || 800) / (cam.zoom || 40);
    this.director?.update(dt);
    const now = this.ctx.currentTime;
    if (now - (this._mt || 0) > 0.05) { this._mt = now; this.music.tick(now); } // the 100 ms timer may be throttled
    this._acc += dt;
    if (this._acc < 0.1) return;
    const step = Math.min(0.5, this._acc);
    this._acc = 0;
    this._ambience(game, step);
  }

  _ambience(game, dt) {
    const env = game.env.env, N = this._near, T = this._timers;
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.5; this._scan(game); }
    const w = game.world;
    const caveNow = w && w.caveDark ? w.caveDark(this.lx, this.ly) : 0;
    this._cave += (caveNow - this._cave) * (1 - Math.exp(-dt * 1.2));
    this.indoor += (N.indoor - this.indoor) * (1 - Math.exp(-dt * 2));
    // head at water level: the world gets muffled, water all around
    const p = game.player, swimNow = p && !p.dead && w && w.waterAt(Math.floor(p.x), Math.floor(p.y)) === 2 ? 1 : 0;
    this._swim += (swimNow - this._swim) * (1 - Math.exp(-dt * 3));
    const cave = this._cave, indoor = this.indoor, out = 1 - cave * 0.88, swim = this._swim;
    const muff = Math.max(indoor * 0.85, cave, swim * 0.5);
    this._param(this.outdoor.frequency, muff > 0.04 ? 18000 * Math.pow(650 / 18000, muff) : 18000, 'ofreq', 0.4);
    this._param(this.verbIn.gain, 1 + 1.4 * cave + 0.3 * indoor, 'verb', 0.5);
    const B = this.body, nd = clamp((0.2 - B.hp) / 0.2, 0, 1), cold = B.cold || 0, warm = B.warm || 0;
    this._param(this.worldLP.frequency, nd > 0.01 ? 20000 * Math.pow(1500 / 20000, nd * 0.85) : 20000, 'wlp', 0.6);
    this._param(this.echoIn.gain, cave * 0.42, 'echo', 0.5);
    this._set(this.bCave, cave * 0.05, 1.0);

    const wind = env.wind ?? 0.2, gust = env.gust || 0;
    this._set(this.bWind, (0.035 + wind * 0.13) * out, 0.6);
    this._param(this.bWind.f.frequency, 260 + wind * 520 + gust * 260, 'wf', 0.8);
    this._set(this.bWind2, (Math.max(0, wind - 0.5) * 0.05 + cold * 0.022 * (1 - indoor)) * out, 0.8);
    this._param(this.bWind2.f.frequency, 1100 + gust * 700 + cold * 900, 'wf2', 1.0);
    this._set(this.bLeaves, N.trees * (0.25 + wind) * 0.035 * out, 0.8);
    const rain = env.rain || 0;
    this._set(this.bRain, rain * 0.075 * (1 - cave * 0.93) * (1 - indoor * 0.4), 1.2);
    this._set(this.bRain2, rain * 0.05 * (1 - cave * 0.8) * (1 - indoor * 0.6), 1.2);
    this._set(this.bRoof, rain * indoor * (1 - cave) * 0.11, 1.0);
    this._set(this.bRiver, N.flow * 0.12, 0.8);
    if (this.bRiver.p) this._param(this.bRiver.p.pan, N.waterPan * 0.6, 'rp', 0.5);
    const tt = performance.now() / 1000;
    const lap = 0.5 + 0.5 * Math.sin(tt * 1.7) * Math.sin(tt * 0.6);
    this._set(this.bLake, N.water * (0.05 + 0.06 * lap) * (1 - N.flow * 0.5) + swim * (0.06 + 0.04 * lap), 0.3);
    if (this.bLake.p) this._param(this.bLake.p.pan, N.waterPan * 0.6 * (1 - swim), 'lp', 0.5);
    this._set(this.bFire, N.fire * 0.05 * (1 + warm * 0.5), 0.3);
    if (this.bFire.p) this._param(this.bFire.p.pan, N.firePan * (1 - warm * 0.5), 'fp', 0.3);
    const day = env.day || 0, night = (env.night || 0) * (1 - cave), hour = env.hour ?? 12;
    this._set(this.bInsect, night * (1 - rain) * (0.3 + N.lush) * 0.011, 2);

    const calm = (1 - rain) * (1 - Math.max(0, wind - 0.6) * 1.5) * (1 - cave);
    const voice = (name, vol, o = {}) => this._sfx(name, { pan: (rnd() - 0.5) * 1.6, volume: vol, indoor: false, ...o });
    // rain grains: drops on leaves outside, drumming on the roof inside
    if (rain > 0.1) {
      const outRate = rain * 9 * (1 - indoor) * (1 - cave), roofRate = rain * 16 * indoor * (1 - cave);
      const cap = this.lowEnd ? 0.5 : 1;
      if (rnd() < outRate * dt * cap) voice('rain_drop', 0.6 + rnd() * 0.6);
      if (rnd() < roofRate * dt * cap) this._sfx('roof_drop', { pan: (rnd() - 0.5) * 1.4, volume: 0.6 + rnd() * 0.5 });
      if (rnd() < roofRate * dt * cap * 0.6) this._sfx('roof_drop', { pan: (rnd() - 0.5) * 1.4, volume: 0.4 + rnd() * 0.4, delay: 0.04 });
    }
    // gusts
    T.gust -= dt;
    if (gust > 0.55 && !this._gustOn && T.gust <= 0 && out > 0.3) { this._gustOn = true; T.gust = 6 + rnd() * 6; this._gust(gust); }
    if (gust < 0.4) this._gustOn = false;
    // caves: drips, distant rumbles
    if (cave > 0.35) {
      T.drip -= dt * cave;
      if (T.drip <= 0) { T.drip = 1.4 + rnd() * 4; this._sfx('drip', { pan: (rnd() - 0.5) * 1.6, volume: 0.6 + rnd() * 0.8 }); }
      T.rumble -= dt * cave;
      if (T.rumble <= 0) { T.rumble = 40 + rnd() * 60; this._sfx('cave_rumble', { pan: (rnd() - 0.5), volume: 0.5 + rnd() * 0.4 }); }
    }
    // fire crackle
    if (N.fire > 0.02) {
      T.crackle -= dt;
      while (T.crackle <= 0) { T.crackle += 0.05 + rnd() * 0.2; this._sfx('crackle', { pan: N.firePan * (1 - warm * 0.5) + (rnd() - 0.5) * 0.2, volume: Math.min(1, N.fire) * (0.4 + rnd() * 0.8) * (1 + warm * 0.4), delay: rnd() * 0.08 }); }
    }
    // birds by day, dawn chorus
    const dawn = hour > 5 && hour < 8.5;
    const chorus = dawn ? 2.4 : 1;
    if (day > 0.2 && calm > 0.2) {
      T.bird -= dt * day * calm * chorus * (0.4 + N.lush * 0.5 + N.trees * 0.8);
      if (T.bird <= 0) {
        T.bird = 1.2 + rnd() * 3.5;
        const k = rnd();
        const name = dawn && k < 0.35 ? 'bird_song' : dawn && k < 0.45 ? 'bird_dove' : N.trees > 0.4 && k < 0.6 ? 'bird_call' : k < 0.8 ? 'bird_chirp' : 'bird_warble';
        voice(name, 0.6 + rnd() * 0.6, { lp: indoor > 0.5 ? 900 : 0 });
      }
      T.wood -= dt * N.trees * calm;
      if (T.wood <= 0) { T.wood = 25 + rnd() * 50; voice('woodpecker', 0.6); }
    }
    // night: crickets, owls, frogs, a distant wolf howl
    if (night > 0.4 && rain < 0.4) {
      T.cricket -= dt * night * (0.5 + N.lush);
      if (T.cricket <= 0) { T.cricket = 0.25 + rnd() * 0.6; voice('cricket', 0.5 + rnd() * 0.7); }
      T.owl -= dt * N.trees;
      if (T.owl <= 0) { T.owl = 18 + rnd() * 30; voice('owl', 0.7 + rnd() * 0.4); }
      T.frog -= dt * (N.marsh * 2 + N.water * 0.6);
      if (T.frog <= 0) { T.frog = 2 + rnd() * 5; voice('frog', 0.6 + rnd() * 0.6); }
      T.howl -= dt * (N.wolves > 0 ? 1 : 0.15);
      if (T.howl <= 0) { T.howl = 45 + rnd() * 80; voice('wolf_howl', N.wolves > 0 ? 0.8 : 0.35, { lp: 2600 }); }
    }
    // lakes: an occasional blub / fish
    if (N.water > 0.3 && cave < 0.3) {
      T.blub -= dt * N.water;
      if (T.blub <= 0) { T.blub = 5 + rnd() * 12; voice(rnd() < 0.7 ? 'water_blub' : 'plop', 0.5 + rnd() * 0.5, { pan: N.waterPan * 0.7 }); }
    }
    if (rain > 0.3) this.bank.prewarm(['thunder_near', 'thunder_far']);
    if (night > 0.3) this.bank.prewarm(['wolf_howl']);
    if (cave > 0.2) this.bank.prewarm(['cave_rumble']);
    // thunder after lightning (C's env.strikes / strikeId)
    const E = game.env;
    if (E.strikeId != null && E.strikeId !== this._strikeId) {
      this._strikeId = E.strikeId;
      const s = E.strikes?.[E.strikes.length - 1];
      if (s) this.thunder(s.dist ?? 0.5);
    }
  }

  thunder(dist = 0.5) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastThunder < 0.4) return; // same strike reported twice (event + strikeId)
    this._lastThunder = now;
    const d = clamp(dist, 0, 1);
    const muff = Math.max(this.indoor, this._cave);
    this._sfx(d < 0.45 ? 'thunder_near' : 'thunder_far', { delay: 0.25 + d * 2.6, volume: (1.25 - d * 0.6) * (1 - this._cave * 0.6), pan: (rnd() - 0.5) * 0.8, lp: muff > 0.3 ? 700 : 0, force: true });
  }

  _gust(strength) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = 2.2 + rnd() * 1.5;
    const s = ctx.createBufferSource(); s.buffer = this.pink;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(800 + strength * 400, t + dur * 0.45); f.frequency.linearRampToValueAtTime(350, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 + strength * 0.06, t + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    let o = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); const a = rnd() < 0.5 ? -0.7 : 0.7; p.pan.setValueAtTime(a, t); p.pan.linearRampToValueAtTime(-a, t + dur); g.connect(p); o = p; }
    s.connect(f); f.connect(g); o.connect(this.outdoor);
    s.start(t, rnd() * 2); s.stop(t + dur + 0.05);
    s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); if (o !== g) o.disconnect(); } catch { /* ignore */ } };
  }

  _scan(game) {
    const w = game.world, cx = Math.floor(this.lx), cy = Math.floor(this.ly), R = 8;
    let water = 0, flow = 0, wpan = 0, marsh = 0, lush = 0, n = 0;
    for (let y = cy - R; y <= cy + R; y += 2) for (let x = cx - R; x <= cx + R; x += 2) {
      if (!w.inBounds(x, y)) continue;
      const i = y * w.W + x, d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > R * R) continue;
      n++;
      const k = 1 - Math.sqrt(d2) / (R + 1);
      if (w.water[i] && !this._occ(x + 0.5, y + 0.5)) {
        water += k;
        wpan += (x - cx) * k;
        if (w.flowX && Math.abs(w.flowX[i]) + Math.abs(w.flowY[i]) > 0.25) flow += k;
      }
      if (w.ground[i] === 4) marsh += k;
      if (w.lush) lush += w.lush[i];
    }
    const N = this._near;
    N.water = clamp(water / 10, 0, 1);
    N.flow = clamp(flow / 7, 0, 1);
    N.waterPan = water > 0 ? clamp(wpan / water / R, -1, 1) : 0;
    N.marsh = clamp(marsh / 8, 0, 1);
    N.lush = n ? lush / n : 0.4;
    let trees = 0, fire = 0, fpan = 0;
    for (const o of w.query(this.lx, this.ly, 10)) {
      if (o.fire) {
        const d = Math.hypot(o.x - this.lx, o.y - this.ly);
        const k = clamp(1 - d / 10, 0, 1) ** 1.5 * (typeof o.fire === 'number' ? o.fire : 1) / (1 + this._occ(o.x, o.y) * 1.5);
        fire += k; fpan += clamp((o.x - this.lx) / (this.viewW * 0.5), -1, 1) * k;
      } else if (o.type && o.type.startsWith('tree_')) trees++;
    }
    N.trees = clamp(trees / 25, 0, 1);
    N.fire = clamp(fire, 0, 1.2); // sync-ok: audio mixer level, not a world object
    N.firePan = fire > 0 ? fpan / fire : 0;
    N.indoor = this._indoorAt(w, cx, cy);
    let wolves = 0;
    for (const e of game.entities) if (e.species === 'wolf' && !e.dead && Math.abs(e.x - this.lx) < 60 && Math.abs(e.y - this.ly) < 60) wolves++;
    N.wolves = wolves;
  }
  // 0..1: walls / rock around the listener on (almost) every side, within 7 tiles
  _indoorAt(w, tx, ty) {
    if (!w.inBounds(tx, ty)) return 0;
    if (w.isCave?.(tx, ty)) return 1;
    let hit = 0;
    for (const [dx, dy] of DIRS8) {
      for (let k = 1; k <= 7; k++) {
        const x = tx + dx * k, y = ty + dy * k;
        if (!w.inBounds(x, y)) { hit++; break; }
        if (this._isWall(y * w.W + x)) { hit++; break; }
      }
    }
    let f = hit / 8;
    const fl = this.game?.build?.grid?.floor?.get(ty * w.W + tx);
    if (fl && !fl.blueprint) f = Math.min(1, f + 0.15);
    return f >= 0.85 ? 1 : f >= 0.6 ? (f - 0.6) / 0.25 : 0;
  }

  // ---------- multiplayer: sounds of everyone's actions (net.js calls this before each op applies) ----------
  onOp(name, args, ctx) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.director) return;
    try { this.director.onOp(name, args || {}, ctx || {}); } catch (e) { console.warn('[audio] onOp', name, e); }
  }
}

// ---------- routed names (resolve to catalogue sounds) ----------
const WEAPON_CLASS = (w) => {
  const s = String(w || '');
  if (!s) return 'light';
  if (/spear|pike|lance/.test(s)) return 'spear';
  if (/axe|club|hammer|mace|pick|maul/.test(s)) return 'heavy';
  if (/sword|knife|dagger|blade|machete|saber/.test(s)) return 'blade';
  if (/bow/.test(s)) return 'light';
  return 'light';
};
const speciesOf = (e) => (e ? (e.species === 'bandit' || (e.kind === 'pawn' && e.isMob) ? 'bandit' : e.species) : null);
const METAL = /iron|copper|bronze|steel|chain|plate/;
const ROUTES = {
  step(o) {
    if (o.x != null && this._world?.waterAt?.(Math.floor(o.x), Math.floor(o.y)) === 2) return; // swimming: strokes instead (director)
    const s = o.surface || (o.ground && o.ground !== 'soft' ? o.ground : null) || this.surfaceAt(o.x, o.y);
    const name = 'step_' + s;
    this._sfx(this.bank.has(name) ? name : 'step_dirt', o.light ? { ...o, pitch: 1.25 * (o.pitch ?? 1), volume: (o.volume ?? 1) * 0.5 } : o);
  },
  swing(o) {
    let w = o.weapon;
    if (w === undefined) { const e = this.entityNear(o.x, o.y, 0.25); w = e ? e.weapon : null; }
    this._sfx('swing_' + WEAPON_CLASS(w), o);
  },
  hit(o) { hitRoute.call(this, 'hit', o); },
  crit(o) { hitRoute.call(this, 'crit', o); },
  growl(o) {
    const sp = o.species || speciesOf(this.entityNear(o.x, o.y, 0.6));
    this._sfx(sp && SPECIES_VOX.has(sp) && this.bank.has(sp + '_aggro') ? sp + '_aggro' : 'wolf_aggro', o);
  },
  death(o) {
    this._sfx('death', o);
    const e = o.species ? null : this.entityNear(o.x, o.y, 0.6);
    const sp = o.species || (e && e !== this.game?.player && !e.remote ? speciesOf(e) : null);
    if (sp && this.bank.has(sp + '_death')) this._sfx(sp + '_death', { ...o, volume: (o.volume ?? 1) * 1.2, dedupe: 0.3 });
  },
  voice(o) { if (o.species && o.kind) this._sfx(o.species + '_' + o.kind, o); },
  birds(o) {
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) this._sfx('bird_chirp', { ...o, delay: k * (0.08 + rnd() * 0.1), force: true });
    this._sfx('wings', o);
  },
  thunder(o) { this.thunder(o.dist ?? 0.4); },
  hotbar(o) { this._sfx('hotbar', { ...o, pitch: Math.pow(2, PENTA[((o.slot | 0) % 10 + 10) % 10] / 12) * 0.9 }); },
  zoom(o) { this._sfx('zoom', { ...o, pitch: (o.dir ?? o.delta ?? 1) > 0 ? 1.15 : 0.85 }); },
  mine(o) { this._sfx('mine', o); },
  // cosmetic wildlife (fx/wildlife.js): quiet and spaced out
  splash(o) { this._sfx((o.volume ?? 1) <= 0.3 ? 'plop' : 'splash', o); }, // a frog / small critter jumping in = a plop
  frog(o) { if (spaced.call(this, 'frog', 2.5)) this._sfx('frog', o); },
  duck(o) { if (spaced.call(this, 'duck', 3) && this._sfx('duck', o)) this._sfx('wings', { ...o, delay: 0.12, volume: (o.volume ?? 1) * 0.9, force: true }); },
  chirp(o) { if (spaced.call(this, 'chirp', 1.2)) this._sfx(Math.random() < 0.7 ? 'bird_chirp' : 'bird_warble', o); },
  // corpses: calling these every frame is fine — they re-trigger at their own pace per spot
  butcher(o) { if (spaced.call(this, 'butcher' + spot(o), 0.35)) this._sfx('butcher', o); },
  bones(o) { if (spaced.call(this, 'bones' + spot(o), 0.45)) this._sfx('bones', o); },
  flies(o) { if (o.x != null && spaced.call(this, 'flies' + spot(o), 2.4)) this._sfx('flies', { ...o, dedupe: 0 }); }, // 3 s buzz every 2.4 s = a seamless loop
};
const spot = (o) => (o.x == null ? '' : ':' + Math.round(o.x) + ',' + Math.round(o.y));
function spaced(key, gap) {
  const t = this.ctx.currentTime, k = 'route:' + key, G = this._gapT;
  if (t - (G[k] ?? -9) < gap) return false;
  G[k] = t;
  if (++this._gapN > 200) { this._gapN = 0; for (const n in G) if (t - G[n] > 30) delete G[n]; } // per-spot keys stay bounded
  return true;
}
function hitRoute(name, o) {
  this._sfx(name, o);
  const e = this.entityNear(o.x, o.y, 0.6);
  if (!e) return;
  const armor = e.armor?.body || e.armorBody || '';
  if (o.metal || METAL.test(armor)) this._sfx('hit_metal', { ...o, volume: (o.volume ?? 1) * 0.55 });
  const sp = e === this.game?.player || e.remote ? null : speciesOf(e);
  if (sp && rnd() < 0.5 && this.bank.has(sp + '_hurt')) {
    const t = this.ctx.currentTime;
    if (!e._vt || t - e._vt > 0.6) { e._vt = t; this._sfx(sp + '_hurt', { x: o.x, y: o.y, delay: 0.03, volume: 0.9 }); }
  }
}

// a short silent 8-bit WAV (iOS audio-session trick), generated in code
function silentWav() {
  const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

// ---------- singleton ----------
let ONE = null;
export function getAudio() {
  if (!ONE) {
    if (typeof window === 'undefined') return null;
    ONE = new Audio();
    ONE.installUnlock();
    window.wosAudio = ONE; // debug handle
  }
  return ONE;
}

// ---------- offline rendering (tests / tools/audio-test.html) ----------
// fn(audio) schedules sounds (use { at: seconds, force: true }) or music (audio.music.renderFor(mood, sec));
// returns { stats: analyze(buffer), ms, buffer }
// onStep(audio, t): called every `step` s during rendering (suspend/resume), like the live 100 ms tick
export async function renderOffline(fn, sec = 4, { sr = 44100, levels = DEFAULT_LEVELS, onStep = null, step = 0.25 } = {}) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Off(2, Math.ceil(sec * sr), sr);
  const a = new Audio({ ctx, offline: true, levels });
  a._enabled = true;
  const t0 = performance.now();
  await fn(a);
  if (onStep) {
    for (let t = step; t < sec - step; t += step) {
      const at = t;
      ctx.suspend(at).then(() => { try { onStep(a, at); } finally { ctx.resume(); } });
    }
  }
  const t1 = performance.now();
  const buffer = await ctx.startRendering();
  const t2 = performance.now();
  return { stats: analyze(buffer), scheduleMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1), buffer, audio: a };
}
