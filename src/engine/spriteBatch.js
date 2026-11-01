// Instanced sprite batch. One instance = one textured quad in world space.
// Layout per instance (26 floats):
//  pos(2) size(2) anchor(2) uv(4) color(4) params(4: sway, rot, flash, flip) extra(4: recvShadow, lift, season class,
//  depth mode) depth(4: reference x, y, height, bias)
// season class (src/art/season.js SC): how the sprite follows the seasons in the sprite shader (0 = never).
//
// DEPTH (docs/CAMERA-ROTATION.md "Profundidade por pixel"; the scene pass of the world tests and writes a depth buffer,
// d = view y + height, larger = nearer the camera). Every sprite is given a depth shape when it is added, from the
// batch's depth state (`batch.Z`, shared by the batches of one renderer, set by game.js per drawable):
//   mode 0 (card): upright, a vertical plane through the reference point (x, y) on the ground at height h — the part of
//          the sprite below that point lies flat at height h (its feet, the ground in front). Without a reference
//          (Z.ref false) a sprite is its own reference: its anchor and its lift.
//   mode 1 (flat): lying at height h (a sleeper on a mattress, a rug on an upper floor).
//   mode 2 (card, see-through): a card that the cutout around the local player may open (tree crowns).
//   bias: toward the camera (tiles of d; Z.sb: sprites only — the flames, glows and billboards of a piece drawn as
//   faces stay in front of its own faces); each sprite of a drawable also gets a tiny growing bias (Z.ord), so its
//   layers drawn on the same plane keep their order.
// Sprites with an alpha below Z.SOLID never write depth (translucent: fading walls, ghosts, crowns faded for the
// player); they only test it.

export const STRIDE = 26;
const ATTR = [[1, 2], [2, 2], [3, 2], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4]];

// the depth state shared by the batches of a renderer (game.js sets the reference of each drawable)
export function depthState() {
  return { ref: false, x: 0, y: 0, h: 0, mode: 0, bias: 0, sb: 0, ord: 0, SOLID: 0.97, ORD: 2e-4, gt: undefined, gm: undefined };
}

export class SpriteBatch {
  constructor(gl, capacity = 4096, Z = null) {
    this.gl = gl;
    this.cap = capacity;
    this.gpuCap = 0;
    this.data = new Float32Array(capacity * STRIDE);
    this.n = 0;
    this.Z = Z || depthState();
    // depth: runs of instances that do not write depth ([start, end) pairs), the first instance drawn without the
    // depth test (overlays added after the sorted drawables), on = this batch takes part in the scene's depth pass
    this.nw = [];
    this.zEnd = Infinity;
    this.zOn = false;
    this.noWrite = false; // every instance translucent (glows)
    this.zb = 0;          // depth bias of every instance (glows: in front of what they glow on)

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    const B = STRIDE * 4;
    let off = 0;
    const attr = (loc, size) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off);
      gl.vertexAttribDivisor(loc, 1);
      off += size * 4;
    };
    for (const [loc, size] of ATTR) attr(loc, size);
    gl.bindVertexArray(null);
  }

  clear() { this.n = 0; this.nw.length = 0; this.zEnd = Infinity; }

  _grow() {
    const nd = new Float32Array(this.cap * 2 * STRIDE);
    nd.set(this.data);
    this.data = nd;
    this.cap *= 2;
  }

  // depth fields of instance i (o = its float offset): reference (x, y) at lift, translucent when a < SOLID
  _depth(o, x, y, lift, a) {
    const d = this.data, Z = this.Z;
    if (Z.ref) { d[o + 22] = Z.x; d[o + 23] = Z.y; d[o + 24] = Z.h; } else { d[o + 22] = x; d[o + 23] = y; d[o + 24] = lift; }
    d[o + 21] = Z.mode;
    d[o + 25] = Z.bias + Z.sb + this.zb + Z.ord++ * Z.ORD;
    if (a < Z.SOLID) {
      const i = o / STRIDE, nw = this.nw, k = nw.length;
      if (k && nw[k - 1] === i) nw[k - 1] = i + 1; else nw.push(i, i + 1);
    }
  }

  // s = sprite {w,h,ax,ay,u0,v0,u1,v1}
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0, sc = 0) {
    if (this.n >= this.cap) this._grow();
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y;
    d[o + 2] = s.w * sx; d[o + 3] = s.h * sy;
    d[o + 4] = s.ax; d[o + 5] = s.ay;
    d[o + 6] = s.u0; d[o + 7] = s.v0; d[o + 8] = s.u1; d[o + 9] = s.v1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = sway; d[o + 15] = rot; d[o + 16] = flash; d[o + 17] = flip;
    d[o + 18] = recv; d[o + 19] = lift; d[o + 20] = sc;
    this._depth(o, x, y, lift, a);
  }

  // Raw quad without sprite (used for lights): world size w,h centered.
  addRaw(x, y, w, h, r, g, b, a) {
    if (this.n >= this.cap) this._grow();
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h; d[o + 4] = 0.5; d[o + 5] = 0.5;
    d[o + 6] = 0; d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = 1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = 0; d[o + 15] = 0; d[o + 16] = 0; d[o + 17] = 1; d[o + 18] = 0; d[o + 19] = 0; d[o + 20] = 0;
    this._depth(o, x, y, 0, a);
  }

  // free quad (roof slices): world rect x, y (top-left), w × h, uv rect, colour, params (anchor 0, 0)
  addQuad(x, y, w, h, u0, v0, u1, v1, r = 1, g = 1, b = 1, a = 1) {
    if (this.n >= this.cap) this._grow();
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h; d[o + 4] = 0; d[o + 5] = 0;
    d[o + 6] = u0; d[o + 7] = v0; d[o + 8] = u1; d[o + 9] = v1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = 0; d[o + 15] = 0; d[o + 16] = 0; d[o + 17] = 1; d[o + 18] = 0; d[o + 19] = 0; d[o + 20] = 0;
    this._depth(o, x, y, 0, 1);
  }

  // rewrite the depth shape of instances [a, b) (a drawable whose pose is known only after it was drawn: a sleeper,
  // a sitter); x = NaN keeps each one's reference point, h = NaN takes each one's own lift (+ hAdd)
  depthOf(a, b, x, y, h, mode, bias, hAdd = 0) {
    const d = this.data;
    for (let i = a; i < b; i++) {
      const o = i * STRIDE;
      if (x === x) { d[o + 22] = x; d[o + 23] = y; }
      d[o + 24] = h === h ? h : d[o + 19] + hAdd; d[o + 21] = mode; d[o + 25] += bias;
    }
  }

  upload() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    if (this.gpuCap < this.cap) {
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      this.gpuCap = this.cap;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * STRIDE);
  }

  // instances [a, b) of the uploaded data (no base-instance in WebGL2: the instance pointers move instead); in the
  // scene's depth pass (zOn) split where the depth writes / the depth test change
  drawRange(a, b) {
    if (b <= a) return;
    if (this.zOn) { zSplit(this, a, b); return; }
    this._draw(a, b);
  }
  _draw(a, b) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (a) this._pointers(a);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b - a);
    if (a) this._pointers(0);
    gl.bindVertexArray(null);
  }
  _pointers(first) {
    const gl = this.gl, BY = STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    let off = first * BY;
    for (const [loc, size] of ATTR) { gl.vertexAttribPointer(loc, size, gl.FLOAT, false, BY, off); off += size * 4; }
  }

  draw() {
    if (!this.n) return;
    this.upload();
    this.drawRange(0, this.n);
  }
}

// [a, b) of a batch in the depth pass: sub-ranges by depth test (before zEnd) and depth write (outside the nw runs);
// the GL state is cached in the shared depth state (Z.gt / Z.gm: the renderer resets them around the pass)
function zTest(gl, Z, on) { if (Z.gt !== on) { if (on) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST); Z.gt = on; } }
function zMask(gl, Z, on) { if (Z.gm !== on) { gl.depthMask(on); Z.gm = on; } }
export function zSplit(T, a, b) {
  const gl = T.gl, nw = T.nw, Z = T.Z, e = Math.min(b, T.zEnd);
  if (a < e) {
    zTest(gl, Z, true);
    if (T.noWrite) { zMask(gl, Z, false); T._draw(a, e); }
    else {
      // the runs are sorted: skip those before a
      let i = 0, k = a;
      while (i < nw.length && nw[i + 1] <= k) i += 2;
      while (k < e) {
        if (i < nw.length && nw[i] <= k) { const j = Math.min(e, nw[i + 1]); zMask(gl, Z, false); T._draw(k, j); k = j; i += 2; }
        else { const j = i < nw.length ? Math.min(e, nw[i]) : e; zMask(gl, Z, true); T._draw(k, j); k = j; }
      }
    }
  }
  if (b > e) { zTest(gl, Z, false); T._draw(Math.max(a, e), b); }
}
