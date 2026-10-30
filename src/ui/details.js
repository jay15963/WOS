// "Detalhes" panel (agent K): styles and details of the construction piece being placed — previews drawn with the real
// art (composeWorld.drawStatic on a Canvas2D mock of the render batches), tabs by category, toggles, exclusive choices,
// tone swatches. The choice applies to the next placements (remembered per type) and, through the style brush or the
// blueprint context menu ("Estilo da planta"), to BLUEPRINTS only — finished pieces keep their look (deconstruct and
// build again). Desktop: a side panel next to the world (non-modal, the ghost updates live). Mobile: a bottom sheet.
// Purely local UI: changes go through building.js (setBuildLook / enterStyleBrush) and the struct.style intent.

import { BUILDINGS } from '../game/data.js';
import { kitOf, stylesFor, detailsFor, decodeKit, normStyle, cleanDet, withDetail, hasDet, detList, hasKit, detName, detDesc } from '../game/content/kits.js';
import { setBuildLook, enterStyleBrush, enterBuildMode, exitBuildMode, lastLook } from '../game/building.js';
import { drawStatic } from '../art/composeWorld.js';
import { KIT_ENV, archSprite } from '../art/archCompose.js';
import { roofArtStyle, ROOF_PROPS } from '../game/content/kits.js';
import { ROOF_STYLES } from '../game/content/roofs.js';

const CSS = `
:is(#hud,body) .kdet{position:absolute;z-index:35;pointer-events:auto;display:flex;flex-direction:column;color:#f1ead8;font:600 12px/1.25 system-ui,sans-serif;
  background:linear-gradient(180deg,rgba(40,36,30,.97),rgba(22,20,18,.97));border:1px solid rgba(226,182,92,.42);border-radius:14px;
  box-shadow:0 12px 34px rgba(0,0,0,.5);overflow:hidden;animation:kdin .16s ease-out;user-select:none;-webkit-user-select:none}
@keyframes kdin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
:is(#hud,body) .kdet.side{right:calc(var(--safe-r,0px) + 10px);top:calc(var(--safe-t,0px) + 200px);bottom:calc(var(--safe-b,0px) + 92px);width:356px}
:is(#hud,body) .kdet.sheet{left:calc(var(--safe-l,0px) + 6px);right:calc(var(--safe-r,0px) + 6px);bottom:calc(var(--safe-b,0px) + 6px);height:min(48vh,430px);border-radius:16px 16px 12px 12px}
:is(#hud,body) .kdet .kh{display:flex;align-items:center;gap:9px;padding:9px 10px 7px 12px;border-bottom:1px solid rgba(226,182,92,.18)}
:is(#hud,body) .kdet .kh img{width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 1px 1px #000)}
:is(#hud,body) .kdet .kh .kt{flex:1;min-width:0}.kdet .kh b{display:block;font-size:14px;color:#ffe9b8;letter-spacing:.2px}
:is(#hud,body) .kdet .kh small{display:block;color:#bfae88;font-weight:500;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
:is(#hud,body) .kdet .kx{all:unset;cursor:pointer;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;color:#e8dcc0;background:rgba(255,255,255,.06)}
:is(#hud,body) .kdet .kx:hover{background:rgba(255,255,255,.14)}
:is(#hud,body) .kdet .ktabs{display:flex;gap:4px;padding:7px 8px 6px;overflow-x:auto;scrollbar-width:none;flex:none}
:is(#hud,body) .kdet .ktabs::-webkit-scrollbar{display:none}
:is(#hud,body) .kdet .ktab{all:unset;cursor:pointer;flex:none;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.06);color:#d8cbae;font-size:12px;border:1px solid transparent}
:is(#hud,body) .kdet .ktab.on{background:rgba(226,182,92,.22);color:#fff3d2;border-color:rgba(226,182,92,.55)}
:is(#hud,body) .kdet .ktab i{font-style:normal;margin-left:5px;font-size:10px;color:#ffd27a}
:is(#hud,body) .kdet .kbody{flex:1;overflow-y:auto;padding:4px 8px 8px;overscroll-behavior:contain}
:is(#hud,body) .kdet .kgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
:is(#hud,body) .kdet.sheet .kgrid{grid-template-columns:repeat(auto-fill,minmax(96px,1fr))}
:is(#hud,body) .kdet .kc{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 4px 6px;border-radius:10px;
  background:rgba(255,255,255,.04);border:1px solid rgba(160,150,130,.22);text-align:center;transition:transform .08s,border-color .15s,background .15s;position:relative}
:is(#hud,body) .kdet .kc:hover{border-color:rgba(226,182,92,.5);background:rgba(255,255,255,.07)}
:is(#hud,body) .kdet .kc:active{transform:scale(.96)}
:is(#hud,body) .kdet .kc.on{border-color:#e6b85c;background:rgba(226,182,92,.16);box-shadow:inset 0 0 0 1px rgba(255,214,130,.35)}
:is(#hud,body) .kdet .kc.on::after{content:'✓';position:absolute;top:3px;right:5px;color:#ffd27a;font-size:12px}
:is(#hud,body) .kdet .kc img{width:100%;aspect-ratio:1.25;object-fit:contain;border-radius:7px;background:radial-gradient(ellipse at 50% 60%,#6b5a3e,#3a3224 75%)}
:is(#hud,body) .kdet .kc span{font-size:11px;color:#eee2c6;line-height:1.15;min-height:2.3em;display:flex;align-items:center}
:is(#hud,body) .kdet .kgrp{grid-column:1/-1;font-size:10.5px;color:#bfae88;font-weight:600;margin:6px 2px 0;text-transform:uppercase;letter-spacing:.6px}
:is(#hud,body) .kdet .kdesc{grid-column:1/-1;font-size:11px;color:#cdbf9f;font-weight:500;margin:2px 2px 4px}
:is(#hud,body) .kdet .kf{display:flex;align-items:center;gap:6px;padding:7px 8px;border-top:1px solid rgba(226,182,92,.18);flex:none}
:is(#hud,body) .kdet .kb{all:unset;cursor:pointer;display:flex;align-items:center;gap:6px;padding:8px 11px;border-radius:9px;background:rgba(255,255,255,.07);color:#efe3c6;font-size:12px}
:is(#hud,body) .kdet .kb:hover{background:rgba(255,255,255,.13)}
:is(#hud,body) .kdet .kb.on{background:rgba(226,182,92,.3);color:#fff}
:is(#hud,body) .kdet .kb.go{background:rgba(70,130,74,.85);color:#fff}
:is(#hud,body) .kdet .kf .ksum{flex:1;color:#bfae88;font-size:11px;font-weight:500;line-height:1.2}
.touch :is(#hud,body) .kdet .kc span{font-size:11.5px}
@media (max-height:520px){:is(#hud,body) .kdet.sheet{height:62vh}}
/* landscape phone: full height on the right (the world and the ghost stay visible on the left), compact chrome */
html :is(#hud,body) .kdet.sheet.land{left:auto;right:calc(var(--safe-r,0px) + 6px);top:calc(var(--safe-t,0px) + 6px);bottom:calc(var(--safe-b,0px) + 6px);height:auto;width:min(50vw,500px);border-radius:14px}
html :is(#hud,body) .kdet.sheet.land .kh{padding:5px 8px 4px 10px;gap:7px}
html :is(#hud,body) .kdet.sheet.land .kh img{width:26px;height:26px}
html :is(#hud,body) .kdet.sheet.land .kh b{font-size:13px}
html :is(#hud,body) .kdet.sheet.land .kh small{display:none}
html :is(#hud,body) .kdet.sheet.land .kx{width:28px;height:28px}
html :is(#hud,body) .kdet.sheet.land .ktabs{padding:4px 6px;gap:3px}
html :is(#hud,body) .kdet.sheet.land .ktab{font-size:11px;padding:4px 8px}
html :is(#hud,body) .kdet.sheet.land .kbody{padding:2px 6px 6px}
html :is(#hud,body) .kdet.sheet.land .kgrid{grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:5px}
html :is(#hud,body) .kdet.sheet.land .kc span{font-size:10.5px;min-height:2.1em}
html :is(#hud,body) .kdet.sheet.land .kdesc{font-size:11px;margin:2px 2px 3px}
html :is(#hud,body) .kdet.sheet.land .kf{padding:4px 6px}
html :is(#hud,body) .kdet.sheet.land .kb{padding:6px 9px;font-size:11px}
html :is(#hud,body) .kdet.sheet.land .kf .ksum{font-size:10.5px}
body.kdet-land #levelbar{right:calc(var(--safe-r,0px) + min(50vw,500px) * var(--ui,1) + 18px)!important}
.abb .det{background:rgba(150,110,40,.75);border-color:rgba(240,200,120,.5)}
.abb .det.off{display:none}
.bcard .bsty{display:inline-block;margin-top:3px;padding:2px 8px;border-radius:999px;background:rgba(226,182,92,.18);color:#ffdc96;font-size:10.5px;border:1px solid rgba(226,182,92,.4);cursor:pointer;align-self:flex-start}
.bcard .bsty:hover{background:rgba(226,182,92,.32)}
`;

// ---------------- previews: real art on a 2D canvas ----------------
class MockBatch {
  constructor() { this.l = []; }
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0) { if (s) this.l.push([s, x, y, sx * flip, sy, r, g, b, a, rot, lift]); }
  addRaw() {}
}
const LAYERS = ['ground', 'blob', 'main', 'emissive'];
const tintCache = new Map();
function tinted(A, s, r, g, b) {
  const key = s.name + '|' + ((r * 50) | 0) + ',' + ((g * 50) | 0) + ',' + ((b * 50) | 0);
  let c = tintCache.get(key);
  if (c) return c;
  const lazy = s.u0 < 0 && s.canvas; // a lazily painted record keeps its own canvas
  const src = lazy ? s.canvas : A.canvas, AS = A.size, sx = lazy ? 0 : s.u0 * AS, sy = lazy ? 0 : s.v0 * AS;
  c = document.createElement('canvas'); c.width = s.pw; c.height = s.ph;
  const x = c.getContext('2d');
  x.drawImage(src, sx, sy, s.pw, s.ph, 0, 0, s.pw, s.ph);
  if (r !== 1 || g !== 1 || b !== 1) {
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = `rgb(${Math.min(255, r * 255) | 0},${Math.min(255, g * 255) | 0},${Math.min(255, b * 255) | 0})`;
    x.fillRect(0, 0, s.pw, s.ph);
    if (r > 1 || g > 1 || b > 1) { x.globalCompositeOperation = 'screen'; x.globalAlpha = 0.25; x.fillStyle = `rgb(${Math.min(255, (r - 1) * 255) | 0},${Math.min(255, (g - 1) * 255) | 0},${Math.min(255, (b - 1) * 255) | 0})`; x.fillRect(0, 0, s.pw, s.ph); x.globalAlpha = 1; }
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(src, sx, sy, s.pw, s.ph, 0, 0, s.pw, s.ph);
  }
  if (tintCache.size > 600) tintCache.clear();
  tintCache.set(key, c);
  return c;
}
function renderObjs(A, objs, W, H, view) {
  const B = Object.fromEntries(['shadow', 'ground', 'blob', 'decor', 'main', 'fx', 'light', 'emissive'].map((k) => [k, new MockBatch()]));
  objs.sort((a, b) => a.y - b.y);
  KIT_ENV.sync = true; // lazy sprites of the preview are painted now
  try { for (const o of objs) drawStatic(B, A, o, 0); } finally { KIT_ENV.sync = false; }
  const c = document.createElement('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const [vx0, vy0, vx1, vy1] = view;
  const Z = Math.min(W / (vx1 - vx0), H / (vy1 - vy0));
  const ox = (W - (vx1 - vx0) * Z) / 2 - vx0 * Z, oy = (H - (vy1 - vy0) * Z) / 2 - vy0 * Z;
  g.imageSmoothingQuality = 'high';
  for (const L of LAYERS) {
    if (L === 'emissive') g.globalCompositeOperation = 'lighter';
    for (const [s, x, y, sx, sy, r, gg, b, a, rot, lift] of B[L].l) {
      if (L === 'blob' && a > 0.6) continue;
      const img = tinted(A, s, r, gg, b);
      g.save();
      g.globalAlpha = Math.min(1, a) * (L === 'emissive' ? 0.6 : 1);
      g.translate(ox + x * Z, oy + (y - lift) * Z);
      if (rot) g.rotate(rot);
      g.scale(s.w * sx * Z, s.h * sy * Z);
      g.drawImage(img, -s.ax, -s.ay, 1, 1);
      g.restore();
    }
  }
  return c.toDataURL();
}
// sample layout for a type: [objects, view rect]
function sample(game, type, style, det, focus) {
  const def = BUILDINGS[type], k = decodeKit(type, style, det);
  const mk = (t, tx, ty, mask, extra = {}) => {
    const o = { type: t, tx, ty, x: tx + 0.5, y: ty + 1, mask, fw: 1, fh: 1, rot: 0, progress: 1, building: true, s: 1, f: 1, v: (tx * 7 + ty * 3) & 7, _k: k.n || k.custom ? k : null, style, det, ...extra };
    if (o._k?.on.carpet) o._cm = mask;
    return o;
  };
  const kit = k.kit;
  if (kit === 'wall' && focus === 'front') return [[mk(type, 0, 0, 2), mk(type, 1, 0, 10), mk(type, 2, 0, 8)], [0.35, -0.5, 2.65, 1.06]];
  if (kit === 'wall') return [[mk(type, 0, 0, 6), mk(type, 1, 0, 10), mk(type, 2, 0, 8), mk(type, 0, 1, 1)], [-0.15, -0.55, 3.15, 2.1]];
  if (kit === 'door') {
    const wall = Object.keys(BUILDINGS).find((t) => BUILDINGS[t].connect === def.connect && BUILDINGS[t].block === 'tile') || 'wall_wood';
    return [[mk(wall, 0, 0, 2, { _k: null }), mk(type, 1, 0, 10, { orient: 'h', door: true, open: 0, _openT: 0 }), mk(wall, 2, 0, 8, { _k: null })], [0.38, -0.62, 2.62, 1.1]];
  }
  if (kit === 'gate') return [[mk('fence_wood', 0, 0, 2, { _k: null }), mk(type, 1, 0, 10, { orient: 'h', door: true, open: 0, _openT: 0 }), mk('fence_wood', 2, 0, 8, { _k: null })], [0.25, -0.95, 2.75, 1.12]];
  if (kit === 'fence') return [[mk(type, 0, 0, 2), mk(type, 1, 0, 10), mk(type, 2, 0, 8)], [0.45, -0.62, 2.55, 1.12]];
  if (kit === 'floor' || kit === 'plot') return [[mk(type, 0, 0, 6), mk(type, 1, 0, 12), mk(type, 0, 1, 3), mk(type, 1, 1, 9)], [-0.1, -0.1, 2.1, 2.1]];
  return [[mk(type, 0, 0, 0)], [-0.6, -1, 1.6, 1.2]];
}
const PREV = new Map();
function preview(game, type, style, det, W = 120, H = 96, focus = '') {
  const key = type + '|' + style + '|' + det + '|' + W + focus;
  let u = PREV.get(key);
  if (u) return u;
  try {
    if (BUILDINGS[type]?.roof) u = roofPreview(game, type, style, det, W, H);
    else {
      const [objs, view] = sample(game, type, style, det, focus);
      u = renderObjs(game.A, objs, W, H, view);
    }
  } catch (e) { console.warn('[detalhes] preview', e); u = ''; }
  if (PREV.size > 400) PREV.clear();
  PREV.set(key, u);
  return u;
}

// roofs are painted per region by agent J's renderer: the card shows a small front-gable house in the style's colours
function roofPreview(game, type, style, det, W, H) {
  const o = { type, style, det };
  const ka = roofArtStyle(o);
  const S = ka?.style || ROOF_STYLES[style] || ROOF_STYLES[Object.keys(ROOF_STYLES).find((k) => ROOF_STYLES[k].type === type)] || ROOF_STYLES.thatch;
  const c = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const rgb = (v, k = 1) => `rgb(${Math.min(255, v[0] * 255 * k) | 0},${Math.min(255, v[1] * 255 * k) | 0},${Math.min(255, v[2] * 255 * k) | 0})`;
  const cx = W / 2, top = H * 0.12, eave = H * 0.62, half = W * 0.42, hip = S.ends === 'hip';
  // walls
  g.fillStyle = '#eadcbf'; g.fillRect(cx - half * 0.86, eave - 2, half * 1.72, H * 0.26);
  g.fillStyle = '#4a2f1c'; g.fillRect(cx - half * 0.86, eave + H * 0.22, half * 1.72, 3); g.fillRect(cx - 5, eave + 6, 10, H * 0.18);
  // roof body
  g.save(); g.beginPath();
  if (hip) { g.moveTo(cx - half, eave); g.lineTo(cx - half * 0.35, top + 6); g.lineTo(cx + half * 0.35, top + 6); g.lineTo(cx + half, eave); }
  else { g.moveTo(cx - half, eave); g.lineTo(cx, top); g.lineTo(cx + half, eave); }
  g.closePath(); g.fillStyle = rgb(S.base); g.fill(); g.clip();
  const rows = S.pattern === 'thatch' ? 9 : 7, rh = (eave - top) / rows;
  for (let r = 0; r < rows; r++) {
    const y = top + r * rh;
    for (let x = -W; x < W * 2; x += S.pattern === 'slab' ? 13 : S.pattern === 'thatch' ? 4 : 9) {
      const xx = x + (r & 1 ? 4.5 : 0);
      g.fillStyle = (r + Math.floor(x / 9)) % 3 ? rgb(S.base) : rgb(S.light, 0.96);
      g.beginPath();
      if (S.pattern === 'scale') g.ellipse(xx, y + rh * 0.7, 4.6, rh * 0.75, 0, 0, Math.PI);
      else if (S.pattern === 'thatch') g.rect(xx, y, 1.6, rh * 1.3);
      else g.rect(xx, y, S.pattern === 'slab' ? 12 : 8, rh - 1);
      g.fill();
      g.strokeStyle = rgb(S.dark); g.lineWidth = 0.8; g.stroke();
    }
  }
  g.restore();
  // gable front (gable ends) with a window
  if (!hip) {
    g.fillStyle = S.gable === 'planks' ? rgb(S.gableCol || [0.6, 0.42, 0.25]) : S.gable === 'stone' ? rgb(S.gableCol || [0.62, 0.6, 0.56]) : rgb(S.gableCol || [0.88, 0.82, 0.7]);
    g.beginPath(); g.moveTo(cx - half * 0.5, eave); g.lineTo(cx, top + (eave - top) * 0.42); g.lineTo(cx + half * 0.5, eave); g.closePath(); g.fill();
    g.fillStyle = '#26303c'; g.fillRect(cx - 4, eave - 13, 8, 8); g.fillStyle = '#5a3b24'; g.fillRect(cx - 0.6, eave - 13, 1.2, 8);
  }
  // ridge + boards
  g.strokeStyle = rgb(S.board || [0.27, 0.17, 0.09]); g.lineWidth = /(^|\.)barge(\.|$)/.test(det) ? 4 : 2.6; g.lineCap = 'round';
  g.beginPath(); if (hip) { g.moveTo(cx - half, eave); g.lineTo(cx - half * 0.35, top + 6); g.lineTo(cx + half * 0.35, top + 6); g.lineTo(cx + half, eave); } else { g.moveTo(cx - half, eave); g.lineTo(cx, top); g.lineTo(cx + half, eave); } g.stroke();
  if (/(^|\.)trim(\.|$)/.test(det)) { g.strokeStyle = '#efe6d0'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx - half, eave + 1.5); g.lineTo(cx + half, eave + 1.5); g.stroke(); }
  if (/(^|\.)moss(\.|$)/.test(det)) { g.fillStyle = 'rgba(86,118,52,0.7)'; for (const [x, y] of [[-0.5, 0.75], [0.3, 0.6], [0.55, 0.85], [-0.2, 0.5]]) { g.beginPath(); g.ellipse(cx + x * half, top + (eave - top) * y, 5, 2.4, 0, 0, Math.PI * 2); g.fill(); } }
  if (/(^|\.)chimney(\.|$)/.test(det)) { g.fillStyle = '#8f887b'; g.fillRect(cx + half * 0.45, top + 8, 9, 18); g.fillStyle = '#3a3530'; g.fillRect(cx + half * 0.45 - 1.5, top + 6, 12, 3); }
  if (/(^|\.)vane(\.|$)/.test(det)) { g.strokeStyle = '#3e3e44'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, top - 9); g.moveTo(cx - 5, top - 7); g.lineTo(cx + 6, top - 7); g.stroke(); }
  const A = game.A, pid = /(^|\.)dormer_pl(\.|$)/.test(det) ? 'dormer_pl' : /(^|\.)dormer(\.|$)/.test(det) ? 'dormer' : null;
  KIT_ENV.sync = true;
  const ps = pid ? archSprite(A, ROOF_PROPS[pid]) : null;
  KIT_ENV.sync = false;
  if (ps) {
    const s = ps, img = tinted(A, s, 1, 1, 1), k = 22 / Math.max(s.pw, s.ph);
    g.drawImage(img, cx - half * 0.62 - s.pw * k / 2, eave - (eave - top) * 0.38 - s.ph * k, s.pw * k, s.ph * k);
  }
  return c.toDataURL();
}

// ---------------- panel ----------------
const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const BRUSH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6-8.5 8.5a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2z"/><path d="M4 20c1-3 2-4 4-4"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
export const DETAILS_ICON = SPARK;

export function installDetails(game) {
  const root = document.getElementById('hud') || document.body;
  if (!document.getElementById('kdet-style')) { const st = document.createElement('style'); st.id = 'kdet-style'; st.textContent = CSS; document.head.appendChild(st); }
  let el = null, S = null; // S: { type, tab, target (blueprint) }
  const touch = () => !!game.input?.isTouch;
  const look = () => {
    if (S.target && !S.target.removed) return [S.target.style || '', S.target.det || ''];
    const m = game.build.mode;
    if (m && (m.kind === 'place' || m.kind === 'brush') && m.type === S.type && !m.move) return [m.style || '', m.det || ''];
    return lastLook(game, S.type);
  };
  const apply = (style, det) => {
    style = normStyle(S.type, style); det = cleanDet(S.type, det);
    setBuildLook(game, S.type, style, det);
    if (S.target && !S.target.removed) {
      if (!S.target.blueprint) { game.events.emit('error', { text: 'Já construída: desmonte e construa de novo para mudar o estilo' }); S.target = null; }
      else game.net.request('struct.style', { ids: [S.target.id], type: S.type, style, det }, { onReject: (why) => why && game.events.emit('error', { text: why }) });
    }
    game.audio?.play('ui_click', {});
    render();
  };
  const close = () => { if (!el) return; el.remove(); el = null; S = null; document.body.classList.remove('kdet-land'); game.audio?.play('ui_close', {}); };
  const tabsOf = (type) => {
    const kit = kitOf(type);
    const sty = stylesFor(type), dets = detailsFor(type);
    return kit.tabs.filter(([cat]) => (cat === 'style' ? sty.length > 1 : dets.some((d) => d.cat === cat)));
  };
  function open(type, opts = {}) {
    if (!hasKit(type)) return;
    const tabs = tabsOf(type);
    if (!tabs.length) { game.events.emit('toast', { text: 'Esta peça não tem estilos', kind: 'info' }); return; }
    S = { type, tab: opts.tab && tabs.some(([c]) => c === opts.tab) ? opts.tab : tabs[0][0], target: opts.target || null };
    if (!el) { el = document.createElement('div'); root.appendChild(el); bind(); game.audio?.play('ui_open', {}); }
    render();
  }
  function bind() {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-k]');
      if (!b || !S) return;
      const [st, dt] = look();
      const k = b.dataset.k, v = b.dataset.v;
      if (k === 'close') { close(); return; }
      if (k === 'tab') { S.tab = v; render(); el.querySelector('.kbody').scrollTop = 0; return; }
      if (k === 'style') { apply(v, dt); return; }
      if (k === 'det') { apply(st, withDetail(S.type, dt, v)); return; }
      if (k === 'clear') { apply('', ''); return; }
      if (k === 'brush') {
        const m = game.build.mode;
        if (m?.kind === 'brush' && m.type === S.type) { exitBuildMode(game); enterBuildMode(game, S.type); }
        else { S.target = null; enterStyleBrush(game, S.type); }
        render(); return;
      }
      if (k === 'build') { const t = S.type; S.target = null; if (game.build.mode?.type !== t || game.build.mode.kind !== 'place') enterBuildMode(game, t); render(); return; }
    });
  }
  function render() {
    if (!el || !S) return;
    const type = S.type, def = BUILDINGS[type], [st, dt] = look();
    el.className = 'kdet ' + (touch() || innerWidth < 760 ? (innerWidth > innerHeight * 1.2 ? 'sheet land' : 'sheet') : 'side');
    document.body.classList.toggle('kdet-land', el.classList.contains('land')); // the story selector moves aside (levelbar.js)
    const tabs = tabsOf(type), dets = detailsFor(type), sty = stylesFor(type);
    const cur = normStyle(type, st), curDet = cleanDet(type, dt);
    const nOn = (cat) => (cat === 'style' ? (cur ? 1 : 0) : dets.filter((d) => d.cat === cat && hasDet(curDet, d.id)).length);
    const tabsHtml = tabs.map(([c, n]) => `<button class="ktab ${S.tab === c ? 'on' : ''}" data-k="tab" data-v="${c}">${n}${nOn(c) ? `<i>●${c === 'style' ? '' : nOn(c)}</i>` : ''}</button>`).join('');
    let body = '';
    if (S.tab === 'style') {
      const sel = cur || sty.find((s) => s.def)?.id;
      body = sty.map((s) => `<button class="kc ${sel === s.id ? 'on' : ''}" data-k="style" data-v="${s.id}" title="${s.desc || ''}"><img src="${preview(game, type, s.def ? '' : s.id, curDet)}" alt=""><span>${s.name}</span></button>`).join('');
      const d = sty.find((s) => s.id === sel)?.desc;
      if (d) body = `<div class="kdesc">${d}</div>` + body;
    } else {
      const list = dets.filter((d) => d.cat === S.tab);
      const groups = [];
      for (const d of list) { const g = d.group || ''; let G = groups.find((x) => x.g === g); if (!G) groups.push(G = { g, items: [] }); G.items.push(d); }
      const GN = { cp: 'Peça de canto (escolha uma)', win: 'Abertura (escolha uma)', mnt: 'Na parede (escolha um)', tone: 'Cor (escolha uma)', brd: 'Borda (escolha uma)', cc: 'Cor do carpete', pc: 'Topo dos postes (escolha um)', pe: 'Borda (escolha uma)', ridge: 'Cumeeira (escolha uma)', ends: 'Forma', gab: 'Empena (escolha uma)', '': '' };
      for (const G of groups) {
        if (groups.length > 1 || G.g) body += `<div class="kgrp">${GN[G.g] ?? ''}</div>`;
        body += G.items.map((d) => {
          const on = hasDet(curDet, d.id);
          const pv = preview(game, type, st, withDetail(type, d.group === 'cc' ? withDetail(type, curDet, 'carpet', true) : curDet, d.id, true), 120, 96, d.front || d.cat === 'wall' ? 'front' : '');
          return `<button class="kc ${on ? 'on' : ''}" data-k="det" data-v="${d.id}" title="${detDesc(type, st, d)}"><img src="${pv}" alt=""><span>${detName(type, st, d)}</span></button>`;
        }).join('');
      }
    }
    const m = game.build.mode;
    const brushing = m?.kind === 'brush' && m.type === type;
    const sName = (sty.find((s) => s.id === (cur || sty.find((x) => x.def)?.id)) || {}).name;
    const nDet = detList(curDet).length;
    const sum = S.target ? 'Mudando esta planta (ainda não construída)' : brushing ? 'Pincel: toque ou arraste sobre plantas azuis' : `${sName ? sName + ' · ' : ''}${nDet ? `${nDet} detalhe${nDet > 1 ? 's' : ''}` : 'sem detalhes'} · grátis`;
    const head = preview(game, type, st, curDet, 96, 80);
    el.innerHTML = `<div class="kh"><img src="${head}" alt=""><div class="kt"><b>Detalhes · ${S.target ? 'Planta: ' : ''}${def.name}</b><small>Estilo e detalhes antes de construir</small></div><button class="kx" data-k="close" title="Fechar">${X}</button></div>
      <div class="ktabs">${tabsHtml}</div><div class="kbody"><div class="kgrid">${body}</div></div>
      <div class="kf"><span class="ksum">${sum}</span>${nDet || cur ? '<button class="kb" data-k="clear">Limpar</button>' : ''}
      <button class="kb ${brushing ? 'on' : ''}" data-k="brush" title="Pintar este estilo em plantas já marcadas">${BRUSH}Pincel</button>
      ${!m || (m.kind !== 'place' && !brushing) || m.type !== type ? `<button class="kb go" data-k="build">Construir</button>` : ''}</div>`;
  }
  game.events.on('details', (d) => { if (d?.type) open(d.type, { target: d.target, tab: d.tab }); });
  game.events.on('buildui', () => {
    if (!el || !S) return;
    const m = game.build.mode;
    if (!m && !S.target) { close(); return; }
    if (m && m.type && m.type !== S.type && hasKit(m.type)) S.type = m.type;
    render();
  });
  game.events.on('closepanels', () => close());
  // a blueprint being edited changed on the host (struct.style arrived, or it was built / removed)
  let rt = 0;
  game.events.on('tile', () => {
    if (!el || !S?.target || rt) return;
    rt = setTimeout(() => { rt = 0; if (S?.target && (S.target.removed || !S.target.blueprint)) S.target = null; render(); }, 60);
  });
  return { open, close, get isOpen() { return !!el; }, toggle(type) { if (el && S?.type === type && !S.target) close(); else open(type); } };
}
