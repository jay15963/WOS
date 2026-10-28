// FX sprites. Mostly white/neutral (tinted at runtime); fx_flame / fx_leaf / fx_ember are colored.

import { spritePx, TAU, lin, rad, circle, leaf } from './paint.js';

const softDot = (stops) => (g, W, H) => {
  g.fillStyle = rad(g, W / 2, H / 2, 0, W / 2, stops);
  g.fillRect(0, 0, W, H);
};

function flame(v) {
  return spritePx(32, 52, (g) => {
    const cx = 16, base = 49;
    const tongue = (s, lean, col) => {
      g.beginPath();
      g.moveTo(cx + lean * s, base - 46 * s);
      g.bezierCurveTo(cx + 4 * s + lean * 0.4 * s, base - 30 * s, cx + 13 * s, base - 20 * s, cx + 11 * s, base - 9 * s);
      g.bezierCurveTo(cx + 9 * s, base, cx - 9 * s, base, cx - 11 * s, base - 9 * s);
      g.bezierCurveTo(cx - 13 * s, base - 20 * s, cx - 4 * s + lean * 0.4 * s, base - 30 * s, cx + lean * s, base - 46 * s);
      g.closePath();
      g.fillStyle = col; g.fill();
    };
    const lean = v === 1 ? 3 : v === 2 ? -3 : 0;
    g.save(); g.shadowColor = 'rgba(255,110,20,0.9)'; g.shadowBlur = 8;
    tongue(1.0, lean, 'rgba(230,70,10,0.55)');
    g.restore();
    tongue(0.92, lean, lin(g, 0, base - 44, 0, base, [[0, 'rgba(230,60,10,0)'], [0.25, 'rgba(240,96,20,0.85)'], [1, 'rgba(255,140,30,1)']]));
    tongue(0.68, lean * 0.8, lin(g, 0, base - 32, 0, base, [[0, 'rgba(255,170,40,0)'], [0.3, 'rgba(255,190,60,0.95)'], [1, 'rgba(255,215,110,1)']]));
    tongue(0.4, lean * 0.5, lin(g, 0, base - 20, 0, base, [[0, 'rgba(255,245,200,0)'], [0.4, 'rgba(255,248,215,0.95)'], [1, 'rgba(255,255,240,1)']]));
  });
}

export function addFx(add) {
  // contact shadow (soft dark ellipse)
  add('fx_blob', spritePx(64, 32, (g) => {
    g.save(); g.scale(1, 0.5);
    g.fillStyle = rad(g, 32, 32, 0, 31, [[0, 'rgba(0,0,0,0.62)'], [0.45, 'rgba(0,0,0,0.42)'], [0.75, 'rgba(0,0,0,0.16)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(0, 0, 64, 64); g.restore();
  }), 0.5, 0.5);
  add('fx_soft', spritePx(32, 32, (g) => softDot([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.65)'], [0.7, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']])(g, 32, 32)), 0.5, 0.5);
  add('fx_spark', spritePx(16, 16, (g) => softDot([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']])(g, 16, 16)), 0.5, 0.5);
  add('fx_glow', spritePx(64, 64, (g) => softDot([[0, 'rgba(255,200,120,0.9)'], [0.3, 'rgba(255,150,60,0.45)'], [0.7, 'rgba(200,80,20,0.12)'], [1, 'rgba(160,50,10,0)']])(g, 64, 64)), 0.5, 0.5);
  add('fx_ember', spritePx(12, 12, (g) => softDot([[0, 'rgba(255,240,190,1)'], [0.3, 'rgba(255,170,60,0.95)'], [0.65, 'rgba(230,80,20,0.35)'], [1, 'rgba(200,40,0,0)']])(g, 12, 12)), 0.5, 0.5);
  add('fx_smoke', spritePx(64, 64, (g) => {
    const puffs = [[32, 36, 20], [21, 30, 13], [43, 29, 14], [31, 22, 13], [24, 41, 12], [41, 41, 12]];
    for (const [x, y, r] of puffs) {
      g.fillStyle = rad(g, x - r * 0.25, y - r * 0.3, 0, r, [[0, 'rgba(255,255,255,0.5)'], [0.6, 'rgba(240,240,240,0.3)'], [1, 'rgba(230,230,230,0)']]);
      g.beginPath(); circle(g, x, y, r); g.fill();
    }
  }), 0.5, 0.5);
  add('fx_dust', spritePx(48, 48, (g) => {
    for (const [x, y, r] of [[24, 27, 16], [16, 24, 10], [32, 22, 11], [24, 18, 9]]) {
      g.fillStyle = rad(g, x, y, 0, r, [[0, 'rgba(240,232,215,0.55)'], [0.6, 'rgba(235,225,205,0.25)'], [1, 'rgba(230,220,200,0)']]);
      g.beginPath(); circle(g, x, y, r); g.fill();
    }
  }), 0.5, 0.5);
  add('fx_leaf', spritePx(18, 18, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 3, 3, 15, 15, [[0, '#8db04c'], [1, '#4d7230']]);
    g.beginPath(); leaf(g, 3, 13, 15, 5, 4, 0.5); g.fill();
    g.strokeStyle = 'rgba(40,60,20,0.8)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(4, 12.5); g.lineTo(13.5, 6); g.stroke();
  }, 1.1, 'rgba(30,36,16,0.8)')), 0.5, 0.5);
  add('fx_drop', spritePx(4, 32, (g) => {
    g.fillStyle = lin(g, 0, 0, 0, 32, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0.95)']]);
    g.beginPath(); g.moveTo(2, 0); g.lineTo(3, 30); g.quadraticCurveTo(2, 32, 1, 30); g.closePath(); g.fill();
  }), 0.5, 1);
  add('fx_ring', spritePx(80, 56, (g) => {
    const cx = 40, cy = 28, rx = 36, ry = 24;
    g.save(); g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 5;
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.6;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 5;
    g.beginPath(); g.ellipse(cx, cy, rx - 3.5, ry - 2.5, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,1)';
    for (const [x, y, a] of [[cx, cy - ry, 0], [cx, cy + ry, Math.PI], [cx - rx, cy, -Math.PI / 2], [cx + rx, cy, Math.PI / 2]]) {
      g.save(); g.translate(x, y); g.rotate(a);
      g.beginPath(); g.moveTo(-4, -3.5); g.lineTo(4, -3.5); g.lineTo(0, 3); g.closePath(); g.fill();
      g.restore();
    }
  }), 0.5, 0.5);
  add('fx_splash', spritePx(64, 44, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(32, 32, 24, 9, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(32, 32, 15, 5.5, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [x, y, r] of [[22, 18, 2.2], [32, 11, 2.6], [42, 17, 2.1], [27, 6, 1.5], [38, 7, 1.4], [16, 25, 1.6], [48, 24, 1.6]]) { g.beginPath(); g.ellipse(x, y, r * 0.8, r * 1.2, 0, 0, TAU); g.fill(); }
  }), 0.5, 0.72);
  add('fx_slash', spritePx(80, 80, (g) => {
    // crescent arc over the top (opening toward the bottom); rotate at runtime toward the hit direction
    const cx = 40, cy = 46;
    const cres = () => { g.beginPath(); g.arc(cx, cy, 32, Math.PI * 1.08, Math.PI * 1.92); g.quadraticCurveTo(cx + 18, cy - 20, cx, cy - 22); g.quadraticCurveTo(cx - 18, cy - 20, cx + Math.cos(Math.PI * 1.08) * 32, cy + Math.sin(Math.PI * 1.08) * 32); g.closePath(); };
    g.save(); g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 7;
    cres(); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill(); g.restore();
    g.beginPath(); g.arc(cx, cy, 31, Math.PI * 1.15, Math.PI * 1.85); g.quadraticCurveTo(cx + 14, cy - 24, cx, cy - 26); g.quadraticCurveTo(cx - 14, cy - 24, cx + Math.cos(Math.PI * 1.15) * 31, cy + Math.sin(Math.PI * 1.15) * 31); g.closePath();
    g.fillStyle = 'rgba(255,255,255,1)'; g.fill();
  }), 0.5, 0.5);
  add('fx_star', spritePx(32, 32, (g) => {
    g.fillStyle = rad(g, 16, 16, 0, 16, [[0, 'rgba(255,255,255,0.7)'], [0.4, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2, r = i % 2 ? 3 : 15;
      const x = 16 + Math.cos(a) * r, y = 16 + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
  }), 0.5, 0.5);
  for (let i = 0; i < 3; i++) add('fx_flame_' + i, flame(i), 0.5, 49 / 52);
  // contract name (single flame) = variant 0
  add('fx_flame', flame(0), 0.5, 49 / 52);
}
