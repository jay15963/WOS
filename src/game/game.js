// Core game: owns world, entities, camera, environment; runs update + builds render batches.

import { drawPawn, drawAnimal, drawStatic, drawDecor, animEnv } from '../art/compose.js';
import { moveCircle, facingFrom, collides } from './physics.js';
import { clamp } from '../engine/noise.js';
import { drawProxy } from './artcompat.js';
import { stepGait } from './anim.js';
import { Net } from '../net/net.js';
import { loadLook } from './look.js';
import { underOpaqueRoof, underCaveCeiling } from './roofs.js';
import { BUILDINGS } from './data.js';
import { STORY_H } from './levels.js';
import { CAMV } from '../art/archCompose.js';
import { faceKindOf, boxDepth } from '../art/faces/index.js'; // camera rotation: pieces drawn as computed faces
import { viewFacing8 } from '../art/facing.js'; // camera rotation: creatures in 8 views

const SOLID = { tree_oak: 0.2, tree_pine: 0.18, tree_birch: 0.16, tree_dead: 0.16, boulder: 0.34 };
const ZOOM_MIN = 22, ZOOM_MAX = 110; // css px per tile
// interiors (game.indoors from src/game/roofs.js): under a roof the camera eases to a fixed, closer zoom (a reduced
// field of view; never farther than the player's own zoom) and zoom input is ignored; leaving eases back to the
// player's zoom. The blend (indoors.zoomK) is a ~1 s smoothstep both ways.
const INDOOR_ZOOM = { cave: 1.45, built: 1.32 };

// the side of a creature the camera sees: its facing turned into view space (4 views; 8 need the diagonal rig art)
const FV = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
function viewFacing(f, c, s) {
  const v = FV[f];
  if (!v) return f;
  const vx = c * v[0] + s * v[1], vy = -s * v[0] + c * v[1];
  return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'e' : 'w') : (vy > 0 ? 's' : 'n');
}

export class Game {
  constructor({ renderer, atlas, world, env, input, particles }) {
    this.R = renderer;
    this.A = atlas;
    this.world = world;
    this.env = env;
    this.input = input;
    this.particles = particles;
    this.time = 0;
    for (const o of world.objects) o.solid = SOLID[o.type] || 0;

    this.player = {
      isEntity: true, kind: 'pawn', name: 'Sobrevivente', x: world.spawn.x, y: world.spawn.y, r: 0.24,
      facing: 's', moving: false, moveT: 0, speed: 4.0, action: null, flash: 0, canSwim: true, swimming: false,
      look: loadLook(), // agent H: the player's saved appearance (per profile, src/game/look.js)
      weapon: 'sword', hp: 100, maxHp: 100,
    };
    this.entities = [this.player];
    // rot: camera yaw (radians, eased toward rotTo); rotFade 0..1 while it is turned (roofs fade, walls become faces)
    this.cam = { x: this.player.x, y: this.player.y, zoom: 0, ppt: 48, rot: 0, rotTo: 0, rotFade: 0 };
    this.cam.zoom = this.defaultZoom();
    this._draw = [];
    this.shakeOff = { x: 0, y: 0 }; // camera shake (juice)
    this.worldTime = 0;             // persistent simulation clock (s), saved; the HOST's clock in multiplayer
    this.systems = []; // { sync, update(game, dt), render?(game, B, view) } — add with addSystem (systems.js)
    this.net = new Net(this);       // role 'solo' until a session makes it 'host' or 'guest'
  }

  defaultZoom() {
    const m = Math.min(this.R.cssW, this.R.cssH);
    return clamp(m / 12.5, 30, 76);
  }

  // smooth, clamped zoom; the chosen factor (relative to the screen's default) survives reloads
  stepZoom(dt, req) {
    const c = this.cam, I = this.indoors;
    if (I && I.zoomK > 0.001) req = 0; // inside: the view is fixed
    if (c.zoomK == null) {
      let k = 1;
      try { const v = parseFloat(localStorage.getItem('wos.zoom')); if (Number.isFinite(v)) k = v; } catch { /* ignore */ }
      c.zoomK = clamp(k, 0.45, 2.6);
      c.zoom = clamp(this.defaultZoom() * c.zoomK, ZOOM_MIN, ZOOM_MAX);
    }
    if (req) {
      const z = clamp(this.defaultZoom() * c.zoomK * Math.exp(req), ZOOM_MIN, ZOOM_MAX);
      c.zoomK = z / this.defaultZoom();
      c._zoomSave = 0.8;
    }
    let target = clamp(this.defaultZoom() * c.zoomK, ZOOM_MIN, ZOOM_MAX);
    if (I && I.zoomK > 0.001) {
      const kind = I.kind || I._lastKind || 'built';
      if (I.kind) I._lastKind = I.kind;
      const inside = Math.max(target, clamp(this.defaultZoom() * INDOOR_ZOOM[kind], ZOOM_MIN, ZOOM_MAX));
      target += (inside - target) * I.zoomK;
    }
    const k = 1 - Math.exp(-dt * 14);
    c.zoom = Math.abs(target - c.zoom) < 0.01 ? target : c.zoom + (target - c.zoom) * k;
    if (c._zoomSave > 0 && (c._zoomSave -= dt) <= 0) { try { localStorage.setItem('wos.zoom', c.zoomK.toFixed(3)); } catch { /* ignore */ } }
  }

  // camera yaw (game.cam.rot): view = the world turned around the camera; up the screen = height
  toWorldDir(vx, vy) { const r = this.cam.rot || 0; if (!r) return [vx, vy]; const c = Math.cos(r), s = Math.sin(r); return [c * vx - s * vy, s * vx + c * vy]; }
  toViewDir(dx, dy) { const r = this.cam.rot || 0; if (!r) return [dx, dy]; const c = Math.cos(r), s = Math.sin(r); return [c * dx + s * dy, -s * dx + c * dy]; }

  screenToWorld(sx, sy) {
    const z = this.cam.zoom;
    const [dx, dy] = this.toWorldDir((sx - this.R.cssW / 2) / z, (sy - this.R.cssH / 2) / z);
    return [this.cam.x + this.shakeOff.x + dx, this.cam.y + this.shakeOff.y + dy];
  }

  // h: tiles straight up the screen (a nameplate over a head)
  worldToScreen(wx, wy, h = 0) {
    const z = this.cam.zoom;
    const [vx, vy] = this.toViewDir(wx - this.cam.x - this.shakeOff.x, wy - this.cam.y - this.shakeOff.y);
    return [vx * z + this.R.cssW / 2, (vy - h) * z + this.R.cssH / 2];
  }

  update(dt) {
    this._dt = dt;
    this.time += dt;
    this.env.update(dt);
    const p = this.player, inp = this.input;

    // movement (systems may set p.autoMove / p.rooted)
    if (p._faceLockT > 0) p._faceLockT -= dt;
    if (p._atkRootT > 0) p._atkRootT -= dt; // standing still during an auto-attack swing / draw
    p.swimming = !p.dead && !(p.z > 0) && this.world.liquidAt(Math.floor(p.x), Math.floor(p.y)) === 2; // deep water: slow + cold (survival.js); not on ice
    // camera yaw: middle-mouse drag / two-finger twist (input.rotate), double middle click = north again
    const C = this.cam;
    if (inp.rotReset || this.camRotReset) { this.camRotReset = false; C.rotTo = Math.round(C.rot / (Math.PI * 2)) * Math.PI * 2; }
    if (inp.rotate) C.rotTo += inp.rotate;
    if (C.rot !== C.rotTo) {
      C.rot += (C.rotTo - C.rot) * (1 - Math.exp(-dt * 14));
      if (Math.abs(C.rotTo - C.rot) < 1e-4) C.rot = C.rotTo;
    }
    if (C.rot === C.rotTo) { const n = Math.round(C.rot / (Math.PI * 2)) * Math.PI * 2; if (Math.abs(C.rot - n) < 1e-4) C.rot = C.rotTo = 0; else if (n) { C.rot -= n; C.rotTo -= n; } }
    C.rotFade += ((C.rot ? 1 : 0) - C.rotFade) * Math.min(1, dt * 6);
    if (!C.rot && C.rotFade < 0.002) C.rotFade = 0;
    let [mx, my] = inp.move();
    if (mx || my) [mx, my] = this.toWorldDir(mx, my); // the stick / keys move relative to the screen
    if (!mx && !my && p.autoMove) { mx = p.autoMove[0]; my = p.autoMove[1]; }
    if (p.rooted || p._atkRootT > 0 || p._hop) mx = my = 0; // (levels: no steering mid-hop)
    const spd = p.speed * (this.levels ? this.levels.speedAt(p) : this.world.speedAt(p.x, p.y)); // levels: stairs slower
    if (mx || my) {
      const x0 = p.x, y0 = p.y, px0 = x0, py0 = y0;
      moveCircle(this.world, p, mx * spd * dt, my * spd * dt);
      // never stuck anywhere: ~2 s of pushing without moving while no step is free in any of 8 directions → the nearest
      // free spot (on the ground when up high); levels.move already lets a body slide out of what it overlaps
      if ((mx || my) && Math.hypot(p.x - px0, p.y - py0) < 0.002 && !p.rooted && !(p.stunT > 0)) p._stuckT = (p._stuckT || 0) + dt; else p._stuckT = 0;
      if (p._stuckT > 2) {
        p._stuckT = 0;
        const L = this.levels, r = p.r || 0.25, lv = p.lv | 0;
        const L8 = [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22], [0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]];
        const hit = (x, y) => (L?.active || L?.hasUpper ? L.collidesL(lv, x, y, r, false, false, L._tile(p.x, p.y)) : collides(this.world, x, y, r, null, false));
        if (!(L?.stairAt?.(lv, p.x, p.y)) && L8.every(([ox, oy]) => hit(p.x + ox, p.y + oy))) {
          let spot = null;
          if (L?.active || L?.hasUpper) spot = L.groundSpot(p.x, p.y, r);
          else for (let n = 1; n < 90 && !spot; n++) { const a = n * 2.4, d = 0.25 + n * 0.06, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; if (!collides(this.world, x, y, r, null, false)) spot = [x, y]; }
          if (spot) {
            p.x = spot[0]; p.y = spot[1];
            if (lv > 0) { p.lv = 0; p._hop = null; p._fallV = 0.01; }
            this.events.emit('toast', { text: lv > 0 ? 'Você estava preso: desceu para o chão' : 'Você estava preso: foi para o lugar livre mais perto', kind: 'info' });
          }
        }
      }
      if (!(p._faceLockT > 0)) p.facing = facingFrom(mx, my, p.facing); // an attack keeps facing its target briefly
      p.moving = true;
      stepGait(p, Math.hypot(p.x - x0, p.y - y0)); // distance actually travelled (same clock as remote copies)
    } else {
      p.moving = false;
    }

    for (const s of this.systems) s.update?.(this, dt);

    // zoom: input moves a target, the camera eases toward it (persisted as a factor of the default zoom)
    this.stepZoom(dt, inp.zoom);

    // camera follow with slight look-ahead
    const look = p.moving ? 0.6 : 0;
    const [ux, uy] = this.toWorldDir(0, -(0.4 + (p.z > 0 ? p.z * STORY_H : 0))); // (a little up the screen; levels: elevated)
    let tx = p.x + ux + mx * look, ty = p.y + uy + my * look;
    // optional focus point (e.g. a long-range aim): the camera leans toward it by weight k (0..1)
    const cf = this.camFocus;
    if (cf && Number.isFinite(cf.x) && Number.isFinite(cf.y)) { const fk = clamp(cf.k ?? 0.5, 0, 1); tx += (cf.x - tx) * fk; ty += (cf.y - ty) * fk; }
    const k = 1 - Math.exp(-dt * 6);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;

    for (const e of this.entities) { if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 6); if (e.dead) e.deadT = (e.deadT || 0) + dt; }
    this.particles.update(dt);
    this.audio?.update(this, dt);

    if (this.world.dirty && !this.headless) {
      const d = this.world.dirty;
      this.R.updateWorldRegion(d[0], d[1], d[2], d[3]);
      this.world.dirty = null;
    }
    if (this.world.caveDirty && !this.headless) {
      const d = this.world.caveDirty;
      this.R.updateCaveRegion?.(d[0], d[1], d[2], d[3]);
      this.world.caveDirty = null;
    }
    this.net.flush(); // one ordered op batch per frame to every synced guest
  }

  // visible world rect (with margins for tall sprites & shadows)
  view() {
    const z = this.cam.zoom, r = this.cam.rot || 0;
    let hw = this.R.cssW / z / 2, hh = this.R.cssH / z / 2;
    if (r) { const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r)); [hw, hh] = [c * hw + s * hh, s * hw + c * hh]; } // (the box around the turned screen)
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }

  render() {
    const R = this.R, B = R.batches, A = this.A, t = this.time;
    R.resize();
    R.clearBatches();
    const env = this.env.compute();
    const v = this.view();
    const rot = this.cam.rot || 0, rc = Math.cos(rot), rs = Math.sin(rot);
    // (turned: tall sprites may reach out in any world direction)
    const mx0 = v.x0 - (rot ? 4 : 3), mx1 = v.x1 + (rot ? 4 : 3), my0 = v.y0 - (rot ? 4 : 1.5), my1 = v.y1 + 4;
    CAMV.c = rc; CAMV.s = rs;
    animEnv.rc = rc; animEnv.rs = rs; animEnv.yaw = rot; // creature rigs: screen-space offsets → world (art/compose.js viewB)
    { const sd = env.shadowDir || [0, 0], L = Math.hypot(sd[0], sd[1]) || 1; CAMV.lx = -sd[0] / L; CAMV.ly = -sd[1] / L; } // light comes from there

    const list = this._draw;
    list.length = 0;
    this.world.forChunks(mx0, my0, mx1, my1, (c) => {
      for (const d of c.decor) {
        if (!d._hid && d.x > v.x0 - 1 && d.x < v.x1 + 1 && d.y > v.y0 - 0.5 && d.y < v.y1 + 1.5) drawDecor(B, A, d); // _hid: on a painted path
      }
      for (const o of c.objects) {
        if (o.roof) continue; // roof tiles: drawn by the roof regions (src/game/roofs.js collect)
        if (o.x > mx0 && o.x < mx1 && o.y > my0 && o.y < my1) list.push(o);
      }
    });
    for (const e of this.entities) if (e.x > mx0 && e.x < mx1 && e.y > my0 && e.y < my1 && !(e.dead && e._corpseId)) list.push(e); // a body on the ground replaces the dead (corpses.js)
    // systems may contribute depth-sorted drawables (projectiles, camp props...): objects with o.draw(B, A, t)
    for (const s of this.systems) s.collect?.(this, list, v);
    // _sy: depth override (pawn lying in a bed / on a chair, stairs); levels: + one tile of depth per story up
    // depth key: `_zk` — NOT `_sk`, which is the pawn rig's stride blend (art/compose.js): sharing the name made
    // side-view boots fly far from the body (the stride became the pawn's y)
    if (!rot) for (let i = 0; i < list.length; i++) { const o = list[i]; o._zk = (o._sy ?? o.y) + (o.isEntity && o.z > 0 ? o.z : 0); }
    else {
      // camera turned: depth = how far down the screen (the turned y); a wall box by its front-most point
      for (let i = 0; i < list.length; i++) {
        const o = list[i], fk = faceKindOf(o); // (art/faces: the pieces drawn as computed faces)
        o._fk = fk;
        if (o.zkRot) o._zk = o.zkRot(rc, rs); // (a roof: its front-most point)
        else if (fk) o._zk = fk.depth ? fk.depth(o, rc, rs) : boxDepth(o, rc, rs);
        else { o._zk = -rs * o.x + rc * (o._sy ?? o.y); if (o.isEntity && o.z > 0) o._zk = this.levels ? this.levels.zkRot(o, o._zk, rc, rs) : o._zk + o.z; } // levels: up a story / on a stair
      }
      // a pawn in a bed / on a seat (art/compose.js _sobj): just in front of it, whichever way the camera looks
      for (let i = 0; i < list.length; i++) { const o = list[i]; if (o.isEntity && o._sobj && o._sy != null && o._sobj._zk != null) o._zk = o._sobj._zk + 0.02; }
    }
    list.sort((a, b) => a._zk - b._zk);
    // canopies in front of the player (and their target) fade so they never vanish behind a tree
    const pl = this.player, tg = pl.target && !pl.target.dead ? pl.target : null;
    const fk = 1 - Math.exp(-(this._dt || 0.016) * 8);
    const hides = (o, e, s) => { const dx = rc * (o.x - e.x) + rs * (o.y - e.y), dy = -rs * (o.x - e.x) + rc * (o.y - e.y); return dy > 0 && dy < 2.6 * s && Math.abs(dx) < 1.15 * s; }; // (in view space)
    for (const o of list) {
      if (o.isEntity || o.draw || !o.type?.startsWith('tree_') || o.stump) continue;
      const s = o.s || 1;
      const covers = hides(o, pl, s) || (tg && hides(o, tg, s));
      const target = covers ? 0.42 : 1;
      const a = o.alpha ?? 1;
      if (a !== target) o.alpha = Math.abs(a - target) < 0.01 ? target : a + (target - a) * fk;
    }
    const LV = this.levels?.hasUpper ? this.levels : null; // levels: upper stories in the world
    R.emMark?.(); // (glows of the ground decor: under everything)
    for (const o of list) {
      R.emMark?.(); // the glows of the object drawn before this one go right after it (renderer.emSeg)
      // anything under an opaque roof is hidden by it (and its flames would glow through): skip it, except the
      // walls / doors whose front faces show below the eaves; same under a cave ceiling (never the local player,
      // who is drawn while its own cave's ceiling fades out)
      if (!o.draw && ((underOpaqueRoof(this, o.x, o.y) && !(o.building && BUILDINGS[o.type]?.connect === 'wall')) || (o !== pl && underCaveCeiling(this, o.x, o.y)))) continue;
      if (o.draw) o.draw(B, A, t);
      else if (rot && o._fk && o._fk.draw(B, A, o, t)) { /* computed faces (art/faces) */ }
      else {
        if (LV) { if (!o.isEntity && o.lv > 0) { LV.drawUpper(B, A, o, t); continue; } if (LV.culled(o)) continue; } // upper pieces lifted; things under a slab hidden
        // levels: an entity up a story is drawn with its base lifted (it stands on the wall top / upper floor)
        const lz = o.isEntity && o.z > 0 ? o.z * STORY_H : 0, x0 = o.x, y0 = o.y;
        if (lz) { o.x = x0 + rs * lz; o.y = y0 - rc * lz; } // (straight up the screen)
        // camera turned: what the camera sees of a creature — 8 views from its facing angle minus the yaw (art/facing.js
        // sets o._dv for a 3/4 view, o.facing becomes the nearest side), its head turn in view letters
        const f0 = o.facing, h0 = o.headFacing;
        if (rot && o.isEntity && f0) { o.facing = viewFacing8(o, t, rot); if (h0) o.headFacing = viewFacing(h0, rc, rs); }
        const d = drawProxy(A, o); // substitutes missing contract sprites (e.g. bear, chest, bed)
        if (!o.isEntity) drawStatic(B, A, d, t);
        else if (o.kind === 'pawn') drawPawn(B, A, d, t);
        else drawAnimal(B, A, d, t);
        if (rot && o.isEntity && f0) { o.facing = f0; o.headFacing = h0; o._dv = null; }
        if (lz) { o.x = x0; o.y = y0; }
      }
      // light emitters: o.light = { r, g, b, radius, intensity, flicker, lift }
      const L = o.light;
      if (L) {
        const f = L.flicker ? 1 - L.flicker * (0.5 + 0.5 * Math.sin(t * 11 + o.x * 3) * Math.sin(t * 7.3 + o.y)) : 1;
        const d = L.radius * 2 * (0.96 + 0.04 * f);
        const lh = L.lift ?? 0.3;
        B.light.addRaw(o.x + rs * lh, o.y - rc * lh, d, d, L.r, L.g, L.b, L.intensity * f);
      }
    }
    R.emMark?.(); // (the last object's glows)
    for (const s of this.systems) s.render?.(this, B, v, env);
    this.particles.draw(B, A, v.x0 - 1, v.y0 - 2, v.x1 + 1, v.y1 + 2);

    // player lantern glow at night (keeps the area readable on mobile); (turned: up the screen)
    if (env.night > 0.05) {
      const p = this.player;
      B.light.addRaw(p.x + rs * 0.3, p.y - rc * 0.3, 9, 9, 1.0, 0.82, 0.6, 0.55 * env.night);
    }

    const dpr = R.dpr;
    const cam = { x: this.cam.x + this.shakeOff.x, y: this.cam.y + this.shakeOff.y, ppt: this.cam.zoom * dpr, rot };
    R.render(cam, env, t);
    animEnv.rc = 1; animEnv.rs = 0; animEnv.yaw = 0; // (other drawers of creatures: menu showcase, previews)
  }
}
