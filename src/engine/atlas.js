// Texture atlas: collects canvases, packs them (shelf packer sorted by height), uploads once.
// Sprite record: { name, index, group, w, h (world units), ax, ay (anchor 0..1), u0,v0,u1,v1, pw, ph }
// Group = name without trailing _<number>  (e.g. "tree_oak_2" -> group "tree_oak").

const PAD = 4;

export class Atlas {
  constructor(maxSize = 4096) {
    this.maxSize = maxSize;
    this.pending = [];
    this.sprites = new Map();
    this.groups = {};
    this.list = [];
    this.canvas = null;
  }

  // canvas: HTMLCanvasElement / OffscreenCanvas; ax, ay anchor in [0..1] (0,0 = top-left)
  // ppu: pixels per world unit (tile) used when drawing this canvas
  add(name, canvas, ax = 0.5, ay = 1, ppu = 64) {
    if (this.sprites.has(name)) console.warn('Atlas: duplicate sprite', name);
    const rec = { name, canvas, ax, ay, ppu };
    this.pending.push(rec);
    const s = {
      name, index: -1, group: name.replace(/_\d+$/, ''),
      w: canvas.width / ppu, h: canvas.height / ppu, ax, ay,
      u0: 0, v0: 0, u1: 0, v1: 0, pw: canvas.width, ph: canvas.height,
    };
    this.sprites.set(name, s);
    rec.s = s;
    return s;
  }

  get(name) {
    const s = this.sprites.get(name);
    if (!s) throw new Error('Sprite não encontrado: ' + name);
    return s;
  }

  has(name) { return this.sprites.has(name); }

  // variant i of a group (wraps)
  pick(group, i = 0) {
    const g = this.groups[group];
    if (!g || !g.length) throw new Error('Grupo de sprite vazio: ' + group);
    return g[((i % g.length) + g.length) % g.length];
  }

  pack() {
    // try sizes until everything fits
    const items = this.pending.slice().sort((a, b) => b.canvas.height - a.canvas.height || b.canvas.width - a.canvas.width);
    let size = 1024;
    for (;;) {
      if (this._tryPack(items, size)) break;
      size *= 2;
      if (size > this.maxSize) throw new Error('Atlas cheio (> ' + this.maxSize + ')');
    }
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    for (const it of items) {
      ctx.drawImage(it.canvas, it.x, it.y);
      const s = it.s;
      s.u0 = it.x / size; s.v0 = it.y / size;
      s.u1 = (it.x + it.canvas.width) / size; s.v1 = (it.y + it.canvas.height) / size;
    }
    // stable order = insertion order
    this.list = [];
    this.groups = {};
    for (const it of this.pending) {
      it.s.index = this.list.length;
      this.list.push(it.s);
      (this.groups[it.s.group] ||= []).push(it.s);
    }
    // groups sorted by numeric suffix
    for (const g of Object.values(this.groups)) {
      g.sort((a, b) => (parseInt(a.name.match(/_(\d+)$/)?.[1] ?? 0)) - (parseInt(b.name.match(/_(\d+)$/)?.[1] ?? 0)));
    }
    this.canvas = c;
    this.size = size;
    this.pending.forEach((p) => { p.canvas = null; });
    return c;
  }

  _tryPack(items, size) {
    let x = PAD, y = PAD, rowH = 0;
    for (const it of items) {
      const w = it.canvas.width, h = it.canvas.height;
      if (x + w + PAD > size) { x = PAD; y += rowH + PAD; rowH = 0; }
      if (y + h + PAD > size) return false;
      it.x = x; it.y = y;
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
    return true;
  }
}

// ---------- cache support (see atlasCache.js) ----------
Atlas.prototype.serialize = function () {
  return {
    size: this.size,
    sprites: this.list.map((s) => ({ ...s })),
  };
};

Atlas.fromCache = function (meta, canvas) {
  const A = new Atlas();
  A.canvas = canvas;
  A.size = meta.size;
  A.list = [];
  A.groups = {};
  for (const s of meta.sprites) {
    A.sprites.set(s.name, s);
    A.list.push(s);
    (A.groups[s.group] ||= []).push(s);
  }
  for (const g of Object.values(A.groups)) {
    g.sort((a, b) => (parseInt(a.name.match(/_(\d+)$/)?.[1] ?? 0)) - (parseInt(b.name.match(/_(\d+)$/)?.[1] ?? 0)));
  }
  return A;
};
