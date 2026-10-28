// Frame pipeline:
//  1. shadow target (half res): sun-shadow silhouettes, MAX blend
//  2. scene target: terrain shader -> terrain decals (ore, rubble) -> blob shadows -> decor (grass) -> sorted sprites -> alpha FX
//  3. light target (half res): ambient (darkened in mountain caves, AMBIENT_FS) + additive point lights
//  4. screen: post (lighting, clouds, mist, grading, vignette) -> emissive sprites (fire, sparks)
// Game code fills `renderer.batches.*` every frame, then calls render(camera, env).

import { createContext, createProgram, createTexture, createTextureArray, createTarget, deleteTarget } from './gl.js';
import { SpriteBatch } from './spriteBatch.js';
import * as S from './shaders.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = createContext(canvas));
    this.progSprite = createProgram(gl, S.SPRITE_VS, S.SPRITE_FS);
    this.progShadow = createProgram(gl, S.SHADOW_VS, S.SHADOW_FS);
    this.progLight = createProgram(gl, S.SPRITE_VS, S.LIGHT_FS);
    this.progTerrain = createProgram(gl, S.FULL_VS, S.TERRAIN_FS);
    this.progPost = createProgram(gl, S.FULL_VS, S.POST_FS);
    this.progAmbient = createProgram(gl, S.FULL_VS, S.AMBIENT_FS); // [world] ambient light with cave darkness
    this.progDecal = createProgram(gl, S.DECAL_VS, S.DECAL_FS);    // [world] per-tile terrain decals (ore, rubble)
    this.fsVao = gl.createVertexArray();

    this.batches = {
      shadow: new SpriteBatch(gl, 2048),   // sun-shadow casters (silhouettes)
      decal: new SpriteBatch(gl, 1024),    // [world] per-tile terrain decals (addRaw: r = kind 0 ore / 1 rubble)
      ground: new SpriteBatch(gl, 2048),   // flat ground sprites under everything (floors, farm plots, rugs)
      blob: new SpriteBatch(gl, 1024),     // contact shadows (dark ellipses) drawn on ground
      decor: new SpriteBatch(gl, 8192),    // ground plants, drawn before sorted sprites
      main: new SpriteBatch(gl, 8192),     // y-sorted world sprites (caller sorts)
      fx: new SpriteBatch(gl, 4096),       // alpha particles (smoke, dust, rain, leaves)
      light: new SpriteBatch(gl, 512),     // point lights (use addRaw)
      emissive: new SpriteBatch(gl, 4096), // additive, unaffected by darkness (fire, sparks)
    };

    this.renderScale = 1;
    this.maxDpr = 2;
    this.w = this.h = 0;
    this.stats = { sprites: 0 };
    this.resize();
  }

  // ---------- resources ----------
  setAtlas(atlas) {
    const gl = this.gl;
    this.atlas = atlas;
    this.atlasTex = createTexture(gl, { source: atlas.canvas, mipmap: true, premultiply: true });
  }

  setGroundTextures(size, layers) {
    this.groundTex = createTextureArray(this.gl, size, layers);
  }

  setNoise(size, data) {
    const gl = this.gl;
    this.noiseTex = createTexture(gl, { width: size, height: size, data, wrap: gl.REPEAT, mipmap: true });
  }

  // world: { W, H, tileData(RGBA W*H), field(RGBA 4W*4H), field2(RGBA W*H), FR }
  setWorld(world) {
    const gl = this.gl;
    this.world = world;
    this.tileTex = createTexture(gl, { width: world.W, height: world.H, data: world.tileData, filter: gl.NEAREST });
    this.fieldTex = createTexture(gl, { width: world.W * world.FR, height: world.H * world.FR, data: world.field });
    this.field2Tex = createTexture(gl, { width: world.W, height: world.H, data: world.field2 });
    // [world] caves/roofs/trampled ground (RGBA 1x, linear) — see world.js caveData
    this.caveTex = createTexture(gl, { width: world.W, height: world.H, data: world.caveData || new Uint8Array(world.W * world.H * 4) });
  }

  // Re-upload a rectangular tile region after the world changed (mining, building...).
  updateWorldRegion(x0, y0, x1, y1) {
    const gl = this.gl, w = this.world;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w.W - 1, x1); y1 = Math.min(w.H - 1, y1);
    const rw = x1 - x0 + 1;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // tile + field2 (1x)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, w.W);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, rw, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, w.tileData);
    gl.bindTexture(gl.TEXTURE_2D, this.field2Tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, rw, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, w.field2);
    if (w.caveData) { // [world]
      gl.bindTexture(gl.TEXTURE_2D, this.caveTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, rw, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, w.caveData);
    }
    // field (FR x)
    const R = w.FR;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, w.W * R);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0 * R);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0 * R);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0 * R, y0 * R, rw * R, (y1 - y0 + 1) * R, gl.RGBA, gl.UNSIGNED_BYTE, w.field);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

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
    this.scene = createTarget(gl, w, h);
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
  }

  // ---------- frame ----------
  // cam: { x, y, ppt (device px per tile) }
  // env: see game/environment.js computeEnvironment()
  render(cam, env, time) {
    const gl = this.gl;
    const B = this.batches;
    const viewW = this.w / cam.ppt, viewH = this.h / cam.ppt;
    const sx = 2 / viewW, sy = 2 / viewH;

    const spriteUniforms = (prog) => {
      gl.uniform2f(prog.u.uCam, cam.x, cam.y);
      gl.uniform2f(prog.u.uScale, sx, sy);
      gl.uniform1f(prog.u.uTime, time);
      gl.uniform1f(prog.u.uWind, env.wind);
      // [world] wind direction + CPU-accumulated sway / wave phases (travelling wind waves)
      if (prog.u.uWindDir) gl.uniform2fv(prog.u.uWindDir, env.windDir);
      if (prog.u.uWindPh) gl.uniform2f(prog.u.uWindPh, env.windPh ? env.windPh[0] : time * 1.4, env.windPh ? env.windPh[1] : time * 1.2);
    };

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

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
      B.shadow.draw();
      gl.blendEquation(gl.FUNC_ADD);
    }

    // 2. scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    {
      const p = this.progTerrain, u = p.u, W = this.world;
      gl.useProgram(p.p);
      gl.uniform2f(u.uCam, cam.x, cam.y);
      gl.uniform2f(u.uView, viewW, viewH);
      gl.uniform2f(u.uWorld, W.W, W.H);
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
      gl.uniform2f(u.uWorld, W.W, W.H);
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
      gl.uniform2f(p.u.uViewport, this.w, this.h);
      gl.uniform1f(p.u.uShadowStr, env.shadowStr);
      B.ground.draw();
      B.blob.draw();
      B.decor.draw();
      B.main.draw();
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
      gl.uniform2f(u.uWorld, this.world.W, this.world.H);
      gl.uniform3f(u.uAmb, amb[0], amb[1], amb[2]);
      gl.uniform3f(u.uCaveAmb, 0.12, 0.125, 0.15);
      this._setExtra(p, env.extra);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.caveTex); gl.uniform1i(u.uCave, 0);
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

    // 4. post to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    {
      const p = this.progPost, u = p.u;
      gl.useProgram(p.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.light.tex); gl.uniform1i(u.uLight, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.noiseTex); gl.uniform1i(u.uNoise, 2);
      gl.uniform2f(u.uCam, cam.x, cam.y);
      gl.uniform2f(u.uView, viewW, viewH);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uCloud, env.cloud);
      gl.uniform1f(u.uDay, env.day);
      gl.uniform2fv(u.uCloudVel, env.cloudVel);
      gl.uniform1f(u.uFog, env.fog);
      gl.uniform3fv(u.uFogCol, env.fogCol);
      gl.uniform3fv(u.uTint, env.tint);
      gl.uniform1f(u.uSat, env.sat);
      gl.uniform1f(u.uContrast, env.contrast);
      gl.uniform1f(u.uVig, env.vignette);
      gl.uniform1f(u.uFlash, env.flash || 0);
      if (u.uField) {
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.fieldTex); gl.uniform1i(u.uField, 3);
        gl.uniform2f(u.uWorld, this.world.W, this.world.H); gl.uniform1f(u.uHasField, 1);
      }
      if (u.uCave) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.caveTex); gl.uniform1i(u.uCave, 4); } // [world]
      this._setExtra(p, env.extra);
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (B.emissive.n) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const p = this.progSprite;
      gl.useProgram(p.p);
      spriteUniforms(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(p.u.uTex, 0);
      gl.uniform1f(p.u.uShadowStr, 0);
      B.emissive.draw();
    }
    gl.bindVertexArray(null);

    let n = 0;
    for (const b of Object.values(B)) n += b.n;
    this.stats.sprites = n;
  }
}
