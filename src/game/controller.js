// Player controller: taps/clicks/keys -> intents (target, engage, interact, walk), goal steering
// via player.autoMove, contextual nearest-interactable, ground rings (target / marker / hint).
// Modes: build placement (ghost, drag line/area), deconstruct. Mining is a direct action (no designations).
// Auto-work is opt-in (work.js): a tap / click on a blueprint or a marked structure starts its sequence,
// which then feeds goals with { auto: true }; Esc cancels it.

import { steer, resetNav } from './nav.js';
import { attackable, dist, isMob, attackRange } from './combat.js';
import { useAbility, nearestEnemy } from './abilities.js';
import { GENERIC_ABILITIES } from './content/combat.js';
import { describeObject, reachDist } from './gathering.js';
import { describeStructure, buildTap, commitPlacement, structureAtPoint, buildDragStart, buildDragMove, buildDragEnd, cancelBuild, rotateBuild } from './building.js';
import { describeRock, isRock } from './mining.js';
import { useInteract } from './work.js';
import { eatBest } from './survival.js';
import { cancelCraft } from './crafting.js';
import { ABILITY_ORDER, ABILITIES, SPECIES, TEMPER_COLOR, BUILDINGS } from './data.js';
import { liftOf, STORY_H } from './levels.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const RING_COL = { hostile: hex(TEMPER_COLOR.hostile), neutral: hex(TEMPER_COLOR.neutral), passive: hex(TEMPER_COLOR.passive) };
const SMALL = new Set(['pebble', 'stick', 'fibergrass', 'wild_potato', 'wild_cotton', 'wild_corn', 'crop']);
const TAP_SLACK = 0.7; // a tapped thing this close beyond its reach is still used (a tiny step, no walking)

// Desktop key scheme (shown by the shortcuts overlay, src/ui/help.js) — owner's rule: everything used while
// walking sits under the left hand on WASD (Space, Shift, Q, E, R, F, 1–5, mouse). Space = attack, Shift =
// sprint, E = interact, Tab = backpack, digits 1–9, 0 = hotbar (herbs / food there too). Weapon / off-hand
// abilities take Q R F in bar order (a 4th / 5th, only sword + shield: G T); heal also on V; Z = next target.
// Ctrl is never bound (Ctrl+W would close the tab while walking).
export const ABILITY_KEYS = ['KeyQ', 'KeyR', 'KeyG', 'KeyT', 'KeyX']; // F = eat (owner); X freed by the removed mining mode
export const KEYS = {
  interact: ['KeyE'], attack: ['Space'], target: ['KeyZ'], eat: ['KeyF'], heal: ['KeyV'], sprint: ['ShiftLeft', 'ShiftRight'],
  inv: ['Tab', 'KeyI'], craft: ['KeyC'], build: ['KeyB'], map: ['KeyM'], help: ['KeyH', 'F1'],
};
// key code for each ability of the bar (null = no key)
export function abilityKeys(ids) {
  let n = 0;
  return ids.map((id) => (id === 'sprint' ? 'ShiftLeft' : GENERIC_ABILITIES.includes(id) ? 'KeyV' : ABILITY_KEYS[n++] || null));
}
export const keyLabel = (code) => (!code ? '' : code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5)
  : { ShiftLeft: '⇧', ShiftRight: '⇧', Space: 'Espaço', Tab: 'Tab', Escape: 'Esc', F1: 'F1', Enter: 'Enter' }[code] || code);

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
  const hid = (x, y) => !!game.roofs?.hidden?.(x, y); // inside a building whose roof covers it (not pickable)
  let best = null, bd = 1;
  for (const e of game.entities) {
    if (!isMob(e) || e.dead || hid(e.x, e.y)) continue;
    const sc = e.scale || 1;
    // humanoid raiders are taller and thinner than animals
    const pawn = e.kind === 'pawn';
    const rx = (pawn ? 0.42 : 0.55) * sc + tol, ry = (pawn ? 0.78 : 0.5) * sc + tol;
    const dx = (wx - e.x) / rx, dy = (wy - (e.y - liftOf(e) - (pawn ? 0.7 : 0.35) * sc)) / ry; // levels: lifted
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
  const LV = game.levels?.hasUpper ? game.levels : null; // levels: upper pieces are drawn lifted (faded / covered ones are not pickable)
  game.world.forChunks(wx - 2, wy - 1, wx + 2, wy + 3 + (LV ? 3 * STORY_H : 0), (c) => {
    for (const o of c.objects) {
      const ly = LV && o.lv ? wy + o.lv * STORY_H : wy;
      if (Math.abs(o.x - wx) > 2.5 || o.y < ly - 0.6 || o.y > ly + 2.6) continue;
      if (LV && (o.lv ? (o.alpha ?? 1) < 0.5 : LV.culled(o))) continue;
      if (!objHit(o, wx, ly, tol) || (hid(o.x, o.y) && !o.door)) continue;
      const d = describeAny(game, o);
      if (!d) continue;
      if (o.flat) { if (!hitFlat) hitFlat = d; continue; }
      if (!hit || o.y > hit.o.y) hit = d;
    }
  });
  if (!hit) hit = game.corpses?.pickAt(wx, wy, tol) || null; // bodies on the ground (corpses.js)
  if (hit) return { type: 'interact', it: hit, wx, wy };
  const rk = describeRock(game, Math.floor(wx), Math.floor(wy));
  if (rk) return { type: 'interact', it: rk, wx, wy };
  for (const it of game.loot) if (Math.hypot(wx - it.x, wy - it.y + 0.15) < 0.4 + tol) return { type: 'loot', it, wx, wy };
  if (hitFlat) return { type: 'interact', it: hitFlat, wx, wy };
  const pj = game.paths?.jobAt?.(Math.floor(wx), Math.floor(wy)); // a blue path plan / red removal mark (paths.js)
  if (pj) return { type: 'interact', it: pj, wx, wy };
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
  const pz = Math.round(p.z || 0);
  game.world.forChunks(p.x - 3, p.y - 3, p.x + 3, p.y + 3, (c) => {
    for (const o of c.objects) {
      if (Math.abs(o.x - p.x) > 3 || Math.abs(o.y - p.y) > 3) continue;
      if (o.building && (o.lv | 0) !== pz && (o.door || o.store || o.type === 'bed' || BUILDINGS[o.type]?.station)) continue; // levels: doors / chests / beds / stations of your own story
      consider(describeAny(game, o));
    }
  });
  game.corpses?.forNear(p.x, p.y, 3, consider); // bodies on the ground (corpses.js)
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    consider(describeRock(game, tx + dx, ty + dy), dx === fx && dy === fy ? 0.3 : 0);
    consider(game.paths?.jobAt?.(tx + dx, ty + dy)); // path plans next to the player (E / action button)
  }
  consider(game.paths?.jobAt?.(tx, ty));
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
      if (dist(p, t) > attackRange(p, t) * 1.05) {
        ctl.flag = { x: t.x, y: t.y, w: 1.15 * (t.scale || 1), h: 0.75 * (t.scale || 1), t: 0 };
        game.events.emit('error', { text: 'Chegue mais perto' });
      }
    },
    // Space: attack the target, else the nearest enemy (never toggles off; Esc / walking away ends it)
    attack() {
      const p = game.player;
      if (p.dead) return;
      if (p.autoAttack && attackable(p.target)) return;
      const t = attackable(p.target) ? p.target : nearestEnemy(game, 10);
      if (!t) { game.events.emit('error', { text: 'Sem alvo' }); return; }
      ctl.engage(t);
      if (dist(p, t) > attackRange(p, t) * 1.05) {
        ctl.flag = { x: t.x, y: t.y, w: 1.15 * (t.scale || 1), h: 0.75 * (t.scale || 1), t: 0 };
        game.events.emit('error', { text: 'Chegue mais perto' });
      }
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

  // right click cancels a ground aim (game.aim, agent G) before anything else sees it
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2 && game.aim?.active) { game.aim.cancel?.(); ctl._aimKey = null; e.stopImmediatePropagation(); }
  }, true);

  // ---------- mouse drags for build / decon modes ----------
  // build: the ghost follows the cursor (any tile on screen within reach), left drag = row / area, right click
  // or Esc = cancel the drag, then the mode; right click on a structure outside the modes = its context menu.
  // Touch build drags (one finger paints, two fingers stay pinch zoom) live in src/ui/buildbar.js.
  const tileAt = (e) => { const [wx, wy] = game.screenToWorld(e.clientX, e.clientY); return [Math.floor(wx), Math.floor(wy), wx, wy]; };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || game.player.dead || game.ui?.modal) return;
    const bm = game.build.mode;
    if (e.button === 2) {
      if (bm) { drag = null; ctl.dragging = false; cancelBuild(game); }
      else game.events.emit('structmenu', { x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button !== 0 || !bm) return;
    const [tx, ty, wx, wy] = tileAt(e);
    drag = { kind: bm.kind, a: [tx, ty], wx, wy };
    ctl.dragging = true;
    buildDragStart(game, wx, wy);
  });
  addEventListener('pointermove', (e) => {
    if (!drag || e.pointerType !== 'mouse') return;
    const [, , wx, wy] = tileAt(e);
    if (game.build.mode) buildDragMove(game, wx, wy);
  });
  addEventListener('pointerup', (e) => {
    if (!drag || e.pointerType !== 'mouse') return;
    const d = drag; drag = null; ctl.dragging = false;
    const [, , wx, wy] = tileAt(e);
    const bm = game.build.mode;
    if (bm && bm.kind === d.kind) buildDragEnd(game, wx, wy);
  });

  // Taps / clicks never walk the player (joystick / WASD do): they target or use one specific thing.
  // Within reach → act; out of reach → highlight it + "Chegue mais perto".
  const tooFar = (x, y, w = 0.9, h = 0.6) => {
    ctl.flag = { x, y, w, h, t: 0 };
    game.events.emit('error', { text: 'Chegue mais perto' });
  };
  const doTap = (tap) => {
    const p = game.player;
    if (p.dead) return;
    if (game.aim?.active) { game.aim.tap?.(tap); return; } // aiming: a click fires at that point (game.aim)
    if (game.ui?.modal) { game.events.emit('closepanels', {}); return; }
    const isMouse = tap.mouse;
    const [wx, wy] = game.screenToWorld(tap.x, tap.y);
    if (game.build.mode) { if (!isMouse) buildTap(game, wx, wy); return; }
    const h = pick(game, tap.x, tap.y);
    if (h.type === 'creature') {
      const e = h.e, temper = e.temper || SPECIES[e.species]?.temper;
      const fighting = e.state === 'chase' && e.threat === p;
      // desktop: a left click ON a creature is the normal attack (owner); phones: first tap targets, second attacks
      if (isMouse || p.target === e || temper === 'hostile' || fighting || e.isProp) {
        ctl.engage(e); // arms the auto attack: it swings as soon as the player walks into range
        if (dist(p, e) > attackRange(p, e) * 1.05) tooFar(e.x, e.y, 1.15 * (e.scale || 1), 0.75 * (e.scale || 1));
      } else {
        ctl.setTarget(e);
        if (!ctl.hinted.tap2) { ctl.hinted.tap2 = true; game.events.emit('toast', { text: isMouse ? 'Clique de novo (ou Espaço) para atacar' : 'Toque de novo para atacar', kind: 'info' }); }
      }
      return;
    }
    if (h.type === 'interact') {
      const it = h.it;
      // a blue blueprint / a frame / a structure marked for deconstruction: start auto-work on it (and the rest of
      // its batch). This is the only way auto-work starts (work.js); it walks there by itself.
      if (it.kind === 'blueprint' || it.kind === 'decon' || it.kind === 'path') { game.work?.begin?.(it); return; }
      if (reachDist(p, it) > it.reach + TAP_SLACK) {
        const s = it.tile ? Math.max(1, it.w || 1) : it.kind === 'tree' ? 0.9 : 0.8;
        tooFar(it.x, it.tile ? it.y : it.y - 0.02, s, s * 0.62);
        return;
      }
      ctl.interact(it);
      return;
    }
    if (h.type === 'rock') return; // rock without an open side: nothing to do (mining is a direct action next to it)
    if (h.type === 'loot') {
      // loot.js pulls items within ~2.3 tiles into the backpack by itself
      if (Math.hypot(p.x - h.it.x, p.y - h.it.y) > 2.2) tooFar(h.it.x, h.it.y, 0.6, 0.4);
      else if (p.inv.room(h.it.item) <= 0) game.events.emit('error', { text: 'Mochila cheia' });
      return;
    }
    // empty ground (no creature near the click / tap): never walks and never picks some far creature — it clears
    // the current target, on desktop and phones alike (owner). Attacking: click the creature, or Space
    if (p.target) { ctl.setTarget(null); if (ctl.goal?.type === 'attack') ctl.goal = null; }
  };

  let hoverT = 0;
  return {
    sync: 'owner', // input of the local player
    update(g, dt) {
      const p = g.player, inp = g.input;
      // build mode: a narrow joystick strip at the left edge, so one-finger paint drags start almost anywhere
      inp.joyZone = g.build.mode ? 0.2 : 0.45;
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

      // keys (scheme: KEYS / abilityKeys above)
      const K = inp.pressed;
      const any = (list) => list.some((c) => K.has(c));
      if (K.size && !p.dead) {
        const bm = !!g.build.mode; // build mode owns R / Shift+R (rotation), T (Detalhes, agent K) and Enter
        const codes = abilityKeys(ABILITY_ORDER);
        ABILITY_ORDER.forEach((id, i) => {
          const c = codes[i];
          if (!c || (bm && (c === 'KeyR' || c === 'KeyT' || c === 'ShiftLeft'))) return;
          if (!(K.has(c) || (c === 'ShiftLeft' && K.has('ShiftRight')))) return;
          // ground-aimed abilities (aim: 'ground'): the aim module (game.aim, agent G) takes over while held
          if (ABILITIES[id]?.aim && g.aim?.beginMouse) { g.aim.beginMouse(id, { key: c }); ctl._aimKey = c; return; }
          useAbility(g, id);
        });
        for (let i = 0; i < 10; i++) if (K.has('Digit' + ((i + 1) % 10)) || K.has('Numpad' + ((i + 1) % 10))) g.events.emit('hotbar', { i });
        if (any(KEYS.target)) ctl.cycleTarget();
        if (any(KEYS.interact) && !bm) ctl.interact();
        if (any(KEYS.attack) && !bm) ctl.attack();
        if (any(KEYS.eat)) eatBest(g);
        if (K.has('Enter') && bm) commitPlacement(g);
        if (K.has('KeyR') && g.build.mode?.kind === 'place') rotateBuild(g, inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight') ? -1 : 1);
        if (K.has('Escape')) {
          if (g.aim?.active) { g.aim.cancel?.(); ctl._aimKey = null; }
          else if (g.build.mode) cancelBuild(g);
          else if (g.ui?.modal) g.events.emit('closepanels', {});
          else if (g.work?.active?.()) { g.work.cancel(); ctl.goal = null; } // the auto-work banner's ✕
          else if (p.target || ctl.goal) { ctl.setTarget(null); ctl.goal = null; }
          else g.events.emit('pausemenu', {});
        }
      }
      // aim key released → fire (a quick tap fires at the mouse at once; game.aim decides)
      if (ctl._aimKey && !inp.keys.has(ctl._aimKey) && !(ctl._aimKey === 'ShiftLeft' && inp.keys.has('ShiftRight'))) { ctl._aimKey = null; g.aim?.release?.(); }
      // shield block keeps up while its key is held
      if (p.block) {
        const c = abilityKeys(ABILITY_ORDER)[ABILITY_ORDER.indexOf('block')];
        if (c && inp.keys.has(c)) { p.blockHeld = true; ctl._blockKey = true; } else if (ctl._blockKey) { p.blockHeld = false; ctl._blockKey = false; }
      }
      if (any(KEYS.inv)) g.events.emit('toggle', { panel: 'inv' });
      if (any(KEYS.build)) g.events.emit('toggle', { panel: 'build' });
      if (any(KEYS.craft)) g.events.emit('toggle', { panel: 'craft' });
      if (any(KEYS.map)) g.events.emit('toggle', { panel: 'map' });
      if (any(KEYS.help)) g.events.emit('help', {});

      // taps / clicks
      for (const t of inp.taps) doTap({ x: t.x, y: t.y, mouse: t.type === 'mouse' });

      // manual movement cancels goals & work
      const [mx, my] = inp.move();
      ctl.manual = !!(mx || my);
      if (ctl.manual) {
        if (ctl.goal) ctl.goal = null;
        // walking cancels the crafting the player is doing (ingredients refunded by cancelCraft)
        const Q = g.craft?.queue;
        if (Q?.length && (p.work?.owner === 'craft' || Q[0].t > 0)) {
          for (let i = Q.length - 1; i >= 0; i--) cancelCraft(g, i);
          g.events.emit('error', { text: 'Craft cancelado' });
        }
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
          // armed auto attack: never chases (the player walks); combat.js swings once in range
          const t = goal.target;
          if (!attackable(t) || p.target !== t || !p.autoAttack) ctl.goal = null;
        } else if (goal.type === 'interact') {
          const it = goal.it;
          const glv = it.use && it.o?.building ? it.o.lv | 0 : null; // levels: doors / chests / beds / stations are used from their own story
          if (reachDist(p, it) <= it.reach && (glv == null || Math.round(p.z || 0) === glv)) {
            ctl.goal = null;
            if (!useInteract(g, it) && goal.auto) g.work?.fail(it);
          } else {
            const gx = it.tile ? Math.max(it.tx, Math.min(it.tx + (it.w || 1), p.x)) : it.x;
            const gy = it.tile ? Math.max(it.ty, Math.min(it.ty + (it.h || 1), p.y)) : it.y;
            const dir = steer(g, p, gx, gy, dt, spd, 0.05, glv);
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
      // never stay locked on a creature: with something usable nearby (campfire, door, chest…) for 3 s and the
      // target not being fought in range, the target is dropped so the action button goes back to the object
      // (counted only while the SAME object stays next to the player — walking past trees keeps resetting it)
      const tg = p.target, nr = ctl.near;
      const nk = nr ? (nr.o || `${nr.kind}:${nr.tx},${nr.ty}`) : null;
      if (tg && nr && !p.dead && nk === ctl.lockK) {
        const fighting = attackable(tg) && p.autoAttack && dist(p, tg) <= attackRange(p, tg) + 0.5;
        ctl.lockT = fighting ? 0 : (ctl.lockT || 0) + dt;
        if (ctl.lockT >= 3) { ctl.lockT = 0; ctl.setTarget(null); if (ctl.goal?.type === 'attack') ctl.goal = null; }
      } else ctl.lockT = 0;
      ctl.lockK = nk;
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
        const ty = t.y - liftOf(t); // levels: ring under its feet up a story
        B.blob.add(ring, t.x, ty, 1.15 * sc * pulse, 0.75 * sc * pulse, c[0], c[1], c[2], 0.95);
        if (env.night > 0.1) B.emissive.add(ring, t.x, ty, 1.15 * sc * pulse, 0.75 * sc * pulse, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0.6 * env.night);
      }
      const n = ctl.near;
      if (n && !p.work && !g.build.mode && !(t && !t.dead && p.autoAttack && dist(p, t) <= attackRange(p, t) + 0.5)) {
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
      }
      const m = ctl.marker;
      if (m) {
        const k = m.t / 0.9;
        B.blob.add(ring, m.x, m.y, 0.6 * (1 - k * 0.5), 0.38 * (1 - k * 0.5), 1, 1, 1, 0.8 * (1 - k));
      }
      // "Chegue mais perto": the tapped thing pulses for a moment
      const f = ctl.flag;
      if (f) {
        f.t += g._dt || 0.016;
        if (f.t > 1.4) ctl.flag = null;
        else {
          const a = Math.sin(Math.min(1, f.t / 1.4) * Math.PI) * (0.65 + 0.35 * Math.sin(f.t * 14));
          B.blob.add(ring, f.x, f.y, f.w, f.h, 1, 0.78, 0.35, 0.95 * a);
          if (env.night > 0.1) B.emissive.add(ring, f.x, f.y, f.w, f.h, 0.6, 0.45, 0.2, 0.7 * a * env.night);
        }
      }
    },
  };
}
