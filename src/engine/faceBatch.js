// Computed faces (art/faces, game/roofs.js): textured quads given by 4 corners on the ground plane with a height each
// (world x, y, h). The vertex shader (shaders.FACE_VS) turns them with the camera like the sprites and lifts them
// straight up the screen by their height, so a wall reads as a box at any camera angle. Non-instanced: 6 vertices per
// quad, VS floats each (x, y, h, u, v, r, g, b, a, depth bias); drawn in depth order with the sprites (renderer:
// faceSeg, marked object by object with emMark).
// Depth: exact per vertex (d = view y + h); the bias is the shared depth state's (spriteBatch.js depthState: the
// drawable's bias + a tiny growing one per quad, so coplanar layers of one piece keep their order) + `bias` (a face laid
// on another one on purpose: things hung on a wall, cracks, a rug on a floor). Quads with an alpha below Z.SOLID
// (fading, glows: a < 0) never write depth.
import { depthState, zSplit } from './spriteBatch.js';

const VS = 10;
const QI = [0, 5, 10, 0, 10, 15]; // (quadF: corner offsets of the two triangles a b c, a c d)

export class FaceBatch {
  constructor(gl, cap = 1024, Z = null) {
    this.gl = gl;
    this.cap = cap;
    this.n = 0; // quads
    this.gpuCap = 0;
    this.data = new Float32Array(cap * 6 * VS);
    this.Z = Z || depthState();
    this.bias = 0;       // extra depth bias of the quads added from now on (callers reset it)
    this.nw = [];        // runs of quads that do not write depth (see spriteBatch.js zSplit)
    this.zEnd = Infinity;
    this.zOn = false;
    this.noWrite = false;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const B = VS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, B, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, B, 36);
    gl.bindVertexArray(null);
  }

  clear() { this.n = 0; this.nw.length = 0; this.zEnd = Infinity; this.bias = 0; }

  _grow() {
    const nd = new Float32Array(this.cap * 2 * 6 * VS);
    nd.set(this.data);
    this.data = nd;
    this.cap *= 2;
  }
  // depth bias of the next quad, and its write flag
  _z(a) {
    const Z = this.Z;
    if (a < Z.SOLID) {
      const i = this.n - 1, nw = this.nw, k = nw.length;
      if (k && nw[k - 1] === i) nw[k - 1] = i + 1; else nw.push(i, i + 1);
    }
    return Z.bias + this.bias + Z.ord++ * Z.ORD;
  }

  // corners top-left, top-right, bottom-right, bottom-left as seen on the face (world x, y, height above the ground);
  // uv = [u0, v0, u1, v1] (top-left … bottom-right of the texture); colour premultiplies like the sprites
  quad(ax, ay, ah, bx, by, bh, cx, cy, ch, dx, dy, dh, uv, r, g, b, a) {
    if (this.n >= this.cap) this._grow();
    const d = this.data;
    let o = this.n++ * 6 * VS;
    const z = this._z(a);
    const u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
    const V = (x, y, h, u, v) => { d[o] = x; d[o + 1] = y; d[o + 2] = h; d[o + 3] = u; d[o + 4] = v; d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a; d[o + 9] = z; o += VS; };
    V(ax, ay, ah, u0, v0); V(bx, by, bh, u1, v0); V(cx, cy, ch, u1, v1);
    V(ax, ay, ah, u0, v0); V(cx, cy, ch, u1, v1); V(dx, dy, dh, u0, v1);
  }

  // a quad with its own uv at each corner (roof surfaces: the painted image under each corner)
  quad4(ax, ay, ah, au, av, bx, by, bh, bu, bv, cx, cy, ch, cu, cv, dx, dy, dh, du, dv, r, g, b, a) {
    if (this.n >= this.cap) this._grow();
    const d = this.data;
    let o = this.n++ * 6 * VS;
    const z = this._z(a);
    const V = (x, y, h, u, v) => { d[o] = x; d[o + 1] = y; d[o + 2] = h; d[o + 3] = u; d[o + 4] = v; d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a; d[o + 9] = z; o += VS; };
    V(ax, ay, ah, au, av); V(bx, by, bh, bu, bv); V(cx, cy, ch, cu, cv);
    V(ax, ay, ah, au, av); V(cx, cy, ch, cu, cv); V(dx, dy, dh, du, dv);
  }

  // a quad copied from src at float offset o: 4 corners × (x, y, h, u, v) in quad4 order (cached geometry:
  // art/faces/solid.js); no closure, no allocation
  quadF(src, o, r, g, b, a) {
    if (this.n >= this.cap) this._grow();
    const d = this.data;
    let w = this.n++ * 6 * VS;
    const z = this._z(a);
    for (let k = 0; k < 6; k++) {
      const s = o + QI[k];
      d[w] = src[s]; d[w + 1] = src[s + 1]; d[w + 2] = src[s + 2]; d[w + 3] = src[s + 3]; d[w + 4] = src[s + 4];
      d[w + 5] = r; d[w + 6] = g; d[w + 7] = b; d[w + 8] = a; d[w + 9] = z;
      w += VS;
    }
  }

  upload() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (this.gpuCap < this.cap) { gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW); this.gpuCap = this.cap; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * 6 * VS);
  }

  drawRange(a, b) {
    if (b <= a) return;
    if (this.zOn) { zSplit(this, a, b); return; }
    this._draw(a, b);
  }
  _draw(a, b) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, a * 6, (b - a) * 6);
    gl.bindVertexArray(null);
  }
}
