// Kingdom banners (docs/REINOS.md): the realm's banner spec { f: field colour, m: metal 'or'|'argent', d: division,
// c: charge, c2: second colour } painted on a canvas — a hanging banner with a swallowtail, or a shield. Cached as data
// URLs per kingdom and size (the mural panel, the place banner, the map).
import { METALS } from '../world/realm/names.js';

const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const shade = (c, k) => rgb(c.map((v) => Math.max(0, Math.min(255, v * k))));

// the field's divisions and ordinaries (clip already set to the banner's shape)
function field(g, B, W, H) {
  const F = rgb(B.f), M = rgb(METALS[B.m] || METALS.or), C2 = rgb(B.c2 || METALS.argent);
  g.fillStyle = F; g.fillRect(0, 0, W, H);
  g.fillStyle = M;
  switch (B.d) {
    case 'per_pale': g.fillRect(W / 2, 0, W / 2, H); break;
    case 'per_fess': g.fillRect(0, H / 2, W, H / 2); break;
    case 'per_bend': g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.lineTo(W, 0); g.closePath(); g.fill(); break;
    case 'quarterly': g.fillRect(W / 2, 0, W / 2, H / 2); g.fillRect(0, H / 2, W / 2, H / 2); break;
    case 'chevron': g.beginPath(); g.moveTo(0, H * 0.78); g.lineTo(W / 2, H * 0.42); g.lineTo(W, H * 0.78); g.lineTo(W, H * 0.92); g.lineTo(W / 2, H * 0.56); g.lineTo(0, H * 0.92); g.closePath(); g.fill(); break;
    case 'cross': g.fillRect(W * 0.41, 0, W * 0.18, H); g.fillRect(0, H * 0.4, W, H * 0.14); break;
    case 'saltire': g.lineWidth = W * 0.16; g.strokeStyle = M; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H * 0.9); g.moveTo(W, 0); g.lineTo(0, H * 0.9); g.stroke(); break;
    case 'bend': g.lineWidth = W * 0.2; g.strokeStyle = M; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.stroke(); break;
    case 'fess': g.fillRect(0, H * 0.38, W, H * 0.2); break;
    case 'pale': g.fillRect(W * 0.36, 0, W * 0.28, H); break;
    case 'chief': g.fillStyle = C2; g.fillRect(0, 0, W, H * 0.24); break;
    case 'bordure': g.lineWidth = W * 0.12; g.strokeStyle = C2; g.strokeRect(W * 0.06, W * 0.06, W * 0.88, H * 0.86); break;
    default: break;
  }
}
// the charge in the middle (the metal on the field; the field's colour where it stands on metal)
function charge(g, B, W, H) {
  const onMetal = B.d === 'per_pale' || B.d === 'per_fess' || B.d === 'quarterly' || B.d === 'pale';
  const col = onMetal ? rgb(B.c2 || B.f) : rgb(METALS[B.m] || METALS.or);
  const cx = W / 2, cy = H * 0.46, r = Math.min(W, H) * 0.2;
  g.fillStyle = col; g.strokeStyle = 'rgba(30,18,10,0.55)'; g.lineWidth = Math.max(1, W * 0.02);
  g.beginPath();
  switch (B.c) {
    case 'star': for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k & 1 ? r * 0.45 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); break;
    case 'tower': g.rect(cx - r * 0.6, cy - r * 0.6, r * 1.2, r * 1.5); for (let k = 0; k < 3; k++) g.rect(cx - r * 0.6 + k * r * 0.45, cy - r * 0.9, r * 0.3, r * 0.32); break;
    case 'crown': g.moveTo(cx - r, cy + r * 0.5); g.lineTo(cx - r, cy - r * 0.3); g.lineTo(cx - r * 0.5, cy + r * 0.1); g.lineTo(cx, cy - r * 0.6); g.lineTo(cx + r * 0.5, cy + r * 0.1); g.lineTo(cx + r, cy - r * 0.3); g.lineTo(cx + r, cy + r * 0.5); g.closePath(); break;
    case 'roundel': g.arc(cx, cy, r * 0.75, 0, Math.PI * 2); break;
    case 'crescent': g.arc(cx, cy, r * 0.8, 0.4, Math.PI * 2 - 0.4); g.arc(cx + r * 0.35, cy, r * 0.62, Math.PI * 2 - 0.55, 0.55, true); g.closePath(); break;
    case 'lozenge': g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.7, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.7, cy); g.closePath(); break;
    case 'key': g.arc(cx, cy - r * 0.5, r * 0.4, 0, Math.PI * 2); g.rect(cx - r * 0.1, cy - r * 0.15, r * 0.2, r * 1.1); g.rect(cx, cy + r * 0.6, r * 0.35, r * 0.15); break;
    case 'tree': g.arc(cx, cy - r * 0.25, r * 0.7, 0, Math.PI * 2); g.rect(cx - r * 0.12, cy, r * 0.24, r * 0.9); break;
    case 'wheat': for (let k = -1; k <= 1; k++) { g.ellipse(cx + k * r * 0.4, cy - r * 0.35, r * 0.18, r * 0.5, k * 0.3, 0, Math.PI * 2); } g.rect(cx - r * 0.06, cy - r * 0.1, r * 0.12, r * 1.1); break;
    case 'sword': g.rect(cx - r * 0.08, cy - r, r * 0.16, r * 1.5); g.rect(cx - r * 0.5, cy + r * 0.35, r, r * 0.14); g.rect(cx - r * 0.1, cy + r * 0.49, r * 0.2, r * 0.4); break;
    default: return;
  }
  g.fill(); g.stroke();
}

// a hanging banner (swallowtail) W × H on ctx at (x, y)
export function drawBanner(g, B, x, y, W, H) {
  g.save();
  g.translate(x, y);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W / 2, H * 0.84); g.lineTo(0, H); g.closePath();
  g.save(); g.clip(); field(g, B, W, H); charge(g, B, W, H);
  // cloth folds: soft vertical shading
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.18)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.06)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.08)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.restore();
  g.lineWidth = Math.max(1, W * 0.035); g.strokeStyle = shade(B.f, 0.45); g.stroke();
  // the pole on top
  g.fillStyle = '#5b3a1f'; g.fillRect(-W * 0.08, -H * 0.05, W * 1.16, H * 0.06);
  g.fillStyle = '#e8c452'; g.beginPath(); g.arc(-W * 0.08, -H * 0.02, W * 0.05, 0, Math.PI * 2); g.arc(W * 1.08, -H * 0.02, W * 0.05, 0, Math.PI * 2); g.fill();
  g.restore();
}
// a shield W × H (map labels of capitals)
export function drawShield(g, B, x, y, W, H) {
  g.save();
  g.translate(x, y);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H * 0.55); g.quadraticCurveTo(W, H * 0.9, W / 2, H); g.quadraticCurveTo(0, H * 0.9, 0, H * 0.55); g.closePath();
  g.save(); g.clip(); field(g, B, W, H); charge(g, B, W, H); g.restore();
  g.lineWidth = Math.max(1, W * 0.07); g.strokeStyle = '#24160d'; g.stroke();
  g.restore();
}
const URLS = new Map();
export function bannerURL(B, W = 64, H = 96, kind = 'banner') {
  const key = `${kind}|${W}|${H}|${B.f}|${B.m}|${B.d}|${B.c}|${B.c2}`;
  let u = URLS.get(key);
  if (u) return u;
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  const pad = kind === 'banner' ? Math.ceil(W * 0.14) : 2;
  c.width = W + pad * 2; c.height = H + pad * 2;
  const g = c.getContext('2d');
  (kind === 'banner' ? drawBanner : drawShield)(g, B, pad, pad, W, H);
  u = c.toDataURL();
  URLS.set(key, u);
  return u;
}
