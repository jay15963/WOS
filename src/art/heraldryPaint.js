// Heraldic divisions painted on cloth and wood (the kingdoms' guards: the tabard's charge — art/look/body.js — and the
// shield's — art/gear.js). Pure canvas drawing, the same names as world/realm/names.js DIVISIONS: the field is the
// piece's own colour, this fills the other part (the metal) in white (tinted at runtime).

export const DIVS = ['plain', 'per_pale', 'per_fess', 'per_bend', 'quarterly', 'chevron', 'cross', 'saltire', 'bend', 'fess', 'pale', 'chief', 'bordure'];

// the metal part of division d over the box x0..x1 × y0..y1 (the caller clips to the piece's outline)
export function paintDivision(g, d, x0, y0, x1, y1, fill = '#efefef') {
  const w = x1 - x0, h = y1 - y0, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const band = (k) => Math.max(2.2, Math.min(w, h) * k);
  g.fillStyle = fill;
  g.beginPath();
  switch (d) {
    case 'per_pale': g.rect(mx, y0, w / 2, h); break;
    case 'per_fess': g.rect(x0, my, w, h / 2); break;
    case 'per_bend': g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x0, y1); g.closePath(); break;
    case 'quarterly': g.rect(mx, y0, w / 2, h / 2); g.rect(x0, my, w / 2, h / 2); break;
    case 'chevron': { const b = band(0.26); g.moveTo(x0, y1 - h * 0.12); g.lineTo(mx, my - h * 0.12); g.lineTo(x1, y1 - h * 0.12); g.lineTo(x1, y1 - h * 0.12 + b * 1.3); g.lineTo(mx, my - h * 0.12 + b * 1.3); g.lineTo(x0, y1 - h * 0.12 + b * 1.3); g.closePath(); break; }
    case 'cross': { const b = band(0.24); g.rect(mx - b / 2, y0, b, h); g.rect(x0, my - h * 0.08 - b / 2, w, b); break; }
    case 'saltire': { const b = band(0.18); for (const s of [1, -1]) { const ax = s > 0 ? x0 : x1, bx = s > 0 ? x1 : x0; g.moveTo(ax, y0); g.lineTo(ax + s * b, y0); g.lineTo(bx, y1 - b); g.lineTo(bx, y1); g.lineTo(bx - s * b, y1); g.lineTo(ax, y0 + b); g.closePath(); } break; }
    case 'bend': { const b = band(0.2); g.moveTo(x0, y0); g.lineTo(x0 + b, y0); g.lineTo(x1, y1 - b); g.lineTo(x1, y1); g.lineTo(x1 - b, y1); g.lineTo(x0, y0 + b); g.closePath(); break; }
    case 'fess': { const b = band(0.28); g.rect(x0, my - b / 2, w, b); break; }
    case 'pale': { const b = band(0.3); g.rect(mx - b / 2, y0, b, h); break; }
    case 'chief': g.rect(x0, y0, w, h * 0.3); break;
    case 'bordure': { const b = band(0.14); g.rect(x0, y0, w, b); g.rect(x0, y1 - b, w, b); g.rect(x0, y0, b, h); g.rect(x1 - b, y0, b, h); break; }
    default: return;
  }
  g.fill();
}
