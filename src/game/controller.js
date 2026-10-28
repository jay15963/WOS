// Player controller: taps/clicks/keys -> intents (target, engage, interact, walk), goal steering
// via player.autoMove, contextual nearest-interactable, ground rings (target / marker / hint).

import { steer, resetNav } from './nav.js';
import { attackable, dist, reach } from './combat.js';
import { useAbility, nearestEnemy } from './abilities.js';
import { describeObject, describeRock, reachDist, startWork } from './gathering.js';
import { describeStructure, useStructure, buildTap, exitBuildMode } from './building.js';
import { eatBest } from './survival.js';
import { ABILITY_ORDER, SPECIES, TEMPER_COLOR } from './data.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const RING_COL = { hostile: hex(TEMPER_COLOR.hostile), neutral: hex(TEMPER_COLOR.neutral), passive: hex(TEMPER_COLOR.passive) };

function objHit(o, wx, wy, tol) {
  const s = o.s || 1;
  if (o.type.startsWith('tree_')) {
    const h = 2.1 * s * (o.age ?? 1);
    return Math.abs(wx - o.x) < 0.5 * s * (o.age ?? 1) + tol && wy < o.y + 0.25 && wy > o.y - h;
  }
  if (o.type === 'wall_wood') return wx >= o.tx && wx < o.tx + 1 && wy > o.ty - 0.45 && wy < o.ty + 1;
  const r = (o.type === 'boulder' ? 0.5 : 0.45) * s + tol;
  return Math.hypot(wx - o.x, wy - (o.y - 0.3 * s)) < r;
}

export function pick(game, sx, sy) {
  const [wx, wy] = game.screenToWorld(sx, sy);
  const tol = 14 / game.cam.zoom;
  let best = null, bd = 1;
  for (const e of game.entities) {
    if (e.kind !== 'animal' || e.dead) continue;
    const sc = e.scale || 1;
    const rx = 0.55 * sc + tol, ry = 0.5 * sc + tol;
    const dx = (wx - e.x) / rx, dy = (wy - (e.y - 0.35 * sc)) / ry;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; }
  }
  if (best) return { type: 'creature', e: best, wx, wy };
  let hit = null;
  game.world.forChunks(wx - 2, wy - 1, wx + 2, wy + 3, (c) => {
    for (const o of c.objects) {
      if (Math.abs(o.x - wx) > 1.5 || o.y < wy - 0.6 || o.y > wy + 2.6) continue;
      if (!objHit(o, wx, wy, tol)) continue;
      const d = o.building ? describeStructure(game, o) : describeObject(game, o);
      if (d && (!hit || o.y > hit.o.y)) hit = d;
    }
  });
  if (hit) return { type: 'interact', it: hit, wx, wy };
  const rk = describeRock(game, Math.floor(wx), Math.floor(wy));
  if (rk) return { type: 'interact', it: rk, wx, wy };
  for (const it of game.loot) if (Math.hypot(wx - it.x, wy - it.y + 0.15) < 0.4 + tol) return { type: 'loot', it, wx, wy };
  return { type: 'ground', wx, wy };
}

export function nearestInteractable(game) {
  const p = game.player;
  let best = null, bs = 1e9;
  const [fx, fy] = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[p.facing] || [0, 1];
  const consider = (it, bonus = 0) => {
    if (!it) return;
    const d = reachDist(p, it);
    if (d > it.reach + 0.8) return;
    const score = d - (it.prio || 0) * 0.2 - bonus;
    if (score < bs) { bs = score; best = it; }
  };
  game.world.forChunks(p.x - 3, p.y - 3, p.x + 3, p.y + 3, (c) => {
    for (const o of c.objects) {
      if (Math.abs(o.x - p.x) > 2.6 || Math.abs(o.y - p.y) > 2.6) continue;
      consider(o.building ? describeStructure(game, o) : describeObject(game, o));
    }
  });
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    consider(describeRock(game, tx + dx, ty + dy), dx === fx && dy === fy ? 0.3 : 0);
  }
  return best;
}

export function installController(game) {
  const ctl = {
    goal: null, manual: false, hover: null, mouse: null, near: null, nearT: 0, marker: null, hinted: {},
    setTarget(t) {
      const p = game.player;
      if (p.target !== t) { p.target = t; if (!t) p.autoAttack = false; game.events.emit('target', { target: t }); }
    },
    engage(t) {
      const p = game.player;
      if (!attackable(t) || p.dead) return;
      ctl.setTarget(t);
      p.autoAttack = true;
      if (p.work) { p.work = null; p.action = null; }
      ctl.goal = { type: 'attack', target: t };
      resetNav(p);
    },
    toggleAttack() {
      const p = game.player;
      if (p.dead) return;
      if (p.autoAttack && attackable(p.target)) { p.autoAttack = false; if (ctl.goal?.type === 'attack') ctl.goal = null; return; }
      const t = attackable(p.target) ? p.target : nearestEnemy(game, 10);
      if (!t) { game.events.emit('error', { text: 'Sem alvo' }); return; }
      ctl.engage(t);
    },
    cycleTarget() {
      const p = game.player;
      const list = game.entities.filter((e) => attackable(e) && dist(e, p) < 18).sort((a, b) => {
        const ka = (SPECIES[a.species].temper === 'passive' ? 6 : 0) + dist(a, p), kb = (SPECIES[b.species].temper === 'passive' ? 6 : 0) + dist(b, p);
        return ka - kb;
      });
      if (!list.length) { game.events.emit('error', { text: 'Nenhum alvo por perto' }); return; }
      const i = list.indexOf(p.target);
      ctl.setTarget(list[(i + 1) % list.length]);
    },
    interact(it) {
      const p = game.player;
      if (p.dead) return;
      it = it || ctl.near;
      if (!it) {
        if (attackable(p.target)) { ctl.engage(p.target); return; }
        game.events.emit('error', { text: 'Nada por perto' });
        return;
      }
      if (p.work && p.work.it.o === it.o && p.work.it.tx === it.tx && p.work.it.ty === it.ty) return;
      p.autoAttack = false;
      ctl.goal = { type: 'interact', it };
      resetNav(p);
    },
    walkTo(x, y) {
      ctl.goal = { type: 'move', x, y };
      ctl.marker = { x, y, t: 0 };
      resetNav(game.player);
    },
  };
  game.ctl = ctl;

  const canvas = game.R.canvas;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') ctl.mouse = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerleave', () => { ctl.mouse = null; });

  const doTap = (tap) => {
    const p = game.player;
    if (p.dead) return;
    if (game.ui?.modal) { game.events.emit('closepanels', {}); return; }
    const isMouse = tap.mouse;
    if (game.build.mode) {
      const [wx, wy] = game.screenToWorld(tap.x, tap.y);
      buildTap(game, wx, wy, isMouse);
      return;
    }
    const h = pick(game, tap.x, tap.y);
    if (h.type === 'creature') {
      const e = h.e, temper = SPECIES[e.species].temper;
      const fighting = e.state === 'chase' && e.threat === p;
      if (p.target === e || temper === 'hostile' || fighting) ctl.engage(e);
      else {
        ctl.setTarget(e);
        if (!ctl.hinted.tap2) { ctl.hinted.tap2 = true; game.events.emit('toast', { text: 'Toque de novo para atacar', kind: 'info' }); }
      }
      return;
    }
    if (h.type === 'interact') { ctl.interact(h.it); return; }
    if (h.type === 'loot') { ctl.walkTo(h.it.x, h.it.y); return; }
    if (p.target && !isMouse) { ctl.setTarget(null); ctl.goal = null; return; }
    if (p.target && isMouse) ctl.setTarget(null);
    ctl.walkTo(h.wx, h.wy);
  };

  let hoverT = 0;
  return {
    update(g, dt) {
      const p = g.player, inp = g.input;
      // hover (desktop mouse)
      if (ctl.mouse && !inp.isTouch) {
        const [wx, wy] = g.screenToWorld(ctl.mouse.x, ctl.mouse.y);
        ctl.hover = { wx, wy, fresh: true };
        hoverT -= dt;
        if (hoverT <= 0) {
          hoverT = 0.12;
          const h = pick(g, ctl.mouse.x, ctl.mouse.y);
          canvas.style.cursor = g.build.mode ? 'crosshair' : h.type === 'ground' ? 'default' : 'pointer';
          ctl.hoverPick = h;
        }
      } else { ctl.hover = null; ctl.hoverPick = null; }

      // keys
      const K = inp.pressed;
      if (K.size && !p.dead) {
        ABILITY_ORDER.forEach((id, i) => { if (K.has('Digit' + (i + 1)) || K.has('Numpad' + (i + 1))) useAbility(g, id); });
        if (K.has('Tab')) ctl.cycleTarget();
        if (K.has('KeyE') || K.has('Space')) ctl.interact();
        if (K.has('KeyF')) ctl.toggleAttack();
        if (K.has('KeyQ')) eatBest(g);
        if (K.has('Escape')) {
          if (g.build.mode) exitBuildMode(g);
          else if (g.ui?.modal) g.events.emit('closepanels', {});
          else { ctl.setTarget(null); ctl.goal = null; }
        }
      }
      if (K.has('KeyI')) g.events.emit('toggle', { panel: 'inv' });
      if (K.has('KeyB')) g.events.emit('toggle', { panel: 'build' });
      if (K.has('KeyM')) g.events.emit('toggle', { panel: 'map' });

      // taps / clicks
      for (const t of inp.taps) doTap({ x: t.x, y: t.y, mouse: t.type === 'mouse' });

      // manual movement cancels goals & work
      const [mx, my] = inp.move();
      ctl.manual = !!(mx || my);
      if (ctl.manual) {
        if (ctl.goal) ctl.goal = null;
        if (p.work) { p.work = null; p.action = null; }
      }

      // goal steering
      p.autoMove = null;
      const goal = ctl.goal;
      if (goal && !p.dead && !p.charge) {
        const spd = p.speed || 4;
        if (goal.type === 'move') {
          const dir = steer(g, p, goal.x, goal.y, dt, spd, 0.15);
          if (!dir) ctl.goal = null; else p.autoMove = dir;
        } else if (goal.type === 'attack') {
          const t = goal.target;
          if (!attackable(t) || p.target !== t || !p.autoAttack) ctl.goal = null;
          else if (dist(p, t) > reach(p, t) * 0.92) p.autoMove = steer(g, p, t.x, t.y, dt, spd, reach(p, t) * 0.85);
        } else if (goal.type === 'interact') {
          const it = goal.it;
          if (reachDist(p, it) <= it.reach) {
            ctl.goal = null;
            if (it.kind === 'chest' || it.kind === 'bed' || it.kind === 'dismantle' || it.kind === 'cook') useStructure(g, it);
            else startWork(g, it);
          } else {
            const gx = it.tile ? Math.max(it.tx, Math.min(it.tx + 1, p.x)) : it.x;
            const gy = it.tile ? Math.max(it.ty, Math.min(it.ty + 1, p.y)) : it.y;
            const dir = steer(g, p, gx, gy, dt, spd, 0.05);
            if (!dir || (p.nav && p.nav.fails > 2)) { ctl.goal = null; if (p.nav?.fails > 2) g.events.emit('error', { text: 'Caminho bloqueado' }); }
            else p.autoMove = dir;
          }
        }
      }

      // contextual interactable (5 Hz)
      ctl.nearT -= dt;
      if (ctl.nearT <= 0) { ctl.nearT = 0.2; ctl.near = p.dead ? null : nearestInteractable(g); }
      if (ctl.marker) { ctl.marker.t += dt; if (ctl.marker.t > 0.9 || !ctl.goal) ctl.marker = null; }
    },

    render(g, B, v, env) {
      const A = g.A, p = g.player;
      if (!A.has('fx_ring')) return;
      const ring = A.get('fx_ring');
      const t = p.target;
      if (t && !t.dead) {
        const sc = t.scale || 1;
        const c = RING_COL[SPECIES[t.species]?.temper] || RING_COL.neutral;
        const pulse = 0.85 + 0.15 * Math.sin(g.time * 5);
        B.blob.add(ring, t.x, t.y, 1.15 * sc * pulse, 0.75 * sc * pulse, c[0], c[1], c[2], 0.95);
        if (env.night > 0.1) B.emissive.add(ring, t.x, t.y, 1.15 * sc * pulse, 0.75 * sc * pulse, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0.6 * env.night);
      }
      const n = ctl.near;
      if (n && !p.work && !g.build.mode && !(t && !t.dead && p.autoAttack)) {
        const s = n.tile ? 1.0 : n.kind === 'tree' ? 0.9 : 0.8;
        const a = 0.35 + 0.15 * Math.sin(g.time * 4);
        B.blob.add(ring, n.x, n.tile ? n.y : n.y - 0.02, s, s * 0.62, 1, 0.95, 0.8, a);
      }
      const m = ctl.marker;
      if (m) {
        const k = m.t / 0.9;
        B.blob.add(ring, m.x, m.y, 0.6 * (1 - k * 0.5), 0.38 * (1 - k * 0.5), 1, 1, 1, 0.8 * (1 - k));
      }
    },
  };
}
