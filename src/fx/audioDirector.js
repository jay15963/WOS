// Audio director (cosmetic: reads game state, never writes shared state).
// - Music mood from the game: danger (creatures chasing / fighting you) > cave > home (by a campfire, or
//   indoors near a bed) > rain > dawn > night > day, with hysteresis so it never flips back and forth.
// - Everyone's actions are audible: remote avatars' footsteps, swings, bow shots, shield, herbs, deaths and
//   level-ups come from their replicated presence; creature footsteps and idle voices from the entity list
//   (host creatures or guest proxies alike); tree / chest / pickup / blueprint / station sounds from ops
//   (onOp, before they apply) — the actor's own client already played the predicted ones (ctx.mine) and
//   duplicates are merged by the engine. Doors (op door.set), build / decon / raze and the local chest lid
//   are played by the construction code (A) itself.

const MELEE = new Set(['attack', 'bash', 'stab', 'lacerate', 'cleave', 'smash', 'pierce', 'sweep', 'charge', 'torch_swing', 'whirlwind', 'disengage']);
const IDLE = new Set(['wolf', 'boar', 'bear', 'deer', 'rabbit', 'spider']);
const FIRE_STATIONS = new Set(['furnace', 'cooking_pot']);
const LIGHTS = new Set(['torch', 'brazier']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const stepK = (e) => Math.floor(((e.moveT || 0) * 8.5) / Math.PI);
const swimK = (e) => Math.floor(((e.moveT || 0) * 17) / Math.PI); // two strokes per walking step: swimming is slow

export function installAudioDirector(game, audio) {
  const music = audio.music;
  const W = new WeakMap();      // per-entity: { k (gait step), act, dead, lv, t }
  const OPEN = new WeakMap();   // door / chest: last open state
  const D = { mood: null, want: null, wantT: 0, dangerUntil: -1, moodT: 0, idleT: 5, structT: 0, hits: [], me: {}, bodyT: 0, bt: { heart: 0, shiver: 0, growl: 0, drip: 0, queasy: 0, shivK: 0 } };
  const now = () => audio.ctx.currentTime;
  const byId = (id) => game.world.objById?.get(id) || game.flora?.dyn?.get(id) || null;
  const near = (o, r) => Math.abs(o.x - audio.lx) < r && Math.abs(o.y - audio.ly) < r;

  // ---------- presentation events ----------
  const ev = game.events;
  // run before the HUD's listeners (they play a plain click): the specific sound wins
  const first = (type, fn) => {
    ev.on(type, fn);
    const l = ev.h?.get?.(type);
    if (l && l[l.length - 1] === fn) { l.pop(); l.unshift(fn); }
  };
  const muteClick = () => { if (audio.ctx) audio._muteClickUntil = now() + 0.06; };
  first('error', () => { audio.play('error'); muteClick(); });
  // panels: a chest plays its own lid (building.js); other panels open / close with a soft sweep
  const chestPanel = () => game.ui?.panels?.open === 'chest';
  first('open', (d) => { if (d?.panel !== 'chest') audio.play('ui_open'); muteClick(); });
  first('closepanels', () => { if (game.ui?.modal && !chestPanel()) { audio.play('ui_close'); muteClick(); } });
  ev.on('built', (d) => { const o = d?.o; if (o && LIGHTS.has(o.type)) audio.play('ignite', { x: o.x, y: o.y, volume: 0.5 }); });
  ev.on('sleep', () => audio.play('sleep'));
  ev.on('respawn', () => audio.play('respawn'));
  ev.on('death', () => { music.rest(25, 4); });
  ev.on('lightning', (d) => audio.thunder(d?.dist ?? 0.5));

  // ---------- per frame ----------
  // deep water (world.water 2) = swimming, derived from the position (works for replicated avatars too)
  function swimWatch(e, s, t) {
    const w = game.world;
    const swim = !e.dead && !!w?.waterAt && w.waterAt(Math.floor(e.x), Math.floor(e.y)) === 2;
    if (swim !== !!s.swim) {
      if (s.swimSeen) audio.play(swim ? 'splash_in' : 'splash_out', { x: e.x, y: e.y });
      s.swim = swim; s.sk = swimK(e); s.tread = t + 1.5;
    }
    s.swimSeen = true;
    if (!swim) return;
    const k = swimK(e);
    if (k !== s.sk) {
      s.sk = k;
      if (e.moving) { audio.play('swim_stroke', { x: e.x, y: e.y, volume: e === game.player ? 0.9 : 0.75 }); s.tread = t + 2; }
    }
    if (!e.moving && t > s.tread) { s.tread = t + 2 + Math.random() * 1.5; audio.play('swim_tread', { x: e.x, y: e.y }); }
  }

  function update(dt) {
    const p = game.player, t = now();
    swimWatch(p, D.me, t);
    // entities: footsteps, remote players' actions, deaths, level-ups
    for (const e of game.entities) {
      if (e === p || !e.isEntity) continue;
      const dx = e.x - audio.lx, dy = e.y - audio.ly;
      if (dx * dx + dy * dy > 484) continue;
      let s = W.get(e);
      if (!s) { W.set(e, { k: stepK(e), act: e.action, dead: !!e.dead, lv: e.level || 0, t: 0, hp: e.hp }); continue; }
      if (e.dead && !s.dead && e.remote) audio.play('death', { x: e.x, y: e.y });
      s.dead = !!e.dead;
      if (e.remote && s.lv && e.level > s.lv) audio.play('levelup', { x: e.x, y: e.y, volume: 0.45, world: true });
      s.lv = e.level || s.lv;
      // a remote player got hurt (their own client applied it): a hit for everyone else, unless an echo played one
      // (real blows only: small ticks — hunger, cold, poison — stay silent; at most one per 1.5 s)
      if (e.remote && !e.dead && s.hp != null && e.hp < s.hp - Math.max(2, (e.maxHp || 100) * 0.04) && t - (s.hitT || 0) > 1.5 && D.hits.length < 8) { s.hitT = t; D.hits.push({ e, t: t + 0.25 }); }
      s.hp = e.hp;
      if (e.dead) {
        if (e.isMob && (e.rotten || e.rot > 0.5 || e._rot > 0.5 || e.deadT > 120) && near(e, 14)) audio.play('flies', { x: e.x, y: e.y, volume: 0.8 });
        continue;
      }
      const k = stepK(e);
      if (k !== s.k) { s.k = k; if (e.moving) footstep(e); }
      if (e.remote && e.kind === 'pawn') {
        swimWatch(e, s, t);
        const a = e.action;
        if (a && a !== s.act && (a.t ?? 0) < 0.5 && t - s.t > 0.18) { s.t = t; action(e, a); }
        s.act = a;
      }
    }
    for (let i = D.hits.length - 1; i >= 0; i--) {
      const h = D.hits[i];
      if (t < h.t) continue;
      D.hits.splice(i, 1);
      if (!h.e.dead && !audio.recentNear(['hit', 'crit', 'block'], h.e.x, h.e.y, 0.7)) audio.play('hit', { x: h.e.x, y: h.e.y, volume: 0.7 });
    }
    D.structT -= dt;
    if (D.structT <= 0) { D.structT = 0.1; watchStructures(t); }
    D.idleT -= dt;
    if (D.idleT <= 0) { D.idleT = 3 + Math.random() * 6; idleVoice(); }
    D.moodT -= dt;
    if (D.moodT <= 0) { D.moodT = 0.5; chooseMood(t); }
    D.bodyT -= dt;
    if (D.bodyT <= 0) { D.bodyT = 0.1; body(t); }
  }

  // how the local player feels (B's p.feel when present, else derived): heartbeat, shivers, stomach,
  // dripping clothes, nausea — sparse, smooth, local only
  function body(t) {
    const p = game.player, F = p.feel || {}, T = D.bt;
    const has = (id) => !!p.buffs?.some((b) => b.id === id);
    if (p.dead) { audio.body = { hp: 1, cold: 0, warm: 0 }; T.heart = t + 1; return; }
    const hp = p.maxHp ? clamp(p.hp / p.maxHp, 0, 1) : clamp(F.hp ?? 1, 0, 1);
    const fed = p.maxHunger && p.hunger != null ? clamp(p.hunger / p.maxHunger, 0, 1) : 1;
    const cold = clamp(F.cold ?? (has('cold') ? (p.swimming || has('wet') ? 0.8 : 0.55) : 0), 0, 1);
    const wet = clamp(F.wet ?? (p.wetT > 0 ? p.wetT / 90 : has('wet') ? 0.6 : 0), 0, 1);
    const sick = clamp(F.sick ?? (has('sick') || has('poison') ? 1 : 0), 0, 1);
    const warm = clamp(F.warm ?? (has('warm') ? 1 : 0), 0, 1);
    const starving = has('starving') || fed < 0.05;
    audio.body = { hp, cold, warm };
    // heartbeat below ~35 % HP: louder and faster as it drops
    if (hp < 0.35) {
      const k = (0.35 - hp) / 0.35;
      if (t >= T.heart) { audio.play('heartbeat', { volume: 0.3 + 0.7 * k, pitch: 1 + k * 0.06 }); T.heart = t + 1.1 - 0.62 * k; }
    } else T.heart = Math.max(T.heart, t + 0.2);
    // severe cold: chattering teeth / shaky breaths
    if (cold > 0.5 && !p.swimming) {
      if (!T.shiver) T.shiver = t + 2 + Math.random() * 4;
      else if (t >= T.shiver) {
        T.shivK = (T.shivK + 1) % 2;
        audio.play(T.shivK ? 'shiver' : 'breath_cold', { volume: 0.5 + cold * 0.5 });
        T.shiver = t + 14 - 8 * (cold - 0.5) * 2 + Math.random() * 4;
      }
    } else T.shiver = 0;
    // hunger: a stomach growl now and then, more often when starving
    if (fed < 0.25 || starving) {
      if (!T.growl) T.growl = t + 8 + Math.random() * 12;
      else if (t >= T.growl) { audio.play('stomach', { volume: starving ? 1 : 0.75 }); T.growl = t + (starving ? 15 + Math.random() * 15 : 40 + Math.random() * 40); }
    } else T.growl = 0;
    // wet clothes drip for a while after leaving the water
    if (wet > 0.05 && !p.swimming) {
      if (t >= T.drip) { audio.play('drip_body', { volume: 0.3 + 0.7 * wet }); T.drip = t + (1.2 + Math.random() * 2.3) / (0.4 + wet); }
    } else T.drip = t + 1.5;
    // sick: a queasy groan now and then
    if (sick > 0.1) {
      if (!T.queasy) T.queasy = t + 3 + Math.random() * 5;
      else if (t >= T.queasy) { audio.play('queasy', { volume: 0.6 + sick * 0.4 }); T.queasy = t + 12 + Math.random() * 13; }
    } else T.queasy = 0;
  }

  function footstep(e) {
    if (e.kind === 'pawn') { audio.play('step', { x: e.x, y: e.y, volume: 0.24 }); return; }
    const sp = e.species, heavy = sp === 'bear' || sp === 'boar' || (e.scale || 1) > 1.25;
    const tiny = sp === 'rabbit' || sp === 'fox' || sp === 'spider';
    if (tiny && Math.random() < 0.5) return;
    audio.play('step', { x: e.x, y: e.y, volume: heavy ? 0.24 : tiny ? 0.07 : 0.13, light: !heavy, pitch: heavy ? 0.8 : 1 });
  }

  function action(e, a) {
    const ty = a.type, o = { x: e.x, y: e.y, weapon: e.weapon || null };
    if (MELEE.has(ty)) {
      audio.play('swing', o);
      if (ty === 'whirlwind') audio.play('swing', { ...o, delay: 0.18, force: true });
    } else if (ty === 'shoot') audio.play('bow', { x: e.x, y: e.y, delay: 0.3 });
    else if (ty === 'block') audio.play('shield_up', { x: e.x, y: e.y });
    else if (ty === 'bandage' || ty === 'heal') audio.play('heal', { x: e.x, y: e.y, volume: 0.8 });
  }

  // chests with a shared open state (if one ever exists): transitions from any source
  function watchStructures(t) {
    const B = game.build;
    if (!B) return;
    const watch = (o, a, b) => {
      const open = o.open === true || o.open > 0.5;
      const was = OPEN.get(o);
      OPEN.set(o, open);
      if (was === undefined || was === open || o.blueprint || !near(o, 24)) return;
      audio.play(open ? a : b, { x: o.x, y: o.y - 0.3 });
    };
    for (const o of B.structures || []) if (o.type === 'chest' && 'open' in o) watch(o, 'chest_open', 'chest_close');
  }

  function idleVoice() {
    const list = [];
    for (const e of game.entities) {
      if (!e.isMob || e.dead || e.state === 'chase' || !IDLE.has(e.species) || !near(e, 18)) continue;
      list.push(e);
    }
    if (!list.length || Math.random() < 0.45) return;
    const e = list[Math.floor(Math.random() * list.length)];
    if (e.species === 'spider' && audio._cave < 0.3 && Math.random() < 0.6) return;
    audio.play('voice', { x: e.x, y: e.y, species: e.species, kind: 'idle', volume: 0.8 });
  }

  function isHome() {
    const S = game.build?.structures;
    if (!S) return false;
    let bed = false;
    for (const o of S) {
      if (o.blueprint || o.removed) continue;
      if (Math.abs(o.x - audio.lx) > 9 || Math.abs(o.y - audio.ly) > 9) continue;
      const d = Math.hypot(o.x - audio.lx, o.y - audio.ly);
      if (o.type === 'campfire' && d < 5.5 && o.fire !== false) return true;
      if (o.type === 'bed' && d < 9) bed = true;
    }
    return bed && audio.indoor > 0.6;
  }

  function chooseMood(t) {
    const p = game.player, env = game.env?.env || {};
    let threat = 0;
    for (const e of game.entities) {
      if (e === p || e.dead || !e.isMob || e.state !== 'chase' || e.threat !== p) continue;
      if (Math.abs(e.x - p.x) < 20 && Math.abs(e.y - p.y) < 20) threat++;
    }
    const tg = p.target;
    if (!threat && p.inCombat && tg && !tg.dead && tg.isMob && tg.temper === 'hostile' && Math.hypot(tg.x - p.x, tg.y - p.y) < 14) threat = 1;
    if (threat && !p.dead) D.dangerUntil = t + 7;
    let m;
    if (t < D.dangerUntil) m = 'danger';
    else if (audio._cave > 0.5) m = 'cave';
    else if (isHome()) m = 'home';
    else if ((env.rain || 0) > 0.45 && audio.indoor < 0.5) m = 'rain';
    else {
      const h = env.hour ?? 12;
      m = h >= 4.8 && h < 8.3 ? 'dawn' : (env.night || 0) > 0.5 || h >= 20.3 || h < 4.8 ? 'night' : 'day';
    }
    music.intensity = clamp(0.35 + threat * 0.2 + (1 - (p.hp || 1) / (p.maxHp || 1)) * 0.35, 0.2, 1);
    if (m === D.want) D.wantT += 0.5; else { D.want = m; D.wantT = 0; }
    const need = D.mood == null || m === 'danger' ? 0 : m === 'home' ? 6 : 4;
    if (D.wantT >= need && m !== D.mood) { D.mood = m; music.setMood(m); }
  }

  // ---------- ops (every peer, before the op applies) ----------
  function onOp(name, a, ctx) {
    switch (name) {
      case 'struct.add': {
        if (ctx.mine || !Array.isArray(a.list)) break;
        const r = a.list.find((row) => Array.isArray(row) && (row[5] ?? 1) < 1);
        if (r) audio.play('blueprint', { x: r[2] + 0.5, y: r[3] + 0.5 });
        break;
      }
      case 'tree.fell': { const o = byId(a.id); if (o) audio.play('tree_creak', { x: o.x, y: o.y }); break; }
      case 'tree.land': { const o = byId(a.id); if (o) audio.play('tree_fall', { x: o.x + (o.fallDir || o.f || 1) * 1.6 * (o.s || 1), y: o.y }); break; }
      case 'loot.take': {
        if (ctx.mine) break;
        const it = (game.loot || []).find((l) => l.id === a.id);
        if (it) audio.play('pickup', { x: it.x, y: it.y, volume: 0.45 });
        break;
      }
      case 'chest.set': { if (ctx.mine) break; const o = byId(a.id); if (o) audio.play('chest_rummage', { x: o.x, y: o.y }); break; }
      case 'struct.working': {
        if (!a.on) break;
        const o = byId(a.id);
        if (o && FIRE_STATIONS.has(o.type) && !o.working) audio.play('ignite', { x: o.x, y: o.y, volume: 0.45 });
        break;
      }
      default: break;
    }
  }

  return { update, onOp, state: D };
}
