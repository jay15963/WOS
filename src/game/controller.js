// Player controller: taps/clicks/keys -> intents (target, engage, interact, walk), goal steering
// via player.autoMove, contextual nearest-interactable, ground rings (target / marker / hint).
// Modes: build placement (ghost, drag line/area), deconstruct, mining designation (desktop: mouse
// drag rectangles; touch: taps). Auto work (work.js) feeds goals with { auto: true }.

import { steer, resetNav } from './nav.js';
import { attackable, dist, reach, isMob, attackRange, hasLOS } from './combat.js';
import { useAbility, nearestEnemy } from './abilities.js';
import { describeObject, reachDist } from './gathering.js';
import { describeStructure, buildTap, exitBuildMode, commitPlacement, structureAtPoint, buildDragStart, buildDragMove, buildDragEnd, cancelBuild, rotateBuild } from './building.js';
import { describeRock, designate, designateRect, isRock } from './mining.js';
import { useInteract } from './work.js';
import { eatBest } from './survival.js';
import { ABILITY_ORDER, SPECIES, TEMPER_COLOR, BUILDINGS } from './data.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const RING_COL = { hostile: hex(TEMPER_COLOR.hostile), neutral: hex(TEMPER_COLOR.neutral), passive: hex(TEMPER_COLOR.passive) };
const SMALL = new Set(['pebble', 'stick', 'fibergrass', 'wild_potato', 'wild_cotton', 'wild_corn', 'crop']);

function objHit(o, wx, wy, tol) {
  const s = o.s || 1;
  if (o.type.startsWith('tree_')) {
    if (o.stump) return Math.hypot(wx - o.x, wy - (o.y - 0.15)) < 0.45 + tol;
    const h = 2.1 * s * (o.age ?? 1);
    return Math.abs(wx - o.x) < 0.5 * s * (o.age ?? 1) + tol && wy < o.y + 0.25 && wy > o.y - h;
  }
  if (o.building) {
    const def = BUILDINGS[o.type];
    const sw = o.fw || def?.size[0] || 1, sh = o.fh || def?.size[1] || 1;
    const top = def?.flat ? 0 : def?.block === 'tile' || def?.block === 'door' ? 0.55 : 0.9;
    return wx >= o.tx - tol && wx < o.tx + sw + tol && wy > o.ty - top && wy < o.ty + sh + tol * 0.5;
  }
  if (SMALL.has(o.type)) return Math.hypot(wx - o.x, wy - (o.y - 0.12)) < 0.36 + tol;
  const r = (o.type === 'boulder' ? 0.5 : 0.45) * s + tol;
  return Math.hypot(wx - o.x, wy - (o.y - 0.3 * s)) < r;
}

// descriptor for any world object (natural, structure, crop)
export function describeAny(game, o) {
  if (o.building) return describeStructure(game, o);
  if (o.type === 'crop') {
    const plot = structureAtPoint(game, o.tx + 0.5, o.ty + 0.5);
    return plot && plot.type === 'farm_plot' ? describeStructure(game, plot) : null;
  }
  return describeObject(game, o);
}

export function pick(game, sx, sy) {
  const [wx, wy] = game.screenToWorld(sx, sy);
  const tol = 14 / game.cam.zoom;
  let best = null, bd = 1;
  for (const e of game.entities) {
    if (!isMob(e) || e.dead) continue;
    const sc = e.scale || 1;
    // humanoid raiders are taller and thinner than animals
    const pawn = e.kind === 'pawn';
    const rx = (pawn ? 0.42 : 0.55) * sc + tol, ry = (pawn ? 0.78 : 0.5) * sc + tol;
    const dx = (wx - e.x) / rx, dy = (wy - (e.y - (pawn ? 0.7 : 0.35) * sc)) / ry;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; }
  }
  // breakable props (bandit crates)
  for (const o of game.props || []) {
    if (o.broken) continue;
    const dx = (wx - o.x) / (0.5 + tol), dy = (wy - (o.y - 0.3)) / (0.45 + tol);
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = o; }
  }
  if (best) return { type: 'creature', e: best, wx, wy };
  let hit = null, hitFlat = null;
  game.world.forChunks(wx - 2, wy - 1, wx + 2, wy + 3, (c) => {
    for (const o of c.objects) {
      if (Math.abs(o.x - wx) > 2.5 || o.y < wy - 0.6 || o.y > wy + 2.6) continue;
      if (!objHit(o, wx, wy, tol)) continue;
      const d = describeAny(game, o);
      if (!d) continue;
      if (o.flat) { if (!hitFlat) hitFlat = d; continue; }
      if (!hit || o.y > hit.o.y) hit = d;
    }
  });
  if (hit) return { type: 'interact', it: hit, wx, wy };
  const rk = describeRock(game, Math.floor(wx), Math.floor(wy));
  if (rk) return { type: 'interact', it: rk, wx, wy };
  for (const it of game.loot) if (Math.hypot(wx - it.x, wy - it.y + 0.15) < 0.4 + tol) return { type: 'loot', it, wx, wy };
  if (hitFlat) return { type: 'interact', it: hitFlat, wx, wy };
  if (isRock(game, Math.floor(wx), Math.floor(wy))) return { type: 'rock', tx: Math.floor(wx), ty: Math.floor(wy), wx, wy };
  return { type: 'ground', wx, wy };
}

export function nearestInteractable(game) {
  const p = game.player;
  let best = null, bs = 1e9;
  const [fx, fy] = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[p.facing] || [0, 1];
  const consider = (it, bonus = 0) => {
    if (!it || (it.prio ?? 0) < 0) return;
    const d = reachDist(p, it);
    if (d > it.reach + 0.8) return;
    const score = d - (it.prio || 0) * 0.2 - bonus;
    if (score < bs) { bs = score; best = it; }
  };
  game.world.forChunks(p.x - 3, p.y - 3, p.x + 3, p.y + 3, (c) => {
    for (const o of c.objects) {
      if (Math.abs(o.x - p.x) > 3 || Math.abs(o.y - p.y) > 3) continue;
      consider(describeAny(game, o));
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
    goal: null, manual: false, hover: null, mouse: null, near: null, nearT: 0, marker: null, hinted: {}, dragging: false,
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
      const tmp = (e) => e.temper || SPECIES[e.species]?.temper;
      const list = game.entities.filter((e) => attackable(e) && dist(e, p) < 18).sort((a, b) => {
        const ka = (tmp(a) === 'passive' ? 6 : 0) + dist(a, p), kb = (tmp(b) === 'passive' ? 6 : 0) + dist(b, p);
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
      if (it.kind === 'rock') designate(game, it.tx, it.ty, true);
      p.autoAttack = false;
      ctl.goal = { type: 'interact', it };
      resetNav(p);
    },
    walkTo(x, y) {
      ctl.goal = { type: 'move', x, y };
      ctl.marker = { x, y, t: 0 };
      resetNav(game.player);
    },
    toggleMineMode(on = null) {
      const M = game.mining;
      M.mode = on == null ? !M.mode : on;
      M.anchor = M.end = null;
      if (M.mode) {
        if (game.build.mode) exitBuildMode(game);
        if (!ctl.hinted.minemode) { ctl.hinted.minemode = true; game.events.emit('toast', { text: game.input.isTouch ? 'Toque nas rochas para marcar (toque de novo desmarca)' : 'Clique ou arraste sobre as rochas para marcar', kind: 'info' }); }
      }
      game.events.emit('buildui', {});
    },
  };
  game.ctl = ctl;

  const canvas = game.R.canvas;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') ctl.mouse = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerleave', () => { ctl.mouse = null; });

  // ---------- mouse drags for build / decon / mining modes ----------
  // build: the ghost follows the cursor (any tile on screen within reach), left drag = row / area, right click
  // or Esc = cancel the drag, then the mode; right click on a structure outside the modes = its context menu.
  // Touch build drags (one finger paints, two fingers stay pinch zoom) live in src/ui/buildbar.js.
  const tileAt = (e) => { const [wx, wy] = game.screenToWorld(e.clientX, e.clientY); return [Math.floor(wx), Math.floor(wy), wx, wy]; };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || game.player.dead || game.ui?.modal) return;
    const bm = game.build.mode, M = game.mining;
    if (e.button === 2) {
      if (bm) { drag = null; ctl.dragging = false; cancelBuild(game); } else if (M.mode) ctl.toggleMineMode(false);
      else game.events.emit('structmenu', { x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0 || (!bm && !M.mode)) return;
    const [tx, ty, wx, wy] = tileAt(e);
    drag = { kind: bm ? bm.kind : 'mine', a: [tx, ty], wx, wy };
    ctl.dragging = true;
    if (bm) buildDragStart(game, wx, wy);
    else { M.anchor = [tx, ty]; M.end = [tx, ty]; drag.on = !M.marks.has(game.world.idx(Math.max(0, tx), Math.max(0, ty))); }
  });
  addEventListener('pointermove', (e) => {
    if (!drag || e.pointerType !== 'mouse') return;
    const [tx, ty, wx, wy] = tileAt(e);
    const bm = game.build.mode;
    if (bm) buildDragMove(game, wx, wy);
    else if (game.mining.mode) game.mining.end = [tx, ty];
  });
  addEventListener('pointerup', (e) => {
    if (!drag || e.pointerType !== 'mouse') return;
    const d = drag; drag = null; ctl.dragging = false;
    const [tx, ty, wx, wy] = tileAt(e);
    const bm = game.build.mode, M = game.mining;
    if (bm && bm.kind === d.kind) {
      buildDragEnd(game, wx, wy);
    } else if (M.mode && d.kind === 'mine') {
      const n = designateRect(game, d.a[0], d.a[1], tx, ty, d.on);
      if (!n) game.events.emit('error', { text: 'Marque tiles de rocha' });
      else if (d.on) game.work?.wake();
      M.anchor = M.end = null;
    }
  });

  const doTap = (tap) => {
    const p = game.player;
    if (p.dead) return;
    if (game.ui?.modal) { game.events.emit('closepanels', {}); return; }
    const isMouse = tap.mouse;
    const [wx, wy] = game.screenToWorld(tap.x, tap.y);
    if (game.build.mode) { if (!isMouse) buildTap(game, wx, wy); return; }
    if (game.mining.mode) {
      if (isMouse) return;
      const r = designate(game, Math.floor(wx), Math.floor(wy));
      if (r == null) game.events.emit('error', { text: 'Toque numa rocha' });
      else if (r) game.work?.wake();
      return;
    }
    const h = pick(game, tap.x, tap.y);
    if (h.type === 'creature') {
      const e = h.e, temper = e.temper || SPECIES[e.species]?.temper;
      const fighting = e.state === 'chase' && e.threat === p;
      if (p.target === e || temper === 'hostile' || fighting || e.isProp) ctl.engage(e);
      else {
        ctl.setTarget(e);
        if (!ctl.hinted.tap2) { ctl.hinted.tap2 = true; game.events.emit('toast', { text: 'Toque de novo para atacar', kind: 'info' }); }
      }
      return;
    }
    if (h.type === 'interact') {
      const it = h.it;
      // tapping already designated rock cancels the designation
      if (it.kind === 'rock' && game.mining.marks.has(game.world.idx(it.tx, it.ty)) && !(p.work?.it?.tx === it.tx && p.work?.it?.ty === it.ty)) {
        designate(game, it.tx, it.ty, false);
        return;
      }
      ctl.interact(it);
      return;
    }
    if (h.type === 'rock') { // interior rock: designate for later
      const r = designate(game, h.tx, h.ty);
      if (r && !ctl.hinted.rockmark) { ctl.hinted.rockmark = true; game.events.emit('toast', { text: 'Rocha marcada: será minerada quando der para alcançar', kind: 'info' }); }
      if (r) game.work?.wake();
      return;
    }
    if (h.type === 'loot') { ctl.walkTo(h.it.x, h.it.y); return; }
    if (p.target && !isMouse) { ctl.setTarget(null); ctl.goal = null; return; }
    if (p.target && isMouse) ctl.setTarget(null);
    ctl.walkTo(h.wx, h.wy);
  };

  let hoverT = 0;
  return {
    sync: 'owner', // input of the local player
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
          canvas.style.cursor = g.build.mode || g.mining.mode ? 'crosshair' : h.type === 'ground' ? 'default' : 'pointer';
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
        if (K.has('KeyX')) ctl.toggleMineMode();
        if (K.has('Enter') && g.build.mode) commitPlacement(g);
        if (K.has('KeyR') && g.build.mode?.kind === 'place') rotateBuild(g, inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight') ? -1 : 1);
        if (K.has('Escape')) {
          if (g.build.mode) cancelBuild(g);
          else if (g.mining.mode) ctl.toggleMineMode(false);
          else if (g.ui?.modal) g.events.emit('closepanels', {});
          else if (p.target || ctl.goal) { ctl.setTarget(null); ctl.goal = null; }
          else g.events.emit('pausemenu', {});
        }
      }
      if (K.has('KeyI')) g.events.emit('toggle', { panel: 'inv' });
      if (K.has('KeyB')) g.events.emit('toggle', { panel: 'build' });
      if (K.has('KeyC')) g.events.emit('toggle', { panel: 'craft' });
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
          const d = Math.hypot(goal.x - p.x, goal.y - p.y);
          if (goal.best == null || d < goal.best - 0.05) { goal.best = d; goal.stall = 0; } else goal.stall = (goal.stall || 0) + dt;
          const dir = goal.stall > 1.2 ? null : steer(g, p, goal.x, goal.y, dt, spd, 0.15); // unreachable: give up
          if (!dir) ctl.goal = null; else p.autoMove = dir;
        } else if (goal.type === 'attack') {
          const t = goal.target;
          if (!attackable(t) || p.target !== t || !p.autoAttack) ctl.goal = null;
          else if (p.wprof?.ranged) {
            // bows: close in only until in range with a clear line of fire
            const far = dist(p, t) > attackRange(p, t) * 0.9;
            if ((far || !hasLOS(g.world, p.x, p.y, t.x, t.y)) && !p.cast) p.autoMove = steer(g, p, t.x, t.y, dt, spd, far ? attackRange(p, t) * 0.8 : 0.6);
          } else if (dist(p, t) > reach(p, t) * 0.92) p.autoMove = steer(g, p, t.x, t.y, dt, spd, reach(p, t) * 0.85);
        } else if (goal.type === 'interact') {
          const it = goal.it;
          if (reachDist(p, it) <= it.reach) {
            ctl.goal = null;
            if (!useInteract(g, it) && goal.auto) g.work?.fail(it);
          } else {
            const gx = it.tile ? Math.max(it.tx, Math.min(it.tx + (it.w || 1), p.x)) : it.x;
            const gy = it.tile ? Math.max(it.ty, Math.min(it.ty + (it.h || 1), p.y)) : it.y;
            const dir = steer(g, p, gx, gy, dt, spd, 0.05);
            if (!dir || (p.nav && p.nav.fails > 2)) {
              ctl.goal = null;
              if (goal.auto) g.work?.fail(it);
              else if (p.nav?.fails > 2) g.events.emit('error', { text: 'Caminho bloqueado' });
            } else p.autoMove = dir;
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
        const c = RING_COL[t.temper || SPECIES[t.species]?.temper] || RING_COL.neutral;
        const pulse = 0.85 + 0.15 * Math.sin(g.time * 5);
        B.blob.add(ring, t.x, t.y, 1.15 * sc * pulse, 0.75 * sc * pulse, c[0], c[1], c[2], 0.95);
        if (env.night > 0.1) B.emissive.add(ring, t.x, t.y, 1.15 * sc * pulse, 0.75 * sc * pulse, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0.6 * env.night);
      }
      const n = ctl.near;
      if (n && !p.work && !g.build.mode && !g.mining.mode && !(t && !t.dead && p.autoAttack)) {
        const s = n.tile ? Math.max(1, n.w || 1) : n.kind === 'tree' ? 0.9 : 0.8;
        const a = 0.35 + 0.15 * Math.sin(g.time * 4);
        B.blob.add(ring, n.x, n.tile ? n.y : n.y - 0.02, s, s * 0.62, 1, 0.95, 0.8, a);
      }
      // mode cursor (desktop hover / decon drag rectangle)
      const bm = g.build.mode;
      if (bm?.kind === 'decon') {
        const h = ctl.hover;
        const a0 = bm.anchor, a1 = bm.end || a0;
        if (a0 && a1) {
          for (let y = Math.min(a0[1], a1[1]); y <= Math.max(a0[1], a1[1]); y++) for (let x = Math.min(a0[0], a1[0]); x <= Math.max(a0[0], a1[0]); x++)
            B.fx.add(ring, x + 0.5, y + 0.6, 0.85, 0.55, 1, 0.4, 0.35, 0.55);
        } else if (h) B.fx.add(ring, Math.floor(h.wx) + 0.5, Math.floor(h.wy) + 0.6, 0.9, 0.58, 1, 0.45, 0.4, 0.7);
      } else if (g.mining.mode && ctl.hover && !g.mining.anchor) {
        const tx = Math.floor(ctl.hover.wx), ty = Math.floor(ctl.hover.wy);
        const ok = isRock(g, tx, ty);
        B.fx.add(ring, tx + 0.5, ty + 0.62, 0.9, 0.58, ok ? 1 : 0.6, ok ? 0.9 : 0.6, ok ? 0.5 : 0.6, 0.6);
      }
      const m = ctl.marker;
      if (m) {
        const k = m.t / 0.9;
        B.blob.add(ring, m.x, m.y, 0.6 * (1 - k * 0.5), 0.38 * (1 - k * 0.5), 1, 1, 1, 0.8 * (1 - k));
      }
    },
  };
}
