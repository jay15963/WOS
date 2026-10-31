// Computed faces (camera rotation, game.js / art/archCompose.drawWallFaces): textured quads given by 4 corners on the
// ground plane with a height each (world x, y, h). The vertex shader (shaders.FACE_VS) turns them with the camera like
// the sprites and lifts them straight up the screen by their height, so a wall reads as a box at any camera angle.
// Non-instanced: 6 vertices per quad, VS floats each (x, y, h, u, v, r, g, b, a); drawn in depth order with the
// sprites (renderer: faceSeg, marked object by object with emMark).
const VS = 9;

export class FaceBatch {
  constructor(gl, cap = 1024) {
    this.gl = gl;
    this.cap = cap;
    this.n = 0; // quads
    this.gpuCap = 0;
    this.data = new Float32Array(cap * 6 * VS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const B = VS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, B, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, 20);
    gl.bindVertexArray(null);
  }

  clear() { this.n = 0; }

  _grow() {
    const nd = new Float32Array(this.cap * 2 * 6 * VS);
    nd.set(this.data);
    this.data = nd;
    this.cap *= 2;
  }

  // corners top-left, top-right, bottom-right, bottom-left as seen on the face (world x, y, height above the ground);
  // uv = [u0, v0, u1, v1] (top-left … bottom-right of the texture); colour premultiplies like the sprites
  quad(ax, ay, ah, bx, by, bh, cx, cy, ch, dx, dy, dh, uv, r, g, b, a) {
    if (this.n >= this.cap) this._grow();
    const d = this.data;
    let o = this.n++ * 6 * VS;
    const u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
    const V = (x, y, h, u, v) => { d[o] = x; d[o + 1] = y; d[o + 2] = h; d[o + 3] = u; d[o + 4] = v; d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a; o += VS; };
    V(ax, ay, ah, u0, v0); V(bx, by, bh, u1, v0); V(cx, cy, ch, u1, v1);
    V(ax, ay, ah, u0, v0); V(cx, cy, ch, u1, v1); V(dx, dy, dh, u0, v1);
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
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, a * 6, (b - a) * 6);
    gl.bindVertexArray(null);
  }
}
