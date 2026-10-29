// Procedural audio (WebAudio, no files). Owned by the environment pass.
// API: game.audio.play(name, { x, y, volume }) — x, y in world tiles (omit for UI/non-spatial sounds).
// SFX names: hit, crit, swing, chop, mine, pickup, eat, levelup, death, growl, ui, build, fire, splash, step,
// drip (+ birds, thunder, owl used by the ambience). Unknown names are ignored.
// game.audio.enabled (bool, persisted), game.audio.volume (master 0..1), .sfxVolume, .ambVolume.
// update(game, dt) drives the soundscape that follows the camera: wind, rain, water, fire crackle,
// birds by day, crickets / owls / frogs at night, thunder after lightning. Inside mountain caves (camera
// over dark mined tiles) the outdoor beds fade, a low rumble and dripping water take over and every
// sound gets a long echo.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = Math.random;

export class Audio {
  constructor() {
    this.ctx = null;
    let en = true;
    try { en = localStorage.getItem('wos.audio.enabled') !== '0'; } catch { /* private mode */ }
    this._enabled = en;
    this._volume = 0.8;
    this.sfxVolume = 1;
    this.ambVolume = 0.9;
    this.lx = 0; this.ly = 0; this.viewW = 30;
    this._last = {};
    this._scanT = 0;
    this._near = { water: 0, flow: 0, waterPan: 0, marsh: 0, lush: 0.5, trees: 0, fire: 0, firePan: 0 };
    this._timers = { bird: 2, cricket: 0.5, owl: 15, frog: 6, crackle: 0, chorus: 0, drip: 2 };
    this._cave = 0; // smoothed "camera is in a cave" 0..1
    this._strikeId = 0;
  }

  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = !!v;
    try { localStorage.setItem('wos.audio.enabled', v ? '1' : '0'); } catch { /* ignore */ }
    this._applyMaster();
  }
  get volume() { return this._volume; }
  set volume(v) { this._volume = clamp(v, 0, 1); this._applyMaster(); }
  toggle() { this.enabled = !this.enabled; return this.enabled; }

  _applyMaster() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this._enabled ? this._volume : 0, t, 0.08);
  }

  // must be called from a user gesture (first tap/click)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; return; }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._enabled ? this._volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVolume; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = this.ambVolume; this.amb.connect(this.master);
    // small room/forest reverb send
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.6, 2.6);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.22;
    this.verbIn.connect(this.verb).connect(this.master);
    // cave echo: feedback delay fed from the sfx + ambience buses (opened only underground)
    this.echoIn = ctx.createGain(); this.echoIn.gain.value = 0;
    this.echo = ctx.createDelay(1.0); this.echo.delayTime.value = 0.23;
    const efb = ctx.createGain(); efb.gain.value = 0.36;
    const elp = ctx.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 1700;
    this.echoIn.connect(this.echo).connect(elp).connect(efb).connect(this.echo);
    elp.connect(this.master);
    this.sfx.connect(this.echoIn);
    this.amb.connect(this.echoIn);
    // noise buffers
    this.white = this._noise('white');
    this.pink = this._noise('pink');
    this.brown = this._noise('brown');
    this._beds();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
    });
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  _noise(kind, sec = 3) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    }
    // crossfade the loop seam
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }

  // looping filtered-noise beds
  _beds() {
    const ctx = this.ctx;
    const bed = (buf, type, freq, q, pan = true) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.loopStart = rnd() * 1; src.loopEnd = buf.duration;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      let out = g;
      src.connect(f).connect(g);
      let p = null;
      if (pan && ctx.createStereoPanner) { p = ctx.createStereoPanner(); g.connect(p); out = p; }
      out.connect(this.amb);
      src.start(0, rnd() * buf.duration);
      return { src, f, g, p };
    };
    this.bWind = bed(this.brown, 'bandpass', 420, 0.5, false);
    this.bWind2 = bed(this.pink, 'bandpass', 1400, 2.5, false);
    this.bRain = bed(this.white, 'highpass', 900, 0.4, false);
    this.bRain2 = bed(this.pink, 'bandpass', 2600, 0.7, false);
    this.bRiver = bed(this.pink, 'bandpass', 650, 0.6);
    this.bLake = bed(this.brown, 'lowpass', 380, 0.7);
    this.bFire = bed(this.brown, 'lowpass', 260, 0.7);
    this.bCave = bed(this.brown, 'lowpass', 110, 0.8, false); // low rumble of the mountain
  }

  _set(node, v, tc = 0.4) { node.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // ---------------------------------------------------------------- spatial helpers
  _spatial(o, range = 14) {
    if (!o || o.x == null) return { gain: 1, pan: 0 };
    const dx = o.x - this.lx, dy = (o.y ?? this.ly) - this.ly;
    const d2 = dx * dx + dy * dy;
    if (d2 > range * range * 6) return null;
    return { gain: 1 / (1 + d2 / (range * range * 0.35)), pan: clamp(dx / (this.viewW * 0.5), -1, 1) * 0.8 };
  }

  _out(gain, pan, rev = 0.25) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    let last = g;
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p; }
    last.connect(this.sfx);
    if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; last.connect(s).connect(this.verbIn); }
    return g;
  }

  _env(g, t, a, peak, d, sus = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + d);
  }

  _tone(dest, t, type, f0, f1, dur, peak, a = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this._env(g, t, a, peak, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  _burst(dest, t, buf, type, freq, q, dur, peak, a = 0.003, f1 = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this._env(g, t, a, peak, dur);
    s.connect(f).connect(g).connect(dest);
    const off = rnd() * (buf.duration - dur - 0.1);
    s.start(t, Math.max(0, off), a + dur + 0.05);
    return s;
  }

  // ---------------------------------------------------------------- SFX
  play(name, opts = {}) {
    if (!this.ctx || !this._enabled || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const minGap = { step: 0.07, hit: 0.03, swing: 0.05, chop: 0.05, mine: 0.05, splash: 0.08, ui: 0.03, pickup: 0.04, birds: 3, growl: 0.4 }[name] ?? 0.02;
    if (now - (this._last[name] || -1) < minGap) return;
    this._last[name] = now;
    const sp = this._spatial(opts.x != null ? opts : null, name === 'thunder' ? 1e3 : 14);
    if (!sp) return;
    const vol = (opts.volume ?? 1) * sp.gain;
    if (vol < 0.01) return;
    const t = now + 0.005;
    const W = this.white, P = this.pink, Br = this.brown;
    const v = (x) => x * vol;
    const fn = SFX[name];
    if (fn) fn.call(this, t, v, sp.pan, { W, P, Br, opts });
  }

  // ---------------------------------------------------------------- ambience
  update(game, dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const env = game.env.env, cam = game.cam;
    this._world = game.world;
    this.lx = cam.x; this.ly = cam.y;
    this.viewW = (game.R.cssW || 800) / (cam.zoom || 40);
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.5; this._scan(game); }
    const N = this._near;
    const amb = this.ambVolume;
    this.amb.gain.setTargetAtTime(amb, this.ctx.currentTime, 0.3);
    this.sfx.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.3);

    // caves: outdoor beds fade, echo + rumble + drips take over
    const w = game.world;
    const caveNow = w && w.caveDark ? w.caveDark(cam.x, cam.y + 0.4) : 0;
    this._cave += (caveNow - this._cave) * (1 - Math.exp(-dt * 1.2));
    const cave = this._cave, out = 1 - cave * 0.88;
    this._set(this.verbIn, 0.22 + 0.55 * cave, 0.5);
    this._set(this.echoIn, cave * 0.42, 0.5);
    this._set(this.bCave.g, cave * 0.05, 1.0);

    // wind: always a little, gusts open the filter
    const wind = env.wind ?? 0.2;
    this._set(this.bWind.g, (0.035 + wind * 0.13) * out, 0.6);
    this.bWind.f.frequency.setTargetAtTime(260 + wind * 520 + (env.gust || 0) * 260, this.ctx.currentTime, 0.8);
    this._set(this.bWind2.g, Math.max(0, wind - 0.5) * 0.05 * out, 0.8);
    this.bWind2.f.frequency.setTargetAtTime(1100 + (env.gust || 0) * 700, this.ctx.currentTime, 1.0);
    // rain (muffled to a distant hiss underground)
    const rain = env.rain || 0;
    this._set(this.bRain.g, rain * 0.075 * (1 - cave * 0.93), 1.2);
    this._set(this.bRain2.g, rain * 0.05 * (1 - cave * 0.8), 1.2);
    // water
    this._set(this.bRiver.g, N.flow * 0.12, 0.8);
    if (this.bRiver.p) this.bRiver.p.pan.setTargetAtTime(N.waterPan * 0.6, this.ctx.currentTime, 0.5);
    const lap = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 1.7) * Math.sin(performance.now() / 1000 * 0.6);
    this._set(this.bLake.g, N.water * (0.05 + 0.06 * lap) * (1 - N.flow * 0.5), 0.3);
    if (this.bLake.p) this.bLake.p.pan.setTargetAtTime(N.waterPan * 0.6, this.ctx.currentTime, 0.5);
    // fire
    this._set(this.bFire.g, N.fire * 0.05, 0.3);
    if (this.bFire.p) this.bFire.p.pan.setTargetAtTime(N.firePan, this.ctx.currentTime, 0.3);

    const T = this._timers;
    const day = env.day || 0, night = (env.night || 0) * (1 - cave), hour = env.hour ?? 12;
    const calm = (1 - rain) * (1 - Math.max(0, wind - 0.6) * 1.5) * (1 - cave);
    // unseen drips somewhere in the dark
    if (cave > 0.35) {
      T.drip -= dt * cave;
      if (T.drip <= 0) { T.drip = 1.4 + rnd() * 4; this._drip((rnd() - 0.5) * 1.6, 0.25 + rnd() * 0.35); }
    }
    // fire crackle
    if (N.fire > 0.02) {
      T.crackle -= dt;
      if (T.crackle <= 0) { T.crackle = 0.04 + rnd() * 0.22; this._crackle(N.fire, N.firePan); }
    }
    // birds by day (dawn chorus)
    const chorus = hour > 5.2 && hour < 8.5 ? 1.8 : 1;
    if (day > 0.2 && calm > 0.2) {
      T.bird -= dt * day * calm * chorus * (0.4 + N.lush * 0.5 + N.trees * 0.8);
      if (T.bird <= 0) { T.bird = 1.2 + rnd() * 3.5; this._bird(N.trees > 0.4 && rnd() < 0.35 ? 2 : Math.floor(rnd() * 2)); }
    }
    // crickets / owls / frogs at night
    if (night > 0.4 && rain < 0.4) {
      T.cricket -= dt * night * (0.5 + N.lush);
      if (T.cricket <= 0) { T.cricket = 0.25 + rnd() * 0.6; this._cricket(); }
      T.owl -= dt * N.trees;
      if (T.owl <= 0) { T.owl = 18 + rnd() * 30; this._owl(); }
      T.frog -= dt * (N.marsh * 2 + N.water * 0.6);
      if (T.frog <= 0) { T.frog = 2 + rnd() * 5; this._frog(); }
    }
    // thunder after lightning (delay grows with distance)
    const E = game.env;
    if (E.strikeId !== this._strikeId) {
      this._strikeId = E.strikeId;
      const s = E.strikes[E.strikes.length - 1];
      if (s) this._thunder(s.dist);
    }
  }

  _groundAt(x, y) {
    const w = this._world;
    if (!w || x == null) return null;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (w.waterAt(tx, ty)) return 'water';
    const g = w.groundAt(tx, ty);
    return g === 2 ? 'sand' : g === 3 ? 'gravel' : g === 6 ? 'stone' : 'soft';
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
      if (w.water[i]) {
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
        const d = Math.hypot(o.x - this.lx, o.y - this.ly), k = clamp(1 - d / 10, 0, 1) ** 1.5 * (typeof o.fire === 'number' ? o.fire : 1);
        fire += k; fpan += clamp((o.x - this.lx) / (this.viewW * 0.5), -1, 1) * k;
      } else if (o.type && o.type.startsWith('tree_')) trees++;
    }
    N.trees = clamp(trees / 25, 0, 1);
    N.fire = clamp(fire, 0, 1.2); // sync-ok: audio mixer level, not a world object
    N.firePan = fire > 0 ? fpan / fire : 0;
  }

  // ---------------------------------------------------------------- ambient voices
  _voice(pan, gain, rev = 0.35) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    let last = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); last = p; }
    last.connect(this.amb);
    const s = ctx.createGain(); s.gain.value = rev; last.connect(s).connect(this.verbIn);
    return g;
  }

  _bird(kind) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const out = this._voice((rnd() - 0.5) * 1.6, 0.05 + rnd() * 0.05);
    if (kind === 0) {
      // bright rising chirps
      const n = 2 + Math.floor(rnd() * 4), base = 2600 + rnd() * 1600;
      for (let k = 0; k < n; k++) this._tone(out, t + k * (0.09 + rnd() * 0.04), 'sine', base * (0.9 + rnd() * 0.15), base * 1.45, 0.06, 0.9);
    } else if (kind === 1) {
      // warbling trill (FM)
      const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
      const f = 3000 + rnd() * 1500, dur = 0.5 + rnd() * 0.6;
      o.frequency.value = f; m.frequency.value = 18 + rnd() * 14; mg.gain.value = f * 0.12;
      m.connect(mg).connect(o.frequency);
      o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.8 + rnd() * 0.4), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
      g.gain.setValueAtTime(0.7, t + dur - 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out); o.start(t); m.start(t); o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
    } else {
      // two-note forest call (cuckoo-ish, soft)
      const f = 620 + rnd() * 180;
      this._tone(out, t, 'sine', f * 1.26, f * 1.22, 0.22, 0.8, 0.02);
      this._tone(out, t + 0.3, 'sine', f, f * 0.97, 0.32, 0.8, 0.02);
    }
  }

  _cricket() {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const out = this._voice((rnd() - 0.5) * 1.8, 0.012 + rnd() * 0.014, 0.2);
    const f = 4300 + rnd() * 700, pulses = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < pulses; k++) this._tone(out, t + k * 0.045, 'sine', f, f, 0.025, 1, 0.004);
  }

  _owl() {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const out = this._voice((rnd() - 0.5) * 1.4, 0.06, 0.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(out);
    const f = 330 + rnd() * 50;
    this._tone(lp, t, 'sine', f, f * 0.92, 0.35, 0.9, 0.08);
    this._tone(lp, t + 0.55, 'sine', f * 1.02, f * 0.9, 0.22, 0.6, 0.05);
    this._tone(lp, t + 0.85, 'sine', f, f * 0.88, 0.45, 0.8, 0.06);
  }

  _frog() {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const out = this._voice((rnd() - 0.5) * 1.6, 0.03 + rnd() * 0.02, 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520 + rnd() * 250; bp.Q.value = 3; bp.connect(out);
    for (let k = 0; k < 2; k++) this._tone(bp, t + k * 0.13, 'sawtooth', 180 + rnd() * 40, 140, 0.08, 1, 0.01);
  }

  _crackle(I, pan) {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const out = this._voice(pan, 0.05 * Math.min(1, I) * (0.4 + rnd() * 0.8), 0.15);
    this._burst(out, t, this.white, 'highpass', 1800 + rnd() * 2500, 0.8, 0.008 + rnd() * 0.02, 1, 0.001);
    if (rnd() < 0.25) this._burst(out, t + 0.03, this.white, 'bandpass', 900 + rnd() * 800, 1.5, 0.03, 0.6, 0.002);
  }

  _drip(pan, vol = 1) {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const out = this._voice(pan, 0.07 * vol, 0.9);
    const f = 850 + rnd() * 900;
    this._tone(out, t, 'sine', f, f * 2.6, 0.045, 0.9, 0.002);
    this._tone(out, t + 0.012, 'sine', f * 1.9, f * 3.1, 0.06, 0.35, 0.002);
  }

  _thunder(dist) {
    const ctx = this.ctx, delay = 0.25 + dist * 2.6, t = ctx.currentTime + delay;
    const out = this._voice((rnd() - 0.5) * 0.8, 0.55 * (1.2 - dist * 0.6), 0.5);
    if (dist < 0.45) this._burst(out, t, this.white, 'highpass', 1200, 0.5, 0.25, 0.6, 0.002);
    const s = ctx.createBufferSource(); s.buffer = this.brown;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(1100 - dist * 500, t); f.frequency.exponentialRampToValueAtTime(110, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.08 + dist * 0.3);
    g.gain.setTargetAtTime(0.35, t + 0.5, 0.4); g.gain.setTargetAtTime(0.0001, t + 1.5, 1.1);
    s.connect(f).connect(g).connect(out);
    s.start(t, rnd() * 0.5, 6); s.stop(t + 6);
  }
}

// ---------------------------------------------------------------- SFX recipes
// this = Audio; t = start time; v(x) = scaled volume; pan; { W, P, Br, opts }
const SFX = {
  hit(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.15);
    this._burst(o, t, W, 'lowpass', 1400, 0.7, 0.09, v(0.55));
    this._tone(o, t, 'sine', 150, 60, 0.12, v(0.6));
  },
  crit(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.3);
    this._burst(o, t, W, 'lowpass', 2200, 0.7, 0.12, v(0.7));
    this._tone(o, t, 'sine', 170, 55, 0.16, v(0.75));
    this._tone(o, t + 0.01, 'triangle', 1250, 1150, 0.3, v(0.2));
    this._tone(o, t + 0.01, 'triangle', 1870, 1800, 0.22, v(0.12));
  },
  swing(t, v, pan, { P }) {
    const o = this._out(1, pan, 0.1);
    this._burst(o, t, P, 'bandpass', 500, 1.4, 0.17, v(0.45), 0.03, 2600);
  },
  chop(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.3);
    this._tone(o, t, 'triangle', 240, 130, 0.09, v(0.55));
    this._burst(o, t, W, 'bandpass', 1300, 1.2, 0.07, v(0.5));
    this._burst(o, t + 0.015, W, 'highpass', 3500, 0.6, 0.03, v(0.2));
  },
  mine(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.35);
    const f = 1700 + rnd() * 300;
    this._tone(o, t, 'triangle', f, f * 0.98, 0.16, v(0.28));
    this._tone(o, t, 'sine', f * 1.51, f * 1.49, 0.11, v(0.16));
    this._burst(o, t, W, 'highpass', 2500, 0.7, 0.04, v(0.45));
    this._burst(o, t + 0.01, W, 'lowpass', 700, 0.7, 0.08, v(0.3));
  },
  pickup(t, v, pan) {
    const o = this._out(1, pan, 0.2);
    this._tone(o, t, 'sine', 660, 660, 0.08, v(0.3));
    this._tone(o, t + 0.07, 'sine', 990, 990, 0.12, v(0.28));
  },
  eat(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.05);
    for (let k = 0; k < 3; k++) this._burst(o, t + k * 0.11 + rnd() * 0.02, W, 'bandpass', 1800 + rnd() * 1400, 1.5, 0.05, v(0.4));
  },
  levelup(t, v, pan) {
    const o = this._out(1, pan, 0.5);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
      this._tone(o, t + k * 0.09, 'triangle', f, f, 0.45, v(0.22));
      this._tone(o, t + k * 0.09, 'sine', f * 2, f * 2, 0.3, v(0.06));
    });
  },
  death(t, v, pan, { Br }) {
    const o = this._out(1, pan, 0.4);
    this._tone(o, t, 'triangle', 240, 70, 0.9, v(0.35), 0.02);
    this._burst(o, t, Br, 'lowpass', 500, 0.7, 0.7, v(0.35), 0.02, 120);
  },
  growl(t, v, pan) {
    const ctx = this.ctx, o = this._out(1, pan, 0.25);
    const osc = ctx.createOscillator(), am = ctx.createOscillator(), amg = ctx.createGain(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    const f = 70 + rnd() * 40, dur = 0.55 + rnd() * 0.3;
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f, t); osc.frequency.linearRampToValueAtTime(f * 0.8, t + dur);
    am.frequency.value = 22 + rnd() * 10; amg.gain.value = 0.5;
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v(0.4), t + 0.08); g.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.1);
    am.connect(amg).connect(g.gain);
    osc.connect(lp).connect(g).connect(o);
    osc.start(t); am.start(t); osc.stop(t + dur + 0.4); am.stop(t + dur + 0.4);
  },
  ui(t, v) {
    const o = this._out(1, 0, 0);
    this._tone(o, t, 'sine', 1250, 1150, 0.035, v(0.18), 0.002);
  },
  build(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.3);
    for (let k = 0; k < 2; k++) {
      this._tone(o, t + k * 0.16, 'triangle', 200, 120, 0.08, v(0.45));
      this._burst(o, t + k * 0.16, W, 'bandpass', 1100, 1, 0.05, v(0.4));
    }
  },
  fire(t, v, pan, { P }) {
    const o = this._out(1, pan, 0.3);
    this._burst(o, t, P, 'bandpass', 300, 0.8, 0.55, v(0.5), 0.08, 1600);
  },
  splash(t, v, pan, { W }) {
    const o = this._out(1, pan, 0.3);
    this._burst(o, t, W, 'bandpass', 900, 0.8, 0.22, v(0.45), 0.005, 400);
    for (let k = 0; k < 3; k++) this._tone(o, t + 0.04 + rnd() * 0.12, 'sine', 1400 + rnd() * 1200, 2200 + rnd() * 900, 0.04, v(0.08));
  },
  step(t, v, pan, { W, opts }) {
    // surface-aware footstep (ground under x, y if a world is known)
    const g = opts.ground ?? this._groundAt?.(opts.x, opts.y);
    const o = this._out(1, pan, 0.05);
    if (g === 'water') this._burst(o, t, W, 'bandpass', 1100, 0.9, 0.09, v(0.22));
    else if (g === 'sand' || g === 'gravel') this._burst(o, t, W, 'highpass', 1800, 0.6, 0.05, v(0.14));
    else if (g === 'stone') { this._burst(o, t, W, 'bandpass', 2200, 1.4, 0.025, v(0.16)); this._tone(o, t, 'sine', 210, 150, 0.03, v(0.08)); }
    else this._burst(o, t, W, 'lowpass', 700 + rnd() * 300, 0.7, 0.05, v(0.2));
  },
  birds(t, v, pan) {
    // a flock passing: a few quick chirps
    const out = this._out(0.6, pan, 0.4);
    for (let k = 0; k < 4; k++) { const f = 2400 + rnd() * 1800; this._tone(out, t + k * 0.12 + rnd() * 0.08, 'sine', f, f * 1.3, 0.05, v(0.12)); }
  },
  thunder(t, v) { void t; void v; this._thunder(0.4); },
  drip(t, v, pan) {
    // a drop falling into a puddle in a cave
    const o = this._out(1, pan, 0.8);
    const f = 900 + rnd() * 800;
    this._tone(o, t, 'sine', f, f * 2.5, 0.045, v(0.16), 0.002);
    this._tone(o, t + 0.01, 'sine', f * 1.8, f * 3.0, 0.06, v(0.07), 0.002);
  },
  owl() { this._owl(); },
};
