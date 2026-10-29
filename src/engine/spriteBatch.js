// Instanced sprite batch. One instance = one textured quad in world space.
// Layout per instance (20 floats):
//  pos(2) size(2) anchor(2) uv(4) color(4) params(4: sway, rot, flash, flip) extra(2: recvShadow, lift)

export const STRIDE = 20;
const ATTR = [[1, 2], [2, 2], [3, 2], [4, 4], [5, 4], [6, 4], [7, 2]];

export class SpriteBatch {
  constructor(gl, capacity = 4096) {
    this.gl = gl;
    this.cap = capacity;
    this.gpuCap = 0;
    this.data = new Float32Array(capacity * STRIDE);
    this.n = 0;

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
    attr(1, 2); attr(2, 2); attr(3, 2); attr(4, 4); attr(5, 4); attr(6, 4); attr(7, 2);
    gl.bindVertexArray(null);
  }

  clear() { this.n = 0; }

  _grow() {
    const nd = new Float32Array(this.cap * 2 * STRIDE);
    nd.set(this.data);
    this.data = nd;
    this.cap *= 2;
  }

  // s = sprite {w,h,ax,ay,u0,v0,u1,v1}
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0) {
    if (this.n >= this.cap) this._grow();
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y;
    d[o + 2] = s.w * sx; d[o + 3] = s.h * sy;
    d[o + 4] = s.ax; d[o + 5] = s.ay;
    d[o + 6] = s.u0; d[o + 7] = s.v0; d[o + 8] = s.u1; d[o + 9] = s.v1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = sway; d[o + 15] = rot; d[o + 16] = flash; d[o + 17] = flip;
    d[o + 18] = recv; d[o + 19] = lift;
  }

  // Raw quad without sprite (used for lights): world size w,h centered.
  addRaw(x, y, w, h, r, g, b, a) {
    if (this.n >= this.cap) this._grow();
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h; d[o + 4] = 0.5; d[o + 5] = 0.5;
    d[o + 6] = 0; d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = 1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = 0; d[o + 15] = 0; d[o + 16] = 0; d[o + 17] = 1; d[o + 18] = 0; d[o + 19] = 0;
  }

  // free quad (roof slices): world rect x, y (top-left), w × h, uv rect, colour, params (anchor 0, 0)
  addQuad(x, y, w, h, u0, v0, u1, v1, r = 1, g = 1, b = 1, a = 1) {
    if (this.n >= this.cap) this._grow();
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h; d[o + 4] = 0; d[o + 5] = 0;
    d[o + 6] = u0; d[o + 7] = v0; d[o + 8] = u1; d[o + 9] = v1;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = 0; d[o + 15] = 0; d[o + 16] = 0; d[o + 17] = 1; d[o + 18] = 0; d[o + 19] = 0;
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

  // instances [a, b) of the uploaded data (no base-instance in WebGL2: the instance pointers move instead)
  drawRange(a, b) {
    if (b <= a) return;
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
