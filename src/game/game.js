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
import { faceKindOf, boxDepth, drawFacesTurned } from '../art/faces/index.js'; // camera rotation: pieces drawn as computed faces
import { viewFacing8 } from '../art/facing.js'; // camera rotation: creatures in 8 views
import { slopeSpeed, reliefShade } from './terrain.js'; // terrain height (docs/TERRAIN-HEIGHT.md)
import { groundOf } from '../world/height.js'; // the ground under a body (a tunnel's floor inside one)
import { drawStock } from '../art/livestockDraw.js'; // farm animals and fish (docs/LIVESTOCK.md)
import { drawFauna } from '../art/faunaDraw.js'; // wild animals of the biomes (docs/FAUNA.md)

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

const byD = (a, b) => a.d - b.d; // (roof lights: nearest the middle of the view first)
const DZ = { ref: false, x: 0, y: 0, h: 0, mode: 0, bias: 0, sb: 0, ord: 0 }; // (a renderer without depth)
// depth of a pawn at rest (art/compose.js pose: p._sobj = its bed / seat): lying flat where it is drawn (each part at its
// own height: the mattress, the pillow, the ground) a little toward the camera, sitting as a card through the seat at
// its height (the backrest hides its back when the camera looks from behind; its legs hang in front of the seat)
function restDepth(B, o, m0, e0, lz) {
  const po = o._sobj, PS = o.pose;
  if (o.moving || o.dead) return;
  if (PS.type === 'sleep') { B.main.depthOf(m0, B.main.n, NaN, 0, NaN, 1, 0.4, lz); return; }
  if (!po || PS.type !== 'sit') return;
  const sa = po._fk?.seatAt ? po._fk.seatAt(po) : null; // (as art/compose.js places the sitter)
  const x = sa ? sa[0] : po.x, y = sa ? sa[1] : po.y - 0.06, h = lz + 0.13 + (sa ? sa[2] : 0);
  B.main.depthOf(m0, B.main.n, x, y, h, 0, 0.1 + (o._zb || 0)); // (_zb: under a bridge deck in a boat, boats.js)
  B.emissive.depthOf(e0, B.emissive.n, x, y, h, 0, 0.1 + (o._zb || 0));
}

export class Game {
  constructor({ renderer, atlas, world, env, input, particles }) {
    this.R = renderer;
    this.A = atlas;
    this.world = world;
    this.env = env;
    this.input = input;
    this.particles = particles;
    this.time = 0; // (natural props get their o.solid when their chunk is installed: world.js NATURAL_SOLID)

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

  // the ground point under a screen point (terrain height: the visible surface along the view ray, docs/TERRAIN-HEIGHT.md)
  screenToWorld(sx, sy) {
    const z = this.cam.zoom, vx = (sx - this.R.cssW / 2) / z, vy = (sy - this.R.cssH / 2) / z;
    const cx = this.cam.x + this.shakeOff.x, cy = this.cam.y + this.shakeOff.y, W = this.world;
    if (!W.hasHeight) { const [dx, dy] = this.toWorldDir(vx, vy); return [W.wrapPos(cx + dx), cy + dy]; } // (canonical x: the planet wraps)
    // a point at height t on the ray shows here when it sits at view y = vy + t: the highest t on the surface is the one
    // seen (march down from the highest ground, then refine)
    const at = (t) => { const [dx, dy] = this.toWorldDir(vx, vy + t); return [cx + dx, cy + dy]; };
    let t = W.height.max + 0.5, prev = t;
    const VH = this.tunnels?.k.size ? (x, y) => this.tunnels.viewH(x, y) : (x, y) => W.heightAt(x, y); // (tunnels: the floor shown)
    for (; t > 0; t -= 0.2) { const [x, y] = at(t); if (VH(x, y) >= t) break; prev = t; }
    if (t <= 0) t = 0;
    else { let lo = t, hi = prev; for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2, [x, y] = at(m); if (VH(x, y) >= m) lo = m; else hi = m; } t = lo; }
    return at(t);
  }

  // h: tiles straight up the screen above the ground there (a nameplate over a head)
  worldToScreen(wx, wy, h = 0) {
    const z = this.cam.zoom;
    const [vx, vy] = this.toViewDir(this.world.dx(wx, this.cam.x + this.shakeOff.x), wy - this.cam.y - this.shakeOff.y);
    return [vx * z + this.R.cssW / 2, (vy - h - (this.tunnels?.k.size ? this.tunnels.viewH(wx, wy) : this.world.heightAt(wx, wy))) * z + this.R.cssH / 2];
  }

  update(dt) {
    this._dt = dt;
    this.time += dt;
    this.env.update(dt);
    const p = this.player, inp = this.input;

    // movement (systems may set p.autoMove / p.rooted)
    if (p._faceLockT > 0) p._faceLockT -= dt;
    if (p._atkRootT > 0) p._atkRootT -= dt; // standing still during an auto-attack swing / draw
    p.swimming = !p.dead && !(p.z > 0) && !p._boat && this.world.liquidAt(Math.floor(p.x), Math.floor(p.y), p._ud) === 2; // deep water: slow + cold (survival.js); not on ice / a deck (under a bridge: p._ud) / in a boat
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
    const spd = p.speed * (this.levels ? this.levels.speedAt(p) : this.world.speedAt(p.x, p.y, p._ud)); // levels: stairs slower
    const spdK = this.world.hasHeight ? slopeSpeed(this, p, mx, my) : 1; // terrain height: slower uphill
    if (mx || my) {
      const x0 = p.x, y0 = p.y, px0 = x0, py0 = y0;
      moveCircle(this.world, p, mx * spd * spdK * dt, my * spd * spdK * dt);
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

    if (this._prof) { // (dev: the slowest systems — game._prof = new Map() then read it)
      for (const s of this.systems) { const t0 = performance.now(); s.update?.(this, dt); const ms = performance.now() - t0, k = s.name || s._pk || (s._pk = this.systems.indexOf(s) + ':' + String(s.update).slice(0, 120).replace(/\s+/g, ' ')); if (ms > (this._prof.get(k) || 0)) this._prof.set(k, +ms.toFixed(2)); }
    } else for (const s of this.systems) s.update?.(this, dt);

    // zoom: input moves a target, the camera eases toward it (persisted as a factor of the default zoom)
    this.stepZoom(dt, inp.zoom);

    // camera follow with slight look-ahead
    const look = p.moving ? 0.6 : 0;
    const [ux, uy] = this.toWorldDir(0, -(0.4 + (p.z > 0 ? p.z * STORY_H : 0) + groundOf(p))); // (a little up the screen; levels / terrain height: elevated; in a tunnel: its floor)
    let tx = p.x + ux + mx * look, ty = p.y + uy + my * look;
    // optional focus point (e.g. a long-range aim): the camera leans toward it by weight k (0..1)
    const cf = this.camFocus;
    if (cf && Number.isFinite(cf.x) && Number.isFinite(cf.y)) { const fk = clamp(cf.k ?? 0.5, 0, 1); tx += (cf.x - tx) * fk; ty += (cf.y - ty) * fk; }
    const k = 1 - Math.exp(-dt * 6), W0 = this.world;
    this.cam.x += W0.dx(tx, this.cam.x) * k; // (the planet wraps: the camera follows across the seam without a jump — it may
    // leave 0..W; the ring textures, the shaders (cw) and the drawing (near) take any x; a teleport re-centres it)
    this.cam.y += (ty - this.cam.y) * k;
    if (W0.wrap) for (const e of this.entities) if (e.x < 0 || e.x >= W0.W) e.x = W0.wrapPos(e.x); // (positions stay canonical)

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
    const HL = this.world.height;
    if (HL.any) {
      // terrain height: high ground below the screen shows (it rises into view): deepen the box toward the camera
      const c = Math.cos(r), s = Math.sin(r), m = HL.maxIn(this.cam.x - hw - hh, this.cam.y - hw - hh, this.cam.x + hw + hh, this.cam.y + hw + hh + HL.max);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < 4; k++) {
        const qx = k & 1 ? hw : -hw, qy = k & 2 ? hh + m : -hh, wx = this.cam.x + c * qx - s * qy, wy = this.cam.y + s * qx + c * qy;
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
      }
      return { x0, y0, x1, y1 };
    }
    if (r) { const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r)); [hw, hh] = [c * hw + s * hh, s * hw + c * hh]; } // (the box around the turned screen)
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }

  // the cutout around the local player (engine/shaders.js CUT_FN): its body on the screen (view units from the camera)
  // and its card's depth; structures clearly in front of it open in a soft dithered circle. Eased in after a respawn /
  // while alive; off when dead or in a menu showcase.
  cutout(cam, rc, rs) {
    const p = this.player, C = this._cut || (this._cut = { x: 0, y: 0, r: 1, k: 0, yP: 0, hP: 0 });
    const want = p && !p.dead && !this.noCut ? 1 : 0;
    C.k += (want - C.k) * Math.min(1, (this._dt || 0.016) * 6);
    if (C.k < 0.01 || !p) { C.k = want ? C.k : 0; return C; }
    const hP = (p.z > 0 ? p.z * STORY_H : 0) + (p._dh || 0) + groundOf(p), dx = p.x - cam.x, dy = p.y - cam.y; // (+ the terrain under it: a tunnel's floor inside one)
    C.yP = -rs * dx + rc * dy; C.hP = hP;
    C.x = rc * dx + rs * dy; C.y = C.yP - hP - 0.55 * (p.scale || 1); C.r = 0.95 * (p.scale || 1);
    return C;
  }

  render() {
    const R = this.R, B = R.batches, A = this.A, t = this.time;
    R.resize();
    R.clearBatches();
    const rt0 = this._prof ? performance.now() : 0;
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
    // the planet wraps (docs/STREAMING.md): near the seam, what lies across it is drawn shifted by a planet width (its
    // x is set back after the frame: positions stay canonical)
    const wld0 = this.world, seam = wld0.wrap && (mx0 < 0 || mx1 > wld0.W), shifted = this._shifted || (this._shifted = []);
    const sh = (o) => { if (!seam) return; const nx = wld0.near(o.x, this.cam.x); if (nx !== o.x) { shifted.push(o, o.x); o.x = nx; } };
    const HG = this.world.height.any ? this.world.height : null; // terrain height (docs/TERRAIN-HEIGHT.md)
    const TK = this.tunnels?.k.size ? this.tunnels.k : null; // tunnels: tiles whose floor is shown (game/tunnels.js)
    this.world.forChunks(mx0, my0, mx1, my1, (c) => {
      for (const d of c.decor) {
        if (seam) sh(d);
        if (!d._hid && d.x > v.x0 - 1 && d.x < v.x1 + 1 && d.y > v.y0 - 0.5 && d.y < v.y1 + 1.5 && !(TK && TK.get(this.world.idx(Math.floor(d.x), Math.floor(d.y))) > 0.5)) drawDecor(B, A, d); // _hid: on a painted path / dug ground; TK: over a shown tunnel floor
      }
      for (const o of c.objects) {
        if (o.roof) continue; // roof tiles: drawn by the roof regions (src/game/roofs.js collect)
        if (seam) sh(o);
        if (o.x > mx0 && o.x < mx1 && o.y > my0 && o.y < my1) list.push(o);
      }
    });
    for (const e of this.entities) { if (seam) sh(e); if (e.x > mx0 && e.x < mx1 && e.y > my0 && e.y < my1 && !(e.dead && e._corpseId)) list.push(e); } // a body on the ground replaces the dead (corpses.js)
    // systems may contribute depth-sorted drawables (projectiles, camp props...): objects with o.draw(B, A, t)
    for (const s of this.systems) s.collect?.(this, list, v);
    // _sy: depth override (pawn lying in a bed / on a chair, stairs); levels: + one tile of depth per story up
    // depth key: `_zk` — NOT `_sk`, which is the pawn rig's stride blend (art/compose.js): sharing the name made
    // side-view boots fly far from the body (the stride became the pawn's y)
    // 3D at every camera angle (docs/CAMERA-ROTATION.md): the pieces with a face kind are always computed faces; the
    // painter's order = how far down the screen (the turned y), a wall box by its front-most point. (Only the blending
    // of soft pixels needs it: the depth buffer decides what hides what, pixel by pixel.)
    for (let i = 0; i < list.length; i++) {
      const o = list[i], fk = faceKindOf(o); // (art/faces: the pieces drawn as computed faces)
      o._fk = fk;
      if (o.zkRot) o._zk = o.zkRot(rc, rs); // (a roof: its front-most point)
      else if (fk) {
        o._zk = fk.depth ? fk.depth(o, rc, rs) : boxDepth(o, rc, rs);
        const fd = fk.front?.(o); // (a chair's backrest / a bed's headboard nearer the camera than its sitter: drawn after it)
        if (fd) list.push(fd);
      }
      else if (o._sy != null && o.pose?.o?._fk) o._zk = o.pose.o._zk + 0.02; // lying in a bed / sitting: right after it (art/faces/props.js)
      else { o._zk = -rs * o.x + rc * (o._sy ?? o.y); if (o.isEntity && o.z > 0) o._zk = this.levels ? this.levels.zkRot(o, o._zk, rc, rs) : o._zk + o.z; } // levels: up a story / on a stair
      if (HG && !o.zkRot && Number.isFinite(o.x) && Number.isFinite(o.y)) o._zk += o._tn != null ? o._tn : HG.heightAt(o.x, o.y); // (terrain height: nearer the camera; in a tunnel: its floor)
    }
    // a pawn in a bed / on a seat (art/compose.js _sobj): just in front of it, whichever way the camera looks
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o.isEntity && o._sobj && o._sy != null && o._sobj._zk != null) o._zk = o._sobj._zk + 0.02; }
    list.sort((a, b) => a._zk - b._zk);
    // canopies in front of the player (and their target) fade so they never vanish behind a tree
    const pl = this.player, tg = pl.target && !pl.target.dead ? pl.target : null;
    const fk = 1 - Math.exp(-(this._dt || 0.016) * 8);
    const hides = (o, e, s) => { const dx = rc * (o.x - e.x) + rs * (o.y - e.y), dy = -rs * (o.x - e.x) + rc * (o.y - e.y); return dy > 0 && dy < (o._ch || 2.6 * s) && Math.abs(dx) < (o._cw || 1.15 * s); }; // (in view space; _ch / _cw: the planet's big crowns, art/composeWorld.js)
    for (const o of list) {
      if (o.isEntity || o.draw || !o.type?.startsWith('tree_') || o.stump) continue;
      const s = o.s || 1;
      const covers = hides(o, pl, s) || (tg && hides(o, tg, s));
      const target = covers ? 0.42 : 1;
      const a = o.alpha ?? 1;
      if (a !== target) o.alpha = Math.abs(a - target) < 0.01 ? target : a + (target - a) * fk;
    }
    const LV = this.levels?.hasUpper ? this.levels : null; // levels: upper stories in the world
    const Z = R.depth || DZ; // depth shape of what each drawable adds (engine/spriteBatch.js depthState)
    R.emMark?.(); // (glows of the ground decor: under everything)
    // outdoor lamps that light the roofs around them (renderer roof light-occluder pass; lamps under a roof never do)
    const RLc = this._rlc || (this._rlc = []), roofG = this.build?.grid?.roof || null, wld = this.world; // (the menu showcase has no build)
    let RLn = 0;
    const roofLight = (x, y, h, rad, r, g, b, I) => {
      const tx = Math.floor(x), ty = Math.floor(y);
      const ro = roofG && wld.inBounds(tx, ty) ? roofG.get(wld.idx(tx, ty)) : null;
      if (ro && !ro.blueprint) return; // (inside a roofed house)
      const c = RLc[RLn] || (RLc[RLn] = { x: 0, y: 0, h: 0, r: 0, cr: 0, cg: 0, cb: 0, d: 0 });
      RLn++;
      c.x = x; c.y = y; c.h = h; c.r = rad; c.cr = r * I * 0.5; c.cg = g * I * 0.5; c.cb = b * I * 0.5; c.d = Math.hypot(x - this.cam.x, y - this.cam.y);
    };
    for (const o of list) {
      R.emMark?.(); // the glows of the object drawn before this one go right after it (renderer.emSeg)
      // anything under an opaque roof is hidden by it (and its flames would glow through): skip it, except the
      // walls / doors whose front faces show below the eaves; same under a cave ceiling (never the local player,
      // who is drawn while its own cave's ceiling fades out)
      if (!o.draw && ((underOpaqueRoof(this, o.x, o.y) && !(o.building && BUILDINGS[o.type]?.connect === 'wall')) || (o !== pl && underCaveCeiling(this, o.x, o.y)))) continue;
      if (TK && o !== pl && !o.draw && (o.isEntity ? o._tn != null && this.tunnels.hidden(o.x, o.y, o) : !o.building && TK.get(this.world.idx(Math.floor(o.x), Math.floor(o.y - 0.05))) > 0.5)) continue; // tunnels: a body in one nobody sees into; what stands on the surface over a shown floor
      // depth (docs/CAMERA-ROTATION.md "Profundidade por pixel"): faces are exact and the sprites of a face kind /
      // drawable stand where they are drawn (their own anchor and lift); a creature or a plant is one card through
      // its foot (its parts never hide each other: drawing order on the card), a creature up a story stands at its
      // height, a little toward the camera (its feet over the floor it stands on); tree crowns may open in the cutout;
      // the sprites of a face kind (flames, glows, billboards) a bit in front of its own faces
      Z.ord = 0; Z.mode = 0; Z.bias = o._fk?.zBias || 0; Z.sb = o._fk ? 0.3 : 0; Z.ref = false;
      Z.g = HG && Number.isFinite(o.x) && Number.isFinite(o.y) ? HG.heightAt(o.x, o.y) : 0; // (computed faces stand on the terrain; sprites are lifted on the GPU)
      if (o.isEntity) { Z.ref = true; Z.x = o.x; Z.y = o.y; Z.h = (o.z > 0 ? o.z * STORY_H : 0) + (o._dh || 0) + (o._th || 0) + (o._jh || 0); Z.bias = 0.02 + (o._zb || 0); } // (_th: tunnels, game/tunnels.js) // (_dh: standing on a pier / bridge deck, decks.js; _zb: riding under one, boats.js)
      else if (!o.draw && !o._fk) { Z.ref = true; Z.x = o.x; Z.y = o.y; Z.h = 0; if (o.type?.startsWith('tree_')) Z.mode = 2; }
      const m0 = B.main.n, e0 = B.emissive.n;
      if (o.draw) o.draw(B, A, t);
      else if (o._fk && drawFacesTurned(B, A, o, t, R)) { /* computed faces (art/faces; + a 3D scaffold while being built) */ }
      else {
        if (LV) { if (!o.isEntity && o.lv > 0) { LV.drawUpper(B, A, o, t); continue; } if (LV.culled(o)) continue; } // upper pieces lifted; things under a slab hidden
        // levels: an entity up a story is drawn with its base lifted (it stands on the wall top / upper floor)
        const lz = o.isEntity ? (o.z > 0 ? o.z * STORY_H : 0) + (o._dh || 0) + (o._th || 0) + (o._jh || 0) : 0, x0 = o.x, y0 = o.y; // (+ a pier / bridge deck under it; + tunnels: game/tunnels.js _th)
        if (lz) { o.x = x0 + rs * lz; o.y = y0 - rc * lz; } // (straight up the screen)
        // camera turned: what the camera sees of a creature — 8 views from its facing angle minus the yaw (art/facing.js
        // sets o._dv for a 3/4 view, o.facing becomes the nearest side), its head turn in view letters
        // (a ballista operator: 8 views at 0° too — it turns with the aim, game/ballista.js _opA)
        const f0 = o.facing, h0 = o.headFacing, v8 = o.isEntity && f0 && (rot || o._opA != null);
        if (v8) { o.facing = viewFacing8(o, t, rot); if (h0) o.headFacing = viewFacing(h0, rc, rs); }
        const d = drawProxy(A, o); // substitutes missing contract sprites (e.g. bear, chest, bed)
        if (!o.isEntity) drawStatic(B, A, d, t);
        else if (o.kind === 'pawn') drawPawn(B, A, d, t);
        else if (!drawStock(B, A, d, t, d.water && this.world.frozenAt(d.x, d.y)) && !drawFauna(B, A, d, t, this.world)) drawAnimal(B, A, d, t);
        if (v8) { o.facing = f0; o.headFacing = h0; o._dv = null; }
        if (lz) { o.x = x0; o.y = y0; }
        // terrain height: what stands in the shade of a hill / cliff is darker (terrain.js reliefShade; plants and props
        // cached ~1 s, creatures every frame; not in a tunnel / a cave)
        if (HG && B.main.n > m0 && !(o._tn != null)) {
          let sh;
          if (o.isEntity) sh = reliefShade(this, o.x, o.y, HG.heightAt(o.x, o.y) + (o._jh || 0), env);
          else { if (!(o._rshT > t - 1)) { o._rshT = t; o._rsh = reliefShade(this, o.x, o.y, HG.heightAt(o.x, o.y), env); } sh = o._rsh; }
          if (sh > 0.01) B.main.tint(m0, B.main.n, 1 - sh, 1 - sh * 0.95, 1 - sh * 0.84);
        }
        if (o.isEntity && o.pose) restDepth(B, o, m0, e0, lz);
      }
      // light emitters: o.light = { r, g, b, radius, intensity, flicker, lift }
      const L = o.light;
      if (L) {
        const f = L.flicker ? 1 - L.flicker * (0.5 + 0.5 * Math.sin(t * 11 + o.x * 3) * Math.sin(t * 7.3 + o.y)) : 1;
        const d = L.radius * 2 * (0.96 + 0.04 * f);
        const lh = L.lift ?? 0.3;
        const lp = o._fk?.lightAt ? o._fk.lightAt(o) : null; // (where a face kind drew the piece, art/faces/props.js)
        B.light.addRaw((lp ? lp[0] : o.x) + rs * lh, (lp ? lp[1] : o.y) - rc * lh, d, d, L.r, L.g, L.b, L.intensity * f);
        if (RLn < 96) roofLight(lp ? lp[0] : o.x, lp ? lp[1] : o.y, lh + (o.lv | 0) * STORY_H, d / 2, L.r, L.g, L.b, L.intensity * f);
      }
    }
    R.emMark?.(); // (the last object's glows)
    Z.ref = false; Z.mode = 0; Z.bias = 0; Z.sb = 0; Z.ord = 0; Z.g = 0;
    // particles: sparks / embers (glow layer) where they fly, behind what stands in front of them (depth-tested)
    this.particles.draw(B, A, v.x0 - 1, v.y0 - 2, v.x1 + 1, v.y1 + 2);
    R.depthEnd?.(); // (overlays from here on: drawn over the world, no depth test)
    for (const s of this.systems) s.render?.(this, B, v, env);

    // player lantern glow at night (keeps the area readable on mobile); (turned: up the screen)
    if (env.night > 0.05) {
      const p = this.player;
      B.light.addRaw(p.x + rs * 0.3, p.y - rc * 0.3, 9, 9, 1.0, 0.82, 0.6, 0.55 * env.night);
      if (RLn < 96) roofLight(p.x, p.y, 0.3 + (p.z > 0 ? p.z * STORY_H : 0), 4.5, 1.0, 0.82, 0.6, 0.55 * env.night);
    }
    // the 24 nearest the middle of the view go to the roofs (FACE_FS uRL / uRC)
    {
      const RL = R.roofLights || (R.roofLights = { n: 0, P: new Float32Array(96), C: new Float32Array(96) });
      if (RLn > 24) { for (let i = RLn; i < RLc.length; i++) RLc[i].d = 1e9; RLc.sort(byD); } // (no allocation: stale entries last)
      const n = Math.min(24, RLn);
      for (let i = 0; i < n; i++) { const c = RLc[i], k = i * 4; RL.P[k] = c.x; RL.P[k + 1] = c.y; RL.P[k + 2] = c.h; RL.P[k + 3] = c.r; RL.C[k] = c.cr; RL.C[k + 1] = c.cg; RL.C[k + 2] = c.cb; RL.C[k + 3] = 0; }
      RL.n = n;
    }

    const dpr = R.dpr;
    const cam = { x: this.cam.x + this.shakeOff.x, y: this.cam.y + this.shakeOff.y, ppt: this.cam.zoom * dpr, rot, cut: null };
    cam.cut = this.cutout(cam, rc, rs);
    if (this._prof) { const t1 = performance.now(); R.render(cam, env, t); const ms = performance.now() - t1; if (ms > (this._prof.get('R.render') || 0)) this._prof.set('R.render', +ms.toFixed(2)); if (t1 - rt0 > (this._prof.get('render.cpu') || 0)) this._prof.set('render.cpu', +(t1 - rt0).toFixed(2)); }
    else R.render(cam, env, t);
    for (let k = shifted.length - 2; k >= 0; k -= 2) shifted[k].x = shifted[k + 1]; // (back to canonical positions)
    shifted.length = 0;
    animEnv.rc = 1; animEnv.rs = 0; animEnv.yaw = 0; // (other drawers of creatures: menu showcase, previews)
  }
}
