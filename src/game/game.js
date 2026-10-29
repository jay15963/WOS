// Core game: owns world, entities, camera, environment; runs update + builds render batches.

import { drawPawn, drawAnimal, drawStatic, drawDecor } from '../art/compose.js';
import { moveCircle, facingFrom } from './physics.js';
import { clamp } from '../engine/noise.js';
import { drawProxy } from './artcompat.js';
import { stepGait } from './anim.js';
import { Net } from '../net/net.js';

const SOLID = { tree_oak: 0.2, tree_pine: 0.18, tree_birch: 0.16, tree_dead: 0.16, boulder: 0.34 };
const ZOOM_MIN = 22, ZOOM_MAX = 110; // css px per tile

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
      facing: 's', moving: false, moveT: 0, speed: 4.0, action: null, flash: 0,
      look: { skin: [0.96, 0.80, 0.66], hair: 'short', hairColor: [0.36, 0.22, 0.12], shirt: [0.34, 0.47, 0.62] },
      weapon: 'sword', hp: 100, maxHp: 100,
    };
    this.entities = [this.player];
    this.cam = { x: this.player.x, y: this.player.y, zoom: 0, ppt: 48 };
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
    const c = this.cam;
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
    const target = clamp(this.defaultZoom() * c.zoomK, ZOOM_MIN, ZOOM_MAX);
    const k = 1 - Math.exp(-dt * 14);
    c.zoom = Math.abs(target - c.zoom) < 0.01 ? target : c.zoom + (target - c.zoom) * k;
    if (c._zoomSave > 0 && (c._zoomSave -= dt) <= 0) { try { localStorage.setItem('wos.zoom', c.zoomK.toFixed(3)); } catch { /* ignore */ } }
  }

  screenToWorld(sx, sy) {
    const z = this.cam.zoom;
    return [this.cam.x + this.shakeOff.x + (sx - this.R.cssW / 2) / z, this.cam.y + this.shakeOff.y + (sy - this.R.cssH / 2) / z];
  }

  worldToScreen(wx, wy) {
    const z = this.cam.zoom;
    return [(wx - this.cam.x - this.shakeOff.x) * z + this.R.cssW / 2, (wy - this.cam.y - this.shakeOff.y) * z + this.R.cssH / 2];
  }

  update(dt) {
    this._dt = dt;
    this.time += dt;
    this.env.update(dt);
    const p = this.player, inp = this.input;

    // movement (systems may set p.autoMove / p.rooted)
    let [mx, my] = inp.move();
    if (!mx && !my && p.autoMove) { mx = p.autoMove[0]; my = p.autoMove[1]; }
    if (p.rooted) mx = my = 0;
    const spd = p.speed * this.world.speedAt(p.x, p.y);
    if (mx || my) {
      const x0 = p.x, y0 = p.y;
      moveCircle(this.world, p, mx * spd * dt, my * spd * dt);
      p.facing = facingFrom(mx, my, p.facing);
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
    let tx = p.x + mx * look, ty = p.y - 0.4 + my * look;
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
    this.net.flush(); // one ordered op batch per frame to every synced guest
  }

  // visible world rect (with margins for tall sprites & shadows)
  view() {
    const z = this.cam.zoom;
    const hw = this.R.cssW / z / 2, hh = this.R.cssH / z / 2;
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }

  render() {
    const R = this.R, B = R.batches, A = this.A, t = this.time;
    R.resize();
    R.clearBatches();
    const env = this.env.compute();
    const v = this.view();
    const mx0 = v.x0 - 3, mx1 = v.x1 + 3, my0 = v.y0 - 1.5, my1 = v.y1 + 4;

    const list = this._draw;
    list.length = 0;
    this.world.forChunks(mx0, my0, mx1, my1, (c) => {
      for (const d of c.decor) {
        if (d.x > v.x0 - 1 && d.x < v.x1 + 1 && d.y > v.y0 - 0.5 && d.y < v.y1 + 1.5) drawDecor(B, A, d);
      }
      for (const o of c.objects) {
        if (o.x > mx0 && o.x < mx1 && o.y > my0 && o.y < my1) list.push(o);
      }
    });
    for (const e of this.entities) if (e.x > mx0 && e.x < mx1 && e.y > my0 && e.y < my1) list.push(e);
    // systems may contribute depth-sorted drawables (projectiles, camp props...): objects with o.draw(B, A, t)
    for (const s of this.systems) s.collect?.(this, list, v);
    list.sort((a, b) => a.y - b.y);
    // canopies in front of the player (and their target) fade so they never vanish behind a tree
    const pl = this.player, tg = pl.target && !pl.target.dead ? pl.target : null;
    const fk = 1 - Math.exp(-(this._dt || 0.016) * 8);
    const hides = (o, e, s) => o.y > e.y && o.y - e.y < 2.6 * s && Math.abs(o.x - e.x) < 1.15 * s;
    for (const o of list) {
      if (o.isEntity || o.draw || !o.type?.startsWith('tree_') || o.stump) continue;
      const s = o.s || 1;
      const covers = hides(o, pl, s) || (tg && hides(o, tg, s));
      const target = covers ? 0.42 : 1;
      const a = o.alpha ?? 1;
      if (a !== target) o.alpha = Math.abs(a - target) < 0.01 ? target : a + (target - a) * fk;
    }
    for (const o of list) {
      if (o.draw) o.draw(B, A, t);
      else {
        const d = drawProxy(A, o); // substitutes missing contract sprites (e.g. bear, chest, bed)
        if (!o.isEntity) drawStatic(B, A, d, t);
        else if (o.kind === 'pawn') drawPawn(B, A, d, t);
        else drawAnimal(B, A, d, t);
      }
      // light emitters: o.light = { r, g, b, radius, intensity, flicker, lift }
      const L = o.light;
      if (L) {
        const f = L.flicker ? 1 - L.flicker * (0.5 + 0.5 * Math.sin(t * 11 + o.x * 3) * Math.sin(t * 7.3 + o.y)) : 1;
        const d = L.radius * 2 * (0.96 + 0.04 * f);
        B.light.addRaw(o.x, o.y - (L.lift ?? 0.3), d, d, L.r, L.g, L.b, L.intensity * f);
      }
    }
    for (const s of this.systems) s.render?.(this, B, v, env);
    this.particles.draw(B, A, v.x0 - 1, v.y0 - 2, v.x1 + 1, v.y1 + 2);

    // player lantern glow at night (keeps the area readable on mobile)
    if (env.night > 0.05) {
      const p = this.player;
      B.light.addRaw(p.x, p.y - 0.3, 9, 9, 1.0, 0.82, 0.6, 0.55 * env.night);
    }

    const dpr = R.dpr;
    const cam = { x: this.cam.x + this.shakeOff.x, y: this.cam.y + this.shakeOff.y, ppt: this.cam.zoom * dpr };
    R.render(cam, env, t);
  }
}
