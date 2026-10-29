// Registry of lazily painted sprites outside the look parts (agent K: style variants, soft corners, detail overlays,
// decoration). Pure leaf module: art modules register { canvas: () => paddedCanvas, ax, ay } at import time and the
// shared lazy texture (art/look/lazy.js, agent H's machinery) paints only the ones the frame asks for.
//   LAZY_DEFS:   name → def        LAZY_GROUPS: group → variant count (name_0 … name_{n-1})
// They never enter the baked atlas, so the atlas digest / cache do not depend on them; the default look of every
// piece stays baked (no holes on the first frame).

export const LAZY_DEFS = new Map();
export const LAZY_GROUPS = new Map();
export function lazyDef(name, canvas, ax = 0.5, ay = 1) {
  LAZY_DEFS.set(name, { canvas, ax, ay });
  const m = /^(.*)_(\d+)$/.exec(name);
  if (m) LAZY_GROUPS.set(m[1], Math.max(LAZY_GROUPS.get(m[1]) || 0, +m[2] + 1));
}
// does a kind have lazy art (exact, _0, _h or a group)?
export const lazyKind = (k) => LAZY_DEFS.has(k) || LAZY_DEFS.has(k + '_0') || LAZY_DEFS.has(k + '_h') || LAZY_GROUPS.has(k);
