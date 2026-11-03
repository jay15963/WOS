// Frame pipeline:
//  1. shadow target (half res): sun-shadow silhouettes, MAX blend
//  2. scene target: terrain shader -> terrain decals (ore, rubble) -> blob shadows -> decor (grass) -> sorted sprites -> alpha FX
//  3. light target (half res): ambient (darkened in mountain caves and revealed interiors, AMBIENT_FS) + additive
//     point lights + roof occluder (opaque roofs keep the outdoor ambient: lamps inside never light the roof)
//  4. screen: post (lighting, clouds, mist, snow / rain, bloom, grading, vignette, grain) -> emissive sprites (fire, sparks)
// Game code fills `renderer.batches.*` every frame, then calls render(camera, env).
//
// ROOFS (src/game/roofs.js, src/art/roofRaster.js): each roof region is a cached texture pair (colour,
// premultiplied + mipmaps; owner slice id, RG8) made by setRoofTex(old, art). A depth-sorted drawable calls
// roofSlice(region, slice) from the main sort: the quad lands in batches.roof and a segment remembers the main
// batch position, so the scene pass draws main sprites up to there, then the roof slice, then the rest.
// roofData (RGBA per tile, uRoofT): R interior darkness, G revealed region (cracks on cave tiles), B built coverage,
// A cave ceiling drawn over the tile (game/roofs.js) — updateRoofData().
//
// WIND SWAY (opt-in per sprite, for everyone who draws plants): pass a non-zero `sway` in
//   batch.add(sprite, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recvShadow, lift)
// sway = bend at the sprite's top as a fraction of its height (the base stays put). swayFor(type) below gives
// the house values (trees 0.02–0.04, bushes 0.05, crops 0.07, grass 0.11, tall grass / reeds 0.15). Pass the
// same sway in batches.shadow so the shadow bends with the plant. The shader takes the wind from env
// (game.env.wind = { x, y, gust }, cosmetic, per frame): calm, nearly constant frequency, amplitude follows
// the wind. sway > 0.09 also gets the silvery wind-wave sheen; any sway > 0 lets snow settle on the sprite's
// top edges in cold biomes. CPU-side motion (particles, critters) can read game.env.wind directly.
//
// WALKERS PARTING VEGETATION: src/fx/brush.js feeds up to 12 pushers (setPushers) every frame; any swaying
// sprite (sway ≥ ~0.04, shorter than 2.2 tiles) bends away from them in the shared sway function — no opt-in
// beyond the sway value.
//
// GOD RAYS: sun-shadow pass punches dappled holes into tree crowns (canopy = swaying sprite > 1.4 tiles) and
// keeps the hole-free canopy in G; the post pass turns gaps into shafts (strength env.extra.uRays, morning
// curve in environment.js). Extra shafts from openings: renderer.addShaft(...) + sunShaft(env), below.
//
// Quality: setQuality(0|1|2) switches the terrain / sprite / light / post programs compiled with
// `#define QL n` (src/fx/quality.js picks the level; game.quality = 'low'|'medium'|'high').

import { createContext, createProgram, createTexture, createTextureArray, createTarget, deleteTarget } from './gl.js';
import { FaceBatch } from './faceBatch.js';
import { SpriteBatch, depthState } from './spriteBatch.js';
import * as S from './shaders.js';
import { TerrainWindow, WIN, fillLayer4 } from '../world/terrainWindow.js'; // GPU ring window over the planet (docs/STREAMING.md)

// house sway values by object / decor type (prefix match); 0 = rigid
const SWAY = [['tree_pine', 0.022], ['tree_dead', 0.015], ['tree_birch', 0.04], ['tree_', 0.03], ['sapling', 0.08],
  ['berrybush', 0.05], ['bush', 0.05], ['crop', 0.07], ['wild_corn', 0.06], ['fibergrass', 0.11], ['tallgrass', 0.15],
  ['reed', 0.15], ['cattail', 0.15], ['grass', 0.11], ['fern', 0.08], ['flower', 0.05], ['herb', 0.06], ['clover', 0.05]];
export function swayFor(type) {
  if (!type) return 0;
  for (const [p, v] of SWAY) if (type.startsWith(p)) return v;
  return 0;
}

// Sunlight for a shaft through an opening (see Renderer.addShaft): unit light direction on the ground
// (dx, dy), ground run per unit of height (len: landing = opening + (dx, dy) * len * height), god-ray
// strength now (k: strongest in the morning, 0 at night / overcast) and a warm colour.
export function sunShaft(env) {
  const sd = env.shadowDir || [0, 0], sl = Math.hypot(sd[0], sd[1]) || 1;
  const k = env.extra && env.extra.uRays != null ? env.extra.uRays : 0;
  const warm = env.hour != null && env.hour > 12 ? 0.08 : 0;
  return { dx: sd[0] / sl, dy: sd[1] / sl, len: sl, k, day: env.day ?? 1, r: 1, g: 0.86 - warm, b: 0.62 - warm * 1.5 };
}

// snow affinity per biome name: precipitation turns to snow and snow lies where it is ≥ ~0.6

const SEA0 = [0, 0, 0, 0]; // no season data yet
// scene draw buffers: the colour only / the colour + the glow layer (sprites, roofs and glows of the main pass)
const DB1 = [0x8CE0], DB2 = [0x8CE0, 0x8CE1], ZERO4 = new Float32Array(4); // (COLOR_ATTACHMENT0 / 1)
// depth of the world (docs/CAMERA-ROTATION.md "Profundidade por pixel"): clip z = −d · DEPTH_K, d = view y + height
// relative to the camera (tiles; |d| < 256 everywhere on screen), 24-bit buffer: ~3e-5 tile per step
const DEPTH_K = 1 / 256;
const ALPHA_CUT = 0.25; // a depth-writing fragment fainter than this is dropped (its soft edge would hide what follows)
// prepend the quality define right after the version line
const ql = (src, level) => src.replace('#version 300 es', `#version 300 es\n#define QL ${level}`);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = createContext(canvas));
    this._variants = {};   // quality level -> { sprite, light, terrain, post } (compiled on first use)
    this.level = -1;       // set by setQuality (quality.js right after boot) or by the first render
    this.progShadow = createProgram(gl, ql(S.SHADOW_VS, 0), ql(S.SHADOW_FS, 0));
    this.progAmbient = createProgram(gl, ql(S.FULL_VS, 0), ql(S.AMBIENT_FS, 0)); // [world] ambient light with cave darkness
    this.progDecal = createProgram(gl, ql(S.DECAL_VS, 0), ql(S.DECAL_FS, 0));    // [world] per-tile terrain decals (ore, rubble)
    this.progRoof = createProgram(gl, ql(S.ROOF_VS, 0), ql(S.ROOF_FS, 0));       // procedural roof slices (scene + light occluder)
    this.progFace = createProgram(gl, ql(S.FACE_VS, 0), ql(S.FACE_FS, 0));       // computed faces (camera rotation: walls as boxes)
    this.roofSeg = [];                      // [{ at (main batch index), start, n, tex }] for this frame
    // glow sprites (B.emissive) sorted with the sprites: [e0, e1, at] = emissive [e0, e1) drawn after main [0, at)
    // (game.render marks them object by object: emMark) — whatever stands in front hides them (owner: no flame over
    // a character, no lit back window over a roof)
    this.emSeg = [];
    this._emLast = 0;
    this.faceSeg = []; // [f0, f1, at]: computed faces [f0, f1) drawn after main [0, at) (same marks as the glows)
    this.faceTex = []; // the texture of each face segment (null = the atlas; a roof handle from roofFaceTex)
    this.pop = { vib: 0.45, gamma: 1.17 }; // the bright cartoon look (post: uPop); game.debug can tune it
    this._roofFaces = []; // [f0, f1, handle] roof faces drawn this frame (camera turned): the light occluder redraws them
    this._fLast = 0;
    this._fTex = null;
    this._segPool = [];
    this.fsVao = gl.createVertexArray();
    this.fx = { grain: 0.022, bloom: 1 };   // post extras (quality.js sets them per tier)
    this.solidNear = true;                  // walls in view (syncSolid): enables the contact-AO fetches

    // depth state shared by the batches (engine/spriteBatch.js depthState: game.js sets the reference per drawable)
    const Z = (this.depth = depthState());
    this.batches = {
      shadow: new SpriteBatch(gl, 2048),   // sun-shadow casters (silhouettes)
      decal: new SpriteBatch(gl, 1024),    // [world] per-tile terrain decals (addRaw: r = kind 0 ore / 1 rubble)
      ground: new SpriteBatch(gl, 2048),   // flat ground sprites under everything (floors, farm plots, rugs)
      blob: new SpriteBatch(gl, 1024),     // contact shadows (dark ellipses) drawn on ground
      decor: new SpriteBatch(gl, 8192),    // ground plants, drawn before sorted sprites
      main: new SpriteBatch(gl, 8192, Z), // y-sorted world sprites (caller sorts); depth-tested
      fx: new SpriteBatch(gl, 4096),       // alpha particles (smoke, dust, rain, leaves)
      light: new SpriteBatch(gl, 512),     // point lights (use addRaw)
      emissive: new SpriteBatch(gl, 4096, Z), // additive, unaffected by darkness (fire, sparks); depth-tested
      roof: new SpriteBatch(gl, 256),      // roof slices (roofSlice), drawn in segments inside the main sort
      faces: new FaceBatch(gl, 512, Z),    // computed faces (walls as boxes…), segments in the main sort; depth-tested
      shadowFaces: new FaceBatch(gl, 256), // sun-shadow casters as ground faces (camera turned: roofs, game/roofs.js)
    };

    this.batches.emissive.noWrite = true; this.batches.emissive.zb = 0.1; // (glows only test the depth: whatever stands in front hides them)
    this.renderScale = 1;
    this.maxDpr = 2;
    this.w = this.h = 0;
    this.stats = { sprites: 0 };
    this.resize();
  }

  // Shader quality 0 (low) / 1 (medium) / 2 (high): programs are compiled once per level and cached.
  // A driver that rejects a level falls back to the next lower one (level 0 failing throws).
  setQuality(level) {
    level = Math.max(0, Math.min(2, level | 0));
    if (level === this.level) return this.level;
    const gl = this.gl;
    for (let l = level; l >= 0; l--) {
      let v = this._variants[l];
      if (!v) {
        try {
          v = this._variants[l] = {
            sprite: createProgram(gl, ql(S.SPRITE_VS, l), ql(S.SPRITE_FS, l)),
            light: createProgram(gl, ql(S.SPRITE_VS, l), ql(S.LIGHT_FS, l)),
            terrain: createProgram(gl, ql(S.FULL_VS, l), ql(S.TERRAIN_FS, l)),
            post: createProgram(gl, ql(S.FULL_VS, l), ql(S.POST_FS, l)),
          };
        } catch (e) {
          if (l === 0) throw e;
          console.warn(`[gl] quality level ${l} shaders failed, trying ${l - 1}:`, e.message);
          continue;
        }
      }
      this.level = l;
      this.progSprite = v.sprite; this.progLight = v.light; this.progTerrain = v.terrain; this.progPost = v.post;
      return l;
    }
    return this.level;
  }

  // ---------- resources ----------
  setAtlas(atlas) {
    const gl = this.gl;
    this.atlas = atlas;
    this.atlasTex = createTexture(gl, { source: atlas.canvas, mipmap: true, premultiply: true });
  }

  // agent H: lazily painted look parts (art/look/lazy.js) in a second texture, sampled for sprites with u < 0.
  // New parts are uploaded once per frame (sub-rects; the whole texture after a repack or a resize).
  _syncLook() {
    const LA = this.atlas && this.atlas.look;
    if (!LA) return;
    LA.tick(4);
    if (!LA.full && !LA.uploads.length) return;
    const gl = this.gl;
    if (!this.lookTex || this.lookW !== LA.W || this.lookH !== LA.H) {
      if (this.lookTex) gl.deleteTexture(this.lookTex);
      this.lookTex = createTexture(gl, { width: LA.W, height: LA.H, mipmap: true, premultiply: true });
      this.lookW = LA.W; this.lookH = LA.H; LA.full = true;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lookTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (LA.full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, LA.canvas);
    else for (const r of LA.uploads) if (r.placed) gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, gl.RGBA, gl.UNSIGNED_BYTE, r.canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    LA.full = false; LA.uploads.length = 0;
  }
  _bindLook(p) {
    if (!this.lookTex || !p.u.uLook) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.lookTex); gl.uniform1i(p.u.uLook, 3);
  }

  setGroundTextures(size, layers) {
    this.groundTex = createTextureArray(this.gl, size, layers);
  }

  setNoise(size, data) {
    const gl = this.gl;
    this.noiseTex = createTexture(gl, { width: size, height: size, data, wrap: gl.REPEAT, mipmap: true });
  }

  // world: src/world/world.js. No world-sized textures: the terrain window (src/world/terrainWindow.js) keeps WIN × WIN
  // ring textures around the camera (tile, field, field2, cave, clim, roof data + what other modules add: paths).
  setWorld(world) {
    const gl = this.gl;
    if (this.win) this.win.dispose();
    this.world = world;
    const win = this.win = new TerrainWindow(gl, world);
    world.onLoad.push((c) => { if (this.win === win) win.chunkChanged(c); }); // (margins of the neighbours)
    this.roofData = null; // (game/roofs.js: its RGBA layer, sent through updateRoofData)
    win.add('roof', { scale: 1, comps: 4, fill: (x0, y0, tw, th, out) => { if (this.roofData) fillLayer4(this.roofData, x0, y0, tw, th, out); } });
    this.tileTex = win.tex.tile; this.fieldTex = win.tex.field; this.field2Tex = win.tex.field2;
    this.caveTex = win.tex.cave; this.climTex = win.tex.clim; this.roofDataTex = win.tex.roof;
    this.pathTex = this.pathCovTex = null;
    this.mine = { u: new Float32Array(32), n: 0 }; // rock being mined (src/fx/rockfx.js): tx, ty, crack / 1 + break, pulse
  }
  // keep the window around the camera (called by render; also by game code that needs the textures early)
  // need(c): the chunks in view load synchronously; the others are asked of the streamer (world.streamer) or, without
  // one (a bounded world), loaded at once too (cheap: slices / bedrock)
  syncWindow(cx, cy, ppt, budgetMs = 4) {
    const w = this.world, win = this.win;
    if (!w || !win) return 0;
    const half = Math.hypot(this.w, this.h) / Math.max(1, ppt) / 2; // (any camera yaw)
    const viewR = half / 64 + 0.75;
    const S = w.streamer;
    if (!S) return win.update(cx, cy, viewR, budgetMs, (c) => w.ensure(c), (c) => w.ensure(c));
    // a streamed planet: only the chunk under the camera is made here and now; the others in view come from the
    // workers first (a teleport shows them a few frames later instead of a long hitch)
    const own = w.chunkIndex(cx, cy);
    return win.update(cx, cy, viewR, budgetMs, (c) => { if (c === own) w.ensure(c); else S.want(c, 0); }, (c, d) => S.want(c, d));
  }

  // ---------- roofs ----------
  // roofData (RGBA per tile, game/roofs.js layer): rect re-upload
  updateRoofData(layer, x0, y0, x1, y1) {
    if (!this.win) return;
    this.roofData = layer;
    this.win.invalidate(x0, y0, x1, y1, ['roof']);
  }
  // cave darkness rect only (smooth light changes after a cave-in)
  updateCaveRegion(x0, y0, x1, y1) { this.win?.invalidate(x0, y0, x1, y1, ['cave']); }
  // textures of a painted roof region (art from src/art/roofRaster.js)
  setRoofTex(old, art) {
    const gl = this.gl;
    if (old) this.deleteRoofTex(old);
    const color = createTexture(gl, { width: art.w, height: art.h, data: art.color, mipmap: true });
    const own = new Uint8Array(art.owner.buffer, art.owner.byteOffset, art.owner.length * 2); // little endian: lo, hi
    const owner = createTexture(gl, { width: art.w, height: art.h, data: own, internal: gl.RG8, format: gl.RG, filter: gl.NEAREST });
    return { color, owner, w: art.w, h: art.h };
  }
  // camera rotation (game/roofs.js, art/roofFacets.js): a roof's turned atlas (plan image + strips) for the computed
  // faces — setFaceTex(handle): the scene pass adds rain / snow on it (snow above v = planV: the plan image), the light
  // pass redraws it as an occluder (lamps inside never light the roof)
  roofFaceTex(art) {
    const gl = this.gl, color = createTexture(gl, { width: art.w, height: art.h, data: art.color, mipmap: true });
    // (slopes seen at a glancing angle: anisotropic filtering keeps the courses crisp where the device has it)
    if (this._aniso === undefined) this._aniso = gl.getExtension('EXT_texture_filter_anisotropic') || null;
    if (this._aniso) gl.texParameterf(gl.TEXTURE_2D, this._aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(this._aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
    return { color, roof: true, planV: art.geom?.planV ?? 0, w: art.w, h: art.h };
  }
  deleteRoofTex(h) {
    if (!h) return;
    this.gl.deleteTexture(h.color); this.gl.deleteTexture(h.owner);
    h.color = h.owner = null;
  }
  // a roof slice, called in depth order from the main sort (o.draw of a roof drawable)
  roofSlice(region, s) {
    const tex = region.gl;
    if (!tex || !tex.color) return;
    const B = this.batches, at = B.main.n, segs = this.roofSeg;
    const a = region.alpha ?? 1;
    if (a <= 0.004) return;
    const last = segs.length ? segs[segs.length - 1] : null;
    if (last && last.at === at && last.tex === tex) last.n++;
    else {
      const sg = this._segPool[segs.length] || (this._segPool[segs.length] = { at: 0, start: 0, n: 0, tex: null });
      sg.at = at; sg.start = B.roof.n; sg.n = 1; sg.tex = tex;
      segs.push(sg);
    }
    const dy = region.dropY || 0; // a collapsing roof drops
    B.roof.addQuad(s.x0, s.y0 + dy, s.x1 - s.x0, s.y1 - s.y0, s.u0, s.v0, s.u1, s.v1, a, s.id + 1, 0, 0);
  }
  _roofPass(mode, uni, amb) {
    const gl = this.gl, p = this.progRoof, B = this.batches;
    gl.useProgram(p.p);
    uni(p);
    gl.uniform1f(p.u.uMode, mode);
    if (p.u.uAmbR) gl.uniform3f(p.u.uAmbR, amb[0] * 0.5, amb[1] * 0.5, amb[2] * 0.5);
    gl.uniform1i(p.u.uTex, 0);
    gl.uniform1i(p.u.uOwner, 1);
    B.roof.upload();
  }
  // the glow sprites added since the last mark belong to the sprites drawn so far (call before each depth-sorted
  // object, and once after them)
  emMark() {
    const B = this.batches, e = B.emissive.n, f = B.faces.n;
    if (e > this._emLast) this.emSeg.push(this._emLast, e, B.main.n);
    this._emLast = e;
    if (f > this._fLast) { this.faceSeg.push(this._fLast, f, B.main.n); this.faceTex.push(this._fTex); }
    this._fLast = f;
    this._fTex = null;
  }
  // the sorted drawables end here: what is added after (systems' overlays, particles) is drawn without the depth test
  depthEnd() {
    const B = this.batches;
    B.main.zEnd = B.main.n; B.faces.zEnd = B.faces.n; B.emissive.zEnd = B.emissive.n;
  }
  // the faces added from now on use texture tex (null = the atlas); the ones before keep theirs
  setFaceTex(tex) {
    const B = this.batches, f = B.faces.n;
    if (f > this._fLast) { this.faceSeg.push(this._fLast, f, B.main.n); this.faceTex.push(this._fTex); }
    this._fLast = f;
    this._fTex = tex;
  }

  _roofSegment(sg) {
    const gl = this.gl, p = this.progRoof;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sg.tex.owner);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sg.tex.color);
    gl.uniform2f(p.u.uTexSz, sg.tex.w, sg.tex.h);
    this.batches.roof.drawRange(sg.start, sg.start + sg.n);
  }

  // Climate texture (window channel 'clim', RGBA 1x, linear): R = snow affinity (cold biomes, blurred over ~3 tiles),
  // G = structure occupancy (walls 1, doors 0.5: contact AO), following world.solid through syncSolid().
  // snow affinity 0..1 at a world point (CPU side of the climate texture: splashes, audio, grading)
  coldAt(x, y) { return this.win ? this.win.coldAt(x, y) : 0; }

  // Re-upload the AO channel where world.solid changed inside a tile rect (the ambient system calls it a few
  // times per second for the visible area). Returns true when something changed.
  syncSolid(x0, y0, x1, y1) {
    if (!this.win || !this.world?.solid) return false;
    const r = this.win.syncSolid(x0, y0, x1, y1);
    this.solidNear = r.any;   // walls in view: contact AO is worth its texture fetch
    return r.changed;
  }

  // Re-upload a rectangular tile region after the world changed (mining, building...).
  updateWorldRegion(x0, y0, x1, y1) { this.win?.invalidate(x0, y0, x1, y1); }


  // ---------- size ----------
  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr) * this.renderScale;
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (w === this.w && h === this.h) return false;
    this.w = w; this.h = h; this.dpr = dpr;
    this.cssW = cw; this.cssH = ch;
    this.canvas.width = w; this.canvas.height = h;
    deleteTarget(gl, this.scene); deleteTarget(gl, this.shadow); deleteTarget(gl, this.light);
    if (this.sceneE) gl.deleteTexture(this.sceneE);
    if (this.sceneZ) gl.deleteRenderbuffer(this.sceneZ);
    this.scene = createTarget(gl, w, h);
    // the glow layer: a second colour attachment of the scene; the depth of the world (render: the sorted pass)
    this.sceneE = createTexture(gl, { width: w, height: h, filter: gl.LINEAR });
    this.sceneZ = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneZ);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.sceneE, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneZ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadow = createTarget(gl, Math.ceil(w / 2), Math.ceil(h / 2));
    this.light = createTarget(gl, Math.ceil(w / 2), Math.ceil(h / 2));
    return true;
  }

  // Extra uniforms supplied by the environment: env.extra = { uName: number | [2..4 numbers] }.
  // Unknown / optimized-out names are skipped.
  _setExtra(p, X) {
    if (!X) return;
    const gl = this.gl;
    for (const k in X) {
      const loc = p.u[k];
      if (!loc) continue;
      const v = X[k];
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
  }

  clearBatches() {
    for (const b of Object.values(this.batches)) b.clear();
    this.roofSeg.length = 0;
    this.emSeg.length = 0;
    this._emLast = 0;
    this.faceSeg.length = 0;
    this.faceTex.length = 0;
    this._roofFaces.length = 0;
    this._fLast = 0;
    this._fTex = null;
    this.shaftN = 0;
  }

  // LIGHT SHAFT primitive (agent J: windows, doorways, cave openings…), call every frame from render():
  //   (x, y)   the opening on the ground plane (world tiles); h its height above the ground — in the 3/4 view the
  //            beam starts h tiles up the screen from (x, y)
  //   (ex, ey) where the light lands on the floor (for sunlight: use sunShaft(env) below)
  //   w0, w1   beam width at the opening / at the landing; i intensity (0..~1.5)
  //   r, g, b  light colour; haze 0..1 (0 = only the lit patch on the floor, 1 = a visible beam in the air)
  // Draws a hazy beam from the opening to the landing point plus a lit, softly edged patch on the floor; on high
  // quality dust motes sparkle inside it. Up to 8 per frame (extra ones are dropped); cleared by clearBatches().
  addShaft(x, y, ex, ey, h = 1, w0 = 0.6, w1 = 1, i = 1, r = 1, g = 0.86, b = 0.62, haze = 0.6) {
    const n = this.shaftN || 0;
    if (n >= 8) return false;
    const A = this._shA || (this._shA = new Float32Array(32)), Bq = this._shB || (this._shB = new Float32Array(32)), C = this._shC || (this._shC = new Float32Array(32));
    const o = n * 4;
    A[o] = x; A[o + 1] = y; A[o + 2] = ex; A[o + 3] = ey;
    Bq[o] = h; Bq[o + 1] = w0; Bq[o + 2] = w1; Bq[o + 3] = i;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = haze;
    this.shaftN = n + 1;
    return true;
  }

  // Vegetation pushers for this frame (src/fx/brush.js): Float32Array of (x, y, radius, strength) × n, n ≤ 12.
  setPushers(arr, n) { this._push = arr; this._pushN = Math.min(12, n | 0); }

  // ---------- frame ----------
  // cam: { x, y, ppt (device px per tile) }
  // env: see game/environment.js computeEnvironment()
  render(cam, env, time) {
    const gl = this.gl;
    const B = this.batches;
    if (this.level < 0) this.setQuality(Renderer.defaultLevel ?? 2);
    this.syncWindow(cam.x, cam.y, cam.ppt); // terrain window around the camera (uploads before any pass reads it)
    const viewW = this.w / cam.ppt, viewH = this.h / cam.ppt;
    const sx = 2 / viewW, sy = 2 / viewH;

    const rc = Math.cos(cam.rot || 0), rs = Math.sin(cam.rot || 0); // camera yaw (game.cam.rot)
    const spriteUniforms = (prog) => {
      gl.uniform2f(prog.u.uCam, cam.x, cam.y);
      gl.uniform2f(prog.u.uScale, sx, sy);
      if (prog.u.uRot) gl.uniform2f(prog.u.uRot, rc, rs);
      gl.uniform1f(prog.u.uTime, time);
      gl.uniform1f(prog.u.uWind, env.wind);
      // [world] wind direction + CPU-accumulated sway / wave phases (travelling wind waves)
      if (prog.u.uWindDir) gl.uniform2fv(prog.u.uWindDir, env.windDir);
      if (prog.u.uWindPh) gl.uniform2f(prog.u.uWindPh, env.windPh ? env.windPh[0] : time * 1.4, env.windPh ? env.windPh[1] : time * 1.2);
      // walkers parting the vegetation (src/fx/brush.js)
      if (prog.u.uPushN) {
        const n = this._pushN || 0;
        gl.uniform1i(prog.u.uPushN, n);
        if (n && prog.u.uPush) gl.uniform4fv(prog.u.uPush, this._push, 0, 48);
      }
      depthUni(prog);
    };
    // depth (DEPTH_FN) and the cutout around the local player (CUT_FN; cam.cut from game.js, view units)
    const cut = cam.cut;
    const depthUni = (prog) => {
      if (prog.u.uZ) gl.uniform1f(prog.u.uZ, DEPTH_K);
      if (prog.u.uACut) gl.uniform1f(prog.u.uACut, 0.003);
      if (prog.u.uCutA) {
        gl.uniform4f(prog.u.uCutA, cut ? cut.x : 0, cut ? cut.y : 0, cut ? cut.r : 1, cut ? cut.k : 0);
        gl.uniform4f(prog.u.uCutB, cut ? cut.yP : 0, cut ? cut.hP : 0, 0, 0);
      }
    };

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this._syncLook(); // agent H: paint + upload look parts requested while composing this frame

    // 1. shadows
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
    gl.viewport(0, 0, this.shadow.w, this.shadow.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (B.shadow.n) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      const p = this.progShadow;
      gl.useProgram(p.p);
      spriteUniforms(p);
      gl.uniform2f(p.u.uShadowDir, env.shadowDir[0], env.shadowDir[1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(p.u.uTex, 0);
      this._bindLook(p);
      // dappled sun flecks in the crown shadows (static on low quality, drifting with the wind above)
      if (p.u.uDap) {
        const sl = Math.hypot(env.shadowDir[0], env.shadowDir[1]) || 1;
        gl.uniform4f(p.u.uDap, Math.min(1, (env.sunI ?? 1) * 1.25), this.level >= 1 ? 1 : 0, 1 + sl * 0.55, 0);
        if (p.u.uSunN) gl.uniform2f(p.u.uSunN, env.shadowDir[0] / sl, env.shadowDir[1] / sl);
        if (p.u.uNoise) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex); gl.uniform1i(p.u.uNoise, 4); }
      }
      B.shadow.draw();
      gl.blendEquation(gl.FUNC_ADD);
    }
    if (B.shadowFaces.n) {
      // camera turned: roofs cast their shadows as faces on the ground (game/roofs.js turnedShadows), MAX blend
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      const pf = this.progFace;
      gl.useProgram(pf.p);
      gl.uniform2f(pf.u.uCam, cam.x, cam.y); gl.uniform2f(pf.u.uScale, sx, sy); gl.uniform2f(pf.u.uRot, rc, rs);
      gl.uniform1i(pf.u.uTex, 0); if (pf.u.uRoofFx) gl.uniform4f(pf.u.uRoofFx, 0, 0, 0, 0);
      if (pf.u.uCutA) gl.uniform4f(pf.u.uCutA, 0, 0, 1, 0); // (no cutout in the shadows)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      B.shadowFaces.upload();
      B.shadowFaces.drawRange(0, B.shadowFaces.n);
      gl.blendEquation(gl.FUNC_ADD);
    }
    if (this.level >= 1 && ((env.extra && env.extra.uRays) || 0) > 0.01) {
      // mip chain of the sun-shadow map: the god-ray march samples a softer level (no ghost copies)
      gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
      if (!this.shadow.mip) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); this.shadow.mip = true; }
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    // 2. scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.drawBuffers(DB2); gl.clearBufferfv(gl.COLOR, 1, ZERO4); gl.drawBuffers(DB1); // (glow layer: empty)
    gl.disable(gl.BLEND);
    {
      const p = this.progTerrain, u = p.u, W = this.world;
      gl.useProgram(p.p);
      gl.uniform2f(u.uCam, cam.x, cam.y);
      gl.uniform2f(u.uView, viewW, viewH);
      if (u.uRot) gl.uniform2f(u.uRot, rc, rs);
      gl.uniform2f(u.uWorld, WIN, WIN); // (ring textures: wp / WIN, REPEAT)
      gl.uniform1f(u.uTime, time);
      gl.uniform2f(u.uShadowDir, env.shadowDir[0], env.shadowDir[1]);
      gl.uniform1f(u.uShadowStr, env.shadowStr);
      gl.uniform3fv(u.uSun, env.sun3);
      gl.uniform1f(u.uSunI, env.sunI);
      gl.uniform3fv(u.uSky, env.sky);
      gl.uniform1f(u.uWet, env.wet);
      const bind = (unit, target, tex, name) => {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); gl.uniform1i(u[name], unit);
      };
      bind(0, gl.TEXTURE_2D, this.tileTex, 'uTile');
      bind(1, gl.TEXTURE_2D, this.fieldTex, 'uField');
      bind(2, gl.TEXTURE_2D, this.field2Tex, 'uField2');
      bind(3, gl.TEXTURE_2D, this.noiseTex, 'uNoise');
      bind(4, gl.TEXTURE_2D, this.shadow.tex, 'uShadow');
      bind(5, gl.TEXTURE_2D_ARRAY, this.groundTex, 'uGround');
      bind(6, gl.TEXTURE_2D, this.caveTex, 'uCave'); // [world]
      if (u.uClim) bind(7, gl.TEXTURE_2D, this.climTex, 'uClim');
      if (u.uRoofT) bind(8, gl.TEXTURE_2D, this.roofDataTex, 'uRoofT');
      if (u.uMineN) { const m = this.mine; gl.uniform1i(u.uMineN, m ? m.n : 0); if (m && m.n && u.uMine) gl.uniform4fv(u.uMine, m.u, 0, 32); }
      // [paths] painted path grid + materials (src/game/paths.js sets pathTex / pathCovTex / pathMatTex / pathOn). The fallbacks keep
      // both samplers bound to a texture of their own type (a 2D and a 2D-array sampler never share a unit).
      if (u.uPathMat) {
        bind(13, gl.TEXTURE_2D, this.pathCovTex || this.tileTex, 'uPathF');
        bind(14, gl.TEXTURE_2D, this.pathTex || this.tileTex, 'uPath');
        bind(15, gl.TEXTURE_2D_ARRAY, this.pathMatTex || this.groundTex, 'uPathMat');
        gl.uniform1f(u.uPathOn, this.pathOn && this.pathTex && this.pathMatTex ? 1 : 0);
      }
      // climate fetch only when it can show something (snow lying, or walls in view for the contact AO)
      if (u.uClimOn) gl.uniform1f(u.uClimOn, this.solidNear || ((env.extra && env.extra.uSnow) || 0) > 0.01 ? 1 : 0);
      this._setExtra(p, env.extra);
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (B.decal.n) {
      // [world] terrain decals: ore deposits on the rock tops, rubble on stone floors (premultiplied over)
      const p = this.progDecal, u = p.u, W = this.world;
      gl.useProgram(p.p);
      spriteUniforms(p);
      gl.uniform2f(u.uWorld, WIN, WIN); // (ring textures: wp / WIN, REPEAT)
      gl.uniform2f(u.uViewport, this.w, this.h);
      gl.uniform3fv(u.uSun, env.sun3);
      gl.uniform1f(u.uSunI, env.sunI);
      gl.uniform2f(u.uShadowDir, env.shadowDir[0], env.shadowDir[1]);
      gl.uniform1f(u.uShadowStr, env.shadowStr);
      gl.uniform1f(u.uWet, env.wet);
      const bindD = (unit, tex, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u[name], unit); };
      bindD(0, this.tileTex, 'uTile');
      bindD(1, this.noiseTex, 'uNoise');
      bindD(2, this.fieldTex, 'uField');
      bindD(3, this.caveTex, 'uCave');
      bindD(4, this.shadow.tex, 'uShadow');
      if (u.uRoofT) bindD(5, this.roofDataTex, 'uRoofT'); // cave ceilings hide the rubble under them
      B.decal.draw();
    }
    {
      const p = this.progSprite;
      gl.useProgram(p.p);
      spriteUniforms(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(p.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
      gl.uniform1i(p.u.uShadow, 1);
      this._bindLook(p);
      gl.uniform2f(p.u.uViewport, this.w, this.h);
      gl.uniform1f(p.u.uShadowStr, env.shadowStr);
      if (p.u.uClim) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.climTex); gl.uniform1i(p.u.uClim, 2); }
      if (p.u.uWorldSz) gl.uniform2f(p.u.uWorldSz, WIN, WIN);
      if (p.u.uSnow) gl.uniform1f(p.u.uSnow, (env.extra && env.extra.uSnow) || 0);
      // seasons (src/fx/seasonfx.js): sprites with a season class follow them (src/art/season.js)
      const SA = (env.extra && env.extra.uSeaA) || SEA0, SB = (env.extra && env.extra.uSeaB) || SEA0;
      if (p.u.uSeaA) gl.uniform4f(p.u.uSeaA, SA[0], SA[1], SA[2], SA[3]);
      if (p.u.uSeaB) gl.uniform4f(p.u.uSeaB, SB[0], SB[1], SB[2], SB[3]);
      const ao = p.u.uAO;
      if (ao) gl.uniform1f(ao, this.solidNear ? 1 : 0);   // contact AO next to walls on floors and ground plants
      if (p.u.uFlat) gl.uniform1f(p.u.uFlat, 1); // floors, rugs: flat on the ground (they turn whole with the camera)
      B.ground.draw();
      if (p.u.uFlat) gl.uniform1f(p.u.uFlat, 0);
      B.blob.draw();
      B.decor.draw();
      if (ao) gl.uniform1f(ao, 0);
      // main sprites up to each roof slice / glow group, the slice / the glows, … (all depth-sorted together; at the
      // same spot the glows go first, so a roof over them hides them). Both layers are written: a sprite or a roof
      // hides the glow behind it. The depth buffer of the world on top: the sorted drawables test it and write it
      // (opaque pixels), the glows only test it; overlays added after them (depthEnd) are drawn without it.
      this.emMark(); // (glows added after the sorted objects: on top of everything)
      gl.drawBuffers(DB2);
      gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      this.depth.gt = true; this.depth.gm = true; // (spriteBatch.js zSplit: the cached GL state)
      B.main.zOn = B.faces.zOn = B.emissive.zOn = true;
      if (p.u.uACut) gl.uniform1f(p.u.uACut, ALPHA_CUT);
      B.main.upload();
      if (B.emissive.n) B.emissive.upload();
      if (B.faces.n) B.faces.upload();
      let k = 0, i = 0, j = 0, q = 0;
      const segs = this.roofSeg, em = this.emSeg, nE = em.length / 3, fs = this.faceSeg, nF = fs.length / 3;
      const pf = this.progFace;
      let faceUni = false, roofFx = false;
      const roofUni = (rp) => { spriteUniforms(rp); gl.uniform1f(rp.u.uWet, env.wet || 0); if (rp.u.uRoofSnow) gl.uniform1f(rp.u.uRoofSnow, SA[0]); };
      const snow = (env.extra && env.extra.uSnow) || 0;
      for (;;) {
        const ra = i < segs.length ? segs[i].at : Infinity, ea = j < nE ? em[j * 3 + 2] : Infinity, fa = q < nF ? fs[q * 3 + 2] : Infinity;
        const at = Math.min(ra, ea, fa);
        if (at === Infinity) break;
        if (at > k) { B.main.drawRange(k, Math.min(at, B.main.n)); k = at; }
        if (fa <= ea && fa <= ra) {
          // computed faces of the objects drawn so far (walls as boxes while the camera is turned)
          gl.useProgram(pf.p);
          if (!faceUni) {
            faceUni = true;
            gl.uniform2f(pf.u.uCam, cam.x, cam.y); gl.uniform2f(pf.u.uScale, sx, sy); gl.uniform2f(pf.u.uRot, rc, rs);
            gl.uniform1i(pf.u.uTex, 0); if (pf.u.uLook) gl.uniform1i(pf.u.uLook, 3);
            if (pf.u.uRoofFx) gl.uniform4f(pf.u.uRoofFx, 0, 0, 0, 0);
            depthUni(pf); if (pf.u.uACut) gl.uniform1f(pf.u.uACut, ALPHA_CUT);
            roofFx = false;
          }
          const f0 = fs[q * 3], tex = this.faceTex[q];
          let f1 = fs[q * 3 + 1];
          q++;
          while (q < nF && fs[q * 3 + 2] === at && this.faceTex[q] === tex && fs[q * 3] === f1) { f1 = fs[q * 3 + 1]; q++; }
          // (a roof handle: its atlas, rain / snow on it, remembered for the light occluder)
          const isRoof = !!(tex && tex.roof);
          if (pf.u.uRoofFx && (isRoof || roofFx)) gl.uniform4f(pf.u.uRoofFx, isRoof ? env.wet || 0 : 0, isRoof ? SA[0] : 0, isRoof ? tex.planV : 0, 0);
          roofFx = isRoof;
          if (isRoof) this._roofFaces.push(f0, f1, tex);
          if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, isRoof ? tex.color : tex); }
          B.faces.drawRange(f0, f1);
          if (tex) gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
          gl.useProgram(p.p);
          continue;
        }
        if (ea <= ra) {
          // the glows of the objects drawn so far: unlit, no sun shadow, no snow (as the old last pass)
          gl.uniform1f(p.u.uEmis, 1); gl.uniform1f(p.u.uShadowStr, 0); if (p.u.uSnow) gl.uniform1f(p.u.uSnow, 0);
          const e0 = em[j * 3];
          let e1 = em[j * 3 + 1];
          j++;
          while (j < nE && em[j * 3 + 2] === at) { e1 = em[j * 3 + 1]; j++; } // (contiguous: one draw)
          B.emissive.drawRange(e0, e1);
          gl.uniform1f(p.u.uEmis, 0); gl.uniform1f(p.u.uShadowStr, env.shadowStr); if (p.u.uSnow) gl.uniform1f(p.u.uSnow, snow);
          continue;
        }
        this._roofPass(0, roofUni, env.ambient);
        // consecutive segments at the same position share the program (the old 0° roof slices: no depth)
        gl.disable(gl.DEPTH_TEST); this.depth.gt = false;
        while (i < segs.length && segs[i].at === at) { this._roofSegment(segs[i]); i++; }
        gl.useProgram(p.p);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
        if (p.u.uClim) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.climTex); gl.activeTexture(gl.TEXTURE0); }
      }
      if (k < B.main.n) B.main.drawRange(k, B.main.n);
      B.main.zOn = B.faces.zOn = B.emissive.zOn = false;
      gl.disable(gl.DEPTH_TEST); gl.depthMask(true); this.depth.gt = this.depth.gm = undefined;
      if (p.u.uACut) gl.uniform1f(p.u.uACut, 0.003);
      gl.drawBuffers(DB1);
      B.fx.draw();
    }

    // 3. lights
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.light.fbo);
    gl.viewport(0, 0, this.light.w, this.light.h);
    const amb = env.ambient;
    {
      // [world] ambient = env.ambient, dimmed to uCaveAmb inside mined mountain caves (stored at half intensity)
      const p = this.progAmbient, u = p.u;
      gl.disable(gl.BLEND);
      gl.useProgram(p.p);
      gl.uniform2f(u.uCam, cam.x, cam.y);
      gl.uniform2f(u.uView, viewW, viewH);
      if (u.uRot) gl.uniform2f(u.uRot, rc, rs);
      gl.uniform2f(u.uWorld, WIN, WIN);
      gl.uniform3f(u.uAmb, amb[0], amb[1], amb[2]);
      gl.uniform3f(u.uCaveAmb, 0.12, 0.125, 0.15);
      this._setExtra(p, env.extra);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.caveTex); gl.uniform1i(u.uCave, 0);
      if (u.uRoofT) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.roofDataTex); gl.uniform1i(u.uRoofT, 1); gl.activeTexture(gl.TEXTURE0); }
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
    }
    if (B.light.n) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const p = this.progLight;
      gl.useProgram(p.p);
      spriteUniforms(p);
      B.light.draw();
    }
    if (this.roofSeg.length) {
      // opaque roofs: the outdoor ambient only (lamps inside a closed house never light its roof)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this._roofPass(1, spriteUniforms, env.ambient);
      for (const sg of this.roofSeg) this._roofSegment(sg);
    }
    if (this._roofFaces.length) {
      // the same for the roofs drawn as faces while the camera is turned (uRoofFx.w = 1: ambient × coverage; glows and
      // eave shadows skipped)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const pf = this.progFace, RF = this._roofFaces;
      gl.useProgram(pf.p);
      gl.uniform2f(pf.u.uCam, cam.x, cam.y); gl.uniform2f(pf.u.uScale, sx, sy); gl.uniform2f(pf.u.uRot, rc, rs);
      gl.uniform1i(pf.u.uTex, 0);
      gl.uniform4f(pf.u.uRoofFx, 0, 0, 0, 1);
      if (pf.u.uAmbR) gl.uniform3f(pf.u.uAmbR, amb[0] * 0.5, amb[1] * 0.5, amb[2] * 0.5);
      // the outdoor lamps around the roofs (game.js roofLights): their light reaches the slopes, by the 3D distance
      const RLs = this.roofLights;
      if (pf.u.uRN) { gl.uniform1i(pf.u.uRN, RLs?.n || 0); if (RLs?.n) { gl.uniform4fv(pf.u.uRL, RLs.P); gl.uniform4fv(pf.u.uRC, RLs.C); } }
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < RF.length; i += 3) { gl.bindTexture(gl.TEXTURE_2D, RF[i + 2].color); B.faces.drawRange(RF[i], RF[i + 1]); }
      gl.uniform4f(pf.u.uRoofFx, 0, 0, 0, 0);
    }
    const bloom = this.level >= 1 ? this.fx.bloom * (env.bloomK ?? 1) : 0;
    if (bloom > 0) {
      // mip chain of the light map = a cheap wide blur for the post bloom
      gl.bindTexture(gl.TEXTURE_2D, this.light.tex);
      if (!this.light.mip) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); this.light.mip = true; }
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    // 4. post to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    {
      const p = this.progPost, u = p.u;
      gl.useProgram(p.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(u.uScene, 0);
      if (u.uEmis) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.sceneE); gl.uniform1i(u.uEmis, 8); }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.light.tex); gl.uniform1i(u.uLight, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex); gl.uniform1i(u.uNoise, 2);
      gl.uniform2f(u.uCam, cam.x, cam.y);
      gl.uniform2f(u.uView, viewW, viewH);
      if (u.uRot) gl.uniform2f(u.uRot, rc, rs);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uCloud, env.cloud);
      gl.uniform1f(u.uDay, env.day);
      gl.uniform2fv(u.uCloudVel, env.cloudVel);
      gl.uniform1f(u.uFog, env.fog);
      gl.uniform3fv(u.uFogCol, env.fogCol);
      gl.uniform3fv(u.uTint, env.tint);
      gl.uniform1f(u.uSat, env.sat);
      // the bright cartoon look (owner): stronger by day, milder at night (night still reads as night)
      if (u.uPop) { const dk = env.day ?? 1, P = this.pop; gl.uniform2f(u.uPop, P.vib * (0.6 + 0.4 * dk), 1 + (P.gamma - 1) * (0.5 + 0.5 * dk)); }
      gl.uniform1f(u.uContrast, env.contrast);
      gl.uniform1f(u.uVig, env.vignette);
      gl.uniform1f(u.uFlash, env.flash || 0);
      if (u.uField) {
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.fieldTex); gl.uniform1i(u.uField, 3);
        gl.uniform2f(u.uWorld, WIN, WIN); gl.uniform1f(u.uHasField, 1);
      }
      if (u.uCave) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.caveTex); gl.uniform1i(u.uCave, 4); } // [world]
      if (u.uClim) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.climTex); gl.uniform1i(u.uClim, 5); }
      if (u.uShadow) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex); gl.uniform1i(u.uShadow, 6); }
      if (u.uRoofT) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.roofDataTex); gl.uniform1i(u.uRoofT, 7); }
      if (u.uAmb) gl.uniform3f(u.uAmb, amb[0], amb[1], amb[2]);
      if (u.uShadowDir) gl.uniform2f(u.uShadowDir, env.shadowDir[0], env.shadowDir[1]);
      if (u.uGrain) gl.uniform1f(u.uGrain, this.fx.grain);
      if (u.uBloom) gl.uniform1f(u.uBloom, this.light.mip ? bloom : 0); // bloomK: 0 when no light is in view
      if (u.uShN) {
        const n = this.shaftN || 0;
        gl.uniform1i(u.uShN, n);
        if (n) { gl.uniform4fv(u.uShA, this._shA, 0, 32); gl.uniform4fv(u.uShB, this._shB, 0, 32); gl.uniform4fv(u.uShC, this._shC, 0, 32); }
      }
      this._setExtra(p, env.extra);
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);

    let n = 0;
    for (const b of Object.values(B)) n += b.n;
    this.stats.sprites = n;
  }
}
