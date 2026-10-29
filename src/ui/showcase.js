// Main-menu live background: the real engine rendering a scenic, local-only showcase world — a campfire
// by a river at the edge of a forest, two survivors resting, deer nearby — with a slow day/night cycle,
// the game's weather, fireflies and ambient life (fx/ambient.js) and a slow cinematic camera.
// Nothing here is shared or saved; stop() frees the world textures before the real world is uploaded.

import { generateWorld } from '../world/worldgen.js';
import { World } from '../world/world.js';
import { generateNoiseTexture } from '../world/terrainTex.js';
import { Environment } from '../fx/environment.js';
import { Particles } from '../fx/particles.js';
import { Game } from '../game/game.js';
import { installAmbient } from '../fx/ambient.js';
import { BUILDINGS } from '../game/data.js';

const SEED = 20260;
const TREE = /^tree_/;

// best campfire spot: dry open tile 2–5 tiles from water, many trees around, away from rock
function findSpot(world) {
  const W = world.W, H = world.H;
  let best = null, bs = -1e9;
  const tries = [];
  for (const z of world.zones || []) if (z.type === 'river' || z.type === 'lake' || z.type === 'shore') tries.push([z.x, z.y]);
  if (!tries.length) tries.push([world.spawn.x, world.spawn.y]);
  for (const [zx, zy] of tries.slice(0, 40)) {
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2, r = 3 + (k % 5) * 2;
      const tx = Math.floor(zx + Math.cos(a) * r), ty = Math.floor(zy + Math.sin(a) * r);
      if (tx < 12 || ty < 12 || tx > W - 12 || ty > H - 12) continue;
      const i = ty * W + tx;
      if (world.rock[i] || world.water[i]) continue;
      const dw = world.dWater?.[i] ?? 9, dr = world.dRock?.[i] ?? 9;
      if (dw < 2.5 || dw > 6 || dr < 5) continue;
      // some water in the frame (a river bend / lake shore), not a sea
      let wet = 0, cells = 0;
      for (let y = ty - 5; y <= ty + 5; y++) for (let x = tx - 8; x <= tx + 8; x++) { cells++; if (world.water[y * W + x]) wet++; }
      const wf = wet / cells;
      let trees = 0, near = 0;
      world.forChunks(tx - 9, ty - 9, tx + 9, ty + 9, (c) => {
        for (const o of c.objects) {
          if (!TREE.test(o.type)) continue;
          const d = Math.hypot(o.x - tx, o.y - ty);
          if (d < 3.4) near++;
          else if (d < 9) trees++;
        }
      });
      const s = Math.min(trees, 18) - near * 3 - Math.abs(dw - 3.5) * 2 + (wf > 0.12 && wf < 0.38 ? 14 : -10);
      if (s > bs) { bs = s; best = [tx, ty]; }
    }
  }
  return best || [Math.floor(world.spawn.x), Math.floor(world.spawn.y)];
}

export function startShowcase({ renderer, atlas, onReady = null }) {
  const world = new World(generateWorld(SEED));
  renderer.setWorld(world);
  renderer.setNoise(256, generateNoiseTexture(SEED));
  const env = new Environment(SEED);
  env.dayLength = 330;        // a calm day/night in ~5.5 min
  env.hour = 17.4;            // start at golden hour
  env.setWeather('clear');
  env.weatherT = 120;
  const input = { move: () => [0, 0], taps: [], pressed: new Set(), keys: new Set(), zoom: 0, isTouch: false, endFrame() {} };
  const game = new Game({ renderer, atlas, world, env, input, particles: new Particles() });
  game.headless = false;
  const [fx, fy] = findSpot(world);

  // the scene: clear a small ring, light a campfire, two survivors and a few deer
  game.net.applying++;
  try {
    const rm = [];
    world.forChunks(fx - 5, fy - 4, fx + 5, fy + 7, (c) => {
      for (const o of c.objects) {
        const dx = o.x - fx - 0.5, dy = o.y - fy - 0.5;
        // a clearing around the fire; tall trees just south of it would hide the scene
        if (Math.hypot(dx, dy) < 3.1 || (TREE.test(o.type) && dy > 0 && dy < 5.5 && Math.abs(dx) < 2.6)) rm.push(o);
      }
      c.decor = c.decor.filter((d) => Math.hypot(d.x - fx - 0.5, d.y - fy - 0.6) > 1.25);
    });
    for (const o of rm) world.removeObject(o); // sync-ok: menu showcase world (local, never shared or saved)
    const def = BUILDINGS.campfire;
    const fire = { id: 'show-fire', type: 'campfire', v: 0, tx: fx, ty: fy, x: fx + 0.5, y: fy + 1, s: 1, f: 1, building: true, progress: 1, mask: 0, solid: 0, fire: true, light: { ...def.light } };
    world.addObject(fire); // sync-ok: menu showcase world (local, never shared or saved)
  } finally { game.net.applying--; }

  const p = game.player;
  Object.assign(p, { x: fx - 0.55, y: fy + 1.25, facing: 'e', weapon: null, name: '' });
  const friend = {
    isEntity: true, kind: 'pawn', name: '', x: fx + 1.6, y: fy + 0.95, r: 0.24, facing: 'w', moving: false, moveT: 0, action: null, flash: 0, weapon: null, hp: 1, maxHp: 1,
    look: { skin: [0.78, 0.58, 0.44], hair: 'long', hairColor: [0.12, 0.09, 0.07], shirt: [0.62, 0.36, 0.28] },
  };
  game.entities.push(friend); // sync-ok: menu showcase world (local, never shared)
  const deer = [];
  for (let k = 0; k < 3; k++) {
    const a = 2.2 + k * 0.7, r = 6.5 + k * 1.3;
    const d = { isEntity: true, kind: 'animal', species: k === 2 ? 'rabbit' : 'deer', name: '', x: fx + Math.cos(a) * r, y: fy + Math.sin(a) * r * 0.6, r: 0.3, facing: k ? 'e' : 'w', moving: false, moveT: 0, action: null, flash: 0, scale: 1, hp: 1, maxHp: 1, _t: k * 3 };
    const tx = Math.floor(d.x), ty = Math.floor(d.y);
    if (world.inBounds(tx, ty) && !world.rock[ty * world.W + tx] && world.water[ty * world.W + tx] !== 2) { deer.push(d); game.entities.push(d); } // sync-ok: menu showcase
  }
  installAmbient(game);
  const amb = game.ambient;

  // slow cinematic camera around the fire; the scene sits right of the menu column on wide screens
  const C = { t: Math.random() * 60, last: performance.now(), raf: 0, alive: true, shown: false };
  const camAt = () => {
    const w = renderer.cssW || innerWidth, h = renderer.cssH || innerHeight;
    const wide = w > 700 && w > h * 1.15;
    const base = Math.max(32, Math.min(64, Math.min(w, h) / (wide ? 12.5 : 11)));
    const z = base * (1 + 0.07 * Math.sin(C.t * 0.031));
    const shift = wide ? (0.2 * w) / z : 0;
    game.cam.zoom = z;
    game.cam.x = fx + 0.5 - shift + Math.sin(C.t * 0.043) * 1.2 + Math.sin(C.t * 0.011) * 0.8;
    game.cam.y = fy + 0.3 + Math.sin(C.t * 0.029 + 1) * 0.9 + (wide ? 0 : 1.6);
  };
  const frame = (now) => {
    if (!C.alive) return;
    C.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - C.last) / 1000));
    C.last = now;
    if (document.hidden) return;
    C.t += dt;
    game.time += dt; game._dt = dt;
    env.update(dt);
    // keep weather gentle in the menu (no storms)
    if (env.weather === 'storm') env.setWeather('rain');
    amb.update(game, dt);
    game.particles.update(dt);
    // idle life: survivors glance around, deer drift while grazing
    if (Math.sin(C.t * 0.37) > 0.96) p.facing = 's'; else p.facing = 'e';
    friend.facing = Math.sin(C.t * 0.23 + 2) > 0.93 ? 's' : 'w';
    for (const d of deer) {
      d._t += dt;
      const mv = Math.sin(d._t * 0.21) > 0.75;
      d.moving = mv;
      if (mv) { const dx = Math.sin(d._t * 0.05) > 0 ? 1 : -1; d.x += dx * dt * 0.6; d.facing = dx > 0 ? 'e' : 'w'; d.moveT = (d.moveT || 0) + dt * 2; }
    }
    camAt();
    try { game.render(); } catch (e) { console.warn('[menu] showcase render failed', e); stop(); return; }
    if (!C.shown) { C.shown = true; onReady?.(); }
  };
  camAt();
  C.raf = requestAnimationFrame(frame);

  function stop() {
    if (!C.alive) return;
    C.alive = false;
    cancelAnimationFrame(C.raf);
    // free this world's GPU textures before the real one is uploaded
    const gl = renderer.gl;
    for (const k of ['tileTex', 'fieldTex', 'field2Tex', 'caveTex', 'noiseTex']) if (renderer[k]) { try { gl.deleteTexture(renderer[k]); } catch { /* ignore */ } renderer[k] = null; }
    renderer.clearBatches?.();
  }
  return { stop, game };
}
